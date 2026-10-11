// 不用浏览器自带的对话框:被嵌进不带 allow-modals 的沙箱 iframe(VS Code webview 也一样)时,confirm 直接返回 false、
// prompt 返回 null,命令就悄悄什么也没做。这里把它们换成沙箱里的样子再跑:能撤销的直接做(提示条上带「撤销」),
// 撤销不回来的用页内的确认框问,要名字的用页内的输入框
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scene, sleep } from './stage.ts';

test('对话框:沙箱里也照常 —— 删除不先问、丢草稿页内确认(Esc 取消)、存查询页内输入', (t) => scene(t, async (s) => {
  const { page } = s;
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__nativeDialogs = 0;
    w.confirm = () => { (w.__nativeDialogs as number)++; return false; };
    w.prompt = () => { (w.__nativeDialogs as number)++; return null; };
    w.alert = () => { (w.__nativeDialogs as number)++; };
  });
  const askOpen = () => page.evaluate(() => !document.getElementById('ask')!.hidden);

  // 删除多个:直接删,提示条上带「撤销」
  await s.ui('add n1 一号'); await s.ui('add n2 二号');
  await s.ui('rm n1 n2');
  assert.ok(!s.has('n1') && !s.has('n2'), '没问就删了');
  assert.match((await s.toast()) ?? '', /撤销/);
  await s.ui('undo');
  for (let i = 0; i < 30 && !s.has('n1'); i++) await sleep(100);
  assert.ok(s.has('n1') && s.has('n2'), '撤销回来了');

  // 丢弃整个草稿:撤销不回来,页内确认;Esc = 取消
  await s.ui('add d1 --draft');
  for (let i = 0; i < 30 && !/草稿:1 条/.test((await s.ui('draft')).out); i++) await sleep(100);
  let pending = s.ui('draft drop');
  await page.waitFor(() => !document.getElementById('ask')!.hidden, 5000);
  assert.match((await page.text('#ask-t')) ?? '', /丢弃整个草稿\(1 条改动\)/);
  await page.keyboard.press('Escape');
  assert.match((await pending).out, /没有丢弃/);
  assert.ok(!(await askOpen()));
  assert.match((await s.ui('draft')).out, /草稿:1 条/, 'Esc 之后草稿还在');
  pending = s.ui('draft drop');
  await page.waitFor(() => !document.getElementById('ask')!.hidden, 5000);
  await page.clickOn('#ask-ok');
  await pending;
  for (let i = 0; i < 30 && !/草稿是空的/.test((await s.ui('draft')).out); i++) await sleep(100);
  assert.match((await s.ui('draft')).out, /草稿是空的/);

  // 存查询:页内输入名字,回车确定
  await page.evaluate(() => { const q = document.getElementById('q') as HTMLInputElement; q.value = "= type == 'note'"; q.dispatchEvent(new Event('input')); });
  await page.waitFor(() => !!document.querySelector('[data-qsave]'), 5000);
  await page.clickOn('[data-qsave]');
  await page.waitFor(() => !document.getElementById('ask')!.hidden && !document.getElementById('ask-in')!.hidden, 5000);
  await page.keyboard.type('笔记');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 30 && !s.has('~query/笔记'); i++) await sleep(100);
  assert.ok(s.has('~query/笔记'), '查询存下来了');
  assert.equal(await page.evaluate(() => (window as unknown as { __nativeDialogs: number }).__nativeDialogs), 0, '一次也没用浏览器自带的对话框');
}));
