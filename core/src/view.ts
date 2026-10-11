// 视图 = 一个纯函数:evaluateView(宇宙, 视图规格, 展开状态) -> 场景(scene)。
// 显示什么、多大、什么颜色、关系怎么画、容器展开还是收起,全由规格里的"有序规则"决定(规格的写法见 viewspec.ts),
// 规格可以叠在另一个视图上(base)、带一个视图脚本(script):叠成几层,见 viewlayers.ts;脚本的写法见 viewscript.ts。
// 分四步:图的索引(viewgraph.ts)→ 外观(这里:选择、大小、颜色、形状、名字、边的画法,逐层算;规则里的表达式见 viewexpr.ts)
// → 折叠与空间(viewfold.ts)。这些文件同时在 Node(CLI)和浏览器(查看器)里运行:不碰 DOM、不碰文件系统。

import { type Node, type Universe, isSchemaId, schemaNode } from './model.ts';
import { hashHex, mixHexColors } from './expr.ts';
import { STYLE_DEFAULT_SHAPES, STYLE_MODES } from './styles.ts';
import { SHAPES, type ColorRule, type CompileOptions, type CompiledView, type EvalOptions, type Explain, type RelationMode, type RelationRule, type Scene, type Shape, type SizeRule, type StepName, type StyleRule, type ViewSpec, type When } from './viewspec.ts';
import { indexGraph, rollupArr } from './viewgraph.ts';
import { viewExprs } from './viewexpr.ts';
import { viewFolder, type EdgeLook, type Looks } from './viewfold.ts';
import { resolveView } from './viewlayers.ts';
import { scaleValue, scriptRun, viewModuleOf, VIEW_HOOKS, type ViewModule } from './viewscript.ts';

const DEFAULT_COLOR = '#cfd8ff';

/** 字符串 → 颜色(同一个字符串总是同一种颜色;和表达式里的 hash() 一样) */
export const hashColor = hashHex;
export const mixHex = mixHexColors;

const DAY_MS = 86_400_000;

