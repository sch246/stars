// 后退 / 前进(Alt ← / →、鼠标侧键):在走过的「空间 + 选中」之间来回,后退后再走新的一步就丢掉前面的;
// 指着节点时的名字气泡在所有面板上面;浮动面板点到 / 打开时到最上面,拖边框挪位置,panel-reset / 双击边框放回原处
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scene, sleep } from './stage.ts';

test('后退前进;悬浮名字不被面板挡住;面板置顶、拖动、放回', (t) => scene(t, async (s) => {
  const { page } = s;
  const where = async () => page.evaluate(() => ({
    space: document.querySelector('#status b')?.textContent ?? '',
    sel: document.getElementById('side')!.hidden ? '' : document.querySelector('#side-info h3')?.textContent ?? '',
  }));
  const step = 650;   // 一连串的变化 400ms 内合成一步

  // ---- 后退 / 前进 ----
  await sleep(step);
  const start = await where();
  await page.mouse.click(...await s.at('docs/readme.md')); await sleep(step);
  assert.match((await where()).sel, /readme/);
  await s.ui('select'); await sleep(step);            // 取消选中不算一步
  await s.ui('jump ideas'); await sleep(step + 300);
  await page.mouse.click(...await s.at('idea/b')); await sleep(step);
  assert.deepEqual(await where(), { space: '想法', sel: '想法B' });

  await page.keyboard.press('Alt+ArrowLeft'); await sleep(300);
  assert.equal((await where()).space, '想法', '退一步:还在「想法」里,没选中');
  assert.doesNotMatch((await where()).sel, /想法B/);
  await page.keyboard.press('Alt+ArrowLeft'); await sleep(300);
  assert.deepEqual(await where(), { space: start.space, sel: 'readme.md' }, '再退:回到最外层、选中 readme');
  const first = await s.ui('back');
  assert.equal(first.data.sel, null, '退到起点:什么都没选');
  assert.equal((await s.ui('back')).data.sel, null, '起点之前没有了:原地不动');
  await page.keyboard.press('Alt+ArrowRight'); await sleep(300);
  assert.match((await where()).sel, /readme/, '前进');
  await page.keyboard.press('Alt+ArrowRight'); await sleep(300);
  await page.keyboard.press('Alt+ArrowRight'); await sleep(300);
  assert.deepEqual(await where(), { space: '想法', sel: '想法B' }, '前进到最后一步');
  // 后退之后走新的一步:前面的丢掉
  await page.keyboard.press('Alt+ArrowLeft'); await sleep(400);
  await page.mouse.click(...await s.at('idea/a')); await sleep(step);
  assert.equal((await s.ui('forward')).data.sel, 'idea/a', '前面那步(想法B)已经丢了');
  // 鼠标侧键
  await page.mouse.click(...await s.at('idea/c')); await sleep(step);
  await page.mouse.move(...await s.emptySpot()); await page.mouse.down('back'); await page.mouse.up('back'); await sleep(300);
  assert.equal((await where()).sel, '想法A', '侧键「后退」');
  await page.mouse.down('forward'); await page.mouse.up('forward'); await sleep(300);
  assert.equal((await where()).sel, '想法C', '侧键「前进」');
  await s.ui('jump'); await s.ui('select'); await sleep(700);

  // ---- 悬浮名字:页面最上层,移到面板上就收起 ----
  const [hx, hy] = await s.at('src/app.ts');
  await page.mouse.move(hx, hy); await sleep(150);
  const tip = () => page.evaluate(() => { const e = document.getElementById('hover-tip')!; return e.hidden ? null : { text: e.textContent, z: +getComputedStyle(e).zIndex }; });
  const shown = await tip();
  assert.equal(shown?.text, 'app.ts', '指着节点:名字气泡');
  const panelZ = await page.evaluate(() => Math.max(...[...document.querySelectorAll<HTMLElement>('.panel')].map((e) => +getComputedStyle(e).zIndex || 0)));
  assert.ok(shown!.z > panelZ, `气泡(${shown!.z})在所有面板(${panelZ})上面`);
  const tools = await page.evaluate(() => { const r = document.getElementById('tools')!.getBoundingClientRect(); return [r.left + r.width / 2, r.bottom - 6] as [number, number]; });
  await page.mouse.move(hx - 40, hy); await page.mouse.move(...tools); await sleep(150);
  assert.equal(await tip(), null, '移到面板上:气泡收起');

  // ---- 面板:打开 / 点到时到最上面 ----
  await page.mouse.click(...await s.at('docs/readme.md')); await page.keyboard.press('Control+c'); await sleep(300);
  const z = (id: string) => page.evaluate((i) => +getComputedStyle(document.getElementById(i)!).zIndex, id);
  assert.ok(await page.evaluate(() => !!document.getElementById('tray') && !document.getElementById('tray')!.hidden), '剪贴板出来了');
  await s.ui('panel projects'); await sleep(200);
  assert.ok(await z('projects') > await z('tray'), '刚打开的项目列表在剪贴板上面');
  const gap = await page.evaluate(() => document.getElementById('tray')!.getBoundingClientRect().top - document.getElementById('projects')!.getBoundingClientRect().bottom);
  assert.ok(gap >= 0, `左边那一摞到剪贴板为止,不把它盖住(间隔 ${gap})`);
  await page.clickOn('#tray .tr-h .t'); await sleep(150);
  assert.ok(await z('tray') > await z('projects'), '点一下剪贴板:它到上面');
  assert.ok(await page.evaluate(() => !document.getElementById('projects')!.hidden), '点剪贴板不会关掉项目列表');
  await page.clickOn('#tray .tr-h .t'); await sleep(150);   // 再点一下展开回来

  // ---- 拖边框挪位置;panel-reset、双击边框放回 ----
  const rect = (id: string) => page.evaluate((i) => { const r = document.getElementById(i)!.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width }; }, id);
  const r0 = await rect('projects');
  const grab: [number, number] = [r0.l + r0.w / 2, r0.t + 4];   // 上边框(内边距)
  assert.ok(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.id === 'projects', grab), '按在边框上');
  await page.mouse.drag(grab, [grab[0] + 260, grab[1] + 40]); await sleep(150);
  const r1 = await rect('projects');
  assert.ok(Math.abs(r1.l - r0.l - 260) < 4 && Math.abs(r1.t - r0.t - 40) < 4, `挪过去了:${JSON.stringify([r0, r1])}`);
  assert.ok(await page.evaluate(() => !document.getElementById('projects')!.hidden), '拖完没被当成「点别处」关掉');
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('stars.panelPos') || '{}').projects), '位置记下了');
  await s.ui('panel projects off'); await s.ui('panel projects on'); await sleep(150);
  const r2 = await rect('projects');
  assert.ok(Math.abs(r2.l - r1.l) < 2 && Math.abs(r2.t - r1.t) < 2, '关了再开还在挪过的地方');
  await s.ui('panel-reset projects'); await sleep(100);
  const r3 = await rect('projects');
  assert.ok(Math.abs(r3.l - r0.l) < 2 && Math.abs(r3.t - r0.t) < 2, 'panel-reset 放回原处');
  // 侧栏:在右半边,按离右边多远记;双击边框放回
  const s0 = await rect('side');
  await page.mouse.drag([s0.l + s0.w / 2, s0.t + 4], [s0.l + s0.w / 2 - 300, s0.t + 64]); await sleep(150);
  const s1 = await rect('side');
  assert.ok(Math.abs(s1.l - s0.l + 300) < 4 && Math.abs(s1.t - s0.t - 60) < 4, '侧栏挪过去了');
  assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('stars.panelPos') || '{}').side.r > 0), '侧栏记的是离右边多远');
  await page.mouse.dblclick(s1.l + s1.w / 2, s1.t + 4); await sleep(150);
  const s2 = await rect('side');
  assert.ok(Math.abs(s2.l - s0.l) < 2 && Math.abs(s2.t - s0.t) < 2, '双击边框放回');
}));
