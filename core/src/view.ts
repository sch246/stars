// 视图 = 一个纯函数:evaluateView(宇宙, 视图规格, 展开状态) -> 场景(scene)。
// 显示什么、多大、什么颜色、关系怎么画、容器展开还是收起,全由规格里的"有序规则"决定,
// 规格本身存放在宇宙里(kind=view 的节点,spec 属性是 JSON),所以改规格就是改图。
// 这个文件同时在 Node(CLI)和浏览器(查看器)里运行:只依赖 model.ts,不碰 DOM、不碰文件系统。

import { type Node, type Universe, SCHEMA_PREFIX, edgeKey, isSchemaId, isSymmetric, schemaNode } from './model.ts';

export type Shape = 'dot' | 'star' | 'nebula' | 'ringed' | 'pulsar';
/** region:不画线,子节点被一个"域"包围;orbit:子绕父转;line/faint:连线;hidden:不显示 */
export type RelationMode = 'orbit' | 'region' | 'line' | 'faint' | 'hidden';

/** 规则的前提:所有 key=value 都相等才匹配(key=type 时匹配节点类型)。省略 = 恒匹配。 */
type When = Record<string, string>;

/** 外部给的"信号":id -> 数值(常用毫秒时间戳)。如 touched(图里最近被编辑)、fileChanged(文件最近被提交/修改)。 */
export type SignalMap = Map<string, number> | Record<string, number>;

export interface SizeRule {
  when?: When;
  /** 取哪个属性当数值(如 size);省略则按度数 */
  attr?: string;
  /** 改取某个信号(见 EvalOptions.signals);配合 recency 把时间戳变成 0..1 的"新鲜度" */
  signal?: string;
  recency?: { halfLifeDays: number };
  by?: 'degree';
  /** 沿某种关系向下汇总:sum / max / count(子孙数) */
  rollup?: { relation: string; op: 'sum' | 'max' | 'count' };
  scale?: 'sqrt' | 'log' | 'linear';
  range?: [number, number];
}
export interface ColorRule {
  when?: When;
  /** 'type' | 'attr:xxx' | 'group'(继承祖先的颜色:沿 relation 往上数到第 level 层的祖先,同一子树同色) | 'recency'(按信号的新旧在 from→to 之间渐变) */
  by?: string;
  relation?: string;
  level?: number;
  value?: string; // 固定颜色
  /** by=recency:用哪个信号、半衰期(天)、冷色 → 热色;rollup 让容器取后代里最新的 */
  signal?: string;
  halfLifeDays?: number;
  from?: string;
  to?: string;
  rollup?: { relation: string; op: 'max' | 'sum' };
}
export interface StyleRule {
  when?: When;
  shape: Shape;
}
export interface RelationRule {
  mode: RelationMode;
  distance?: number;
  strength?: number;
  color?: string;
  width?: number;
  arrow?: boolean;
  /** 轨道/域内子节点的公转速度倍数,默认 orbit=1,其余=0 */
  spin?: number;
}

/** 容器(沿 relation 有子节点的节点)的展开规则。 */
export interface ExpandRule {
  relation?: string; // 默认 contains
  /** 默认展开到第几层:离根 < depth 的容器展开。省略 = 全部展开 */
  depth?: number;
  /** 语义缩放:容器在屏幕上的视觉半径超过 radiusPx 就自动展开(由查看器执行) */
  auto?: { radiusPx: number };
}

export interface ViewSpec {
  look?: 'galaxy' | 'plain';
  select?: {
    onlyTypes?: string[];
    hideTypes?: string[];
    /** 只保留至少有一条这些类型的边的节点 */
    withRelations?: string[];
    schema?: boolean;
  };
  expand?: ExpandRule;
  size?: SizeRule[];
  color?: ColorRule[];
  style?: StyleRule[];
  /** 键是边类型,'*' 是兜底 */
  relations?: Record<string, RelationRule>;
}

