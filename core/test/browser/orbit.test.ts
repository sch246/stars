// 开普勒轨道(设置 orbit,默认关):打开后进入的星系里成员沿轨道走,指着的、选中的照样走、也点得到;关掉回到布局位置不动
// 另外两条是这一版修的:①拖完松手要停在落点、轨道就地重起,不能顺着旧相位滑到另一头;
// ②进入一个**就地展开**的容器再退出,容器要钉在原地(往外那层没被画出来时位置也得算得对)。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scene, sleep } from './stage.ts';

type P = any;

test('开普勒轨道:打开后成员在走、指着的照样走也能点中;关掉就静止在布局位置', (t) => scene(t, async (s) => {
  const ids = ['idea/a', 'idea/b', 'idea/c'];
  const moved = (p: Record<string, [number, number, number?]>, q: Record<string, [number, number, number?]>) => Math.max(...ids.map((id) => Math.hypot(q[id]![0] - p[id]![0], q[id]![1] - p[id]![1])));
  await s.ui('jump ideas'); await sleep(900);
  const still0 = await s.screen(...ids); await sleep(700);
  assert.ok(moved(still0, await s.screen(...ids)) < 1.5, '默认关:热量关着时不动');

  await s.ui('param orbit 0.8'); await sleep(300);
  const p = await s.screen(...ids); await sleep(900);
  assert.ok(moved(p, await s.screen(...ids)) > 4, '打开后在轨道上走');

  const at = await s.at('idea/b');
  await s.page.mouse.move(...at); await sleep(1400);
  const b2 = await s.at('idea/b');
  assert.ok(Math.hypot(b2[0] - at[0], b2[1] - at[1]) > 1.5, '指着的照样走(不停)');
  await s.page.mouse.click(...b2); await sleep(300);
  assert.match((await s.page.text('#side-info h3')) ?? '', /想法B/, '点得中');

  await s.ui('select'); await s.ui('param orbit 0'); await sleep(300);
  const q = await s.screen(...ids); await sleep(700);
  assert.ok(moved(q, await s.screen(...ids)) < 1.5, '关掉:回到布局位置,不再动');
}));

// 拖完松手:轨道以落点为远点重新起(相位 π),画的位置 = 布局位置;老行为会保留旧相位、沿旧轨道滑走
test('开普勒轨道:拖完松手停在落点,轨道就地重起', (t) => scene(t, async (s) => {
  const node = (id: string) => s.page.evaluate((x: string) => {
    const w = (window as P).__stars, sp = w.getSpace(w.space()), n = sp.byId.get(x);
    return n ? { x: n.x, y: n.y, ox: n.ox, oy: n.oy, oa: n.oa, om: n.om } : null;
  }, id) as Promise<{ x: number; y: number; ox: number; oy: number; oa: number; om: number } | null>;
  await s.ui('jump repo'); await sleep(500);
  await s.ui('param orbit 0.8'); await sleep(400);
  // 相位挪到 1/4 处:离远点很远,老行为松手后必然往那儿滑;新行为会就地重起
  await s.page.evaluate(() => { (window as P).__stars.getSpace('repo').byId.get('src/').om = Math.PI / 2; });
  await sleep(150);
  const from = await s.at('src/');
  await s.page.mouse.move(...from); await s.page.mouse.down();
  await s.page.mouse.move(from[0] + 160, from[1] - 120, 12); await sleep(400);
  assert.equal(await s.page.evaluate(() => (window as P).__stars.dragInfo()?.id), 'src/', '拖的是要拖的那个容器');
  await s.page.mouse.up(); await sleep(90);
  const n = await node('src/');
  assert.ok(n, '拿得到节点');
  assert.equal(n.oa, 1, '松手后回到轨道状态(不再做 0→1 的滑行)');
  assert.ok(Math.abs(n.om - Math.PI) < 0.3, `轨道就地重起(相位回到远点 π),实际 ${n.om.toFixed(2)}`);
  assert.ok(Math.hypot(n.ox - n.x, n.oy - n.y) < 6, `画的位置就是落点(布局位置),差了 ${Math.hypot(n.ox - n.x, n.oy - n.y).toFixed(1)}`);
}, ['repo', 'ideas']));

// 就地展开的容器:进去时外层不再当"上下文"画,所以退出取位置时它的空间这一帧没被算过 ——
// 位置必须按需补算,否则退出用的是布局位置,容器(和整个镜头)会偏出去一截
test('开普勒轨道:进出一个就地展开的容器,容器钉在原地', (t) => scene(t, async (s) => {
  const T = () => s.page.evaluate(() => { const t = (window as P).__stars.transform(); return { x: t.x, y: t.y, k: t.k }; }) as Promise<{ x: number; y: number; k: number }>;
  const space = () => s.page.evaluate(() => (window as P).__stars.space()) as Promise<string | null>;
  const orbOf = (id: string) => s.page.evaluate((x: string) => { const n = (window as P).__stars.getSpace('repo').byId.get(x); return { ox: n.ox, oy: n.oy }; }, id) as Promise<{ ox: number; oy: number }>;
  await s.ui('jump repo'); await sleep(600);
  await s.ui('param orbit 0.8'); await sleep(400);
  assert.ok((await s.page.evaluate(() => [...(window as P).__stars.expanded()]) as string[]).includes('ideas'), 'ideas 是就地展开的');

  const q0 = await orbOf('ideas');
  // 转慢一点:让"钉在原地"能卡到像素级(否则采样这一两帧里它已经又走了几像素)
  await s.page.evaluate(() => { (window as P).__stars.P.spin = 0.05; }); await sleep(100);
  await s.page.evaluate(() => (window as P).__stars.enter('ideas', false)); await sleep(150);
  assert.equal(await space(), 'ideas', '进到 ideas 里面');
  const inside = await T();
  await sleep(1200);
  const q1 = await orbOf('ideas');
  assert.ok(Math.hypot(q1.ox - q0.ox, q1.oy - q0.oy) > 0.2, '在里面时外面那层照转(它的位置一直在变)');
  const still = await T();
  assert.ok(Math.hypot(still.x - inside.x, still.y - inside.y) < 0.5 && still.k === inside.k, '镜头不动:容器就是钉在这个屏幕位置上的');

  await s.page.evaluate(() => (window as P).__stars.exit(false)); await sleep(150);
  assert.equal(await space(), 'repo', '回到 repo');
  const p = (await s.screen('ideas'))['ideas'];
  assert.ok(p, 'ideas 回到画面里');
  assert.ok(Math.hypot(p[0] - inside.x, p[1] - inside.y) < 4, `退出后容器还钉在原来的屏幕位置(偏了 ${Math.hypot(p[0] - inside.x, p[1] - inside.y).toFixed(1)}px)`);
}));
