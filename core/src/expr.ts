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
}

const RESERVED = new Set([
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'typeof', 'in', 'of', 'instanceof', 'new', 'void', 'this',
  'Math', 'Number', 'String', 'Boolean', 'Date', 'JSON', 'Object', 'Array', 'isFinite', 'isNaN', 'parseFloat', 'parseInt',
]);
/** 表达式里可直接调用的辅助函数。 */
export const HELPER_NAMES = ['log', 'log1p', 'log2', 'sqrt', 'pow', 'min', 'max', 'abs', 'floor', 'ceil', 'round', 'clamp', 'mix', 'hsl', 'hash', 'days', 'recent', 'now', 'fn'];

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

function helpers(env: ExprEnv): Record<string, unknown> {
  return {
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
  const body = `"use strict";const {${HELPER_NAMES.join(',')}}=H;return function(i){`
    + names.map((n, k) => `const ${n}=c${k}[i];`).join('') + `return (${src});}`;
  try {
    return new Function('H', ...cols.map((_, k) => `c${k}`), body)(h, ...cols) as (i: number) => unknown;
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
export function compileFn(code: string, env: Pick<ExprEnv, 'now' | 'fns'>): (...args: never[]) => unknown {
  const h = helpers({ column: () => [], fns: env.fns, now: env.now });
  try {
    const fn = new Function('H', `"use strict";const {${HELPER_NAMES.join(',')}}=H;return (${code});`)(h);
    if (typeof fn !== 'function') throw new Error('code 的值不是函数');
    return fn as (...args: never[]) => unknown;
  } catch (err) {
    throw new Error(`函数无法编译: ${(err as Error).message}`);
  }
}
