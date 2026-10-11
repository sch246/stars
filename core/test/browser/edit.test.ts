// 编辑与删除:侧栏里点标题改名、改说明、加属性;关系行上反转 / 改类型 / 删掉;Del 删节点(文件进回收站)、Ctrl+Z 拿回来
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { scene, sleep } from './stage.ts';

test('侧栏:改名、说明、属性;关系行:反转、改类型、删掉', (t) => scene(t, async (s) => {
  const { page } = s;
  const node = (id: string) => s.store.load().nodes.get(id);
  await s.ui('select idea/a'); await sleep(400);
  await page.clickOn('#side-info .nd-title'); await sleep(150);
  await page.keyboard.press('Control+a'); await page.keyboard.type('更好的想法'); await page.keyboard.press('Enter'); await sleep(900);
  assert.equal(node('idea/a')?.label, '更好的想法', '点标题改名(id 不变)');
  await page.clickOn('#side-info .nd-sum'); await sleep(150);
  await page.keyboard.type('这是说明'); await page.keyboard.press('Control+Enter'); await sleep(900);
  assert.equal(node('idea/a')?.attrs.summary, '这是说明');
  await page.clickOn('#side-info [data-nadd]'); await sleep(150);
  await page.keyboard.type('priority=high'); await page.keyboard.press('Enter'); await sleep(900);
  assert.equal(node('idea/a')?.attrs.priority, 'high');

  await s.ui('link idea/a describes idea/b'); await sleep(900);
  /** 关系行(含 text 的那行)上的某个按钮:按钮只在悬停时出现,先移到行上再找它。改完之后侧栏会重画(体检结果晚 1.5 秒到还会再画一次),先等它停下 */
  const rowButton = async (text: string, button: string) => {
    await sleep(1600);
    const row = await page.center('#side-info .row.link', text);
    assert.ok(row, `侧栏里有「${text}」那行`);
    await page.mouse.move(...row, 3); await sleep(150);
    const c = await page.evaluate((t: string, b: string) => {
      const e = [...document.querySelectorAll<HTMLElement>('#side-info .row.link')].find((r) => r.innerText.includes(t))?.querySelector(b);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2] as [number, number];
    }, text, button);
    assert.ok(c, `悬停时「${text}」那行有 ${button}`);
    await page.mouse.move(...c, 2); await page.mouse.click(...c); await sleep(900);
  };
  await rowButton('想法B', '[data-erev]');
  assert.ok(s.edge('idea/b', 'describes', 'idea/a') && !s.edge('idea/a', 'describes', 'idea/b'), '反转');
  await rowButton('想法B', '[data-eretype]');
  assert.ok(await page.text('#linkpick'), '改类型:弹出类型');
  await page.keyboard.type('inspires'); await page.keyboard.press('Enter'); await sleep(900);
  assert.ok(s.edge('idea/b', 'inspires', 'idea/a') && !s.edge('idea/b', 'describes', 'idea/a'), '改了类型');
  await rowButton('想法B', '[data-erm]');
  assert.ok(!s.edge('idea/b', 'inspires', 'idea/a'), '删掉');
  await s.ui('link idea/a related idea/c'); await s.ui('select idea/a'); await sleep(900);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#side-info .row.link')].find((r) => r.innerText.includes('想法C'))?.querySelector('[data-erev]') ?? null), null, '不分方向的关系没有「反转」');
}));

test('Del:普通节点直接删、Ctrl+Z 拿回来;文件 = 先问,挪进回收站,Ctrl+Z 搬回来', (t) => scene(t, async (s) => {
  const { page } = s;
  await s.ui('select idea/c'); await sleep(300);
  await page.mouse.move(...await s.emptySpot());
  await page.keyboard.press('Delete'); await sleep(1000);
  assert.ok(!s.has('idea/c') && page.dialogs.length === 0, '一个普通节点:不问,直接删');
  assert.match((await s.toast()) ?? '', /撤销/);
  await page.keyboard.press('Control+z'); await sleep(1000);
  assert.ok(s.has('idea/c') && s.edge('ideas', 'contains', 'idea/c'), 'Ctrl+Z:连同关系回来');

  await s.ui('select docs/readme.md'); await sleep(300);
  await page.keyboard.press('Delete'); await sleep(1500);
  assert.ok(page.dialogs.some((d) => d.startsWith('confirm')), '删文件先问');
  assert.ok(!existsSync(join(s.dir, 'docs/readme.md')) && !s.has('docs/readme.md'));
  assert.equal(readdirSync(join(s.dir, '.git/stars-trash')).length, 1, '挪进了 .git/stars-trash/');
  await page.keyboard.press('Control+z'); await sleep(1200);
  assert.ok(existsSync(join(s.dir, 'docs/readme.md')) && s.has('docs/readme.md'), 'Ctrl+Z:文件搬回来');
}));
