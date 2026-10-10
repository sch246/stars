// 类型的样式(L2):节点类型、边类型本身就是宇宙里的模式节点(~module、~dependsOn),样式就是它们的属性。
//   节点类型:color(#rrggbb)· shape(dot / star / nebula / ringed / pulsar)· scale(大小倍率)
//   边类型:  color · width(线宽)· arrow(true / false)· mode(line / faint / hidden / orbit / region)
// 视图按类型取外观时的先后:视图规则明确写了的 > 节点自己的同名属性 > 类型节点的属性 > 内置默认。
// 所以改类型节点 = 所有没专门规定它的视图里,这类东西立刻换样子(查看器的「类型」面板就是改它)。
// 这个文件同时在 Node 和浏览器里运行;静态导出拼进同一个作用域:顶层名字都以 style 开头。
import { type Universe, SCHEMA_PREFIX, StarsError, schemaNode } from './model.ts';
import { type Op } from './ops.ts';

export const STYLE_SHAPES = ['dot', 'star', 'nebula', 'ringed', 'pulsar'];
export const STYLE_MODES = ['line', 'faint', 'hidden', 'orbit', 'region'];
/** 类型节点没写 shape 时的内置形状(按类型取形状的规则用;和以前内置视图写死的一样) */
export const STYLE_DEFAULT_SHAPES: Record<string, string> = { dir: 'nebula', file: 'star', module: 'ringed', concept: 'pulsar' };
export const STYLE_NODE_KEYS = ['color', 'shape', 'scale'];
export const STYLE_EDGE_KEYS = ['color', 'width', 'arrow', 'mode'];

export type StyleKind = 'nodeType' | 'edgeType';

export interface StyleTypeInfo {
  name: string;
  kind: StyleKind;
  /** 用这个类型的节点数 / 边数 */
  count: number;
  label: string;
  /** 宇宙里有没有这个类型的模式节点 */
  declared: boolean;
  /** 类型节点上写着的样式属性 */
  style: Record<string, string>;
  summary?: string;
}

/** 类型是节点类型还是边类型:模式节点写了 kind 就听它的,否则看有没有边用这个类型 */
export function styleKindOf(u: Universe, name: string): StyleKind {
  const k = schemaNode(u, name)?.attrs.kind;
  if (k === 'nodeType' || k === 'edgeType') return k;
  for (const e of u.edges.values()) if (e.type === name) return 'edgeType';
  return 'nodeType';
}

/** 检查一个样式属性;没问题返回 null */
export function styleCheck(kind: StyleKind, key: string, value: string): string | null {
  const keys = kind === 'edgeType' ? STYLE_EDGE_KEYS : STYLE_NODE_KEYS;
  if (!keys.includes(key)) return `${kind === 'edgeType' ? '边' : '节点'}类型的样式只有 ${keys.join(' / ')}(得到 ${key})`;
  const num = (lo: number, hi: number) => { const x = Number(value); return value.trim() !== '' && Number.isFinite(x) && x >= lo && x <= hi; };
  switch (key) {
    case 'color': return /^#[0-9a-fA-F]{6}$/.test(value) ? null : `color 应写成 #rrggbb(得到 ${value})`;
    case 'shape': return STYLE_SHAPES.includes(value) ? null : `shape 只能是 ${STYLE_SHAPES.join(' / ')}(得到 ${value})`;
    case 'scale': return num(0.05, 20) ? null : `scale 是大小倍率,0.05 到 20(得到 ${value})`;
    case 'width': return num(0.1, 20) ? null : `width 是线宽,0.1 到 20(得到 ${value})`;
    case 'arrow': return value === 'true' || value === 'false' ? null : `arrow 只能是 true / false(得到 ${value})`;
    case 'mode': return STYLE_MODES.includes(value) ? null : `mode 只能是 ${STYLE_MODES.join(' / ')}(得到 ${value})`;
  }
  return null;
}

/** 改一个类型的样式:类型节点不在就新建(kind 按 styleKindOf 猜);返回一个操作,交给 commit */
export function styleOp(u: Universe, name: string, set: Record<string, string>, unset: string[] = [], kind?: StyleKind): Op {
  if (!name || name.startsWith(SCHEMA_PREFIX)) throw new StarsError(`类型名不要带 ${SCHEMA_PREFIX}(得到 ${name})`);
  const k = kind ?? styleKindOf(u, name);
  const errs = Object.entries(set).map(([key, v]) => styleCheck(k, key, v)).filter((x): x is string => !!x);
  for (const key of unset) if (!(k === 'edgeType' ? STYLE_EDGE_KEYS : STYLE_NODE_KEYS).includes(key)) errs.push(`没有样式 ${key}`);
  if (errs.length) throw new StarsError(errs.join(';'));
  const id = SCHEMA_PREFIX + name;
  const node = u.nodes.get(id);
  if (!node) return { op: 'addNode', id, label: name, attrs: { kind: k, ...set } };
  return { op: 'setNode', id, set, unset: unset.filter((key) => key in node.attrs) };
}

/** 宇宙里的类型:声明了的(模式节点)和实际用到的,按用量排序 */
export function styleTypes(u: Universe): { nodes: StyleTypeInfo[]; edges: StyleTypeInfo[] } {
  const nodeCount = new Map<string, number>(), edgeCount = new Map<string, number>();
  for (const n of u.nodes.values()) {
    if (n.id.startsWith(SCHEMA_PREFIX)) continue;
    const t = n.attrs.type;
    if (t) nodeCount.set(t, (nodeCount.get(t) ?? 0) + 1);
  }
  for (const e of u.edges.values()) edgeCount.set(e.type, (edgeCount.get(e.type) ?? 0) + 1);
  for (const n of u.nodes.values()) {
    if (!n.id.startsWith(SCHEMA_PREFIX) || n.id.includes('/')) continue;
    const name = n.id.slice(SCHEMA_PREFIX.length);
    if (n.attrs.kind === 'nodeType' && !nodeCount.has(name)) nodeCount.set(name, 0);
    if (n.attrs.kind === 'edgeType' && !edgeCount.has(name)) edgeCount.set(name, 0);
  }
  const info = (name: string, kind: StyleKind, count: number): StyleTypeInfo => {
    const s = schemaNode(u, name);
    const style: Record<string, string> = {};
    for (const key of kind === 'edgeType' ? STYLE_EDGE_KEYS : STYLE_NODE_KEYS) if (s?.attrs[key] !== undefined) style[key] = s.attrs[key]!;
    return { name, kind, count, label: s?.label || name, declared: !!s, style, ...(s?.attrs.summary ? { summary: s.attrs.summary } : {}) };
  };
  const sort = (m: Map<string, number>, kind: StyleKind) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, c]) => info(t, kind, c));
  return { nodes: sort(nodeCount, 'nodeType'), edges: sort(edgeCount, 'edgeType') };
}
