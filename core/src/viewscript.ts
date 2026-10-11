// 视图脚本:一个 JS 模块就是一个视图模板。导出的函数各接管一步:拿到下面算出的值(规则的,或更下层脚本的),
// 返回新的;不返回(undefined)= 不改。没导出的步骤照旧按规则算。怎么叠成几层见 viewlayers.ts,在哪一步调用见 view.ts。
//
//   export const spec = { base: 'galaxy' };              // 这一层的规则,和视图规格同一种写法
//   export const params = { 半衰期: 10 };                  // 参数的默认值;视图里写的 params 盖掉它
//   export function color(n, v, c) { return n.stale ? '#ff5a5a' : c; }
//
// n 是一个节点:n.id、n.label、n.type、n.attrs(原始字符串);别的名字都是「列」,和表达式里的标识符一样:
//   n.size、n.ext、n.degree、n.depth、n.children(孩子数)、n.descendants、n.fileChanged、n.touched、n.stale ……
//   结构:n.parent(容器,没有 = null)、n.kids(容器树里的孩子)、n.edges(类型?, 'out' | 'in' | 'both')。
// v 是这次计算:v.params、v.now、v.spec(合并好的规格)、v.expr('表达式')、v.query('名字')、v.fn.名字、v.node(id)、v.nodes、
//   v.col('size')(整列)、v.max(f)(全图上的最大值,按函数缓存)、v.scale(x, max, 'sqrt' | 'log' | 'linear', [lo, hi])、v.shapes、v.warn(消息),
//   以及表达式里的辅助函数(同名同义):v.mix、v.hsl、v.hash、v.days、v.recent、v.clamp、v.log1p……
// Node 和浏览器里都跑。

import { isSchemaId } from './model.ts';
import { helpers } from './expr.ts';
import { SHAPES, type Shape, type ViewSpec } from './viewspec.ts';
import { buildCsr, type Csr, type ViewGraph } from './viewgraph.ts';
import type { ViewExprs } from './viewexpr.ts';
import type { EdgeLook } from './viewfold.ts';

export interface NodeRef {
  readonly i: number;
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly attrs: Readonly<Record<string, string | undefined>>;
  readonly parent: NodeRef | null;
  readonly kids: NodeRef[];
  edges(type?: string, dir?: 'out' | 'in' | 'both'): Array<{ type: string; node: NodeRef; out: boolean; proposed: boolean }>;
  readonly [column: string]: unknown;
}
export interface ViewCtx {
  readonly params: Record<string, unknown>;
  readonly now: number;
  readonly spec: ViewSpec;
  readonly shapes: readonly Shape[];
  readonly nodes: NodeRef[];
  readonly fn: Record<string, (...args: never[]) => unknown>;
  expr(src: string): (n: NodeRef) => unknown;
  query(name: string): (n: NodeRef) => boolean;
  col(name: string): ArrayLike<number | string>;
  node(id: string): NodeRef | undefined;
  max(f: (n: NodeRef) => number): number;
  scale(x: number, max: number, scale?: 'sqrt' | 'log' | 'linear', range?: [number, number]): number;
  warn(msg: string): void;
  // 表达式里的辅助函数(同名同义)
  mix(a: string, b: string, t: number): string;
  hsl(h: number, s: number, l: number): string;
  hash(s: string): string;
  /** 距今多少天;没有记录 = Infinity */
  days(t: number): number;
  /** 新鲜度 0..1:每过一个半衰期减半;没有记录 = 0 */
  recent(t: number, halfLifeDays?: number): number;
  clamp(x: number, lo: number, hi: number): number;
  readonly [helper: string]: unknown;
}
/** looks() 拿到的图:按下标的数组 */
export interface LooksGraph {
  N: number; E: number; ids: string[]; parent: Int32Array; depth: Int32Array; degree: Int32Array;
  ef: Int32Array; et: Int32Array; ety: Int32Array; typeNames: string[];
}
/** looks() 直接改的整列外观;shape 是 v.shapes 里的下标 */
export interface LooksArrays { selected: Uint8Array; rad: Float32Array; color: string[]; shape: Uint8Array; label: string[]; edge: EdgeLook[] }

