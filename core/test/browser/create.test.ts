// 新建、打包、解散:空格在指针处新建(在文件夹里默认是文件)、Tab 打包成域 / 新建域、Shift+Tab 解散(有冲突弹窗中止);双击
import assert from 'node:assert/strict';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { scene, sleep } from './stage.ts';

test('空格新建:在指针处;文件夹里默认新建文件(提示里是磁盘路径),类型按钮能切;两处各记各的上次选择;Shift+回车接着建', (t) => scene(t, async (s) => {
  const { page } = s;
  const chip = () => page.text('#creator .cr-types .on');
  const hint = () => page.text('#creator .cr-hint');

  const bg = await s.emptySpot();
  await page.mouse.dblclick(...bg); await sleep(300);
  assert.equal(await page.count('#creator'), 0, '双击空地不新建');
  await page.mouse.move(...bg); await page.keyboard.press(' '); await sleep(300);
  assert.equal(await chip(), '概念', '文件夹外面默认是概念');
  await page.keyboard.type('空格建的'); await page.keyboard.press('Enter'); await sleep(1000);
  assert.equal(s.store.load().nodes.get('空格建的')?.attrs.type, 'concept');

  await page.mouse.move(...await s.emptySpot('docs/')); await page.keyboard.press(' '); await sleep(300);
  assert.equal(await chip(), '文件', '文件夹里默认是文件');
  await page.keyboard.type('笔记.md'); await sleep(100);
  assert.match((await hint()) ?? '', /在磁盘上新建文件 docs\/笔记\.md/, '提示里是将要建的路径');
  await page.keyboard.press('Enter'); await sleep(1200);
  assert.ok(existsSync(join(s.dir, 'docs/笔记.md')), '磁盘上有了');
  assert.ok(s.edge('docs/', 'contains', 'docs/笔记.md'));
  assert.match((await page.text('#side-info')) ?? '', /笔记\.md/, '新建的选中了');
  await s.ui('select');   // 文件的侧栏很宽,会挡住 docs

  await page.mouse.move(...await s.emptySpot('docs/')); await page.keyboard.press(' '); await sleep(300);
  await page.clickOn('#creator [data-crtype="concept"]'); await sleep(100);
  assert.equal(await chip(), '概念', '点按钮切类型');
  assert.match((await hint()) ?? '', /新建「concept」节点,放进「docs」/);
  await page.keyboard.type('文档概念'); await page.keyboard.press('Enter'); await sleep(1000);
  assert.ok(s.edge('docs/', 'contains', '文档概念') && !existsSync(join(s.dir, 'docs/文档概念')), '概念节点放进文件夹,不动磁盘');
  await page.mouse.move(...await s.emptySpot('docs/')); await page.keyboard.press(' '); await sleep(300);
  assert.equal(await chip(), '概念', '文件夹里记住了上次选的概念');
  await page.keyboard.press('Escape'); await sleep(200);
  assert.equal(await page.count('#creator'), 0, 'Esc 关掉');

  await page.mouse.move(...await s.emptySpot('ideas')); await page.keyboard.press(' '); await sleep(300);
  assert.equal(await chip(), '概念');
  await page.keyboard.type('子想法一'); await page.keyboard.press('Shift+Enter'); await sleep(1000);
  assert.ok(await page.text('#creator'), 'Shift+回车:框还在,接着建');
  await page.keyboard.type('子想法二'); await page.keyboard.press('Enter'); await sleep(1000);
  assert.ok(s.edge('ideas', 'contains', '子想法一') && s.edge('ideas', 'contains', '子想法二'), '两个都放进了 ideas');
}));

test('Tab 打包 / 新建域,Shift+Tab 解散:文件夹里是真文件夹;解散遇到图里没有的文件 = 弹窗中止;会丢说明 = 先问;双击展开的文件夹 = 收起', (t) => scene(t, async (s) => {
  const { page } = s;
  await s.ui('select idea/a idea/b'); await sleep(300);
  await page.keyboard.press('Tab'); await sleep(300);
  assert.match((await page.text('#creator .cr-hint')) ?? '', /把选中的 2 个打包成一个域/);
  await page.keyboard.press('Control+a'); await page.keyboard.type('两个想法'); await page.keyboard.press('Enter'); await sleep(1500);
  assert.ok(s.edge('ideas', 'contains', '两个想法') && s.edge('两个想法', 'contains', 'idea/a') && s.edge('两个想法', 'contains', 'idea/b'));
  assert.ok((await s.screen('两个想法'))['两个想法']?.[2], '新域保持展开');

  await s.ui('select src/app.ts src/util.ts'); await sleep(300);
  await page.keyboard.press('Tab'); await sleep(300);
  assert.match((await page.text('#creator .cr-hint')) ?? '', /一个新文件夹/);
  await page.keyboard.press('Control+a'); await page.keyboard.type('lib'); await page.keyboard.press('Enter'); await sleep(1500);
  assert.deepEqual(readdirSync(join(s.dir, 'src/lib')).sort(), ['app.ts', 'util.ts'], '文件真的搬进了新文件夹');

  await s.ui('select'); await sleep(200);
  await page.mouse.move(...await s.emptySpot('docs/')); await page.keyboard.press('Tab'); await sleep(300);
  await page.keyboard.press('Enter'); await sleep(1500);
  assert.ok(existsSync(join(s.dir, 'docs/新文件夹')), '什么都没选:在指针处新建空文件夹');

  writeFileSync(join(s.dir, 'src/lib/scratch.tmp'), 'x');
  await sleep(600);
  await s.ui('select src/lib/'); await sleep(300);
  await page.keyboard.press('Shift+Tab'); await sleep(1200);
  assert.ok(page.dialogs.some((d) => d.startsWith('alert') && d.includes('scratch.tmp')), `弹窗说明冲突:${page.dialogs}`);
  assert.ok(existsSync(join(s.dir, 'src/lib/app.ts')), '什么都没做');
  rmSync(join(s.dir, 'src/lib/scratch.tmp')); await sleep(600);
  await page.keyboard.press('Shift+Tab'); await sleep(1500);
  assert.ok(existsSync(join(s.dir, 'src/app.ts')) && !existsSync(join(s.dir, 'src/lib')), '冲突没了就解散');

  await s.ui('set 两个想法 -s 说明'); await sleep(800);
  await s.ui('select 两个想法'); await sleep(300);
  const asked = page.dialogs.length;
  await page.keyboard.press('Shift+Tab'); await sleep(1500);
  assert.ok(page.dialogs.slice(asked).some((d) => d.startsWith('confirm')), '会丢掉说明:先问');
  assert.ok(s.edge('ideas', 'contains', 'idea/a') && !s.has('两个想法'), '确定之后解散');

  await s.ui('select'); await s.ui('fit'); await s.settle(['docs/']);
  await page.mouse.dblclick(...await s.emptySpot('docs/')); await sleep(800);
  assert.ok(!(await s.screen('docs/readme.md'))['docs/readme.md'], '双击展开的文件夹 = 收起');
}));
