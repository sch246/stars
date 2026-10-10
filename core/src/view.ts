// 视图 = 一个纯函数:evaluateView(宇宙, 视图规格, 展开状态) -> 场景(scene)。
// 显示什么、多大、什么颜色、关系怎么画、容器展开还是收起,全由规格里的"有序规则"决定(规格的写法见 viewspec.ts)。
// 分四步:图的索引(viewgraph.ts)→ 外观(这里:选择、大小、颜色、形状、边的画法;规则里的表达式见 viewexpr.ts)
// → 折叠与空间(viewfold.ts)。这些文件同时在 Node(CLI)和浏览器(查看器)里运行:不碰 DOM、不碰文件系统。

import { type Node, type Universe, isSchemaId, schemaNode } from './model.ts';
import { STYLE_DEFAULT_SHAPES, STYLE_MODES } from './styles.ts';
import { SHAPES, type CompileOptions, type CompiledView, type EvalOptions, type RelationMode, type RelationRule, type Scene, type Shape, type ViewSpec, type When } from './viewspec.ts';
import { indexGraph, rollupArr } from './viewgraph.ts';
import { viewExprs } from './viewexpr.ts';
import { viewFolder, type EdgeLook, type Looks } from './viewfold.ts';

const DEFAULT_COLOR = '#cfd8ff';

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function hashColor(s: string): string {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return hslToHex(h % 360, 0.8, 0.62);
}

const DAY_MS = 86_400_000;

/** 时间戳 -> 新鲜度:刚发生 = 1,每过一个半衰期减半;没有记录 = 0。 */
export function recencyWeight(t: number | undefined, halfLifeDays: number, now: number): number {
  if (!t) return 0;
  return 0.5 ** (Math.max(0, now - t) / DAY_MS / Math.max(halfLifeDays, 0.001));
}