export interface ViewModule {
  spec?: ViewSpec;
  params?: Record<string, unknown>;
  /** 每个(非模式)节点一次;base = 规则的结论 */
  select?(n: NodeRef, v: ViewCtx, base: boolean): boolean | void;
  /** 入选的节点各一次;r = 下面算出的半径(像素),返回新的半径 */
  size?(n: NodeRef, v: ViewCtx, r: number): number | void;
  color?(n: NodeRef, v: ViewCtx, c: string): string | void;
  shape?(n: NodeRef, v: ViewCtx, s: Shape): Shape | void;
  label?(n: NodeRef, v: ViewCtx, t: string): string | void;
  /** 每种边类型一次:返回 { mode, color, width, arrow, distance, strength, spin } 里想改的几项 */
  edge?(type: string, v: ViewCtx, base: Readonly<EdgeLook>): Partial<EdgeLook> | void;
  /** 查看器里物理每一帧调用,和 spec.forces 的函数节点一样 */
  forces?(nodes: unknown[], links: unknown[], alpha: number, ctx: unknown): void;
  /** 最后一次,整列改(节点很多、逐个调用嫌慢时用) */
  looks?(g: LooksGraph, v: ViewCtx, base: LooksArrays): void;
}
export const VIEW_HOOKS = ['select', 'size', 'color', 'shape', 'label', 'edge', 'forces', 'looks'] as const;
export type ViewHook = typeof VIEW_HOOKS[number];
const MODULE_KEYS = new Set<string>([...VIEW_HOOKS, 'spec', 'params', 'default']);

/** import() 得到的模块 → 视图模块(也认 export default { … });导出了不认识的名字(多半是打错,比如 colour)记进 problems */
export function viewModuleOf(ns: Record<string, unknown>, problems: string[] = []): ViewModule {
  const d = ns.default && typeof ns.default === 'object' ? ns.default as Record<string, unknown> : {};
  const m: Record<string, unknown> = { ...d, ...ns };
  delete m.default;
  for (const k of Object.keys(m)) if (!MODULE_KEYS.has(k)) problems.push(`导出了不认识的 "${k}"(认得的:${[...MODULE_KEYS].filter((x) => x !== 'default').join(' / ')})`);
  for (const k of VIEW_HOOKS) if (m[k] !== undefined && typeof m[k] !== 'function') problems.push(`${k} 应该是函数`);
  return m as ViewModule;
}

export function scaleValue(v: number, max: number, scale: 'sqrt' | 'log' | 'linear', [lo, hi]: [number, number]): number {
  if (max <= 0) return lo;
  const t = scale === 'log' ? Math.log1p(v) / Math.log1p(max) : scale === 'linear' ? v / max : Math.sqrt(v / max);
  return lo + (hi - lo) * Math.max(0, Math.min(1, t));
}
/** 视图脚本的文件:.js / .mjs,或 .ts / .mts(浏览器里由服务端去掉类型;import 别的 .ts 时写上扩展名,和 Node 一样) */
export const VIEW_SCRIPT_FILE = /\.m?[jt]s$/;
/** 一定有的信号(没有记录 = 0) */
const KNOWN_SIGNALS = ['touched', 'fileChanged', 'stale'];
const STRUCT = new Set(['i', 'id', 'label', 'type', 'attrs', 'parent', 'kids', 'edges']);
const BUILTIN_COLS = ['degree', 'depth', 'children', 'descendants'];

/** 返回值检查:不对就当没返回 */
export const CHECK: Record<'select' | 'size' | 'color' | 'shape' | 'label' | 'edge', (r: unknown) => boolean> = {
  select: (r) => typeof r === 'boolean',
  size: (r) => typeof r === 'number' && Number.isFinite(r) && r >= 0,
  color: (r) => typeof r === 'string' && /^#[0-9a-fA-F]{6}$/.test(r),
  shape: (r) => SHAPES.includes(r as Shape),
  label: (r) => typeof r === 'string',
  edge: (r) => typeof r === 'object' && r !== null,
};

export interface ScriptRun {
  readonly v: ViewCtx;
  node(i: number): NodeRef;
  /**
   * 调一个脚本函数。抛错:记一条提醒,这一步余下的都不再调它(用下面的值);返回值不对:当没返回,最后汇总提醒一次。
   * 返回 undefined = 不改。
   */
  call(script: string, hook: ViewHook, f: (a: never, b: never, c: never) => unknown, a: unknown, b: unknown, c: unknown, at?: string): unknown;
  /** 收尾:把"返回值不对"汇总进提醒,返回全部提醒 */
  finish(): string[];
}