/** 时间戳 -> 新鲜度:刚发生 = 1,每过一个半衰期减半;没有记录 = 0。 */
export function recencyWeight(t: number | undefined, halfLifeDays: number, now: number): number {
  if (!t) return 0;
  return 0.5 ** (Math.max(0, now - t) / DAY_MS / Math.max(halfLifeDays, 0.001));
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
 * 逐节点的三步(大小、颜色、形状)按层算:从最上层往下找第一条匹配的规则(都不匹配 = 默认),再从那一层往上依次过脚本函数。
 */
export function compileView(u: Universe, spec: ViewSpec, opts: CompileOptions = {}): CompiledView {
  const now = opts.now ?? Date.now();
  const R = resolveView(u, spec, opts.modules, opts.name, opts.mapLayer);
  const S = R.spec, layers = R.layers, nL = layers.length;
  const g = indexGraph(u, S.expand?.relation ?? 'contains');
  const { N, nodeList, ids, idx, E, ef, et, ety, typeNames, typeIdx, tSym, relation, parent, depth, order, treeKids } = g;
  const sel = S.select ?? {};

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
    const own = S.relations?.[t];
    const r = own ? { ...schemaRel(t), ...own } : { ...(S.relations?.['*'] ?? { mode: 'line' }), ...schemaRel(t) };
    if (!r.mode) r.mode = 'line';   // 上层只改了颜色、下层也没写画法
    return r;
  };
  const tRel = typeNames.map(relOf);

  // ---- 视图脚本:有导出函数的层才建 n / v ----
  const warnings: string[] = [...R.missing.map((p) => `视图脚本 ${p} 还没加载(先只用规则算)`), ...R.errors];
  for (const L of layers) if (L.module) { const probs: string[] = []; viewModuleOf(L.module as Record<string, unknown>, probs); for (const m of probs) warnings.push(`${L.script}: ${m}`); }
  const hookOf = (h: keyof ViewModule) => layers.map((L) => {
    const f = L.module?.[h];
    return typeof f === 'function' ? (f as (...a: unknown[]) => unknown).bind(L.module) : null;
  });
  const hooks = Object.fromEntries(VIEW_HOOKS.map((h) => [h, hookOf(h)])) as Record<typeof VIEW_HOOKS[number], Array<((...a: unknown[]) => unknown) | null>>;
  const anyHook = VIEW_HOOKS.some((h) => h !== 'forces' && h !== 'edge' && hooks[h].some(Boolean));
  const scriptOf = (li: number) => layers[li]!.script!;
  const runOpts = { params: R.params, spec: S, now }, sigNames = Object.keys(opts.signals ?? {});

  // ---- 边的画法:每种类型一份;脚本的 edge() 逐层改。在算度数之前:被它藏起来的边不算度数(所以 edge() 里读到的度数都是 0) ----
  const edge = tRel.map((rel, t): EdgeLook => ({
    mode: rel.mode,
    color: rel.color ?? hashColor(`edge:${typeNames[t]!}`),
    width: rel.width ?? 1,
    arrow: rel.arrow ?? (rel.mode === 'line' && !tSym[t]),
    distance: rel.distance, strength: rel.strength, spin: rel.spin,
  }));
  if (hooks.edge.some(Boolean)) {
    const pre = scriptRun(g, viewExprs(g, new Int32Array(N), opts, now), sigNames, runOpts);   // 用完就扔:缓存里不会留下度数为 0 时算的东西
    for (let li = 0; li < nL; li++) {
      const f = hooks.edge[li];
      if (f) for (let t = 0; t < edge.length; t++) {
        const r = pre.call(scriptOf(li), 'edge', f, typeNames[t], pre.v, { ...edge[t] }, typeNames[t]) as Partial<EdgeLook> | undefined;
        if (r) edge[t] = mergeEdge(edge[t]!, r);
      }
    }
    warnings.push(...pre.finish());
  }

  // ---- 度数:全图里"会显示的"边的条数。静态的,所以展开/收起时节点大小不会跳变 ----
  const degree = new Int32Array(N);
  for (let e = 0; e < E; e++) if (edge[ety[e]!]!.mode !== 'hidden') { degree[ef[e]!]!++; degree[et[e]!]!++; }

  const X = viewExprs(g, degree, opts, now);
  const { exprFor, attrArr, signalArr } = X;
  const whereFn = sel.where ? exprFor(sel.where) : null;
  const run = anyHook ? scriptRun(g, X, sigNames, runOpts) : null;

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
  for (let li = 0; li < nL; li++) {
    const f = hooks.select[li];
    if (!f || !run) continue;
    for (let i = 0; i < N; i++) {
      if (isSchemaId(ids[i]!)) continue;
      const r = run.call(scriptOf(li), 'select', f, run.node(i), run.v, selected[i] === 1, ids[i]);
      if (r !== undefined) selected[i] = r ? 1 : 0;
    }
  }

  /**
   * 一步的规则:每层的规则列表编译好,对每个入选节点从最上层往下找第一条匹配的(layer / rule,都不匹配 = -1)。
   * 单层的视图就是以前的"第一条匹配的规则生效"。
   */
  const decide = <T extends { when?: When }>(key: StepName) => {
    const rules = layers.map((L) => (L.spec[key] ?? []) as T[]);
    const preds = rules.map((rs) => rs.map((r) => compileWhen(r.when, exprFor)));
    const layer = new Int8Array(N).fill(-1), rule = new Int16Array(N).fill(-1);
    for (let i = 0; i < N; i++) {
      if (!selected[i]) continue;
      for (let li = nL - 1; li >= 0; li--) {
        if (!rules[li]!.length) continue;
        const k = firstMatch(preds[li]!, nodeList[i]!, i);
        if (k >= 0) { layer[i] = li; rule[i] = k; break; }
      }
    }
    return { rules, layer, rule };
  };
  /** 从决定的那一层(没有 = 最底层)起往上,依次过脚本函数;返回改过它的最上一层(-1 = 没改) */
  const changedBy = (step: 'size' | 'color' | 'shape' | 'label') => (run && hooks[step].some(Boolean) ? new Int8Array(N).fill(-1) : null);
  const applyHooks = <V>(step: 'size' | 'color' | 'shape' | 'label', i: number, from: number, val: V, by: Int8Array | null): V => {
    if (!by) return val;
    for (let li = Math.max(from, 0); li < nL; li++) {
      const f = hooks[step][li];
      if (!f) continue;
      const r = run!.call(scriptOf(li), step, f, run!.node(i), run!.v, val, ids[i]);
      if (r !== undefined) { val = r as V; by[i] = li; }
    }
    return val;
  };

  // ---- 大小:每条规则在它决定的节点里独立归一化 ----
  const SZ = decide<SizeRule>('size');
  const ruleVals = SZ.rules.map((rs) => rs.map((r): Float64Array => {
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
  }));
  const maxByRule = SZ.rules.map((rs) => new Float64Array(rs.length));
  for (let i = 0; i < N; i++) {
    const li = SZ.layer[i]!, k = SZ.rule[i]!;
    if (k >= 0) maxByRule[li]![k] = SZ.rules[li]![k]!.recency ? 1 : Math.max(maxByRule[li]![k]!, ruleVals[li]![k]![i]!);
  }
  const rad = new Float32Array(N), sizeBy = changedBy('size');
  for (let i = 0; i < N; i++) {
    const li = SZ.layer[i]!, k = SZ.rule[i]!;
    let r = 3.5;
    if (k >= 0) { const rule = SZ.rules[li]![k]!; r = scaleValue(ruleVals[li]![k]![i]!, maxByRule[li]![k]!, rule.scale ?? 'sqrt', rule.range ?? [2, 10]); }
    rad[i] = selected[i] ? applyHooks('size', i, li, r, sizeBy) : r;
  }
  // 大小倍率:节点自己的 scale,其次类型节点的 scale(在"类型"面板里调);脚本给的半径也乘
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
  const CL = decide<ColorRule>('color');
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
  const recencyTables = new Map<ColorRule, string[]>();
  const rampOf = (cr: ColorRule): string[] => {
    let table = recencyTables.get(cr);
    if (!table) { table = Array.from({ length: 64 }, (_, q) => mixHex(cr.from ?? '#2f3b6e', cr.to ?? '#ffcf70', q / 63)); recencyTables.set(cr, table); }
    return table;
  };
  const color: string[] = new Array(N), colorBy = changedBy('color');
  for (let i = 0; i < N; i++) {
    if (!selected[i]) { color[i] = DEFAULT_COLOR; continue; }
    const n = nodeList[i]!, li = CL.layer[i]!, k = CL.rule[i]!;
    const cr = k >= 0 ? CL.rules[li]![k]! : undefined;
    // 没有规则管它:节点自己或类型节点写了颜色就用(改类型颜色在没写颜色规则的视图里也看得见)
    let c = k < 0 ? (n.attrs.color ?? ofType(n.attrs.type).color ?? DEFAULT_COLOR) : DEFAULT_COLOR;
    if (cr?.expr) {
      const v = exprFor(cr.expr)(i);
      if (typeof v === 'number') c = rampOf(cr)[Math.round(Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) * 63)]!;
      else if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) c = v;
    } else if (cr?.value) c = cr.value;
    else if (cr?.by === 'type') c = n.attrs.color ?? colorOfType(n.attrs.type);
    else if (cr?.by === 'recency') {
      const raw = signalArr(cr.signal ?? 'touched', cr.rollup)[i]!;
      c = rampOf(cr)[Math.round(recencyWeight(raw, cr.halfLifeDays ?? 14, now) * 63)]!;
    } else if (cr?.by === 'group') c = hc(ids[ancOf(cr.relation ?? 'contains', cr.level ?? 1)[i]!]!);
    else if (cr?.by?.startsWith('attr:')) { const v = n.attrs[cr.by.slice(5)]; c = v ? hc(v) : DEFAULT_COLOR; }
    color[i] = applyHooks('color', i, li, c, colorBy);
  }

  // ---- 形状 ----
  const ST = decide<StyleRule>('style');
  const shapeIdx = new Uint8Array(N), shapeBy = changedBy('shape');
  for (let i = 0; i < N; i++) {
    const n = nodeList[i]!, li = ST.layer[i]!, k = ST.rule[i]!;
    const rule = k >= 0 ? ST.rules[li]![k]! : undefined;
    const own = n.attrs.shape ?? ofType(n.attrs.type).shape;   // 节点自己 / 类型节点写的形状
    let shape = rule?.expr ? String(exprFor(rule.expr)(i))
      : rule?.by === 'type' ? own ?? STYLE_DEFAULT_SHAPES[n.attrs.type ?? ''] : rule ? rule.shape : own;
    if (selected[i] && shapeBy) shape = applyHooks('shape', i, li, (SHAPES.includes(shape as Shape) ? shape : 'star') as string, shapeBy);
    const si = SHAPES.indexOf((shape ?? 'star') as Shape);
    shapeIdx[i] = si >= 0 ? si : 1;
  }

  // ---- 名字:只有脚本能改 ----
  const labelBy = changedBy('label');
  let label: string[] | undefined;
  if (labelBy) {
    label = nodeList.map((n) => n.label);
    for (let i = 0; i < N; i++) if (selected[i]) label[i] = applyHooks('label', i, 0, label[i]!, labelBy);
  }

  const value = new Float64Array(N).fill(NaN);
  for (let i = 0; i < N; i++) { const li = SZ.layer[i]!, k = SZ.rule[i]!; if (k >= 0) value[i] = ruleVals[li]![k]![i]!; }
  const looks: Looks = { selected, rad, color, shape: shapeIdx, value, edge, ...(label ? { label } : {}) };
  // ---- looks():最后一次,整列改 ----
  if (run) for (let li = 0; li < nL; li++) {
    const f = hooks.looks[li];
    if (!f) continue;
    looks.label ??= nodeList.map((n) => n.label);
    run.call(scriptOf(li), 'looks', f, { N, E, ids, parent, depth, degree, ef, et, ety, typeNames }, run.v, looks);
  }
  if (run) warnings.push(...run.finish());
  const F = viewFolder(g, looks, S);

  const forces = hooks.forces.filter((f): f is NonNullable<typeof f> => !!f) as unknown as CompiledView['forces'];
  const stepNames: StepName[] = ['size', 'color', 'style'];
  const decided = { size: SZ, color: CL, style: ST };
  const by = { size: sizeBy, color: colorBy, style: shapeBy, label: labelBy };
  return {
    nodeCount: N, edgeCount: E, fold: F.fold, space: F.space, matches: X.matches, queryResults: X.queryResults,
    layout: S.layout ?? 'flat',
    look: S.look ?? 'galaxy',
    enterAt: S.space?.enterAt ?? 0.42,
    ancestors: (id) => { const i = idx.get(id); return i === undefined ? [] : g.chainOf(i).map((v) => ids[v]!); },
    node: (id) => { const i = idx.get(id); return i === undefined ? undefined : F.node(i); },
    parentOf: (id) => { const i = idx.get(id); return i === undefined || parent[i]! < 0 ? undefined : ids[parent[i]!]!; },
    children: (id) => { const i = idx.get(id), out: string[] = []; if (i !== undefined) for (let k = treeKids.start[i]!; k < treeKids.start[i + 1]!; k++) out.push(ids[treeKids.list[k]!]!); return out; },
    relation,
    explain: (id) => {
      const i = idx.get(id);
      if (i === undefined) return undefined;
      const ex: Explain = { size: SZ.rule[i]!, color: CL.rule[i]!, style: ST.rule[i]! };
      if (nL > 1) ex.layer = Object.fromEntries(stepNames.map((s) => [s, decided[s].rule[i]! >= 0 ? layers[decided[s].layer[i]!]!.name : ''])) as Explain['layer'];
      const sc: NonNullable<Explain['script']> = {};
      for (const [s, a] of Object.entries(by)) if (a && a[i]! >= 0) sc[s as StepName | 'label'] = scriptOf(a[i]!);
      if (Object.keys(sc).length) ex.script = sc;
      return ex;
    },
    spec: S, layers: layers.map((L) => (L.script ? { name: L.name, script: L.script } : { name: L.name })), scripts: R.scripts, params: R.params, forces, warnings,
  };
}

const EDGE_MODES = ['orbit', 'region', 'line', 'faint', 'hidden'];
/** 脚本 edge() 返回的几项盖到原来的画法上(不认识的值不要) */
function mergeEdge(base: EdgeLook, r: Partial<EdgeLook>): EdgeLook {
  const out = { ...base };
  if (EDGE_MODES.includes(r.mode as string)) out.mode = r.mode!;
  if (typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color)) out.color = r.color;
  if (typeof r.width === 'number' && r.width >= 0) out.width = r.width;
  if (typeof r.arrow === 'boolean') out.arrow = r.arrow;
  for (const k of ['distance', 'strength', 'spin'] as const) if (typeof r[k] === 'number' && Number.isFinite(r[k])) out[k] = r[k];
  return out;
}

/** 一步到位:编译 + 折叠。交互场景请自己持有 compileView 的结果,展开/收起只调 fold。 */
export function evaluateView(u: Universe, spec: ViewSpec, opts: EvalOptions = {}): Scene {
  return compileView(u, spec, opts).fold(opts);
}
