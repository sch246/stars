// 视图 = 一个纯函数:evaluate(宇宙, 视图规格) -> 场景(scene)。
// 显示什么、多大、什么颜色、关系怎么画,全由规格里的"有序规则"决定,
// 规格本身存放在宇宙里(kind=view 的节点,spec 属性是 JSON),所以改规格就是改图。
// 查看器只负责把 scene 画出来 —— 这个函数在内核里,CLI 和 AI 同样能用。

import { type Node, type Universe, SCHEMA_PREFIX, isSchemaId, schemaNode } from './model.ts';

export type Shape = 'dot' | 'star' | 'nebula' | 'ringed' | 'pulsar';
export type RelationMode = 'orbit' | 'line' | 'faint' | 'hidden';

/** 规则的前提:所有 key=value 都相等才匹配(key=type 时匹配节点类型)。省略 = 恒匹配。 */
type When = Record<string, string>;

export interface SizeRule {
  when?: When;
  /** 取哪个属性当数值(如 size);省略则按度数 */
  attr?: string;
  by?: 'degree';
  /** 沿某种关系向下汇总:sum / max / count(子孙数) */
  rollup?: { relation: string; op: 'sum' | 'max' | 'count' };
  scale?: 'sqrt' | 'log' | 'linear';
  range?: [number, number];
}
export interface ColorRule {
  when?: When;
  /** 'type' | 'attr:xxx' | 'group'(继承祖先的颜色:沿 relation 往上数到第 level 层的祖先,同一子树同色) */
  by?: string;
  relation?: string;
  level?: number;
  value?: string; // 固定颜色
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
}
export interface SceneEdge {
  from: string;
  to: string;
  type: string;
  mode: Exclude<RelationMode, 'hidden'>;
  distance?: number;
  strength?: number;
  color: string;
  width: number;
  arrow: boolean;
  proposed: boolean;
}
export interface Scene {
  look: 'galaxy' | 'plain';
  nodes: SceneNode[];
  edges: SceneEdge[];
}

