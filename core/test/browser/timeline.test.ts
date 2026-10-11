// 时间线按操作:操作日志里的每一次写入是一步,回放那一步刚做完时的宇宙;删掉的节点留在原位(红圈)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scene, sleep } from './stage.ts';

test('时间线:按操作一步一步回放;删掉的节点在回放里看得到;回到现在', (t) => scene(t, async (s) => {
  const { page } = s;
  await s.ui('add g1 幽灵 -t note');
  await s.ui('set g1 -s 说明');
  await s.ui('rm g1');
  assert.ok(!s.has('g1'));
  await s.ui('panel timeline on');
  await s.ui('timeline ops');
  await page.waitFor(() => /步操作/.test(document.getElementById('tl-info')?.textContent ?? ''), 8000);
  assert.ok(await page.count('#tl-svg [data-op]') >= 3);

  await s.ui('timeline prev');   // 最后一步:rm g1
  await page.waitFor(() => /操作 #\d+/.test(document.getElementById('replaybar')?.textContent ?? ''), 8000);
  assert.match((await page.text('#replaybar')) ?? '', /−1/);
  assert.match((await s.ui('show g1')).out, /g1 \[note\]  幽灵/, '删掉的节点回放里还在(红圈)');
  await s.ui('timeline prev');   // set g1
  await page.waitFor(() => /~node g1/.test(document.getElementById('replaybar')?.textContent ?? ''), 8000);
  await s.ui('timeline prev');   // add g1
  await page.waitFor(() => /\+node g1/.test(document.getElementById('replaybar')?.textContent ?? ''), 8000);
  assert.match((await page.text('#replaybar')) ?? '', /\+1/);
  assert.doesNotMatch((await s.ui('show g1')).out, /summary/, '这一步的时候还没写说明');

  await s.ui('timeline now');
  await sleep(500);
  assert.ok(await page.evaluate(() => document.getElementById('replaybar')!.hidden));
  await assert.rejects(s.ui('show g1'), /节点不存在/);
  await s.ui('timeline ops');   // 切回按提交
  assert.ok(!(await page.evaluate(() => document.getElementById('tl-ops')!.classList.contains('on'))));
}));
