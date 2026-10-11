// 查看器页面的拼装:服务端(/)与静态导出(stars export)共用。
//
// 查看器的源码按功能分在 viewer/ 下:
//   index.html   页面骨架(DOM、import 语句),里面两个占位:/*@STYLE@*/ 与 /*@APP@*/
//   style.css    样式
//   app/NN-*.js  页面脚本(NNa-*.js 排在 NN-*.js 之后),按文件名顺序拼进同一个作用域(一个函数体)—— 它们共享状态,不是各自独立的模块;
//                顶层的 let / const 按顺序初始化,所以文件的先后就是执行的先后。
// 浏览器里能直接 import 的内核模块(BROWSER_MODULES)去掉类型后原样提供:/core/<名>.js。
// 静态导出把它们拼进同一个作用域:去掉 import / export,所以这些模块的顶层名字不能重复。
import { readdirSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const viewerDir = resolve(here, '..', 'viewer');

/** 浏览器能直接 import 的共享模块(都不依赖 Node),按依赖顺序(静态导出按这个顺序拼)。 */
export const BROWSER_MODULES = ['model', 'expr', 'styles', 'query', 'viewspec', 'viewgraph', 'viewexpr', 'viewfold', 'viewscript', 'viewlayers', 'view', 'ops', 'proposals', 'llf', 'format', 'textsync', 'bridge', 'cmdline', 'jsonc', 'toml', 'draft', 'scriptnode', 'arrange'];
const BROWSER_SET = new Set(BROWSER_MODULES);
/** 读自己的源码:换行统一成 LF(Windows 上 git 可能检出成 CRLF,下面按行拼接 / 去掉 import 的正则都按 LF 写) */
const readSrc = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
export const isBrowserModule = (name: string) => BROWSER_SET.has(name);

/** 项目里的 .ts / .mts(视图脚本、预览页引用的模块)给浏览器之前去掉类型;只能去掉"擦掉就行"的语法(enum、namespace 这类报错) */
export const isTsModule = (path: string) => /\.m?ts$/i.test(path);
export function stripTs(src: string): string {
  return stripTypeScriptTypes(src);
}

/** /core/<名>.js:去掉类型,import 路径改成 .js */
export function browserModule(name: string): string {
  const ts = readSrc(resolve(here, `${name}.ts`));
  return stripTypeScriptTypes(ts).replace(/from '\.\/(\w+)\.ts'/g, "from './$1.js'");
}

/** 静态导出:几个 ES 模块拼成同一作用域里的代码(去掉 import / export) */
export function inlineModules(): string {
  return BROWSER_MODULES.map((name) => stripTypeScriptTypes(readSrc(resolve(here, `${name}.ts`)))
    .replace(/^import[\s\S]*?from\s+'[^']+';\n/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?(?:function|const|class|let)\b)/gm, '')).join('\n');
}

/** 页面脚本的各个部分(按文件名排序) */
export function viewerParts(): string[] {
  return readdirSync(resolve(viewerDir, 'app')).filter((f) => /^\d+[a-z]?-[\w-]+\.js$/.test(f)).sort();
}

const indent = (s: string) => s.replace(/^(?=.)/gm, '  ');

/** 拼好的页面(占位符 __STARS_TOKEN__ 等留给调用方替换)。每次都读盘:改了查看器的源码,刷新就生效。 */
export function viewerHtml(): string {
  const shell = readSrc(resolve(viewerDir, 'index.html'));
  const style = readSrc(resolve(viewerDir, 'style.css'));
  const app = viewerParts().map((f) => `  // ==== app/${f} ====\n${indent(readSrc(resolve(viewerDir, 'app', f)))}`).join('');
  return shell.replace('/*@STYLE@*/\n', () => indent(style)).replace('/*@APP@*/\n', () => app);
}
