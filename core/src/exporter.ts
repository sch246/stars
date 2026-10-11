// 静态导出:把查看器 + d3 + 视图内核 + 当前宇宙快照打成一个自包含的 HTML 文件。
// 没有服务器、没有网络依赖:拷到任何机器上用浏览器打开即可(只读;视图规则编辑器可以预览,不能保存)。
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { buildSnapshot } from './snapshot.ts';
import { pageConfig } from './config.ts';
import { resolveImport, rewriteImports } from './imports.ts';
import { inlineModules, viewerDir, viewerHtml } from './page.ts';
import { type Store } from './store.ts';

const safe = (s: string) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

/** 视图脚本在导出的页面里的模块名:stars-view:/<路径>,由页面里的 import map 指到 data: 地址 */
const VIEW_SCHEME = 'stars-view:/';

/**
 * 视图脚本的 import map:每个文件一个 data: 模块,相对 import 换成 stars-view:/<路径>。
 * 模块名固定,所以互相 import(循环)也行 —— 浏览器按解出来的地址认模块。
 */
export function viewImportMap(viewSrc: Record<string, string>): { imports: Record<string, string> } {
  const imports: Record<string, string> = {};
  for (const [path, src] of Object.entries(viewSrc)) {
    const code = rewriteImports(src, (spec) => { const dep = resolveImport(path, spec); return dep === null ? null : VIEW_SCHEME + dep; });
    imports[VIEW_SCHEME + path] = 'data:text/javascript;charset=utf-8;base64,' + Buffer.from(code, 'utf8').toString('base64');
  }
  return { imports };
}

/** viewSrc:视图脚本的源码(路径 → 源码,见 viewload.ts 的 viewSources),做成页面里的 import map */
export function exportHtml(store: Store, baseDir: string, viewSrc: Record<string, string> = {}): string {
  process.removeAllListeners('warning'); // stripTypeScriptTypes 的实验性提示对用户是噪音
  const d3 = readFileSync(resolve(viewerDir, 'd3.v7.min.js'), 'utf8');
  const kernel = inlineModules();
  // 只带项目名,不带本机路径(导出的文件常会发给别人)
  const project = { id: 'static', name: basename(resolve(baseDir)), dir: '静态导出 · 只读', file: basename(store.file), primary: true };
  const snapshot = JSON.stringify({ ...buildSnapshot(store, baseDir), project });
  return viewerHtml()
    .replace('<meta name="stars-token" content="__STARS_TOKEN__">', '')
    .replace('<meta name="stars-preview" content="__STARS_PREVIEW__">', '')
    .replace('<script src="/d3.js"></script>', () => `<script>${safe(d3)}</script>`)
    .replace('__STARS_CONFIG__', () => pageConfig(false))   // 只带默认值;个人设置存在看的人的浏览器里
    .replace(/^import \{[^}]*\} from '\/core\/\w+\.js';\n/gm, '')
    .replace('<script type="module">', () => `<script type="importmap">${safe(JSON.stringify(viewImportMap(viewSrc)))}</script>\n<script type="module">\nwindow.__STARS_STATIC__ = ${safe(snapshot)};\nwindow.__STARS_VIEWMODS__ = ${safe(JSON.stringify(Object.keys(viewSrc)))};\n${safe(kernel)}\n`);
}
