import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse, serialize } from '../src/format.ts';
import { mergeUniverses } from '../src/merge.ts';
import { apply, type Op } from '../src/ops.ts';
import { Store } from '../src/store.ts';

const genesisText = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const fork = (...ops: Op[]) => { const u = parse(genesisText); for (const op of ops) apply(u, op); return u; };

test('合并:两边各加不同的节点和边 → 干净合并', () => {
  const base = fork({ op: 'addNode', id: 'a', label: 'A' });
  const ours = fork({ op: 'addNode', id: 'a', label: 'A' }, { op: 'addNode', id: 'b', label: 'B' }, { op: 'addEdge', from: 'a', type: 'dependsOn', to: 'b' });
  const theirs = fork({ op: 'addNode', id: 'a', label: 'A' }, { op: 'addNode', id: 'c', label: 'C' }, { op: 'addEdge', from: 'c', type: 'related', to: 'a' });
  const { universe, conflicts } = mergeUniverses(base, ours, theirs);
  assert.deepEqual(conflicts, []);
  assert.deepEqual([...universe.nodes.keys()].filter((k) => !k.startsWith('~')).sort(), ['a', 'b', 'c', 'universe']);
  assert.equal(universe.edges.size, 2);
});

test('合并:同一节点的不同字段各改各的 → 合并;同一字段改成不同值 → 冲突', () => {
  const mk = (...extra: Op[]) => fork({ op: 'addNode', id: 'a', label: 'A', attrs: { summary: 's', type: 'concept' } }, ...extra);
  const base = mk();
  const ours = mk({ op: 'setNode', id: 'a', set: { summary: 'ours' } });
  const theirs = mk({ op: 'setNode', id: 'a', set: { color: '#fff' } });
  const clean = mergeUniverses(base, ours, theirs);
  assert.deepEqual(clean.conflicts, []);
  assert.deepEqual(clean.universe.nodes.get('a')!.attrs, { summary: 'ours', type: 'concept', color: '#fff' });

  const t2 = mk({ op: 'setNode', id: 'a', set: { summary: 'theirs' } });
  const bad = mergeUniverses(base, ours, t2);
  assert.equal(bad.conflicts.length, 1);
  assert.equal(bad.universe.nodes.get('a')!.attrs.summary, 'ours');
});

test('合并:一边删除一边没动 → 删除;一边删除一边修改 → 冲突并保留修改;删节点另一边连了边 → 恢复节点', () => {
  const mk = (...extra: Op[]) => fork({ op: 'addNode', id: 'a', label: 'A' }, { op: 'addNode', id: 'b', label: 'B' }, ...extra);
  const base = mk();
  const deleted = mk({ op: 'removeNode', id: 'a' });
  assert.ok(!mergeUniverses(base, deleted, mk()).universe.nodes.has('a'));
  const modified = mk({ op: 'setNode', id: 'a', set: { x: '1' } });
  const r = mergeUniverses(base, deleted, modified);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.universe.nodes.get('a')!.attrs.x, '1');
  const linked = mk({ op: 'addEdge', from: 'a', type: 'related', to: 'b' });
  const r2 = mergeUniverses(base, deleted, linked);
  assert.ok(r2.universe.nodes.has('a'), '边引用的节点被恢复');
  assert.match(r2.conflicts.join('\n'), /已恢复/);
});

test('合并:作为 git 合并驱动 —— 相邻位置的并发插入,纯文本合并会冲突,驱动能合并', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-merge-'));
  const file = join(dir, 'universe.stars');
  const sh = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const store = new Store(file);
  sh('init', '-q', '-b', 'main');
  store.create(genesisText);
  sh('add', '.'); sh('commit', '-qm', 'genesis');
  sh('checkout', '-qb', 'exp');
  store.commit({ op: 'addNode', id: 'alpha', label: 'α' }, { author: 'x' });
  sh('add', '-A'); sh('commit', '-qm', 'exp');   // 连同操作日志一起提交:两边的日志也各自追加了
  sh('checkout', '-q', 'main');
  store.commit({ op: 'addNode', id: 'beta', label: 'β' }, { author: 'y' });
  sh('add', '-A'); sh('commit', '-qm', 'main');

  // 没有驱动:同一位置相邻插入 → 文本冲突
  assert.throws(() => sh('merge', '--no-edit', 'exp'));
  sh('merge', '--abort');

  // 启用驱动(就用 install-merge 本身):宇宙文件按事实合并,操作日志按行取并集
  execFileSync('node', [cli, 'install-merge'], { cwd: dir, stdio: 'ignore' });
  assert.deepEqual(readFileSync(join(dir, '.gitattributes'), 'utf8').trim().split('\n'), ['*.stars merge=stars', '*.stars.log merge=union']);
  sh('add', '.gitattributes'); sh('commit', '-qm', 'attrs');
  sh('merge', '--no-edit', 'exp');
  const log = readFileSync(file + '.log', 'utf8');
  assert.ok(log.includes('"alpha"') && log.includes('"beta"') && !log.includes('<<<<<<<'), '两边的操作日志都在,没有冲突标记');
  const merged = parse(readFileSync(file, 'utf8'));
  assert.ok(merged.nodes.has('alpha') && merged.nodes.has('beta'));
  assert.equal(serialize(merged), readFileSync(file, 'utf8'), '合并结果仍是规范格式');
  assert.equal(sh('log', '--format=%P', '-n', '1').trim().split(' ').length, 2, '确实是一个合并提交');
});
