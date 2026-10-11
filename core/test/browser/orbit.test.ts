// 开普勒轨道(设置 orbit,默认关):打开后进入的星系里成员沿轨道走、指着的停下、点得到;关掉回到布局位置不动
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scene, sleep } from './stage.ts';

test('开普勒轨道:打开后成员在走、指着的停下能点中;关掉就静止在布局位置', (t) => scene(t, async (s) => {
  const ids = ['idea/a', 'idea/b', 'idea/c'];
  const moved = (p: Record<string, [number, number, number?]>, q: Record<string, [number, number, number?]>) => Math.max(...ids.map((id) => Math.hypot(q[id]![0] - p[id]![0], q[id]![1] - p[id]![1])));
  await s.ui('jump ideas'); await sleep(900);
  const still0 = await s.screen(...ids); await sleep(700);
  assert.ok(moved(still0, await s.screen(...ids)) < 1.5, '默认关:热量关着时不动');

  await s.ui('param orbit 0.8'); await sleep(300);
  const p = await s.screen(...ids); await sleep(900);
  assert.ok(moved(p, await s.screen(...ids)) > 4, '打开后在轨道上走');

  const at = await s.at('idea/b');
  await s.page.mouse.move(...at); await sleep(500);
  const b2 = await s.at('idea/b');
  assert.ok(Math.hypot(b2[0] - at[0], b2[1] - at[1]) < 4, '指着的停下');
  await s.page.mouse.click(...b2); await sleep(300);
  assert.match((await s.page.text('#side-info h3')) ?? '', /想法B/, '点得中');

  await s.ui('select'); await s.ui('param orbit 0'); await sleep(300);
  const q = await s.screen(...ids); await sleep(700);
  assert.ok(moved(q, await s.screen(...ids)) < 1.5, '关掉:回到布局位置,不再动');
}));
