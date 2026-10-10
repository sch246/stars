// 视图规格:写法(规则的类型)、内置视图、校验、从宇宙里列出视图。
// 视图 = 一份规格 + 宇宙 → 场景;规格存在宇宙里(kind=view 的节点,spec 属性是 JSON),所以改规格就是改图。
// 怎么算出场景在 view.ts(外观)、viewgraph.ts(图的索引)、viewexpr.ts(表达式)、viewfold.ts(折叠与空间)。
// Node 和浏览器里都跑。

import { type Universe, SCHEMA_PREFIX } from './model.ts';
import { checkExpr } from './expr.ts';
import type { QueryResult } from './query.ts';

export type Shape = 'dot' | 'star' | 'nebula' | 'ringed' | 'pulsar';
export const SHAPES: Shape[] = ['dot', 'star', 'nebula', 'ringed', 'pulsar'];
/** region:不画线,子节点被一个"域"包围;orbit:子绕父转;line/faint:连线;hidden:不显示 */
export type RelationMode = 'orbit' | 'region' | 'line' | 'faint' | 'hidden';

/** 规则的前提:所有 key=value 都相等才匹配(key=type 时匹配节点类型)。省略 = 恒匹配。 */
export type When = Record<string, string> | string;

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
  /** 容器树里的直接孩子(按容器关系的第一条;不管过滤和展开) */
  children(id: string): string[];
  /** 容器关系(视图的 expand.relation,默认 contains) */
  readonly relation: string;
  /** 在已编译的外观上,按展开状态算出场景:只做线性扫描,不重算任何节点的大小/颜色/样式。 */
  fold(opts?: FoldOptions): Scene;
  /** 对全部(非模式)节点算一条布尔表达式,返回匹配的 id。和视图规则同一套列与函数;写错了会抛出 */
  matches(expr: string): string[];
  /** 保存的查询(~query/<名字>)的结果:算一次缓存;某条算不出来就带 error */
  queryResults(): QueryResult[];
  /** 这个节点的大小 / 颜色 / 形状由哪条规则决定(下标;-1 = 没有规则管它,用的是类型节点或默认) */
  explain(id: string): { size: number; color: number; style: number } | undefined;
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
      if (key === 'style' && r.expr === undefined && r.by === undefined && !SHAPES.includes(r.shape as Shape)) bad.push(`style[${i}].shape 必须是 ${SHAPES.join('/')}(或写 expr、by: "type")`);
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
