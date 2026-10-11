// 视图脚本:view-script 用已有的 .js 新建视图;改了它 import 的文件,画面跟着变;写坏了顶上提示、先用着上一次加载成功的;
// 规则面板里列出层;把 .js 文件节点拖到视图列表上 = 新建视图;文件不存在时写一份骨架
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { scene, sleep, type Stage } from './stage.ts';

type Look = { color: string; r: number; shape: string; label: string; explain: { script?: Record<string, string> } } | null;
async function waitLook(s: Stage, id: string, ok: (l: Look) => boolean, what: string): Promise<Look> {
  let l: Look = null;
  for (let i = 0; i < 60; i++) {
    l = ((await s.ui(`look ${id}`)).data as Record<string, Look>)[id] ?? null;
    if (ok(l)) return l;
    await sleep(200);
  }
  throw new Error(`等不到:${what}(最后是 ${JSON.stringify(l)})`);
}

test('视图脚本:新建、改依赖跟着变、写坏了留着上一次的、加载不了不建、层、拖到视图列表、骨架', (t) => scene(t, async (s) => {
  const { page } = s;
  mkdirSync(join(s.dir, 'views'));
  const heat = (hot: string) => `import { hot } from './pal.js';\nexport const spec = { base: 'galaxy' };\nexport function color(n, v, c) { return n.ext === 'ts' ? hot : c; }\nexport function label(n, v, t) { return n.ext === 'ts' ? t + ' ★' : t; }\n// ${hot}\n`;
  writeFileSync(join(s.dir, 'views/pal.js'), "export const hot = '#ff00ff';\n");
  writeFileSync(join(s.dir, 'views/heat.js'), heat('a'));
  for (let i = 0; i < 50 && !s.has('views/heat.js'); i++) await sleep(150);   // 监听器把新文件铺进图
  const gal = ((await s.ui('look src/app.ts')).data as Record<string, Look>)['src/app.ts']!;

  await s.ui('view-script 热力 --file views/heat.js');
  const l1 = await waitLook(s, 'src/app.ts', (l) => l?.color === '#ff00ff', '脚本的颜色');
  assert.equal(l1!.label, 'app.ts ★', 'label()');
  assert.deepEqual(l1!.explain.script, { color: 'views/heat.js', label: 'views/heat.js' });
  assert.deepEqual(JSON.parse(s.store.load().nodes.get('~view/热力')!.attrs.spec!), { script: 'views/heat.js' });
  const info = (await s.ui('look')).data as { layers: Array<{ name: string }>; warnings: string[] };
  assert.deepEqual(info.layers.map((l) => l.name), ['galaxy', 'views/heat.js', '热力']);
  assert.deepEqual(info.warnings, []);

  writeFileSync(join(s.dir, 'views/pal.js'), "export const hot = '#00ffaa';\n");
  await waitLook(s, 'src/app.ts', (l) => l?.color === '#00ffaa', '改了它 import 的 pal.js → 整串重新加载');

  writeFileSync(join(s.dir, 'views/heat.js'), 'export function color( {');
  await page.waitFor(() => /views\/heat\.js 加载失败/.test(document.getElementById('banner')?.textContent ?? ''), 10_000);
  assert.equal(((await s.ui('look src/app.ts')).data as Record<string, Look>)['src/app.ts']!.color, '#00ffaa', '写坏了:先用着上一次加载成功的,画面不塌');

  writeFileSync(join(s.dir, 'views/heat.js'), heat('b'));
  await waitLook(s, 'src/app.ts', (l) => l?.color === '#00ffaa', '修好了');
  await s.ui('panel rules on'); await sleep(300);
  assert.match((await page.text('#ed-layers')) ?? '', /galaxy → views\/heat\.js 打开 → 热力/, '规则面板里列出层');
  await s.ui('panel rules off');

  // .ts:服务端去掉类型再给浏览器;import 别的 .ts 写上扩展名
  writeFileSync(join(s.dir, 'views/tpal.ts'), "export const cool: string = '#3355ff';\n");
  writeFileSync(join(s.dir, 'views/typed.ts'), "import { cool } from './tpal.ts';\ninterface N { ext: string }\nexport const spec = { base: 'galaxy' };\nexport function color(n: N, v: unknown, c: string): string { return n.ext === 'ts' ? cool : c; }\n");
  await s.ui('view-script 带类型 --file views/typed.ts');
  await waitLook(s, 'src/app.ts', (l) => l?.color === '#3355ff', '.ts 视图脚本的颜色');
  await s.ui('view 热力');
  await waitLook(s, 'src/app.ts', (l) => l?.color === '#00ffaa', '切回热力');

  // 一开始就加载不了的:只用视图自己写的规则算,顶上提示
  writeFileSync(join(s.dir, 'views/bad.js'), 'export const spec = {');
  await s.ui('view-script 坏的 --file views/bad.js').catch(() => {});
  assert.ok(!s.has('~view/坏的'), '加载不了的不建视图');
  assert.match((await s.toast()) ?? '', /views\/bad\.js 加载不了/);
  assert.notEqual(gal.color, '#00ffaa');

  // 把 views/heat.js 拖到视图列表上
  await s.ui('view galaxy'); await sleep(1200);
  await s.ui('expand views/'); await sleep(800);
  await s.settle(['views/']);
  const from = await s.at('views/heat.js'), to = (await page.center('#views'))!;
  await page.mouse.drag(from, to); await sleep(1500);
  assert.ok(s.has('~view/heat'), '拖到视图列表上 = 新建视图(名字取文件名)');
  assert.match((await s.ui('view')).out, /当前:heat/);
  await waitLook(s, 'src/app.ts', (l) => l?.color === '#00ffaa', '新视图用的就是这个脚本');

  // 文件不存在:写一份以当前视图为底的骨架
  await s.ui('view-script 草稿'); await sleep(800);
  assert.ok(existsSync(join(s.dir, 'views/草稿.js')));
  assert.match(readFileSync(join(s.dir, 'views/草稿.js'), 'utf8'), /export const spec = \{ base: "heat" \}/);
  assert.match((await s.ui('view')).out, /当前:草稿/);
}));
