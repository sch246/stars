// 静态导出:把查看器 + d3 + 视图内核 + 当前宇宙快照打成一个自包含的 HTML 文件。
// 没有服务器、没有网络依赖:拷到任何机器上用浏览器打开即可(只读;视图规则编辑器可以预览,不能保存)。
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { buildSnapshot } from './snapshot.ts';
import { pageConfig } from './config.ts';
import { inlineModules, viewerDir, viewerHtml } from './page.ts';
import { type Store } from './store.ts';

const safe = (s: string) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

export function exportHtml(store: Store, baseDir: string): string {
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
    .replace('<script type="module">', () => `<script type="module">\nwindow.__STARS_STATIC__ = ${safe(snapshot)};\n${safe(kernel)}\n`);
}
