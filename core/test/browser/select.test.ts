// 选择与关系:单击 / Ctrl+点击、右键框选的四种模式、右键菜单、Ctrl+A / Esc、右键拖出关系(一对一、多对一)、点边
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scene, sleep } from './stage.ts';

test('选择:单击、Ctrl+点击加减、框选(替换 / Ctrl 并 / Shift 减 / Ctrl+Shift 反选)、Ctrl+A、Esc', (t) => scene(t, async (s) => {
  const { page } = s;
  const status = async () => (await page.text('#status')) ?? '';
  const count = async () => Number(/已选 (\d+)/.exec(await status())?.[1] ?? await page.count('#side-info .nd-title'));

  await page.mouse.click(...await s.at('idea/a')); await sleep(400);
  assert.match((await page.text('#side-info')) ?? '', /想法A/);
  await page.keyboard.down('Control'); await page.mouse.click(...await s.at('idea/b')); await page.keyboard.up('Control'); await sleep(300);
  assert.equal(await count(), 2, 'Ctrl+点击 = 加进来');
  await page.keyboard.down('Control'); await page.mouse.click(...await s.at('idea/b')); await page.keyboard.up('Control'); await sleep(300);
  assert.equal(await count(), 1, '再 Ctrl+点击 = 移出');

  const box = async (x0: number, y0: number, x1: number, y1: number, mods: string[] = []) => {
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.move(x0, y0); await page.mouse.down('right');
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, 4); await page.mouse.move(x1, y1, 4); await sleep(100);
    await page.mouse.up('right');
    for (const m of mods) await page.keyboard.up(m);
    await sleep(300);
  };
  const q = await s.screen('idea/a', 'idea/b', 'idea/c'), X = Object.values(q).map((p) => p[0]), Y = Object.values(q).map((p) => p[1]);
  await box(Math.min(...X) - 30, Math.min(...Y) - 30, Math.max(...X) + 30, Math.max(...Y) + 30);
  const all = await count();
  assert.ok(all >= 3, `框住三个想法(还可能有 ideas 自己):${all}`);
  const [ax, ay] = await s.at('idea/a');
  await box(ax - 25, ay - 25, ax + 25, ay + 25, ['Shift']);
  assert.equal(await count(), all - 1, 'Shift 框 = 减去');
  await box(ax - 25, ay - 25, ax + 25, ay + 25, ['Control', 'Shift']);
  assert.equal(await count(), all, 'Ctrl+Shift 框 = 反选(又加回来)');
  await box(ax - 25, ay - 25, ax + 25, ay + 25);
  assert.equal(await count(), 1, '不带键的框 = 替换');
  assert.match((await page.text('#side-info')) ?? '', /想法A/);

  const [ex, ey] = await s.emptySpot();
  await page.mouse.click(ex, ey); await sleep(200);
  await page.keyboard.press('Control+a'); await sleep(300);
  assert.ok(await count() > 5, 'Ctrl+A = 画面里的全部');
  await page.keyboard.press('Escape'); await sleep(300);
  assert.equal(await count(), 0, 'Esc = 取消选择');
}));

test('右键:空地和节点上的菜单;右键从节点拖出关系(一对一、选中的几个一起连)、点边看关系', (t) => scene(t, async (s) => {
  const { page } = s;
  const [ex, ey] = await s.emptySpot();
  await page.mouse.click(ex, ey, 'right'); await sleep(250);
  assert.match((await page.text('#ctxmenu')) ?? '', /新建节点[\s\S]*新建域/);
  await page.keyboard.press('Escape'); await sleep(150);
  await page.mouse.click(...await s.at('ideas'), 'right'); await sleep(250);
  assert.match((await page.text('#ctxmenu')) ?? '', /改名[\s\S]*解散/);
  await page.keyboard.press('Escape'); await sleep(150);

  const A = await s.at('idea/a'), C = await s.at('idea/c');
  await page.mouse.drag(A, C, { button: 'right' }); await sleep(300);
  assert.ok(await page.text('#linkpick'), '松手弹出关系类型');
  await page.keyboard.type('inspires'); await sleep(100);
  await page.keyboard.press('Enter'); await sleep(900);
  assert.ok(s.edge('idea/a', 'inspires', 'idea/c'), '建了 idea/a -inspires-> idea/c');

  await s.ui('select idea/a idea/b'); await sleep(300);
  await page.mouse.drag(await s.at('idea/a'), await s.at('docs/readme.md'), { button: 'right' }); await sleep(300);
  await page.keyboard.type('mentions'); await page.keyboard.press('Enter'); await sleep(900);
  assert.ok(s.edge('idea/a', 'mentions', 'docs/readme.md') && s.edge('idea/b', 'mentions', 'docs/readme.md'), '选中的两个都连上了');

  await s.ui('select'); await sleep(300);
  const [a, c] = [await s.at('idea/a'), await s.at('idea/c')];
  await page.mouse.click((a[0] + c[0]) / 2, (a[1] + c[1]) / 2); await sleep(300);
  assert.match((await page.text('#side-info')) ?? '', /inspires/, '点边 = 侧栏里是这条关系');
}));
