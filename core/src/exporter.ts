// 静态导出:把查看器 + d3 + 视图内核 + 当前宇宙快照打成一个自包含的 HTML 文件。
// 没有服务器、没有网络依赖:拷到任何机器上用浏览器打开即可(只读;视图规则编辑器可以预览,不能保存)。
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from './snapshot.ts';
import { pageConfig } from './config.ts';
import { type Store } from './store.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** 把几个 ES 模块拼成同一作用域里的代码:去掉 import / export。 */
function inline(name: string): string {
  const src = stripTypeScriptTypes(readFileSync(resolve(here, `${name}.ts`), 'utf8'));
  return src
    .replace(/^import[\s\S]*?from\s+'[^']+';\n/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?(?:function|const|class|let)\b)/gm, '');
}

const safe = (s: string) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

export function exportHtml(store: Store, baseDir: string): string {
  process.removeAllListeners('warning'); // stripTypeScriptTypes 的实验性提示对用户是噪音
  let html = readFileSync(resolve(here, '..', 'viewer', 'index.html'), 'utf8');
  const d3 = readFileSync(resolve(here, '..', 'viewer', 'd3.v7.min.js'), 'utf8');
  const kernel = ['model', 'expr', 'view', 'ops', 'proposals', 'query', 'llf', 'format', 'textsync', 'bridge'].map(inline).join('\n');
  // 只带项目名,不带本机路径(导出的文件常会发给别人)
  const project = { id: 'static', name: basename(resolve(baseDir)), dir: '静态导出 · 只读', file: basename(store.file), primary: true };
  const snapshot = JSON.stringify({ ...buildSnapshot(store, baseDir), project });
  html = html
    .replace('<meta name="stars-token" content="__STARS_TOKEN__">', '')
    .replace('<meta name="stars-preview" content="__STARS_PREVIEW__">', '')
    .replace('<script src="/d3.js"></script>', () => `<script>${safe(d3)}</script>`)
    .replace('__STARS_CONFIG__', () => pageConfig(false))   // 只带默认值;个人设置存在看的人的浏览器里
    .replace(/^import \{[^}]*\} from '\/core\/\w+\.js';\n/gm, '')
    .replace('<script type="module">', () => `<script type="module">\nwindow.__STARS_STATIC__ = ${safe(snapshot)};\n${safe(kernel)}\n`);
  return html;
}