export const BUILTIN_VIEWS: Record<string, ViewSpec> = {
  galaxy: {
    look: 'galaxy',
    size: [
      { when: { type: 'dir' }, attr: 'size', rollup: { relation: 'contains', op: 'sum' }, scale: 'log', range: [5, 17] },
      { when: { type: 'file' }, attr: 'size', scale: 'sqrt', range: [1.8, 9] },
      { by: 'degree', range: [3.5, 12] },
    ],
    color: [
      { when: { type: 'dir' }, by: 'group', relation: 'contains', level: 1 },
      { when: { type: 'file' }, by: 'attr:ext' },
      { by: 'type' },
    ],
    style: [
      { when: { type: 'dir' }, shape: 'nebula' },
      { when: { type: 'file' }, shape: 'star' },
      { when: { type: 'module' }, shape: 'ringed' },
      { when: { type: 'concept' }, shape: 'pulsar' },
    ],
    relations: {
      contains: { mode: 'orbit', distance: 34, strength: 0.9 },
      '*': { mode: 'line', distance: 110, strength: 0.25 },
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

function scaleValue(v: number, max: number, scale: 'sqrt' | 'log' | 'linear', [lo, hi]: [number, number]): number {
  if (max <= 0) return lo;
  const t = scale === 'log' ? Math.log1p(v) / Math.log1p(max) : scale === 'linear' ? v / max : Math.sqrt(v / max);
  return lo + (hi - lo) * Math.max(0, Math.min(1, t));
}

export function evaluateView(u: Universe, spec: ViewSpec): Scene {
  const sel = spec.select ?? {};
  const incident = new Map<string, Set<string>>();
  for (const e of u.edges.values()) {
    for (const id of [e.from, e.to]) {
      if (!incident.has(id)) incident.set(id, new Set());
      incident.get(id)!.add(e.type);
    }
  }
  const relOf = (type: string): RelationRule => spec.relations?.[type] ?? spec.relations?.['*'] ?? { mode: 'line' };

  const nodes = [...u.nodes.values()].filter((n) => {
    if (isSchemaId(n.id) && !sel.schema) return false;
    if (sel.onlyTypes && !sel.onlyTypes.includes(n.attrs.type ?? '')) return false;
    if (sel.hideTypes?.includes(n.attrs.type ?? '')) return false;
    if (sel.withRelations && !sel.withRelations.some((t) => incident.get(n.id)?.has(t))) return false;
    return true;
  });
  const kept = new Set(nodes.map((n) => n.id));

  // 度数只计算当前视图里真正显示的边
  const edgesIn = [...u.edges.values()].filter((e) => kept.has(e.from) && kept.has(e.to) && relOf(e.type).mode !== 'hidden');
  const degree = new Map<string, number>();
  for (const e of edgesIn) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  // --- 大小:每条规则在自己匹配到的节点里独立归一化 ---
  const sizeRules = spec.size ?? [];
  const sizeOf = new Map<string, { rule: number; value: number }>();
  const attrNum = (n: Node, attr: string) => {
    const x = Number(n.attrs[attr]);
    return Number.isFinite(x) ? x : 0;
  };
  const rolled = sizeRules.map((r) =>
    r.rollup ? rollup(u, r.rollup.relation, r.rollup.op, (n) => (r.attr ? attrNum(n, r.attr) : 0)) : null);
  for (const n of nodes) {
    const i = sizeRules.findIndex((r) => matches(n, r.when));
    if (i === -1) continue;
    const r = sizeRules[i]!;
    const value = r.by === 'degree' || (!r.attr && !r.rollup)
      ? (degree.get(n.id) ?? 0)
      : (rolled[i]?.get(n.id) ?? attrNum(n, r.attr ?? ''));
    sizeOf.set(n.id, { rule: i, value });
  }
  const maxByRule = new Map<number, number>();
  for (const { rule, value } of sizeOf.values()) maxByRule.set(rule, Math.max(maxByRule.get(rule) ?? 0, value));

  const colorRules = spec.color ?? [];
  const parents = new Map<string, Map<string, string>>();
  const parentMap = (relation: string) => {
    let m = parents.get(relation);
    if (!m) {
      m = new Map();
      for (const e of u.edges.values()) if (e.type === relation && !m.has(e.to)) m.set(e.to, e.from);
      parents.set(relation, m);
    }
    return m;
  };
  const styleRules = spec.style ?? [];
  const sceneNodes: SceneNode[] = nodes.map((n) => {
    const s = sizeOf.get(n.id);
    const rule = s ? sizeRules[s.rule]! : undefined;
    const r = s && rule
      ? scaleValue(s.value, maxByRule.get(s.rule)!, rule.scale ?? 'sqrt', rule.range ?? [2, 10])
      : 3.5;

    let color = DEFAULT_COLOR;
    const cr = colorRules.find((c) => matches(n, c.when));
    if (cr?.value) color = cr.value;
    else if (cr?.by === 'type') color = n.attrs.color ?? schemaNode(u, n.attrs.type ?? '')?.attrs.color ?? (n.attrs.type ? hashColor(n.attrs.type) : DEFAULT_COLOR);
    else if (cr?.by === 'group') color = hashColor(groupOf(parentMap(cr.relation ?? 'contains'), n.id, cr.level ?? 1));
    else if (cr?.by?.startsWith('attr:')) {
      const v = n.attrs[cr.by.slice(5)];
      color = v ? hashColor(v) : DEFAULT_COLOR;
    }

    const shape = styleRules.find((x) => matches(n, x.when))?.shape ?? 'star';
    const out: SceneNode = { id: n.id, label: n.label, r: Math.round(r * 100) / 100, color, shape };
    if (s) out.value = s.value;
    return out;
  });

  const sceneEdges: SceneEdge[] = edgesIn.map((e) => {
    const rel = relOf(e.type);
    const mode = rel.mode as SceneEdge['mode'];
    const edge: SceneEdge = {
      from: e.from, to: e.to, type: e.type, mode,
      color: rel.color ?? schemaNode(u, e.type)?.attrs.color ?? hashColor(`edge:${e.type}`),
      width: rel.width ?? 1,
      arrow: rel.arrow ?? (mode === 'line' && schemaNode(u, e.type)?.attrs.symmetric !== 'true'),
      proposed: e.attrs.status === 'proposed',
    };
    if (rel.distance !== undefined) edge.distance = rel.distance;
    if (rel.strength !== undefined) edge.strength = rel.strength;
    return edge;
  });

  return { look: spec.look ?? 'galaxy', nodes: sceneNodes, edges: sceneEdges };
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