export interface SceneNode {
  id: string;
  label: string;
  r: number;
  color: string;
  shape: Shape;
  /** 驱动 r 的原始数值(用于提示框) */
  value?: number;
  /** 可见的父容器(域的成员关系);根节点没有 */
  parent?: string;
  /** 是否是容器(沿 expand.relation 有子节点) */
  container?: boolean;
  expanded?: boolean;
  /** 后代总数 / 直接子节点数 */
  descendants?: number;
  children?: number;
  /** 收起的容器:里面内容的缩影 [颜色, 半径],查看器据此把它画成一个小星系 */
  kids?: Array<[string, number]>;
}
export interface SceneEdge {
  from: string;
  to: string;
  type: string;
  mode: Exclude<RelationMode, 'hidden'>;
  distance?: number;
  strength?: number;
  spin?: number;
  color: string;
  width: number;
  arrow: boolean;
  proposed: boolean;
  /** 这条可见的边汇总了多少条底层的边 */
  count: number;
  /** true = 全部由被折叠的内部关系提升而来(派生的,不是宇宙里真实存在的边) */
  lifted: boolean;
}
export interface Scene {
  look: 'galaxy' | 'plain';
  nodes: SceneNode[];
  edges: SceneEdge[];
  expand: { relation: string; auto?: { radiusPx: number } };
}

export interface EvalOptions {
  /** 强制展开 / 强制收起这些容器(覆盖 depth 规则) */
  expanded?: Iterable<string>;
  collapsed?: Iterable<string>;
  /** 覆盖 spec.expand.depth */
  depth?: number;
  /** 外部信号(见 SignalMap);视图是纯函数,时间也是输入 */
  signals?: Record<string, SignalMap>;
  /** 当前时间(毫秒),默认 Date.now();测试里固定它 */
  now?: number;
}

const GALAXY_SIZE: SizeRule[] = [
  { when: { type: 'dir' }, attr: 'size', rollup: { relation: 'contains', op: 'sum' }, scale: 'log', range: [5, 17] },
  { when: { type: 'file' }, attr: 'size', scale: 'sqrt', range: [1.8, 9] },
  { by: 'degree', range: [3.5, 12] },
];
const GALAXY_COLOR: ColorRule[] = [
  { when: { type: 'dir' }, by: 'group', relation: 'contains', level: 1 },
  { when: { type: 'file' }, by: 'attr:ext' },
  { by: 'type' },
];
const GALAXY_STYLE: StyleRule[] = [
  { when: { type: 'dir' }, shape: 'nebula' },
  { when: { type: 'file' }, shape: 'star' },
  { when: { type: 'module' }, shape: 'ringed' },
  { when: { type: 'concept' }, shape: 'pulsar' },
];

