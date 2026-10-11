// 一张命令表:查看器里的写命令交给服务端的内核执行(和 CLI 同一份实现),--draft 也认;选项按命令表查;
// 只在命令行里有过的(view-set、scan …)查看器里也能用;「提议」级的脚本只能提议、只能改自己提的
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { scene, sleep } from './stage.ts';

test('命令:写命令走内核、--draft、选项检查、CLI 才有的命令、「提议」级脚本', (t) => scene(t, async (s) => {
  await s.ui('add c1 想法C1 -t note -s 说明');
  const c1 = s.store.load().nodes.get('c1')!;
  assert.deepEqual([c1.label, c1.attrs.type, c1.attrs.summary], ['想法C1', 'note', '说明']);
  assert.equal(s.store.readLog().at(-1)!.author, 'viewer');
  await s.ui('link c1 related idea/a');
  assert.ok(s.edge('c1', 'related', 'idea/a'));
  await s.ui('relink c1 related idea/a --type dependsOn');
  assert.ok(s.edge('c1', 'dependsOn', 'idea/a') && !s.edge('c1', 'related', 'idea/a'));
  const look = (await s.ui('show c1')).out;   // 读命令在本地算:马上看得到刚写的
  assert.match(look, /→ -dependsOn-> idea\/a/);

  // --draft:进草稿,不落进宇宙;draft apply 整批应用
  await s.ui('add d1 --draft');
  assert.ok(!s.has('d1'));
  assert.ok(existsSync(join(s.dir, 'universe.stars.draft')));
  for (let i = 0; i < 30 && !/草稿:1 条/.test((await s.ui('draft')).out); i++) await sleep(100);   // 草稿推过来
  await s.ui('draft apply');
  assert.ok(s.has('d1'));

  // 选项按命令表查;用法从命令表来
  await assert.rejects(s.ui('add x --depth 2'), /add 不认识选项 --depth/);
  await assert.rejects(s.ui('set'), /用法:set <id>/);
  // 以前只有 CLI 有的
  await s.ui('view-set 只看文件 --base galaxy --spec \'{"select":{"onlyTypes":["file","dir"]}}\'');
  assert.ok(s.has('~view/只看文件'));
  const help = (await s.ui('help')).out;
  for (const name of ['view-set', 'fn-set', 'scan', 'imports', 'stamp']) assert.match(help, new RegExp(`\\b${name}\\b`), `help 里有 ${name}`);
  assert.match((await s.ui('help view-set')).out, /view-set <名字> --spec/);

  // 「提议」级的脚本(查看器里的 run,和页面同一座桥):新增的落成 proposed,只能改自己提的
  mkdirSync(join(s.dir, 'tools'), { recursive: true });
  writeFileSync(join(s.dir, 'tools/p.js'), `export default async (stars) => {
  await stars.cmd.add('p1', '提议的', { type: 'note' });
  let blocked = '';
  try { await stars.cmd.set('idea/a', { label: '改别人的' }); } catch (e) { blocked = 'blocked'; }
  await stars.cmd.set('p1', { summary: blocked || 'not-blocked' });
  await stars.cmd.link('p1', 'dependsOn', 'idea/a');
  return 'done';
};\n`);
  await s.ui('connect propose tools/p.js');
  const r = await s.ui('run tools/p.js');
  assert.match(r.out, /done/);
  const p1 = s.store.load().nodes.get('p1')!;
  assert.deepEqual([p1.attrs.status, p1.attrs.summary], ['proposed', 'blocked']);
  assert.equal(s.store.load().edges.get(`p1\u0000dependsOn\u0000idea/a`)?.attrs.status, 'proposed');
  assert.equal(s.store.load().nodes.get('idea/a')!.label, '想法A', '别人的没被改');
  assert.ok(s.store.readLog().some((e) => e.author === 'script:tools/p.js'));
  assert.doesNotMatch(readFileSync(join(s.dir, 'universe.stars'), 'utf8'), /改别人的/);
}));
