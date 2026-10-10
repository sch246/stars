// 视图规则里的表达式:一段 JavaScript 表达式,直接编译成原生函数(new Function),
// 每条表达式只编译一次,运行时按节点下标读"列"(类型化数组),不为每个节点生成对象。
// 性能优先:没有解释器、没有沙箱;表达式和函数节点都是你自己的代码,按你自己的权限运行。
// 这个文件同时在 Node 和浏览器里运行,不依赖任何 Node 模块。

export const DAY = 86_400_000;

export interface ExprEnv {
  /** 取一个标识符对应的列(按节点下标取值)。内置列、信号、属性都从这里来。 */
  column(name: string): ArrayLike<number | string>;
  /** 用户函数(宇宙里 kind=function 的节点),表达式里用 fn.名字(...) 调用 */
  fns: Record<string, (...args: never[]) => unknown>;
  now: number;
  /** 图上的查询(from / to / near / out / into / query 用);没有就不能用这几个函数 */
  graph?: ExprGraph;
}

/** 路径条件:按节点下标给结果。结果由实现方按参数缓存,所以同一条表达式里对每个节点调用只算一次。 */
export interface ExprGraph {
  /** 当前算到第几个节点(compileExpr 生成的函数每次调用时写进来) */
  cur: { i: number };
  /** 从 root 出发沿 type 边(省略 = 任何边)走 1..depth 步能到的节点(不含 root);dir=in 是逆着边走,both 不分方向 */
  reach(root: string, type: string | undefined, dir: 'out' | 'in' | 'both', depth: number): Uint8Array;
  /** 每个节点的出边(dir=out)/ 入边(dir=in)条数,可限定类型和另一端 */
  count(type: string | undefined, other: string | undefined, dir: 'out' | 'in'): ArrayLike<number>;
  /** 保存的查询 ~query/<name> 的结果(1 = 在里面) */
  query(name: string): Uint8Array;
}

const RESERVED = new Set([
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'typeof', 'in', 'of', 'instanceof', 'new', 'void', 'this',
  'Math', 'Number', 'String', 'Boolean', 'Date', 'JSON', 'Object', 'Array', 'isFinite', 'isNaN', 'parseFloat', 'parseInt',
]);
/** 表达式里可直接调用的辅助函数。 */
export const HELPER_NAMES = ['log', 'log1p', 'log2', 'sqrt', 'pow', 'min', 'max', 'abs', 'floor', 'ceil', 'round', 'clamp', 'mix', 'hsl', 'hash', 'days', 'recent', 'now', 'fn',
  'from', 'to', 'near', 'out', 'into', 'query'];