export const BUILTIN_VIEWS: Record<string, ViewSpec> = {
  // 默认:从全局开始,放大哪里哪里展开成一个"域";收起的目录是一个小星系
  galaxy: {
    look: 'galaxy',
    expand: { relation: 'contains', depth: 1, auto: { radiusPx: 58 } },
    size: GALAXY_SIZE,
    color: GALAXY_COLOR,
    style: GALAXY_STYLE,
    relations: {
      contains: { mode: 'region', distance: 46, strength: 0.7, spin: 0.5 },
      '*': { mode: 'line', distance: 140, strength: 0.18 },
    },
  },
  // 热力:大小仍是体量,颜色是"多久之前动过"(文件看 git/工作区,图里的节点看编辑记录)
  recent: {
    look: 'galaxy',
    expand: { relation: 'contains', depth: 1, auto: { radiusPx: 58 } },
    size: GALAXY_SIZE,
    color: [
      { when: { type: 'dir' }, by: 'recency', signal: 'fileChanged', rollup: { relation: 'contains', op: 'max' }, halfLifeDays: 10 },
      { when: { type: 'file' }, by: 'recency', signal: 'fileChanged', halfLifeDays: 10 },
      { by: 'recency', signal: 'touched', halfLifeDays: 3 },
    ],
    style: GALAXY_STYLE,
    relations: {
      contains: { mode: 'region', distance: 46, strength: 0.7, spin: 0.5 },
      '*': { mode: 'line', distance: 140, strength: 0.18 },
    },
  },
  // 全部展开,子绕父转
  orbit: {
    look: 'galaxy',
    size: GALAXY_SIZE,
    color: GALAXY_COLOR,
    style: GALAXY_STYLE,
    relations: {
      contains: { mode: 'orbit', distance: 34, strength: 0.9 },
      '*': { mode: 'line', distance: 110, strength: 0.25 },
    },
  },
  // 架构级:只展开到第一层,文件隐藏,文件之间的关系提升到目录之间
  arch: {
    look: 'galaxy',
    select: { hideTypes: ['file'] },
    expand: { relation: 'contains', depth: 1 },
    size: [{ when: { type: 'dir' }, attr: 'size', rollup: { relation: 'contains', op: 'sum' }, scale: 'log', range: [6, 18] }, { by: 'degree', range: [5, 14] }],
    color: GALAXY_COLOR,
    style: GALAXY_STYLE,
    relations: {
      contains: { mode: 'region', distance: 60, strength: 0.7 },
      '*': { mode: 'line', distance: 150, strength: 0.2, arrow: true },
    },
  },
  deps: {
    look: 'galaxy',
    select: { withRelations: ['dependsOn', 'related', 'describes'] },
    size: [{ by: 'degree', range: [5, 15] }],
    color: [{ by: 'type' }],
    style: [
      { when: { type: 'module' }, shape: 'ringed' },
      { when: { type: 'concept' }, shape: 'pulsar' },
      { shape: 'star' },
    ],
    relations: {
      contains: { mode: 'hidden' },
      describes: { mode: 'faint', distance: 70, strength: 0.2 },
      '*': { mode: 'line', distance: 130, strength: 0.3, arrow: true },
    },
  },
  tree: {
    look: 'plain',
    size: [{ attr: 'size', scale: 'sqrt', range: [2, 8] }, { by: 'degree', range: [3, 9] }],
    color: [{ by: 'type' }],
    relations: { contains: { mode: 'line', distance: 28, strength: 0.7 }, '*': { mode: 'line', distance: 90, strength: 0.2 } },
  },
};

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

/** 沿 relation 往上走到离根 level 层的祖先 id;不足 level 层则返回自己。 */
function groupOf(parent: Map<string, string>, id: string, level: number): string {
  const chain = [id];
  const seen = new Set(chain);
  for (let cur = parent.get(id); cur !== undefined && !seen.has(cur); cur = parent.get(cur)) {
    chain.push(cur);
    seen.add(cur);
  }
  // chain = [自己, 父, 祖父, ..., 根]
  const fromRoot = chain.reverse();
  return fromRoot[Math.min(level, fromRoot.length - 1)]!;
}

const matches = (n: Node, when?: When): boolean =>
  !when || Object.entries(when).every(([k, v]) => (k === 'id' ? n.id : k === 'label' ? n.label : n.attrs[k]) === v);

/** 沿关系向下汇总。假定关系无环(遇到环就截断,不会死循环)。 */
function rollup(u: Universe, relation: string, op: 'sum' | 'max' | 'count', own: (n: Node) => number): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const e of u.edges.values()) {
    if (e.type === relation) children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
  }
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const go = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const kids = children.get(id) ?? [];
    let v: number;
    if (op === 'count') v = kids.reduce((acc, k) => acc + 1 + go(k), 0);
    else {
      const self = u.nodes.has(id) ? own(u.nodes.get(id)!) : 0;
      const parts = kids.map(go);
      v = op === 'sum' ? self + parts.reduce((a, b) => a + b, 0) : Math.max(self, ...parts);
    }
    visiting.delete(id);
    memo.set(id, v);
    return v;
  };
  for (const id of u.nodes.keys()) go(id);
  return memo;
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


/**
 * 容器树:沿 relation 取每个节点的第一个父节点。若有环,在环上断开一条父链,保证每个节点可达某个根。
 */
