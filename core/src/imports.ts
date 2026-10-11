// JS / TS 源码里引用了哪些文件:静态 import、export … from、import('字面量')、import '副作用'。
// 视图脚本用它找依赖(依赖里哪个改了都重新加载、静态导出时一起打包);扫描用它把 import 写成 dependsOn 边。
// 只认相对路径(./、../),按文本找,不执行代码。Node 和浏览器里都跑。

/** 去掉注释,字符串换成编号("0"、"1"……,原文在 strs 里):注释掉的、写在字符串里的 import 都不算 */
function scanSource(src: string): { code: string; strs: string[] } {
  let code = '', i = 0;
  const n = src.length, strs: string[] = [];
  while (i < n) {
    const c = src[i]!, d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; code += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; else if (c !== '`' && src[j] === '\n') break; j++; }
      code += c === '`' ? '``' : `"${strs.length}"`;
      strs.push(src.slice(i + 1, j));
      i = j + 1; continue;
    }
    code += c; i++;
  }
  return { code, strs };
}

const STATIC = /(?:^|[^\w$.])import\s*(?:type\s+)?(?:[\w$*{}\s,]+?\s*from\s*)?"(\d+)"/g;
const REEXPORT = /(?:^|[^\w$.])export\s*(?:type\s+)?(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^}]*\}\s*)from\s*"(\d+)"/g;
const DYNAMIC = /(?:^|[^\w$.])import\s*\(\s*"(\d+)"\s*\)/g;

/** 源码里引用的模块名(原样,按出现顺序去重) */
export function importsOf(src: string): string[] {
  const { code, strs } = scanSource(src), out = new Set<string>();
  for (const re of [STATIC, REEXPORT, DYNAMIC]) for (const m of code.matchAll(re)) out.add(strs[Number(m[1])]!);
  return [...out];
}

/** 按 from(项目里的路径)所在目录解出相对引用的路径;不是相对路径、跑出项目根 = null */
export function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const parts = from.split('/').slice(0, -1);
  for (const seg of spec.split(/[?#]/)[0]!.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join('/');
}

/** TS / Node 习惯省略扩展名(./auth → auth.ts):按顺序试这些 */
export const IMPORT_GUESSES = ['', '.ts', '.tsx', '.js', '.mjs', '.jsx', '/index.ts', '/index.js'];
/** 一个 import 解出的路径可能对应的文件:原样、补扩展名;TS 里写 ./a.js 实际是 a.ts */
export function importCandidates(base: string): string[] {
  const out = IMPORT_GUESSES.map((g) => base + g);
  const m = /\.(m?)js(x?)$/.exec(base);
  if (m) out.push(base.slice(0, -m[0].length) + `.${m[1]}ts${m[2]}`);
  return out;
}

/**
 * 从入口出发的整串文件(含入口,先入口后依赖)。read(路径) 返回源码,读不到 = null(记进 missing)。
 * guess = true:省略了扩展名的按 IMPORT_GUESSES 试(浏览器加载的模块不能省略,视图脚本不开)。
 */
export function moduleGraph(entry: string, read: (path: string) => string | null, guess = false): { files: string[]; missing: string[] } {
  const files: string[] = [], missing: string[] = [], seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    let src: string | null = null, real = p;
    for (const c of guess ? importCandidates(p) : [p]) { src = read(c); if (src !== null) { real = c; break; } }
    if (src === null) { missing.push(p); continue; }
    if (real !== p) { if (seen.has(real)) continue; seen.add(real); }
    files.push(real);
    for (const spec of importsOf(src)) { const q = resolveImport(real, spec); if (q !== null && !seen.has(q)) queue.push(q); }
  }
  return { files, missing };
}

const SPEC_AT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])([^'"\n]+)\2/g;
/** 把源码里 import 的模块名换掉(fn 返回 null = 不换);静态导出时把相对路径换成页面里的模块地址 */
export function rewriteImports(src: string, fn: (spec: string) => string | null): string {
  return src.replace(SPEC_AT, (m, pre: string, q: string, spec: string) => { const r = fn(spec); return r === null ? m : pre + q + r + q; });
}
