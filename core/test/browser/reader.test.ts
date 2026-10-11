// 打开文件:双击 / 回车 / open = 居中的大窗,单击选中 = 侧栏预览,多选不预览;HTML 页面整份载入(超过 24 KB 也不截断)、
// 默认跑脚本、沙箱里的 localStorage / cookie 用替身,localStorage 由查看器按页面存着,重新载入还在
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { scene, sleep } from './stage.ts';

test('大窗:双击打开、Esc / 收回到侧栏;多选时侧栏不预览;大 HTML 整份跑、localStorage 记得住', (t) => scene(t, async (s) => {
  const { page } = s;
  const inReader = () => page.evaluate(() => !document.getElementById('reader')!.hidden && document.getElementById('side-file')!.parentElement!.id === 'reader-box');
  const sideFile = () => page.evaluate(() => document.getElementById('side')!.classList.contains('file'));

  // 单击 = 侧栏预览
  await page.mouse.click(...await s.at('docs/readme.md')); await sleep(500);
  assert.ok(await sideFile(), '单击文件:侧栏下半是它');
  assert.ok(!(await inReader()));
  // 多选:没有一个特定的目标,侧栏不预览
  await page.keyboard.down('Control'); await page.mouse.click(...await s.at('src/app.ts')); await page.keyboard.up('Control'); await sleep(400);
  assert.match((await page.text('#status')) ?? '', /已选 2/);
  assert.ok(!(await sideFile()), '多选时不预览哪个文件');

  // 双击 = 大窗
  const [rx, ry] = await s.at('docs/readme.md');
  await page.mouse.dblclick(rx, ry); await sleep(600);
  assert.ok(await inReader(), '双击打开:在大窗里');
  assert.ok(!(await sideFile()), '大窗开着时侧栏只有详情');
  assert.match((await page.text('#fp-title')) ?? '', /docs\/readme\.md/);
  await page.keyboard.press('Escape'); await sleep(200);
  if (await inReader()) { await page.keyboard.press('Escape'); await sleep(200); }   // 第一次 Esc 可能只是让编辑框失焦
  assert.ok(!(await inReader()), 'Esc 收回');
  assert.ok(await sideFile(), '收回后在侧栏里预览');
  await s.ui('reader on');
  assert.ok(await inReader());
  await page.clickOn('#fp-big'); await sleep(200);
  assert.ok(!(await inReader()) && await sideFile(), '「收回侧栏」按钮');

  // 大 HTML:开头垫 30 KB 注释(超过只载入开头的 24 KB);一上来就读 localStorage(沙箱里原本会抛 SecurityError,整段脚本挂掉)
  const pad = '<!-- ' + 'x'.repeat(30_000) + ' -->';
  writeFileSync(join(s.dir, 'page.html'), `<!doctype html><html><head><title>p</title></head><body>${pad}<script>
var n = +(localStorage.getItem('n') || 0) + 1; localStorage.setItem('n', String(n)); localStorage.extra = 'y';
document.cookie = 'a=1';
stars.print('ran ' + n + ' cookie=' + document.cookie + ' keys=' + Object.keys(localStorage).join(','));
</script></body></html>`);
  for (let i = 0; i < 50 && !s.has('page.html'); i++) await sleep(200);
  assert.ok(s.has('page.html'), '实时同步把 page.html 加进图里');
  await sleep(600);
  const con = () => page.evaluate(() => document.getElementById('con-out')!.textContent ?? '');   // 控制台关着也照样记(stars.print 打到这里)
  const ran = async (re: RegExp) => { for (let i = 0; i < 50; i++) { if (re.test(await con())) return true; await sleep(200); } return false; };
  await s.ui('open page.html');
  assert.ok(await inReader(), 'open = 大窗');
  await page.waitFor(() => !!document.getElementById('fp-html'), 8000);   // 先载入全文(超过 24 KB),再挂预览
  assert.ok(await ran(/ran 1 cookie=a=1 keys=n,extra/), `脚本整段跑完了:${await con()}`);
  await sleep(500);   // 替身攒 200ms 才把 localStorage 发给查看器存
  await s.ui('preview reload');
  assert.ok(await ran(/ran 2 /), `重新载入后 localStorage 还在:${await con()}`);
}));