function buildTree(u: Universe, relation: string) {
  const parent = new Map<string, string>();
  const kids = new Map<string, string[]>();
  for (const e of u.edges.values()) {
    if (e.type !== relation || !u.nodes.has(e.from) || !u.nodes.has(e.to) || parent.has(e.to)) continue;
    parent.set(e.to, e.from);
    kids.set(e.from, [...(kids.get(e.from) ?? []), e.to]);
  }
  const depth = new Map<string, number>();
  const walk = (roots: string[]) => {
    let frontier = roots;
    for (const r of roots) depth.set(r, 0);
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const k of kids.get(id) ?? []) {
          if (!depth.has(k)) {
            depth.set(k, depth.get(id)! + 1);
            next.push(k);
          }
        }
      }
      frontier = next;
    }
  };
  walk([...u.nodes.keys()].filter((id) => !parent.has(id)));
  for (const id of u.nodes.keys()) {
    if (depth.has(id)) continue;
    // 环上的节点:断开它的父链,让它自己当根
    const p = parent.get(id);
    if (p !== undefined) kids.set(p, (kids.get(p) ?? []).filter((k) => k !== id));
    parent.delete(id);
    walk([id]);
  }
  return { parent, kids, depth };
}

export function evaluateView(u: Universe, spec: ViewSpec, opts: EvalOptions = {}): Scene {
  const sel = spec.select ?? {};
  const relation = spec.expand?.relation ?? 'contains';
  const incident = new Map<string, Set<string>>();
  for (const e of u.edges.values()) {
    for (const id of [e.from, e.to]) {
      if (!incident.has(id)) incident.set(id, new Set());
      incident.get(id)!.add(e.type);
    }
  }
  const relOf = (type: string): RelationRule => spec.relations?.[type] ?? spec.relations?.['*'] ?? { mode: 'line' };

  // --- 1. 选择:哪些节点有资格出现 ---
  const nodes = [...u.nodes.values()].filter((n) => {
    if (isSchemaId(n.id) && !sel.schema) return false;
    if (sel.onlyTypes && !sel.onlyTypes.includes(n.attrs.type ?? '')) return false;
    if (sel.hideTypes?.includes(n.attrs.type ?? '')) return false;
    if (sel.withRelations && !sel.withRelations.some((t) => incident.get(n.id)?.has(t))) return false;
    return true;
  });
  const selected = new Set(nodes.map((n) => n.id));

  // --- 2. 折叠:哪些容器展开,哪些节点因此可见 ---
  const { parent, kids, depth } = buildTree(u, relation);
  const maxDepth = opts.depth ?? spec.expand?.depth ?? Infinity;
  const forceOpen = new Set(opts.expanded ?? []);
  const forceShut = new Set(opts.collapsed ?? []);
  const isOpen = (id: string): boolean => (forceShut.has(id) ? false : forceOpen.has(id) ? true : (depth.get(id) ?? 0) < maxDepth);
  const treeVisible = new Set<string>();
  {
    let frontier = [...u.nodes.keys()].filter((id) => !parent.has(id));
    for (const r of frontier) treeVisible.add(r);
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const id of frontier) {
        if (!isOpen(id)) continue;
        for (const k of kids.get(id) ?? []) {
          treeVisible.add(k);
          next.push(k);
        }
      }
      frontier = next;
    }
  }
  const visible = new Set([...treeVisible].filter((id) => selected.has(id)));
  /** 最近的"树上可见"的祖先(含自己) */
  const repOf = (id: string): string => {
    let cur = id;
    while (!treeVisible.has(cur)) cur = parent.get(cur)!;
    return cur;
  };

  // --- 3. 边:折叠掉的内部关系提升到容器上,并按 (起点,类型,终点) 汇总 ---
  interface Agg { from: string; to: string; type: string; count: number; real: boolean; proposed: boolean }
  const aggs = new Map<string, Agg>();
  for (const e of u.edges.values()) {
    if (!u.nodes.has(e.from) || !u.nodes.has(e.to) || relOf(e.type).mode === 'hidden') continue;
    let from = repOf(e.from);
    let to = repOf(e.to);
    if (from === to || !visible.has(from) || !visible.has(to)) continue;
    if (from !== e.from || to !== e.to) {
      if (isSymmetric(u, e.type) && from > to) [from, to] = [to, from];
    }
    const key = edgeKey(from, e.type, to);
    const a = aggs.get(key) ?? { from, to, type: e.type, count: 0, real: false, proposed: true };
    a.count++;
    if (from === e.from && to === e.to) a.real = true;
    if (e.attrs.status !== 'proposed') a.proposed = false;
    aggs.set(key, a);
  }
  const degree = new Map<string, number>();
  for (const a of aggs.values()) {
    degree.set(a.from, (degree.get(a.from) ?? 0) + 1);
    degree.set(a.to, (degree.get(a.to) ?? 0) + 1);
  }

  // --- 4. 视觉属性:对所有入选节点统一归一化,这样展开/收起时节点大小不会跳变 ---
  const now = opts.now ?? Date.now();
  const signalCache = new Map<string, Map<string, number>>();
  const signalOf = (name: string, rel?: { relation: string; op: 'max' | 'sum' }): Map<string, number> => {
    const key = `${name}|${rel?.relation ?? ''}|${rel?.op ?? ''}`;
    let m = signalCache.get(key);
    if (!m) {
      const src = opts.signals?.[name];
      const base = src instanceof Map ? src : new Map(Object.entries(src ?? {}));
      m = rel ? rollup(u, rel.relation, rel.op, (n) => base.get(n.id) ?? 0) : base;
      signalCache.set(key, m);
    }
    return m;
  };
  const sizeRules = spec.size ?? [];
  const sizeOf = new Map<string, { rule: number; value: number }>();
  const attrNum = (n: Node, attr: string) => {
    const x = Number(n.attrs[attr]);
    return Number.isFinite(x) ? x : 0;
  };
  const rolled = sizeRules.map((r) =>
    r.rollup && !r.signal ? rollup(u, r.rollup.relation, r.rollup.op, (n) => (r.attr ? attrNum(n, r.attr) : 0)) : null);
  for (const n of nodes) {
    const i = sizeRules.findIndex((r) => matches(n, r.when));
    if (i === -1) continue;
    const r = sizeRules[i]!;
    let value: number;
    if (r.signal) {
      const raw = signalOf(r.signal, r.rollup && r.rollup.op !== 'count' ? { relation: r.rollup.relation, op: r.rollup.op } : undefined).get(n.id);
      value = r.recency ? recencyWeight(raw, r.recency.halfLifeDays, now) : (raw ?? 0);
    } else if (r.by === 'degree' || (!r.attr && !r.rollup)) value = degree.get(n.id) ?? 0;
    else value = rolled[i]?.get(n.id) ?? attrNum(n, r.attr ?? '');
    sizeOf.set(n.id, { rule: i, value });
  }
  const maxByRule = new Map<number, number>();
  for (const { rule, value } of sizeOf.values()) maxByRule.set(rule, sizeRules[rule]!.recency ? 1 : Math.max(maxByRule.get(rule) ?? 0, value));

  const colorRules = spec.color ?? [];
  const styleRules = spec.style ?? [];
  const parents = new Map<string, Map<string, string>>([[relation, parent]]);
  const parentMap = (rel: string) => {
    let m = parents.get(rel);
    if (!m) {
      m = new Map();
      for (const e of u.edges.values()) if (e.type === rel && !m.has(e.to)) m.set(e.to, e.from);
      parents.set(rel, m);
    }
    return m;
  };
  const sceneOf = new Map<string, SceneNode>();
  for (const n of nodes) {
    const s = sizeOf.get(n.id);
    const rule = s ? sizeRules[s.rule]! : undefined;
    const r = s && rule
      ? scaleValue(s.value, maxByRule.get(s.rule)!, rule.scale ?? 'sqrt', rule.range ?? [2, 10])
      : 3.5;

    let color = DEFAULT_COLOR;
    const cr = colorRules.find((c) => matches(n, c.when));
    if (cr?.value) color = cr.value;
    else if (cr?.by === 'type') color = n.attrs.color ?? schemaNode(u, n.attrs.type ?? '')?.attrs.color ?? (n.attrs.type ? hashColor(n.attrs.type) : DEFAULT_COLOR);
    else if (cr?.by === 'recency') {
      const raw = signalOf(cr.signal ?? 'touched', cr.rollup).get(n.id);
      color = mixHex(cr.from ?? '#2f3b6e', cr.to ?? '#ffcf70', recencyWeight(raw, cr.halfLifeDays ?? 14, now));
    }
    else if (cr?.by === 'group') color = hashColor(groupOf(parentMap(cr.relation ?? 'contains'), n.id, cr.level ?? 1));
    else if (cr?.by?.startsWith('attr:')) {
      const v = n.attrs[cr.by.slice(5)];
      color = v ? hashColor(v) : DEFAULT_COLOR;
    }

    const shape = styleRules.find((x) => matches(n, x.when))?.shape ?? 'star';
    const out: SceneNode = { id: n.id, label: n.label, r: Math.round(r * 100) / 100, color, shape };
    if (s) out.value = s.value;
    sceneOf.set(n.id, out);
  }

  // 容器信息:后代数、收起时的"缩影"
  const descendantsOf = (id: string, limit = Infinity): string[] => {
    const out: string[] = [];
    let frontier = kids.get(id) ?? [];
    while (frontier.length > 0 && out.length < limit) {
      const next: string[] = [];
      for (const k of frontier) {
        out.push(k);
        next.push(...(kids.get(k) ?? []));
      }
      frontier = next;
    }
    return out;
  };
  const descCount = new Map<string, number>();
  const count = (id: string): number => {
    const c = descCount.get(id);
    if (c !== undefined) return c;
    const v = (kids.get(id) ?? []).reduce((acc, k) => acc + 1 + count(k), 0);
    descCount.set(id, v);
    return v;
  };

  const sceneNodes: SceneNode[] = [];
  for (const id of visible) {
    const n = sceneOf.get(id);
    if (!n) continue;
    const p = parent.get(id);
    if (p !== undefined && visible.has(p)) n.parent = p;
    const direct = kids.get(id) ?? [];
    if (direct.length > 0) {
      n.container = true;
      n.children = direct.length;
      n.descendants = count(id);
      n.expanded = isOpen(id);
      if (!n.expanded) {
        n.kids = descendantsOf(id, 48).slice(0, 48)
          .map((k) => sceneOf.get(k))
          .filter((k): k is SceneNode => k !== undefined)
          .map((k): [string, number] => [k.color, k.r]);
      }
    }
    sceneNodes.push(n);
  }

  const sceneEdges: SceneEdge[] = [...aggs.values()].map((a) => {
    const rel = relOf(a.type);
    const mode = rel.mode as SceneEdge['mode'];
    const edge: SceneEdge = {
      from: a.from, to: a.to, type: a.type, mode,
      color: rel.color ?? schemaNode(u, a.type)?.attrs.color ?? hashColor(`edge:${a.type}`),
      width: rel.width ?? 1,
      arrow: rel.arrow ?? (mode === 'line' && schemaNode(u, a.type)?.attrs.symmetric !== 'true'),
      proposed: a.proposed,
      count: a.count,
      lifted: !a.real,
    };
    if (rel.distance !== undefined) edge.distance = rel.distance;
    if (rel.strength !== undefined) edge.strength = rel.strength;
    if (rel.spin !== undefined) edge.spin = rel.spin;
    return edge;
  });

  const expand: Scene['expand'] = { relation };
  if (spec.expand?.auto) expand.auto = spec.expand.auto;
  return { look: spec.look ?? 'galaxy', nodes: sceneNodes, edges: sceneEdges, expand };
}