export function scriptRun(g: ViewGraph, X: ViewExprs, signalNames: string[], opts: { params: Record<string, unknown>; spec: ViewSpec; now: number }): ScriptRun {
  const { N, nodeList, ids, idx, E, ef, et, ety, eprop, typeNames, tSym, parent, treeKids } = g;
  const env = X.env;

  // ---- 列:属性名、信号名、内置列都变成 n 上的属性 ----
  const attrNames = new Set<string>();
  for (const n of nodeList) for (const k in n.attrs) attrNames.add(k);
  const sigOnly = new Set([...KNOWN_SIGNALS, ...signalNames].filter((s) => !attrNames.has(s)));
  const col = (name: string): ArrayLike<number | string> => (sigOnly.has(name) ? X.signalArr(name) : env.column(name));

  let incident: Csr | null = null;   // 每个节点碰到的边(下标)
  const incidentOf = (): Csr => {
    if (incident) return incident;
    const A = new Int32Array(2 * E), B = new Int32Array(2 * E);
    let m = 0;
    for (let e = 0; e < E; e++) { A[m] = ef[e]!; B[m++] = e; if (et[e] !== ef[e]) { A[m] = et[e]!; B[m++] = e; } }
    return (incident = buildCsr(N, A, B, () => true, m));
  };
  type This = { i: number };
  class Ref { readonly i: number; constructor(i: number) { this.i = i; } }   // 每次编译一个类:列的取值函数挂在它的原型上
  const proto = Ref.prototype as unknown as Record<string, unknown>;
  const refs: Array<NodeRef | undefined> = new Array(N);
  const node = (i: number): NodeRef => refs[i] ?? (refs[i] = new Ref(i) as unknown as NodeRef);
  Object.defineProperties(proto, {
    id: { get(this: This) { return ids[this.i]; } },
    label: { get(this: This) { return nodeList[this.i]!.label; } },
    type: { get(this: This) { return nodeList[this.i]!.attrs.type ?? ''; } },
    attrs: { get(this: This) { return nodeList[this.i]!.attrs; } },
    parent: { get(this: This) { const p = parent[this.i]!; return p >= 0 ? node(p) : null; } },
    kids: { get(this: This) { const out: NodeRef[] = []; for (let k = treeKids.start[this.i]!; k < treeKids.start[this.i + 1]!; k++) out.push(node(treeKids.list[k]!)); return out; } },
    edges: {
      value(this: This, type?: string, dir: 'out' | 'in' | 'both' = 'both') {
        const inc = incidentOf(), out: ReturnType<NodeRef['edges']> = [];
        for (let k = inc.start[this.i]!; k < inc.start[this.i + 1]!; k++) {
          const e = inc.list[k]!, t = typeNames[ety[e]!]!, isOut = ef[e] === this.i;
          if (type !== undefined && t !== type) continue;
          if (!tSym[ety[e]!] && ((dir === 'out' && !isOut) || (dir === 'in' && isOut))) continue;
          out.push({ type: t, node: node(isOut ? et[e]! : ef[e]!), out: isOut, proposed: eprop[e] === 1 });
        }
        return out;
      },
    },
    toString: { value(this: This) { return ids[this.i]; } },
  });
  for (const name of new Set([...BUILTIN_COLS, ...attrNames, ...sigOnly])) {
    if (STRUCT.has(name) || name in Object.prototype) continue;   // n.parent 是结构;同名属性用 n.attrs.parent
    let c: ArrayLike<number | string> | null = null;
    Object.defineProperty(proto, name, { get(this: This) { return (c ??= col(name))[this.i]; }, enumerable: true });
  }

  // ---- v ----
  const warnings: string[] = [];
  const warn = (msg: string) => { const m = String(msg); if (warnings.length < 30 && !warnings.includes(m)) warnings.push(m); };
  const H = helpers(env) as Record<string, unknown> & Pick<ViewCtx, 'mix' | 'hsl' | 'hash' | 'days' | 'recent' | 'clamp'>;
  for (const k of ['from', 'to', 'near', 'out', 'into', 'query']) delete H[k];   // 这几个按"当前节点"算,脚本里用 v.expr / v.query
  let all: NodeRef[] | null = null;
  const maxCache = new Map<(n: NodeRef) => number, number>();
  const v: ViewCtx = {
    ...H,
    params: opts.params, now: opts.now, spec: opts.spec, shapes: SHAPES, fn: env.fns,
    get nodes() { if (!all) { all = []; for (let i = 0; i < N; i++) if (!isSchemaId(ids[i]!)) all.push(node(i)); } return all; },
    expr(src) { const f = X.exprFor(String(src)); return (n) => f(n.i); },
    query(name) { if (!env.graph) throw new Error('没有图'); const r = env.graph.query(String(name)); return (n) => r[n.i] === 1; },
    col: (name) => col(String(name)),
    node(id) { const i = idx.get(id); return i === undefined ? undefined : node(i); },
    max(f) {
      let m = maxCache.get(f);
      if (m === undefined) { m = -Infinity; for (const n of v.nodes) { const x = Number(f(n)); if (x > m) m = x; } if (m === -Infinity) m = 0; maxCache.set(f, m); }
      return m;
    },
    scale: (x, max, scale = 'sqrt', range = [2, 10]) => scaleValue(Number(x) || 0, Number(max) || 0, scale, range),
    warn,
  };

  const dead = new Set<string>();
  const bad = new Map<string, { count: number; example: string }>();
  return {
    v, node,
    call(script, hook, f, a, b, c, at) {
      if (dead.size && dead.has(`${script}#${hook}`)) return undefined;
      let r: unknown;
      try { r = f(a as never, b as never, c as never); }
      catch (err) {
        dead.add(`${script}#${hook}`);
        warn(`${script} 的 ${hook}()${at ? ` 在 ${at} 上` : ''}出错: ${(err as Error)?.message ?? err}(这一步余下的用规则算)`);
        return undefined;
      }
      if (r === undefined) return undefined;
      const check = CHECK[hook as keyof typeof CHECK];
      if (check && !check(r)) {
        const key = `${script}#${hook}`, x = bad.get(key) ?? { count: 0, example: '' };
        x.count++; if (!x.example) x.example = `${JSON.stringify(r)?.slice(0, 40)}${at ? ` @ ${at}` : ''}`;
        bad.set(key, x);
        return undefined;
      }
      return r;
    },
    finish() {
      for (const [key, b] of bad) { const [s, h] = key.split('#'); warn(`${s} 的 ${h}() 有 ${b.count} 次返回了不认识的值(如 ${b.example}),当没返回`); }
      bad.clear();
      return warnings;
    },
  };
}

