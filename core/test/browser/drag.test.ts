// 拖动整理:Shift 拖 = 移动(文件真的在磁盘上搬)、Ctrl 拖 = 复制、Alt 拖 = 引用;放进自己里面被拒;Ctrl+Z 一步步撤回;多选一起被拉
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { scene, sleep } from './stage.ts';

test('拖动整理:移动 / 复制 / 引用;放不进自己里面;Ctrl+Z 撤回(文件搬回原处)', (t) => scene(t, async (s) => {
  const { page } = s;
  /** 拖 id 到容器 into 上:展开着的放在里面的空地上,收起的放在它身上 */
  const dragInto = async (id: string, into: string, mods: string[]) => {
    await s.ui('fit'); await s.settle([id, into]);
    const open = (await s.screen(into))[into]?.[2];
    await page.mouse.drag(await s.at(id), open ? await s.emptySpot(into) : await s.at(into), { mods }); await sleep(1200);
  };
  await dragInto('idea/b', 'docs/', ['Shift']);
  assert.ok(s.edge('docs/', 'contains', 'idea/b') && !s.edge('ideas', 'contains', 'idea/b'), 'Shift 拖 = 移动:换了上级');
  await dragInto('src/app.ts', 'docs/', ['Shift']);
  assert.ok(existsSync(join(s.dir, 'docs/app.ts')) && !existsSync(join(s.dir, 'src/app.ts')), '文件在磁盘上搬了');
  assert.ok(s.edge('docs/app.ts', 'dependsOn', 'src/auth.ts'), '关系跟着走');
  await dragInto('idea/a', 'auth-mod', ['Control']);
  assert.ok(s.edge('auth-mod', 'contains', 'idea/a-copy') && s.edge('ideas', 'contains', 'idea/a'), 'Ctrl 拖 = 复制,原来的不动');
  await dragInto('idea/c', 'src/', ['Alt']);
  assert.ok(s.edge('src/', 'contains', 'idea/c') && s.edge('ideas', 'contains', 'idea/c'), 'Alt 拖 = 引用:两边都装着');

  await s.ui('select ideas idea/a'); await sleep(300);
  await page.mouse.drag(await s.at('idea/a'), await s.at('idea/c'), { mods: ['Shift'] }); await sleep(1000);
  assert.match((await s.toast()) ?? '', /自己里面/, '把 ideas 拖进自己的孩子里:拒绝');
  assert.ok(s.edge('repo', 'contains', 'ideas'));

  await s.ui('select'); await page.mouse.move(...await s.emptySpot());
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Control+z'); await sleep(700); }
  assert.ok(existsSync(join(s.dir, 'src/app.ts')) && !existsSync(join(s.dir, 'docs/app.ts')), '撤回:文件回到 src');
  assert.ok(s.edge('ideas', 'contains', 'idea/b') && !s.has('idea/a-copy') && !s.edge('src/', 'contains', 'idea/c'));
}));

test('多选普通拖:选中的一起被拉向指针', (t) => scene(t, async (s) => {
  const { page } = s;
  await s.ui('select idea/a idea/b'); await sleep(300);
  const a0 = await s.at('idea/a'), b0 = await s.at('idea/b'), to: [number, number] = [a0[0] + 160, a0[1] + 120];
  await page.mouse.move(...a0); await page.mouse.down();
  await page.mouse.move(...to, 15); await sleep(1500);
  const a1 = await s.at('idea/a'), b1 = await s.at('idea/b');
  await page.mouse.up();
  const d = (p: number[], q: number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!);
  assert.ok(d(a1, to) < d(a0, to) - 40 && d(b1, to) < d(b0, to) - 40, `两个都靠近了:a ${d(a0, to) | 0}→${d(a1, to) | 0},b ${d(b0, to) | 0}→${d(b1, to) | 0}`);
}));