/** 宇宙里的视图节点(kind=view,spec 是 JSON)覆盖同名内置视图。 */
export function listViews(u: Universe): { specs: Record<string, ViewSpec>; errors: Record<string, string> } {
  const specs: Record<string, ViewSpec> = { ...BUILTIN_VIEWS };
  const errors: Record<string, string> = {};
  const prefix = `${SCHEMA_PREFIX}view/`;
  for (const n of u.nodes.values()) {
    if (!n.id.startsWith(prefix) || n.attrs.kind !== 'view') continue;
    const name = n.id.slice(prefix.length);
    try {
      specs[name] = JSON.parse(n.attrs.spec ?? '{}') as ViewSpec;
    } catch (err) {
      errors[name] = `视图 ${name} 的 spec 不是合法 JSON: ${(err as Error).message}`;
    }
  }
  return { specs, errors };
}

const KEYS = {
  spec: ['look', 'select', 'expand', 'size', 'color', 'style', 'relations'],
  select: ['onlyTypes', 'hideTypes', 'withRelations', 'schema'],
  expand: ['relation', 'depth', 'auto'],
  size: ['when', 'attr', 'signal', 'recency', 'by', 'rollup', 'scale', 'range'],
  color: ['when', 'by', 'relation', 'level', 'value', 'signal', 'halfLifeDays', 'from', 'to', 'rollup'],
  style: ['when', 'shape'],
  relation: ['mode', 'distance', 'strength', 'color', 'width', 'arrow', 'spin'],
};
const SHAPES = ['dot', 'star', 'nebula', 'ringed', 'pulsar'];
const MODES = ['orbit', 'region', 'line', 'faint', 'hidden'];