/** 新建视图脚本时的骨架:能导出的都写好、注释掉(CLI 的 view-set --script 和查看器的 view-script 都用它) */
export function viewSkeleton(path: string, base = 'galaxy'): string {
  return `// 视图脚本:一个模板。视图用它:stars view-set <名字> --script ${path}(查看器里也可以把这个文件拖到视图列表上)
// 导出的函数各接管一步:拿到下面算出的值,返回新的;不返回 = 不改。用不到的删掉就行。
// n 是节点:n.id、n.label、n.type、n.attrs;别的名字都是「列」,和表达式里一样(n.size、n.ext、n.degree、n.fileChanged、n.stale ……);
//   n.parent、n.kids、n.edges(类型?, 'out' | 'in' | 'both')。
// v 是这次计算:v.params、v.now、v.expr('表达式')、v.query('名字')、v.fn.名字、v.node(id)、v.nodes、v.max(f)、v.scale(…)、v.warn(…),
//   以及表达式里的辅助函数:v.mix、v.hsl、v.hash、v.days、v.recent、v.clamp ……
// 可以 import 同一个文件夹里的辅助文件(import { x } from './工具.js'),改了它视图也会跟着重算。

/** 这一层的规则(和视图规格同一种写法);base = 垫在下面的视图 */
export const spec = { base: ${JSON.stringify(base)} };

/** 参数的默认值;视图里写的 params 盖掉它,函数里用 v.params 读 */
export const params = {};

// /** 哪些节点出现;base = 规则的结论 */
// export function select(n, v, base) { return base; }

// /** 半径(像素);r = 下面算出的 */
// export function size(n, v, r) { return n.type === 'dir' ? r * 1.2 : r; }

// /** 颜色 #rrggbb */
// export function color(n, v, c) { return n.stale ? '#ff5a5a' : c; }

// /** 形状:dot / star / nebula / ringed / pulsar */
// export function shape(n, v, s) { return s; }

// /** 显示的名字 */
// export function label(n, v, t) { return t; }

// /** 每种边类型一次:返回 { mode, color, width, arrow, distance, strength, spin } 里想改的几项 */
// export function edge(type, v, base) { return type === 'dependsOn' ? { color: '#7aa7ff' } : undefined; }
`;
}