function toRgb(h: string): [number, number, number] {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function mixHex(a: string, b: string, t: number): string {
  const [x, y] = [toRgb(a), toRgb(b)];
  return '#' + [0, 1, 2].map((i) => Math.round(x[i]! + (y[i]! - x[i]!) * t).toString(16).padStart(2, '0')).join('');
}

function scaleValue(v: number, max: number, scale: 'sqrt' | 'log' | 'linear', [lo, hi]: [number, number]): number {
  if (max <= 0) return lo;
  const t = scale === 'log' ? Math.log1p(v) / Math.log1p(max) : scale === 'linear' ? v / max : Math.sqrt(v / max);
  return lo + (hi - lo) * Math.max(0, Math.min(1, t));
}

/** 规则前提编译成函数 (节点, 下标) => 是否匹配:避免对每个节点 Object.entries;字符串前提是表达式。 */
type Pred = (n: Node, i: number) => boolean;
function compileWhen(when: When | undefined, exprFor: (src: string) => (i: number) => unknown): Pred | null {
  if (!when) return null;
  if (typeof when === 'string') { const f = exprFor(when); return (_n, i) => !!f(i); }
  const ents = Object.entries(when);
  if (ents.length === 0) return null;
  const get = (n: Node, k: string) => (k === 'id' ? n.id : k === 'label' ? n.label : n.attrs[k]);
  if (ents.length === 1) {
    const [k, v] = ents[0]!;
    if (k === 'type') return (n) => n.attrs.type === v;
    return (n) => get(n, k) === v;
  }
  return (n) => ents.every(([k, v]) => get(n, k) === v);
}
const firstMatch = (preds: Array<Pred | null>, n: Node, i: number): number => {
  for (let k = 0; k < preds.length; k++) {
    const p = preds[k]!;
    if (p === null || p(n, i)) return k;
  }
  return -1;
};

/**
 * 编译:把"每个节点长什么样"一次算好,存成类型化数组。
 * 性能约定:宇宙或规格或信号变了才重新编译;展开/收起只调用 fold()。
 */
export function compileView(u: Universe, spec: ViewSpec, opts: CompileOptions = {}): CompiledView {
  const now = opts.now ?? Date.now();
  const g = indexGraph(u, spec.expand?.relation ?? 'contains');
  const { N, nodeList, ids, idx, E, ef, et, ety, typeNames, typeIdx, tSym, relation, parent, depth, order, treeKids } = g;
  const sel = spec.select ?? {};

  // ---- 关系规则:每种边类型查一次 ----
  // 边类型的外观:视图里专门写了这种边的规则 > 类型节点(~类型)上的 color / width / arrow / mode > 视图的兜底规则 *
  const schemaRel = (t: string): Partial<RelationRule> => {
    const a = schemaNode(u, t)?.attrs;
    if (!a) return {};
    const r: Partial<RelationRule> = {};
    if (a.color && /^#[0-9a-fA-F]{6}$/.test(a.color)) r.color = a.color;
    if (a.width && Number(a.width) > 0) r.width = Number(a.width);
    if (a.arrow === 'true' || a.arrow === 'false') r.arrow = a.arrow === 'true';
    if (a.mode && STYLE_MODES.includes(a.mode)) r.mode = a.mode as RelationMode;
    return r;
  };
  const relOf = (t: string): RelationRule => {
    const own = spec.relations?.[t];
    return own ? { ...schemaRel(t), ...own } : { ...(spec.relations?.['*'] ?? { mode: 'line' }), ...schemaRel(t) };
  };
  const tRel = typeNames.map(relOf);
  const tShown = tRel.map((r) => r.mode !== 'hidden');

  // ---- 度数:全图里"会显示的"边的条数。静态的,所以展开/收起时节点大小不会跳变 ----
  const degree = new Int32Array(N);
  for (let e = 0; e < E; e++) if (tShown[ety[e]!]) { degree[ef[e]!]!++; degree[et[e]!]!++; }

  const X = viewExprs(g, degree, opts, now);
  const { exprFor, attrArr, signalArr } = X;
  const whereFn = sel.where ? exprFor(sel.where) : null;

  // ---- 选择:哪些节点有资格出现 ----
  const selected = new Uint8Array(N);
  let hasRel: Uint8Array | null = null;
  if (sel.withRelations) {
    const want = new Set(sel.withRelations.map((t) => typeIdx.get(t)).filter((x): x is number => x !== undefined));
    hasRel = new Uint8Array(N);
    for (let e = 0; e < E; e++) if (want.has(ety[e]!)) { hasRel[ef[e]!] = 1; hasRel[et[e]!] = 1; }
  }
  for (let i = 0; i < N; i++) {
    const n = nodeList[i]!, type = n.attrs.type ?? '';
    selected[i] = (isSchemaId(n.id) && !sel.schema) || (sel.onlyTypes && !sel.onlyTypes.includes(type)) || sel.hideTypes?.includes(type)
      || (hasRel && !hasRel[i]) || (whereFn && !whereFn(i)) ? 0 : 1;
  }

  // ---- 大小:每条规则在自己匹配到的节点里独立归一化 ----
  const sizeRules = spec.size ?? [];
  const sizePreds = sizeRules.map((r) => compileWhen(r.when, exprFor));
  const ruleVals = sizeRules.map((r): Float64Array => {
    if (r.expr) {
      const f = exprFor(r.expr), out = new Float64Array(N);
      for (let i = 0; i < N; i++) { const v = Number(f(i)); out[i] = Number.isFinite(v) ? v : 0; }
      return out;
    }
    if (r.signal) {
      const raw = signalArr(r.signal, r.rollup);
      if (!r.recency) return raw;
      const out = new Float64Array(N);
      for (let i = 0; i < N; i++) out[i] = recencyWeight(raw[i], r.recency.halfLifeDays, now);
      return out;
    }
    if (r.by === 'degree' || (!r.attr && !r.rollup)) return Float64Array.from(degree);
    if (r.rollup) return rollupArr(N, g.adjOf(r.rollup.relation), r.rollup.op, r.attr ? attrArr(r.attr) : null);
    return attrArr(r.attr!);
  });
  const sizeRule = new Int16Array(N).fill(-1);
  const maxByRule = new Float64Array(sizeRules.length);
  for (let i = 0; i < N; i++) {
    if (!selected[i]) continue;
    const k = firstMatch(sizePreds, nodeList[i]!, i);
    sizeRule[i] = k;
    if (k >= 0) maxByRule[k] = sizeRules[k]!.recency ? 1 : Math.max(maxByRule[k]!, ruleVals[k]![i]!);
  }
  const rad = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const k = sizeRule[i]!;
    if (k < 0) { rad[i] = 3.5; continue; }
    const r = sizeRules[k]!;
    rad[i] = scaleValue(ruleVals[k]![i]!, maxByRule[k]!, r.scale ?? 'sqrt', r.range ?? [2, 10]);
  }
  // 大小倍率:节点自己的 scale,其次类型节点的 scale(在"类型"面板里调)
  const typeAttr = new Map<string, Record<string, string | undefined>>();
  const ofType = (type: string | undefined): Record<string, string | undefined> => {
    if (!type) return {};
    let a = typeAttr.get(type);
    if (!a) { a = schemaNode(u, type)?.attrs ?? {}; typeAttr.set(type, a); }
    return a;
  };
  for (let i = 0; i < N; i++) {
    const n = nodeList[i]!;
    const sc = n.attrs.scale ?? ofType(n.attrs.type).scale;
    if (sc === undefined) continue;
    const x = Number(sc);
    if (Number.isFinite(x) && x > 0) rad[i] = rad[i]! * x;
  }

  // ---- 颜色 ----
  const colorRules = spec.color ?? [];
  const colorPreds = colorRules.map((r) => compileWhen(r.when, exprFor));
  const hashMemo = new Map<string, string>();
  const hc = (s: string) => { let c = hashMemo.get(s); if (c === undefined) { c = hashColor(s); hashMemo.set(s, c); } return c; };
  const typeColor = new Map<string, string>();
  const colorOfType = (type: string | undefined): string => {
    if (!type) return DEFAULT_COLOR;
    let c = typeColor.get(type);
    if (c === undefined) { c = schemaNode(u, type)?.attrs.color ?? hc(type); typeColor.set(type, c); }
    return c;
  };
  const groupAnc = new Map<string, Int32Array>();
  const ancOf = (relName: string, level: number): Int32Array => {
    const key = `${relName}|${level}`;
    let anc = groupAnc.get(key);
    if (anc) return anc;
    anc = new Int32Array(N);
    if (relName === relation) {
      for (let k = 0; k < N; k++) { const v = order[k]!; anc[v] = depth[v]! <= level ? v : anc[parent[v]!]!; }
    } else {
      const par = new Int32Array(N).fill(-1), t = typeIdx.get(relName);
      if (t !== undefined) for (let e = 0; e < E; e++) if (ety[e] === t && par[et[e]!] === -1) par[et[e]!] = ef[e]!;
      for (let v = 0; v < N; v++) {
        const chain = [v]; const seen = new Set(chain);
        for (let c = par[v]!; c >= 0 && !seen.has(c); c = par[c]!) { chain.push(c); seen.add(c); }
        chain.reverse();
        anc[v] = chain[Math.min(level, chain.length - 1)]!;
      }
    }
    groupAnc.set(key, anc);
    return anc;
  };
  const recencyTables = new Map<number, string[]>();
  const color: string[] = new Array(N);
  const colorRuleOf = new Int16Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (!selected[i]) { color[i] = DEFAULT_COLOR; continue; }
    const n = nodeList[i]!;
    const k = firstMatch(colorPreds, n, i);
    colorRuleOf[i] = k;
    const cr = k >= 0 ? colorRules[k]! : undefined;
    // 没有规则管它:节点自己或类型节点写了颜色就用(改类型颜色在没写颜色规则的视图里也看得见)
    let c = k < 0 ? (n.attrs.color ?? ofType(n.attrs.type).color ?? DEFAULT_COLOR) : DEFAULT_COLOR;
    if (cr?.expr) {
      const v = exprFor(cr.expr)(i);
      if (typeof v === 'number') {
        let table = recencyTables.get(k);
        if (!table) { table = Array.from({ length: 64 }, (_, q) => mixHex(cr.from ?? '#2f3b6e', cr.to ?? '#ffcf70', q / 63)); recencyTables.set(k, table); }
        c = table[Math.round(Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) * 63)]!;
      } else if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) c = v;
    } else if (cr?.value) c = cr.value;
    else if (cr?.by === 'type') c = n.attrs.color ?? colorOfType(n.attrs.type);
    else if (cr?.by === 'recency') {
      let table = recencyTables.get(k);
      if (!table) {
        table = Array.from({ length: 64 }, (_, q) => mixHex(cr.from ?? '#2f3b6e', cr.to ?? '#ffcf70', q / 63));
        recencyTables.set(k, table);
      }
      const raw = signalArr(cr.signal ?? 'touched', cr.rollup)[i]!;
      c = table[Math.round(recencyWeight(raw, cr.halfLifeDays ?? 14, now) * 63)]!;
    } else if (cr?.by === 'group') c = hc(ids[ancOf(cr.relation ?? 'contains', cr.level ?? 1)[i]!]!);
    else if (cr?.by?.startsWith('attr:')) { const v = n.attrs[cr.by.slice(5)]; c = v ? hc(v) : DEFAULT_COLOR; }
    color[i] = c;
  }

  // ---- 样式 ----
  const styleRules = spec.style ?? [];
  const stylePreds = styleRules.map((r) => compileWhen(r.when, exprFor));
  const shapeIdx = new Uint8Array(N);
  const styleRuleOf = new Int16Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    const n = nodeList[i]!;
    const k = selected[i] ? firstMatch(stylePreds, n, i) : -1;
    styleRuleOf[i] = k;
    const rule = k >= 0 ? styleRules[k]! : undefined;
    const own = n.attrs.shape ?? ofType(n.attrs.type).shape;   // 节点自己 / 类型节点写的形状
    const shape = rule?.expr ? String(exprFor(rule.expr)(i))
      : rule?.by === 'type' ? own ?? STYLE_DEFAULT_SHAPES[n.attrs.type ?? ''] : rule ? rule.shape : own;
    const si = SHAPES.indexOf((shape ?? 'star') as Shape);
    shapeIdx[i] = si >= 0 ? si : 1;
  }

  // ---- 边的画法:每种类型一份 ----
  const edge = tRel.map((rel, t): EdgeLook => ({
    mode: rel.mode,
    color: rel.color ?? hashColor(`edge:${typeNames[t]!}`),
    width: rel.width ?? 1,
    arrow: rel.arrow ?? (rel.mode === 'line' && !tSym[t]),
    distance: rel.distance, strength: rel.strength, spin: rel.spin,
  }));
  const value = new Float64Array(N).fill(NaN);
  for (let i = 0; i < N; i++) { const k = sizeRule[i]!; if (k >= 0) value[i] = ruleVals[k]![i]!; }
  const looks: Looks = { selected, rad, color, shape: shapeIdx, value, edge };
  const F = viewFolder(g, looks, spec);

  return {
    nodeCount: N, edgeCount: E, fold: F.fold, space: F.space, matches: X.matches, queryResults: X.queryResults,
    layout: spec.layout ?? 'flat',
    look: spec.look ?? 'galaxy',
    enterAt: spec.space?.enterAt ?? 0.42,
    ancestors: (id) => { const i = idx.get(id); return i === undefined ? [] : g.chainOf(i).map((v) => ids[v]!); },
    node: (id) => { const i = idx.get(id); return i === undefined ? undefined : F.node(i); },
    parentOf: (id) => { const i = idx.get(id); return i === undefined || parent[i]! < 0 ? undefined : ids[parent[i]!]!; },
    children: (id) => { const i = idx.get(id), out: string[] = []; if (i !== undefined) for (let k = treeKids.start[i]!; k < treeKids.start[i + 1]!; k++) out.push(ids[treeKids.list[k]!]!); return out; },
    relation,
    explain: (id) => { const i = idx.get(id); return i === undefined ? undefined : { size: sizeRule[i]!, color: colorRuleOf[i]!, style: styleRuleOf[i]! }; },
  };
}

/** 一步到位:编译 + 折叠。交互场景请自己持有 compileView 的结果,展开/收起只调 fold。 */
export function evaluateView(u: Universe, spec: ViewSpec, opts: EvalOptions = {}): Scene {
  return compileView(u, spec, opts).fold(opts);
}
