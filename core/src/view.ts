// 视图 = 一个纯函数:evaluateView(宇宙, 视图规格, 展开状态) -> 场景(scene)。
// 显示什么、多大、什么颜色、关系怎么画、容器展开还是收起,全由规格里的"有序规则"决定,
// 规格本身存放在宇宙里(kind=view 的节点,spec 属性是 JSON),所以改规格就是改图。
// 这个文件同时在 Node(CLI)和浏览器(查看器)里运行:只依赖 model.ts,不碰 DOM、不碰文件系统。

import { type Node, type Universe, SCHEMA_PREFIX, isSchemaId, isSymmetric, schemaNode } from './model.ts';
import { STYLE_DEFAULT_SHAPES, STYLE_MODES } from './styles.ts';
import { checkExpr, compileExpr, compileFn, freeIdentifiers, type ExprEnv, type ExprGraph } from './expr.ts';

export type Shape = 'dot' | 'star' | 'nebula' | 'ringed' | 'pulsar';
/** region:不画线,子节点被一个"域"包围;orbit:子绕父转;line/faint:连线;hidden:不显示 */
export type RelationMode = 'orbit' | 'region' | 'line' | 'faint' | 'hidden';

/** 规则的前提:所有 key=value 都相等才匹配(key=type 时匹配节点类型)。省略 = 恒匹配。 */
type When = Record<string, string> | string;

/** 外部给的"信号":id -> 数值(常用毫秒时间戳)。如 touched(图里最近被编辑)、fileChanged(文件最近被提交/修改)。 */
export type SignalMap = Map<string, number> | Record<string, number>;

export interface SizeRule {
  when?: When;
  /** 取哪个属性当数值(如 size);省略则按度数 */
  attr?: string;
  /** 表达式,返回数值,如 "log1p(size) * (days(touched) < 7 ? 2 : 1)"(与 attr/signal 三选一) */
  expr?: string;
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
  /** 表达式:返回 "#rrggbb" 颜色,或 0..1 的数(在 from→to 之间渐变) */
  expr?: string;
  /** by=recency:用哪个信号、半衰期(天)、冷色 → 热色;rollup 让容器取后代里最新的 */
  signal?: string;
  halfLifeDays?: number;
  from?: string;
  to?: string;
  rollup?: { relation: string; op: 'max' | 'sum' };
}
export interface StyleRule {
  when?: When;
  shape?: Shape;
  /** "type":形状取节点自己的 shape 属性,其次类型节点(~类型)的 shape,再其次内置默认(见 styles.ts) */
  by?: 'type';
  /** 表达式,返回形状名(dot/star/nebula/ringed/pulsar) */
  expr?: string;
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
  /** 默认展开到第几层:离根 < depth 的容器展开。省略 = 全部展开(但受 maxNodes 限制) */
  depth?: number;
  /**
   * 画面里最多放多少个节点(平面布局)。一层一层往下展开,同一层先展开小的容器,放不下的保持收起(一个小星系)。
   * 省略:没写 depth 时默认 1500,写了 depth 就不限。用户手动展开/收起的不受它约束。
   */
  maxNodes?: number;
  /** 语义缩放:容器在屏幕上的视觉半径超过 radiusPx 就自动展开(由查看器执行) */
  auto?: { radiusPx: number };
}