function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function mixHexColors(a: string, b: string, t: number): string {
  const p = (h: string) => { const v = parseInt(h.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const [x, y] = [p(a), p(b)];
  return '#' + [0, 1, 2].map((i) => Math.round(x[i]! + (y[i]! - x[i]!) * Math.max(0, Math.min(1, t))).toString(16).padStart(2, '0')).join('');
}
function hashHex(s: string): string {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return hslHex(h % 360, 0.8, 0.62);
}

const noGraph = (name: string) => (): never => { throw new Error(`这里不能用 ${name}()(只能在视图规则和查询里用)`); };
const depthOf = (d: unknown): number => (d === undefined || d === null ? Infinity : Math.max(1, Number(d) || 1));

function helpers(env: ExprEnv): Record<string, unknown> {
  const g = env.graph;
  const path = g ? {
    /** 从 root 顺着 type 边(省略 = 任何边)走得到当前节点,最多 depth 步(省略 = 不限) */
    from: (root: string, type?: string, depth?: number) => g.reach(String(root), type || undefined, 'out', depthOf(depth))[g.cur.i] === 1,
    /** 当前节点顺着 type 边走得到 root */
    to: (root: string, type?: string, depth?: number) => g.reach(String(root), type || undefined, 'in', depthOf(depth))[g.cur.i] === 1,
    /** 和 root 相距 depth 步之内(不分方向,默认 1 步) */
    near: (root: string, depth = 1, type?: string) => g.reach(String(root), type || undefined, 'both', depthOf(depth))[g.cur.i] === 1,
    /** 当前节点有几条出边 / 入边(可限定类型、另一端) */
    out: (type?: string, other?: string) => Number(g.count(type || undefined, other, 'out')[g.cur.i]),
    into: (type?: string, other?: string) => Number(g.count(type || undefined, other, 'in')[g.cur.i]),
    /** 当前节点在保存的查询 ~query/<name> 里 */
    query: (name: string) => g.query(String(name))[g.cur.i] === 1,
  } : { from: noGraph('from'), to: noGraph('to'), near: noGraph('near'), out: noGraph('out'), into: noGraph('into'), query: noGraph('query') };
  return {
    ...path,
    log: Math.log, log1p: Math.log1p, log2: Math.log2, sqrt: Math.sqrt, pow: Math.pow, min: Math.min, max: Math.max,
    abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
    clamp: (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x),
    mix: mixHexColors, hsl: hslHex, hash: hashHex,
    /** 距今多少天;没有记录 = Infinity */
    days: (t: number) => (t ? Math.max(0, env.now - t) / DAY : Infinity),
    /** 新鲜度 0..1:每过一个半衰期减半;没有记录 = 0 */
    recent: (t: number, halfLifeDays = 14) => (t ? 0.5 ** (Math.max(0, env.now - t) / DAY / Math.max(halfLifeDays, 0.001)) : 0),
    now: env.now,
    fn: env.fns,
  };
}

/** 找出表达式用到的自由标识符(去掉字符串、属性访问、保留字、辅助函数)。 */
export function freeIdentifiers(src: string): string[] {
  const bare = src.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  const found = new Set<string>();
  for (const m of bare.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)) {
    const id = m[0];
    if (!RESERVED.has(id) && !HELPER_NAMES.includes(id)) found.add(id);
  }
  return [...found];
}

/** 编译表达式:返回 (i) => 值。语法错误会抛出,消息里带上原表达式。 */
export function compileExpr(src: string, env: ExprEnv): (i: number) => unknown {
  const names = freeIdentifiers(src);
  const cols = names.map((n) => env.column(n));
  const h = helpers(env);
  const cur = env.graph?.cur ?? { i: 0 };
  const body = `"use strict";const {${HELPER_NAMES.join(',')}}=H;return function(i){$cur.i=i;`
    + names.map((n, k) => `const ${n}=c${k}[i];`).join('') + `return (${src});}`;
  try {
    return new Function('H', '$cur', ...cols.map((_, k) => `c${k}`), body)(h, cur, ...cols) as (i: number) => unknown;
  } catch (err) {
    throw new Error(`表达式 "${src}" 无法编译: ${(err as Error).message}`);
  }
}

/** 仅检查语法(不需要真实数据),用于编辑器/CLI 的即时校验。 */
export function checkExpr(src: string): string | null {
  try {
    const names = freeIdentifiers(src);
    new Function('H', ...names.map((_, k) => `c${k}`), `"use strict";const {${HELPER_NAMES.join(',')}}=H;return function(i){`
      + names.map((n, k) => `const ${n}=c${k}[i];`).join('') + `return (${src});}`);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/** 把函数节点的 code 编译成函数。code 是一个函数表达式,如 "(t, s) => log1p(s) * (days(t) < 7 ? 2 : 1)";可以用上面的辅助函数。 */
export function compileFn(code: string, env: Pick<ExprEnv, 'now' | 'fns' | 'graph'>): (...args: never[]) => unknown {
  const h = helpers({ column: () => [], fns: env.fns, now: env.now, graph: env.graph });
  try {
    const fn = new Function('H', `"use strict";const {${HELPER_NAMES.join(',')}}=H;return (${code});`)(h);
    if (typeof fn !== 'function') throw new Error('code 的值不是函数');
    return fn as (...args: never[]) => unknown;
  } catch (err) {
    throw new Error(`函数无法编译: ${(err as Error).message}`);
  }
}