/** 检查视图规格,返回问题列表(空 = 没问题)。CLI、查看器编辑器和 AI 写入前都应该先过一遍。 */
export function validateSpec(spec: unknown): string[] {
  const bad: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const unknownKeys = (o: Record<string, unknown>, allowed: string[], where: string) => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) bad.push(`${where}: 未知字段 "${k}"(可用: ${allowed.join(', ')})`);
  };
  if (!isObj(spec)) return ['规格必须是一个 JSON 对象'];
  unknownKeys(spec, KEYS.spec, '规格');
  if (spec.look !== undefined && !['galaxy', 'plain'].includes(spec.look as string)) bad.push('look 只能是 galaxy 或 plain');
  if (spec.select !== undefined) isObj(spec.select) ? unknownKeys(spec.select, KEYS.select, 'select') : bad.push('select 必须是对象');
  if (spec.expand !== undefined) isObj(spec.expand) ? unknownKeys(spec.expand, KEYS.expand, 'expand') : bad.push('expand 必须是对象');
  for (const key of ['size', 'color', 'style'] as const) {
    const rules = spec[key];
    if (rules === undefined) continue;
    if (!Array.isArray(rules)) { bad.push(`${key} 必须是规则数组(按顺序匹配,第一条生效)`); continue; }
    rules.forEach((r, i) => {
      if (!isObj(r)) { bad.push(`${key}[${i}] 必须是对象`); return; }
      unknownKeys(r, KEYS[key], `${key}[${i}]`);
      if (key === 'style' && !SHAPES.includes(r.shape as string)) bad.push(`style[${i}].shape 必须是 ${SHAPES.join('/')}`);
      if (key === 'size' && r.scale !== undefined && !['sqrt', 'log', 'linear'].includes(r.scale as string)) bad.push(`size[${i}].scale 必须是 sqrt/log/linear`);
      if (key === 'size' && r.range !== undefined && !(Array.isArray(r.range) && r.range.length === 2 && r.range.every((x) => typeof x === 'number'))) bad.push(`size[${i}].range 必须是 [最小, 最大]`);
      if (r.when !== undefined && !isObj(r.when)) bad.push(`${key}[${i}].when 必须是对象`);
    });
  }
  if (spec.relations !== undefined) {
    if (!isObj(spec.relations)) bad.push('relations 必须是对象(键是边类型,* 是兜底)');
    else for (const [t, r] of Object.entries(spec.relations)) {
      if (!isObj(r)) { bad.push(`relations.${t} 必须是对象`); continue; }
      unknownKeys(r, KEYS.relation, `relations.${t}`);
      if (!MODES.includes(r.mode as string)) bad.push(`relations.${t}.mode 必须是 ${MODES.join('/')}`);
    }
  }
  return bad;
}