export interface ViewSpec {
  look?: 'galaxy' | 'plain';
  /**
   * flat:一个物理世界,所有可见节点一起受力(展开 = 把子节点放进同一个世界)。
   * spaces:嵌套的独立空间。每个容器是一个空间,里面只有它的直接子节点,只受内部关系约束,和外界没有力的交互;
   *         放大到容器占据小半屏幕(space.enterAt)才"进入"它,父级的布局从不因为放大而改变。
   */
  layout?: 'flat' | 'spaces';
  /** 自定义布局力:函数节点(~fn/名字)的列表,每个是 (nodes, links, alpha, ctx) => void,每个 tick 调用 */
  forces?: string[];
  space?: { enterAt?: number; boundary?: boolean };
  /** 把容器当作 tag 打在节点上(容器本身不必显示):节点带上它在前 depth 层的祖先容器 */
  tags?: { relation?: string; depth?: number };
  select?: {
    onlyTypes?: string[];
    hideTypes?: string[];
    /** 只保留至少有一条这些类型的边的节点 */
    withRelations?: string[];
    schema?: boolean;
    /** 表达式(布尔),为真的节点才入选,如 "days(touched) < 7 && degree > 2" —— 把视图当"第一遍搜寻"用 */
    where?: string;
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
  /** 作为 tag 的祖先容器 id(视图声明了 tags 时) */
  tags?: string[];
  /** 收起的容器:里面内容的缩影 [颜色, 半径],查看器据此把它画成一个小星系 */
  /** 收起的容器的缩影:最多 48 个后代(广度优先)的 [颜色, 半径, id] —— 画成小星系的粒子;放大展开时每颗粒子长成它对应的节点 */
  kids?: Array<[string, number, string]>;
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

/** 编译选项:决定"每个节点长什么样"(宇宙、规格或信号变了才需要重新编译)。 */
export interface CompileOptions {
  /** 外部信号(见 SignalMap);视图是纯函数,时间也是输入 */
  signals?: Record<string, SignalMap>;
  /** 当前时间(毫秒),默认 Date.now();测试里固定它 */
  now?: number;
}
/** 折叠选项:决定"现在显示哪些"(每次展开/收起都变,必须很便宜)。 */
export interface FoldOptions {
  /** 强制展开 / 强制收起这些容器(覆盖 depth 规则) */
  expanded?: Iterable<string>;
  collapsed?: Iterable<string>;
  /** 覆盖 spec.expand.depth */
  depth?: number;
  /** 覆盖 spec.expand.maxNodes */
  maxNodes?: number;
}
export type EvalOptions = CompileOptions & FoldOptions;

/** 空间里一条通向"外面"的关系:画成从子节点伸向空间边界的短桩,不参与这个空间的物理。 */
export interface ExternalLink {
  node: string;       // 空间里的哪个直接子节点
  other: string;      // 外部那一端(在两条祖先链分叉处的那个节点,即从这里"看出去"的对象)
  type: string;
  out: boolean;       // 方向:子节点 → 外部
  count: number;
  color: string;
}
export interface SpaceScene {
  id: string | null;  // null = 顶层空间
  nodes: SceneNode[];
  edges: SceneEdge[];
  external: ExternalLink[];
}

export interface CompiledView {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly layout: 'flat' | 'spaces';
  readonly look: 'galaxy' | 'plain';
  /** 进入空间的阈值:容器的显示直径占屏幕短边的比例 */
  readonly enterAt: number;
  /** 一个容器(null = 顶层)的空间:它的直接子节点、子节点之间的关系,以及通向外面的关系。结果会缓存。 */
  space(id: string | null): SpaceScene;
  /** 从顶层到该节点(含)的 id 链 */
  ancestors(id: string): string[];
  node(id: string): SceneNode | undefined;
  parentOf(id: string): string | undefined;
  /** 在已编译的外观上,按展开状态算出场景:只做线性扫描,不重算任何节点的大小/颜色/样式。 */
  fold(opts?: FoldOptions): Scene;
  /** 对全部(非模式)节点算一条布尔表达式,返回匹配的 id。和视图规则同一套列与函数;写错了会抛出 */
  matches(expr: string): string[];
  /** 保存的查询(~query/<名字>)的结果:算一次缓存;某条算不出来就带 error */
  queryResults(): QueryResult[];
  /** 这个节点的大小 / 颜色 / 形状由哪条规则决定(下标;-1 = 没有规则管它,用的是类型节点或默认) */
  explain(id: string): { size: number; color: number; style: number } | undefined;
}

/** 保存的查询 = 一个节点:~query/<名字>,kind=query,expr 是一条布尔表达式。结果随宇宙变化,所以是"动态区域"。 */
export const QUERY_PREFIX = `${SCHEMA_PREFIX}query/`;
export interface SavedQuery { name: string; id: string; label: string; expr: string; color?: string; summary?: string }
export interface QueryResult extends SavedQuery { members: string[]; error?: string }
export function listQueries(u: Universe): SavedQuery[] {
  const out: SavedQuery[] = [];
  for (const n of u.nodes.values()) {
    if (!n.id.startsWith(QUERY_PREFIX) || n.attrs.kind !== 'query' || n.attrs.expr === undefined) continue;
    const name = n.id.slice(QUERY_PREFIX.length);
    out.push({ name, id: n.id, label: n.label || name, expr: n.attrs.expr, color: n.attrs.color, summary: n.attrs.summary });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
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
// 形状按类型:类型节点(~dir、~module……)写了 shape 就用它,没写就是内置的(目录星云、文件恒星、模块带环、概念脉冲星)
const GALAXY_STYLE: StyleRule[] = [{ by: 'type' }];

/** 平面布局默认最多放多少个节点:力导向在浏览器里能流畅跑、标签还看得清的量级 */
export const DEFAULT_MAX_NODES = 1500;

export const BUILTIN_VIEWS: Record<string, ViewSpec> = {
  // 默认:从全局开始,放大哪里哪里展开成一个"域";收起的目录是一个小星系
  galaxy: {
    look: 'galaxy',
    layout: 'spaces',
    space: { enterAt: 0.42 },
    expand: { relation: 'contains' },
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
    layout: 'spaces',
    space: { enterAt: 0.42 },
    expand: { relation: 'contains' },
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
  // 文件夹作为 tag:文件夹本身不显示,而是打在文件上(颜色 = 顶层文件夹),同一 tag 的节点聚在一起
  tags: {
    look: 'galaxy',
    select: { hideTypes: ['dir'] },
    tags: { relation: 'contains', depth: 2 },
    size: [{ when: { type: 'file' }, attr: 'size', scale: 'sqrt', range: [2, 9] }, { by: 'degree', range: [3.5, 12] }],
    color: [{ when: { type: 'file' }, by: 'group', relation: 'contains', level: 1 }, { by: 'type' }],
    style: GALAXY_STYLE,
    relations: { contains: { mode: 'hidden' }, '*': { mode: 'line', distance: 120, strength: 0.15 } },
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
    layout: 'spaces',
    space: { enterAt: 0.42 },
    select: { hideTypes: ['file'] },
    expand: { relation: 'contains' },
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
    style: [{ by: 'type' }],
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

const SHAPE_LIST: Shape[] = ['dot', 'star', 'nebula', 'ringed', 'pulsar'];

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

/** 压缩邻接表(CSR):start[i]..start[i+1] 是 i 的孩子在 list 里的区间。 */
interface Csr { start: Int32Array; list: Int32Array }

function buildCsr(N: number, from: ArrayLike<number>, to: ArrayLike<number>, pick: (e: number) => boolean, count: number): Csr {
  const start = new Int32Array(N + 1);
  for (let e = 0; e < count; e++) if (pick(e)) start[from[e]! + 1]++;
  for (let i = 0; i < N; i++) start[i + 1]! += start[i]!;
  const fill = start.slice(0, N);
  const list = new Int32Array(start[N]!);
  for (let e = 0; e < count; e++) if (pick(e)) list[fill[from[e]!]!++] = to[e]!;
  return { start, list };
}

/** 沿邻接表向下汇总(迭代式后序遍历,不会栈溢出;遇到环就当那条边不存在)。 */
function rollupArr(N: number, adj: Csr, op: 'sum' | 'max' | 'count', own: Float64Array | null): Float64Array {
  const out = new Float64Array(N), st = new Uint8Array(N), ptr = new Int32Array(N);
  const stack: number[] = [];
  for (let s = 0; s < N; s++) {
    if (st[s]) continue;
    st[s] = 1; ptr[s] = adj.start[s]!; stack.push(s);
    while (stack.length > 0) {
      const v = stack[stack.length - 1]!;
      if (ptr[v]! < adj.start[v + 1]!) {
        const c = adj.list[ptr[v]!++]!;
        if (st[c] === 0) { st[c] = 1; ptr[c] = adj.start[c]!; stack.push(c); }
        continue;
      }
      let acc = op === 'count' ? 0 : (own ? own[v]! : 0);
      for (let k = adj.start[v]!; k < adj.start[v + 1]!; k++) {
        const c = adj.list[k]!;
        if (st[c] !== 2) continue;
        if (op === 'sum') acc += out[c]!;
        else if (op === 'max') acc = Math.max(acc, out[c]!);
        else acc += 1 + out[c]!;
      }
      out[v] = acc; st[v] = 2; stack.pop();
    }
  }
  return out;
}

/**
 * 编译:把"每个节点长什么样"一次算好,存成类型化数组。
 * 性能约定:宇宙或规格或信号变了才重新编译;展开/收起只调用 fold()。
 */
export function compileView(u: Universe, spec: ViewSpec, opts: CompileOptions = {}): CompiledView {
  const now = opts.now ?? Date.now();
  const nodeList = [...u.nodes.values()];
  const N = nodeList.length;
  const ids = nodeList.map((n) => n.id);
  const idx = new Map<string, number>();
  for (let i = 0; i < N; i++) idx.set(ids[i]!, i);
  const relation = spec.expand?.relation ?? 'contains';
  const sel = spec.select ?? {};

  // ---- 关系规则:按边类型编号,每种类型只查一次 ----
  const typeNames: string[] = [];
  const typeIdx = new Map<string, number>();
  const typeId = (t: string): number => {
    let i = typeIdx.get(t);
    if (i === undefined) { i = typeNames.length; typeNames.push(t); typeIdx.set(t, i); }
    return i;
  };
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

  // ---- 边:压成数组;顺手确定容器树(同一节点取第一条 relation 入边作父节点) ----
  const E0 = u.edges.size;
  const ef = new Int32Array(E0), et = new Int32Array(E0), ety = new Int32Array(E0);
  const eprop = new Uint8Array(E0);
  const parent = new Int32Array(N).fill(-1);
  let E = 0;
  // 一个节点在几个容器里时(contains 没有 single-parent):和文件路径对得上的那条(目录包含文件)进容器树,
  // 不然取第一条 —— 不取决于边在文件里的先后,模块包含文件时文件夹层级也不会被打乱
  const fsPair = (from: Node, to: Node): boolean => {
    const tf = to.attrs.file;
    if (from.attrs.type !== 'dir' || !tf) return false;
    const ff = from.attrs.file;
    return ff ? ff.endsWith('/') && tf.startsWith(ff) && tf !== ff : !tf.replace(/\/$/, '').includes('/');
  };
  const fsParent = new Uint8Array(N);
  for (const e of u.edges.values()) {
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a === undefined || b === undefined) continue;
    if (e.type === relation && a !== b && (parent[b] === -1 || !fsParent[b])) {
      const fs = fsPair(nodeList[a]!, nodeList[b]!);
      if (parent[b] === -1 || fs) { parent[b] = a; fsParent[b] = fs ? 1 : 0; }
    }
    ef[E] = a; et[E] = b; ety[E] = typeId(e.type);
    eprop[E] = e.attrs.status === 'proposed' ? 1 : 0;
    E++;
  }
  const nT = typeNames.length;
  const tRel = typeNames.map(relOf);
  const tShown = tRel.map((r) => r.mode !== 'hidden');
  const tSym = typeNames.map((t) => isSymmetric(u, t));
  const tColor = typeNames.map((t, i) => tRel[i]!.color ?? hashColor(`edge:${t}`));

  // ---- 断环 + 深度 ----
  const state = new Uint8Array(N), path: number[] = [];
  for (let s = 0; s < N; s++) {
    if (state[s]) continue;
    path.length = 0;
    let cur = s;
    while (cur >= 0 && state[cur] === 0) { state[cur] = 1; path.push(cur); cur = parent[cur]!; }
    if (cur >= 0 && state[cur] === 1) parent[cur] = -1; // 走回了本条链上的节点:环,在这里断开,它自己当根
    for (const v of path) state[v] = 2;
  }
  const depth = new Int32Array(N).fill(-1), climb: number[] = [];
  for (let s = 0; s < N; s++) {
    if (depth[s]! >= 0) continue;
    climb.length = 0;
    let cur = s;
    while (cur >= 0 && depth[cur]! < 0) { climb.push(cur); cur = parent[cur]!; }
    let d = cur >= 0 ? depth[cur]! : -1;
    for (let k = climb.length - 1; k >= 0; k--) depth[climb[k]!] = ++d;
  }
  // 按深度排序(计数排序),这样"先父后子"的单遍扫描就能算出可见性和代表节点
  let maxD = 0;
  for (let i = 0; i < N; i++) if (depth[i]! > maxD) maxD = depth[i]!;
  const bucket = new Int32Array(maxD + 2);
  for (let i = 0; i < N; i++) bucket[depth[i]! + 1]!++;
  for (let d = 0; d <= maxD; d++) bucket[d + 1]! += bucket[d]!;
  const order = new Int32Array(N);
  { const fill = bucket.slice(0, maxD + 1); for (let i = 0; i < N; i++) order[fill[depth[i]!]!++] = i; }
  // 容器树的孩子表(CSR)
  const treeKids = ((): Csr => {
    const start = new Int32Array(N + 1);
    for (let i = 0; i < N; i++) if (parent[i]! >= 0) start[parent[i]! + 1]!++;
    for (let i = 0; i < N; i++) start[i + 1]! += start[i]!;
    const fill = start.slice(0, N), list = new Int32Array(start[N]!);
    for (let i = 0; i < N; i++) if (parent[i]! >= 0) list[fill[parent[i]!]!++] = i;
    return { start, list };
  })();
  // 第二个、第三个容器:一个节点可以在几个容器里(contains 没有 single-parent),容器树只用第一条;
  // 其余的(和断环时断开的那条)画成淡线 —— 不是疆界,但看得见"它也属于那里"
  const second = new Uint8Array(E);
  { const rt = typeIdx.get(relation); if (rt !== undefined) for (let e = 0; e < E; e++) if (ety[e] === rt && parent[et[e]!] !== ef[e]) second[e] = 1; }
  const desc = new Int32Array(N);
  for (let k = N - 1; k >= 0; k--) { const v = order[k]!, p = parent[v]!; if (p >= 0) desc[p]! += desc[v]! + 1; }

  // ---- 度数:全图里"会显示的"边的条数。静态的,所以展开/收起时节点大小不会跳变 ----
  const degree = new Int32Array(N);
  for (let e = 0; e < E; e++) if (tShown[ety[e]!]) { degree[ef[e]!]!++; degree[et[e]!]!++; }

  // ---- 数值数组(惰性):属性、信号、汇总 ----
  const adjCache = new Map<number, Csr>();
  const adjOf = (relName: string): Csr => {
    const t = typeIdx.get(relName);
    if (t === undefined) return { start: new Int32Array(N + 1), list: new Int32Array(0) };
    let a = adjCache.get(t);
    if (!a) { a = buildCsr(N, ef, et, (e) => ety[e] === t, E); adjCache.set(t, a); }
    return a;
  };
  /** 信号里"有记录"的节点才有值,其余是 NaN(用来覆盖同名属性,如监听器报告的实时 size) */
  const sparseSignal = (name: string): Float64Array | null => {
    const src = opts.signals?.[name];
    if (!src) return null;
    const a = new Float64Array(N).fill(NaN);
    if (src instanceof Map) for (let i = 0; i < N; i++) { const v = src.get(ids[i]!); if (v !== undefined) a[i] = v; }
    else for (let i = 0; i < N; i++) { const v = src[ids[i]!]; if (v !== undefined) a[i] = v; }
    return a;
  };
  const attrCache = new Map<string, Float64Array>();
  const attrArr = (attr: string): Float64Array => {
    let a = attrCache.get(attr);
    if (!a) {
      a = new Float64Array(N);
      for (let i = 0; i < N; i++) { const x = Number(nodeList[i]!.attrs[attr]); a[i] = Number.isFinite(x) ? x : 0; }
      const over = sparseSignal(attr); // 同名信号(如实时 size)覆盖属性
      if (over) for (let i = 0; i < N; i++) if (over[i]! === over[i]!) a[i] = over[i]!;
      attrCache.set(attr, a);
    }
    return a;
  };
  const sigCache = new Map<string, Float64Array>();
  const signalArr = (name: string, rel?: { relation: string; op: 'max' | 'sum' | 'count' }): Float64Array => {
    const key = `${name}|${rel?.relation ?? ''}|${rel?.op ?? ''}`;
    let a = sigCache.get(key);
    if (!a) {
      const src = opts.signals?.[name];
      const base = new Float64Array(N);
      if (src instanceof Map) for (let i = 0; i < N; i++) base[i] = src.get(ids[i]!) ?? 0;
      else if (src) for (let i = 0; i < N; i++) base[i] = src[ids[i]!] ?? 0;
      a = rel ? rollupArr(N, adjOf(rel.relation), rel.op, base) : base;
      sigCache.set(key, a);
    }
    return a;
  };


  // ---- 表达式环境:标识符 → 列(类型化数组/字符串数组),函数节点 → 用户函数 ----
  const childCount = new Int32Array(N);
  for (let i = 0; i < N; i++) childCount[i] = treeKids.start[i + 1]! - treeKids.start[i]!;
  const colCache = new Map<string, ArrayLike<number | string>>();
  const exprSignal = (name: string): Float64Array | null => (opts.signals?.[name] ? signalArr(name) : null);
  const exprColumn = (name: string): ArrayLike<number | string> => {
    let col = colCache.get(name);
    if (col) return col;
    switch (name) {
      case 'id': col = ids; break;
      case 'label': col = nodeList.map((n) => n.label); break;
      case 'degree': col = degree; break;
      case 'depth': col = depth; break;
      case 'children': col = childCount; break;
      case 'descendants': col = desc; break;
      default: {
        const sig = exprSignal(name);
        const hasAttr = nodeList.some((n) => n.attrs[name] !== undefined);
        col = sig && !hasAttr ? sig : undefined;
        if (!col) { // 属性列:全是数字就做成数值列,否则是字符串列(缺失 → 0 / '')
          let numeric = true, any = false;
          for (let i = 0; i < N; i++) { const v = nodeList[i]!.attrs[name]; if (v === undefined || v === '') continue; any = true; if (!Number.isFinite(Number(v))) { numeric = false; break; } }
          if (any && numeric) { col = attrArr(name); }
          else col = nodeList.map((n) => n.attrs[name] ?? '');
        }
      }
    }
    colCache.set(name, col);
    return col;
  };
  // ---- 路径条件(表达式里的 from / to / near / out / into / query):全部按参数缓存,惰性计算 ----
  const dirAdj = new Map<string, Csr>();
  /** 按方向的邻接表:out 顺着边,in 逆着边,both 都算;对称的边类型两头都算 */
  const adjDir = (type: string | undefined, dir: 'out' | 'in' | 'both'): Csr => {
    const key = `${type ?? ''}|${dir}`;
    let a = dirAdj.get(key);
    if (a) return a;
    const t = type === undefined ? -1 : typeIdx.get(type) ?? -2;
    const A = new Int32Array(2 * E), B = new Int32Array(2 * E);
    let m = 0;
    if (t !== -2) for (let e = 0; e < E; e++) {
      if (t >= 0 && ety[e] !== t) continue;
      const both = dir === 'both' || tSym[ety[e]!];
      if (dir === 'out' || both) { A[m] = ef[e]!; B[m] = et[e]!; m++; }
      if (dir === 'in' || both) { A[m] = et[e]!; B[m] = ef[e]!; m++; }
    }
    a = buildCsr(N, A, B, () => true, m);
    dirAdj.set(key, a);
    return a;
  };
  const reachCache = new Map<string, Uint8Array>();
  const countCache = new Map<string, Int32Array>();
  const queryCache = new Map<string, Uint8Array>();
  const queryStack: string[] = [];
  const graph: ExprGraph = {
    cur: { i: 0 },
    reach(root, type, dir, maxDepth) {
      const key = `${root}\u0000${type ?? ''}\u0000${dir}\u0000${maxDepth}`;
      let r = reachCache.get(key);
      if (r) return r;
      r = new Uint8Array(N);
      const s = idx.get(root);
      if (s !== undefined) {
        const adj = adjDir(type, dir), seen = new Uint8Array(N);
        seen[s] = 1;
        let frontier = [s];
        for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
          const next: number[] = [];
          for (const v of frontier) {
            for (let k = adj.start[v]!; k < adj.start[v + 1]!; k++) { const w = adj.list[k]!; if (!seen[w]) { seen[w] = 1; r[w] = 1; next.push(w); } }
          }
          frontier = next;
        }
      }
      reachCache.set(key, r);
      return r;
    },
    count(type, other, dir) {
      const key = `${type ?? ''}\u0000${other ?? ''}\u0000${dir}`;
      let c = countCache.get(key);
      if (c) return c;
      c = new Int32Array(N);
      const t = type === undefined ? -1 : typeIdx.get(type) ?? -2, o = other === undefined ? -1 : idx.get(other) ?? -2;
      if (t !== -2 && o !== -2) for (let e = 0; e < E; e++) {
        if (t >= 0 && ety[e] !== t) continue;
        const a = dir === 'out' ? ef[e]! : et[e]!, b = dir === 'out' ? et[e]! : ef[e]!;
        if (o < 0 || b === o) c[a]!++;
        if (tSym[ety[e]!] && (o < 0 || a === o)) c[b]!++; // 对称边:两头都算出边也都算入边
      }
      countCache.set(key, c);
      return c;
    },
    query(name) {
      let r = queryCache.get(name);
      if (r) return r;
      const qn = u.nodes.get(QUERY_PREFIX + name);
      if (!qn || qn.attrs.expr === undefined) throw new Error(`没有保存的查询 "${name}"`);
      if (queryStack.includes(name)) throw new Error(`查询循环引用: ${[...queryStack, name].join(' → ')}`);
      queryStack.push(name);
      const outer = graph.cur.i; // 里面会把 cur 走一遍,算完要还原,外面那条表达式还在算第 outer 个节点
      try {
        const f = exprFor(qn.attrs.expr);
        r = new Uint8Array(N);
        for (let i = 0; i < N; i++) if (!isSchemaId(ids[i]!) && f(i)) r[i] = 1;
      } finally { queryStack.pop(); graph.cur.i = outer; }
      queryCache.set(name, r);
      return r;
    },
  };

  const userFns: Record<string, (...args: never[]) => unknown> = {};
  const exprEnv: ExprEnv = { column: exprColumn, fns: userFns, now, graph };
  for (const n of nodeList) { // 函数节点:~fn/<名字>,kind=function,code 是一个函数表达式
    if (!n.id.startsWith(`${SCHEMA_PREFIX}fn/`) || n.attrs.kind !== 'function' || !n.attrs.code) continue;
    userFns[n.id.slice(SCHEMA_PREFIX.length + 3)] = compileFn(n.attrs.code, exprEnv);
  }
  const exprCache = new Map<string, (i: number) => unknown>();
  const exprFor = (src: string): ((i: number) => unknown) => {
    let f = exprCache.get(src);
    if (!f) { f = compileExpr(src, exprEnv); exprCache.set(src, f); }
    return f;
  };
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
    if (r.rollup) return rollupArr(N, adjOf(r.rollup.relation), r.rollup.op, r.attr ? attrArr(r.attr) : null);
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
    const si = SHAPE_LIST.indexOf((shape ?? 'star') as Shape);
    shapeIdx[i] = si >= 0 ? si : 1;
  }

  // ---- 边的静态外观:每种类型一份 ----
  const tEdge = tRel.map((rel, t) => ({
    mode: rel.mode as SceneEdge['mode'],
    width: rel.width ?? 1,
    arrow: rel.arrow ?? (rel.mode === 'line' && !tSym[t]),
    distance: rel.distance, strength: rel.strength, spin: rel.spin,
  }));
  const hasValue = new Uint8Array(N);
  for (let i = 0; i < N; i++) hasValue[i] = sizeRule[i]! >= 0 ? 1 : 0;

  const expandAuto = spec.expand?.auto;
  const look = spec.look ?? 'galaxy';

  const tagDepth = spec.tags ? (spec.tags.depth ?? 2) + 1 : 0; // 根(挂载点)本身不算 tag

  function fold(f: FoldOptions = {}): Scene {
    // 1. 哪些容器展开
    const maxDepth = f.depth ?? spec.expand?.depth ?? Infinity;
    const budget = f.maxNodes ?? spec.expand?.maxNodes ?? (maxDepth === Infinity ? DEFAULT_MAX_NODES : Infinity);
    const forced = new Int8Array(N); // 用户手动:1 展开,-1 收起
    for (const id of f.expanded ?? []) { const i = idx.get(id); if (i !== undefined) forced[i] = 1; }
    for (const id of f.collapsed ?? []) { const i = idx.get(id); if (i !== undefined) forced[i] = -1; }
    const open = new Uint8Array(N);
    if (budget === Infinity) {
      for (let i = 0; i < N; i++) open[i] = forced[i] ? (forced[i]! > 0 ? 1 : 0) : depth[i]! < maxDepth ? 1 : 0;
    } else {
      // 一层一层往下:这一层可见的容器里,先展开孩子少的,直到再展开就超出预算。
      // 不在画面里的容器(没被选中,比如 tags 视图隐藏的目录)是"透明"的:收起它只会把内容藏起来,所以总是展开。
      const vis = new Uint8Array(N), kidsOf = (v: number) => treeKids.start[v + 1]! - treeKids.start[v]!;
      let count = 0;
      for (let k = 0; k < N;) {
        const d = depth[order[k]!]!, cands: number[] = [];
        let room = budget;
        for (; k < N && depth[order[k]!] === d; k++) {
          const v = order[k]!, p = parent[v]!;
          if (p >= 0 && !(vis[p] && open[p])) continue;
          vis[v] = 1;
          if (selected[v]) count++;
          if (kidsOf(v) === 0) continue;
          if (forced[v]) open[v] = forced[v]! > 0 ? 1 : 0;
          else if (d >= maxDepth) open[v] = 0;
          else if (!selected[v]) open[v] = 1;
          else { cands.push(v); continue; }
          if (open[v]) room -= kidsOf(v);
        }
        room -= count;
        cands.sort((a, b) => kidsOf(a) - kidsOf(b));
        for (const v of cands) { if (kidsOf(v) > room) break; open[v] = 1; room -= kidsOf(v); }
      }
    }

    // 2. 可见性与代表节点:按深度从小到大扫一遍
    const treeVis = new Uint8Array(N), rep = new Int32Array(N);
    for (let k = 0; k < N; k++) {
      const v = order[k]!, p = parent[v]!;
      if (p < 0) { treeVis[v] = 1; rep[v] = v; }
      else if (treeVis[p] && open[p]) { treeVis[v] = 1; rep[v] = v; }
      else rep[v] = rep[p]!;
    }
    const visible = new Uint8Array(N);
    for (let i = 0; i < N; i++) visible[i] = treeVis[i]! & selected[i]!;

    // 3. 边:折叠掉的内部关系提升到容器上,按 (起点,类型,终点) 汇总
    interface Agg { from: number; to: number; type: number; count: number; real: boolean; proposed: boolean; sec: number }
    const aggs = new Map<number, Agg>();
    for (let e = 0; e < E; e++) {
      const t = ety[e]!;
      if (!tShown[t]) continue;
      let a = rep[ef[e]!]!, b = rep[et[e]!]!;
      if (a === b || !visible[a] || !visible[b]) continue;
      const lifted = a !== ef[e] || b !== et[e];
      if (lifted && tSym[t] && ids[a]! > ids[b]!) { const x = a; a = b; b = x; }
      const key = ((a * N + b) * nT + t) * 2 + second[e]!;
      let g = aggs.get(key);
      if (!g) { g = { from: a, to: b, type: t, count: 0, real: false, proposed: true, sec: second[e]! }; aggs.set(key, g); }
      g.count++;
      if (!lifted) g.real = true;
      if (!eprop[e]) g.proposed = false;
    }

    // 4. 场景
    const nodes: SceneNode[] = [];
    for (let i = 0; i < N; i++) {
      if (!visible[i]) continue;
      const sn: SceneNode = { id: ids[i]!, label: nodeList[i]!.label, r: Math.round(rad[i]! * 100) / 100, color: color[i]!, shape: SHAPE_LIST[shapeIdx[i]!]! };
      if (hasValue[i]) sn.value = ruleVals[sizeRule[i]!]![i]!;
      const p = parent[i]!;
      if (p >= 0 && visible[p]) sn.parent = ids[p]!;
      if (tagDepth > 0) {
        const tags: string[] = [];
        for (let a = parent[i]!; a >= 0; a = parent[a]!) if (depth[a]! < tagDepth && depth[a]! > 0) tags.push(ids[a]!);
        if (tags.length) sn.tags = tags.reverse();
      }
      const cc = treeKids.start[i + 1]! - treeKids.start[i]!;
      if (cc > 0) {
        sn.container = true; sn.children = cc; sn.descendants = desc[i]!; sn.expanded = open[i] === 1;
        if (!sn.expanded) { // 收起的容器:取最多 48 个后代作为缩影(广度优先,够数就停)
          const kids: Array<[string, number, string]> = [], queue = [i];
          for (let q = 0; q < queue.length && kids.length < 48; q++) {
            const v = queue[q]!;
            for (let k = treeKids.start[v]!; k < treeKids.start[v + 1]! && kids.length < 48; k++) {
              const c = treeKids.list[k]!;
              queue.push(c);
              if (selected[c]) kids.push([color[c]!, rad[c]!, ids[c]!]);
            }
          }
          sn.kids = kids;
        }
      }
      nodes.push(sn);
    }
    const edges: SceneEdge[] = [];
    for (const g of aggs.values()) edges.push(mkEdge(g.from, g.to, g.type, g.count, g.real, g.proposed, g.sec));
    const expand: Scene['expand'] = { relation };
    if (expandAuto) expand.auto = expandAuto;
    return { look, nodes, edges, expand };
  }

  // ---------- 空间:每个容器一个独立的小世界 ----------
  const relTypeIdx = typeIdx.get(relation);
  const mkNode = (i: number): SceneNode => {
    const sn: SceneNode = { id: ids[i]!, label: nodeList[i]!.label, r: Math.round(rad[i]! * 100) / 100, color: color[i]!, shape: SHAPE_LIST[shapeIdx[i]!]! };
    if (hasValue[i]) sn.value = ruleVals[sizeRule[i]!]![i]!;
    const cc = treeKids.start[i + 1]! - treeKids.start[i]!;
    if (cc > 0) {
      sn.container = true; sn.children = cc; sn.descendants = desc[i]!; sn.expanded = false;
      const kids: Array<[string, number, string]> = [], queue = [i];
      for (let q = 0; q < queue.length && kids.length < 48; q++) {
        const v = queue[q]!;
        for (let k = treeKids.start[v]!; k < treeKids.start[v + 1]! && kids.length < 48; k++) {
          const c = treeKids.list[k]!;
          queue.push(c);
          if (selected[c]) kids.push([color[c]!, rad[c]!, ids[c]!]);
        }
      }
      sn.kids = kids;
    }
    return sn;
  };
  /** sec:第二个容器的 contains(见 second):疆界 / 轨道画不出"也属于",改成淡线,不带距离、公转 */
  function mkEdge(from: number, to: number, t: number, count: number, real: boolean, proposed: boolean, sec = 0): SceneEdge {
    const te = tEdge[t]!;
    const weak = sec === 1 && (te.mode === 'region' || te.mode === 'orbit');
    const edge: SceneEdge = {
      from: ids[from]!, to: ids[to]!, type: typeNames[t]!, mode: weak ? 'faint' : te.mode,
      color: tColor[t]!, width: te.width, arrow: weak ? true : te.arrow, proposed, count, lifted: !real,
    };
    if (weak) return edge;
    if (te.distance !== undefined) edge.distance = te.distance;
    if (te.strength !== undefined) edge.strength = te.strength;
    if (te.spin !== undefined) edge.spin = te.spin;
    return edge;
  }
  const chainOf = (v: number): number[] => { const c: number[] = []; for (let x = v; x >= 0; x = parent[x]!) c.push(x); return c.reverse(); };
  const spaceCache = new Map<number, SpaceScene>();

  function space(id: string | null): SpaceScene {
    const ci = id === null ? -1 : (idx.get(id) ?? -2);
    if (ci === -2) return { id, nodes: [], edges: [], external: [] };
    const hit = spaceCache.get(ci);
    if (hit) return hit;

    // 直接子节点:没被选择过滤掉的孩子;被过滤掉的容器"透明",它的孩子提升上来
    const children: number[] = [];
    const queue: number[] = [];
    if (ci < 0) { for (let i = 0; i < N; i++) if (parent[i]! < 0) queue.push(i); }
    else for (let k = treeKids.start[ci]!; k < treeKids.start[ci + 1]!; k++) queue.push(treeKids.list[k]!);
    for (let h = 0; h < queue.length; h++) {
      const v = queue[h]!;
      if (selected[v]) children.push(v);
      else for (let k = treeKids.start[v]!; k < treeKids.start[v + 1]!; k++) queue.push(treeKids.list[k]!);
    }
    // rep:每个节点属于哪个直接子节点(在这个空间之外的 = -1)
    const rep = new Int32Array(N).fill(-1);
    const stack: number[] = [];
    for (const c of children) {
      stack.push(c);
      while (stack.length > 0) { const v = stack.pop()!; rep[v] = c; for (let k = treeKids.start[v]!; k < treeKids.start[v + 1]!; k++) stack.push(treeKids.list[k]!); }
    }
    const here = ci < 0 ? new Set<number>() : new Set<number>(chainOf(ci));

    interface Agg { from: number; to: number; type: number; count: number; real: boolean; proposed: boolean; sec: number }
    const internal = new Map<number, Agg>();
    const external = new Map<string, ExternalLink & { _k: string }>();
    for (let e = 0; e < E; e++) {
      const t = ety[e]!;
      if (!tShown[t]) continue;
      const ra = rep[ef[e]!]!, rb = rep[et[e]!]!;
      if (ra < 0 && rb < 0) continue;
      if (ra >= 0 && rb >= 0) {
        if (ra === rb) continue;
        let a = ra, b = rb;
        const lifted = a !== ef[e] || b !== et[e];
        if (lifted && tSym[t] && ids[a]! > ids[b]!) { const x = a; a = b; b = x; }
        const key = ((a * N + b) * nT + t) * 2 + second[e]!;
        let g = internal.get(key);
        if (!g) { g = { from: a, to: b, type: t, count: 0, real: false, proposed: true, sec: second[e]! }; internal.set(key, g); }
        g.count++;
        if (!lifted) g.real = true;
        if (!eprop[e]) g.proposed = false;
        continue;
      }
      if (t === relTypeIdx && !second[e]) continue; // 容器树上的"包含"是空间本身,不当作外部链接;第二个容器的照样伸出去
      const out = ra >= 0, inside = out ? ra : rb, otherIdx = out ? et[e]! : ef[e]!;
      let other = otherIdx;
      for (const v of chainOf(otherIdx)) if (!here.has(v)) { other = v; break; } // 两条祖先链分叉处
      const key = `${inside}|${t}|${out ? 1 : 0}|${other}`;
      const x = external.get(key);
      if (x) x.count++;
      else external.set(key, { _k: key, node: ids[inside]!, other: ids[other]!, type: typeNames[t]!, out, count: 1, color: tColor[t]! });
    }
    const out: SpaceScene = {
      id,
      nodes: children.map(mkNode),
      edges: [...internal.values()].map((g) => mkEdge(g.from, g.to, g.type, g.count, g.real, g.proposed, g.sec)),
      external: [...external.values()].map(({ _k, ...rest }) => rest),
    };
    spaceCache.set(ci, out);
    return out;
  }

  const matches = (expr: string): string[] => {
    const f = compileExpr(expr, exprEnv), out: string[] = [];
    for (let i = 0; i < N; i++) if (!isSchemaId(ids[i]!) && f(i)) out.push(ids[i]!);
    return out;
  };
  let queryList: QueryResult[] | null = null;
  const queryResults = (): QueryResult[] => (queryList ??= listQueries(u).map((q): QueryResult => {
    try {
      const r = graph.query(q.name), members: string[] = [];
      for (let i = 0; i < N; i++) if (r[i]) members.push(ids[i]!);
      return { ...q, members };
    } catch (err) { return { ...q, members: [], error: (err as Error).message }; }
  }));

  return {
    nodeCount: N, edgeCount: E, fold, space, matches, queryResults,
    layout: spec.layout ?? 'flat',
    look,
    enterAt: spec.space?.enterAt ?? 0.42,
    ancestors: (id) => { const i = idx.get(id); return i === undefined ? [] : chainOf(i).map((v) => ids[v]!); },
    node: (id) => { const i = idx.get(id); return i === undefined ? undefined : mkNode(i); },
    parentOf: (id) => { const i = idx.get(id); return i === undefined || parent[i]! < 0 ? undefined : ids[parent[i]!]!; },
    explain: (id) => { const i = idx.get(id); return i === undefined ? undefined : { size: sizeRule[i]!, color: colorRuleOf[i]!, style: styleRuleOf[i]! }; },
  };
}

/** 一步到位:编译 + 折叠。交互场景请自己持有 compileView 的结果,展开/收起只调 fold。 */
export function evaluateView(u: Universe, spec: ViewSpec, opts: EvalOptions = {}): Scene {
  return compileView(u, spec, opts).fold(opts);
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
  spec: ['look', 'layout', 'space', 'tags', 'select', 'expand', 'size', 'color', 'style', 'relations', 'forces'],
  select: ['onlyTypes', 'hideTypes', 'withRelations', 'schema', 'where'],
  expand: ['relation', 'depth', 'maxNodes', 'auto'],
  size: ['when', 'attr', 'expr', 'signal', 'recency', 'by', 'rollup', 'scale', 'range'],
  color: ['when', 'by', 'relation', 'level', 'value', 'expr', 'signal', 'halfLifeDays', 'from', 'to', 'rollup'],
  style: ['when', 'shape', 'expr', 'by'],
  relation: ['mode', 'distance', 'strength', 'color', 'width', 'arrow', 'spin'],
};
const SHAPES = ['dot', 'star', 'nebula', 'ringed', 'pulsar'];
const MODES = ['orbit', 'region', 'line', 'faint', 'hidden'];

/** 检查视图规格,返回问题列表(空 = 没问题)。CLI、查看器编辑器和 AI 写入前都应该先过一遍。 */
export function validateSpec(spec: unknown, u?: Universe): string[] {
  const bad: string[] = [];
  const checkSrc = (src: unknown, where: string) => {
    if (typeof src !== 'string') { bad.push(`${where} 必须是字符串表达式`); return; }
    const err = checkExpr(src);
    if (err) bad.push(`${where} 的表达式有误: ${err}(${src})`);
    if (u) for (const m of src.matchAll(/\bfn\.(\w+)/g)) if (!u.nodes.has(`${SCHEMA_PREFIX}fn/${m[1]}`)) bad.push(`${where}: fn.${m[1]} 不存在(需要节点 ${SCHEMA_PREFIX}fn/${m[1]},kind=function,带 code)`);
  };
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const unknownKeys = (o: Record<string, unknown>, allowed: string[], where: string) => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) bad.push(`${where}: 未知字段 "${k}"(可用: ${allowed.join(', ')})`);
  };
  if (!isObj(spec)) return ['规格必须是一个 JSON 对象'];
  unknownKeys(spec, KEYS.spec, '规格');
  if (spec.forces !== undefined && (!Array.isArray(spec.forces) || !spec.forces.every((f) => typeof f === 'string'))) bad.push('forces 必须是函数名字符串数组(如 ["~fn/名字"])');
  if (spec.look !== undefined && !['galaxy', 'plain'].includes(spec.look as string)) bad.push('look 只能是 galaxy 或 plain');
  if (spec.layout !== undefined && !['flat', 'spaces'].includes(spec.layout as string)) bad.push('layout 只能是 flat 或 spaces');
  if (spec.select !== undefined) {
    if (!isObj(spec.select)) bad.push('select 必须是对象');
    else { unknownKeys(spec.select, KEYS.select, 'select'); if (spec.select.where !== undefined) checkSrc(spec.select.where, 'select.where'); }
  }
  if (spec.expand !== undefined) isObj(spec.expand) ? unknownKeys(spec.expand, KEYS.expand, 'expand') : bad.push('expand 必须是对象');
  for (const key of ['size', 'color', 'style'] as const) {
    const rules = spec[key];
    if (rules === undefined) continue;
    if (!Array.isArray(rules)) { bad.push(`${key} 必须是规则数组(按顺序匹配,第一条生效)`); continue; }
    rules.forEach((r, i) => {
      if (!isObj(r)) { bad.push(`${key}[${i}] 必须是对象`); return; }
      unknownKeys(r, KEYS[key], `${key}[${i}]`);
      if (key === 'style' && r.by !== undefined && r.by !== 'type') bad.push(`style[${i}].by 只能是 "type"(得到 ${JSON.stringify(r.by)})`);
      if (key === 'style' && r.expr === undefined && r.by === undefined && !SHAPES.includes(r.shape as string)) bad.push(`style[${i}].shape 必须是 ${SHAPES.join('/')}(或写 expr、by: "type")`);
      if (r.expr !== undefined) checkSrc(r.expr, `${key}[${i}].expr`);
      if (typeof r.when === 'string') checkSrc(r.when, `${key}[${i}].when`);
      if (key === 'size' && r.by !== undefined && r.by !== 'degree') bad.push(`size[${i}].by 只能是 "degree"(得到 ${JSON.stringify(r.by)})`);
      if (key === 'color' && r.by !== undefined && !(typeof r.by === 'string' && /^(type|group|recency|attr:.+)$/.test(r.by))) bad.push(`color[${i}].by 只能是 type / group / recency / attr:<属性名>(得到 ${JSON.stringify(r.by)})`);
      if (r.rollup !== undefined && !(isObj(r.rollup) && typeof r.rollup.relation === 'string' && ['sum', 'max', 'count'].includes(r.rollup.op as string))) bad.push(`${key}[${i}].rollup 应为 {"relation":"contains","op":"sum|max|count"}`);
      if (key === 'size' && r.scale !== undefined && !['sqrt', 'log', 'linear'].includes(r.scale as string)) bad.push(`size[${i}].scale 必须是 sqrt/log/linear`);
      if (key === 'size' && r.range !== undefined && !(Array.isArray(r.range) && r.range.length === 2 && r.range.every((x) => typeof x === 'number'))) bad.push(`size[${i}].range 必须是 [最小, 最大]`);
      if (r.when !== undefined && !isObj(r.when) && typeof r.when !== 'string') bad.push(`${key}[${i}].when 必须是对象或表达式字符串`);
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
