import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runKernel, type CliOpts } from '../src/commands.ts';
import { parse } from '../src/format.ts';
import { apply, type Op } from '../src/ops.ts';
import { Store } from '../src/store.ts';
import { compileView, listQueries, QUERY_PREFIX, validateSpec } from '../src/view.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');

/** a → b → c → d(dependsOn),e 依赖 c;x ~ y(对称的 related);m 包含 a、b */
function world() {
  const u = parse(genesis);
  const ops: Op[] = [];
  for (const id of ['a', 'b', 'c', 'd', 'e', 'x', 'y']) ops.push({ op: 'addNode', id, label: id.toUpperCase(), attrs: { type: id < 'x' ? 'module' : 'concept' } });
  ops.push({ op: 'addNode', id: 'm', label: 'M', attrs: { type: 'group' } });
  for (const [f, t] of [['a', 'b'], ['b', 'c'], ['c', 'd'], ['e', 'c']]) ops.push({ op: 'addEdge', from: f!, type: 'dependsOn', to: t! });
  ops.push({ op: 'addEdge', from: 'y', type: 'related', to: 'x' });
  ops.push({ op: 'addEdge', from: 'm', type: 'contains', to: 'a' }, { op: 'addEdge', from: 'm', type: 'contains', to: 'b' });
  apply(u, { op: 'batch', ops });
  return u;
}
const sorted = (xs: string[]) => [...xs].sort();

test('查询:路径条件 from / to / near / out / into', () => {
  const c = compileView(world(), {});
  assert.deepEqual(sorted(c.matches("from('a', 'dependsOn')")), ['b', 'c', 'd'], 'a 直接或间接依赖的');
  assert.deepEqual(sorted(c.matches("from('a', 'dependsOn', 1)")), ['b'], '限一步');
  assert.deepEqual(sorted(c.matches("to('c', 'dependsOn')")), ['a', 'b', 'e'], '直接或间接依赖 c 的');
  assert.deepEqual(sorted(c.matches("near('c')")), ['b', 'd', 'e'], '一步之内,不分方向、不含自己');
  assert.deepEqual(sorted(c.matches("near('c', 2, 'dependsOn')")), ['a', 'b', 'd', 'e']);
  assert.deepEqual(sorted(c.matches("from('m')")), ['a', 'b', 'c', 'd'], '不给类型 = 任何边');
  assert.deepEqual(sorted(c.matches("out('dependsOn') > 0 && into('dependsOn') == 0")), ['a', 'e'], '依赖链的起点');
  assert.deepEqual(c.matches("into('dependsOn', 'e') > 0"), ['c']);
  assert.deepEqual(sorted(c.matches("from('x', 'related')")), ['y'], '对称边:两个方向都算');
  assert.deepEqual(sorted(c.matches("out('related') == 1")), ['x', 'y']);
  assert.deepEqual(c.matches("from('nope', 'dependsOn')"), [], '起点不存在 = 空');
  assert.deepEqual(c.matches("from('a', 'noSuchType')"), []);
  assert.deepEqual(c.matches("type == 'concept' && label == 'Y'"), ['y'], '普通条件照常');
  assert.ok(!c.matches('true').some((id) => id.startsWith('~')), '模式节点不算');
  assert.throws(() => c.matches('type ==='), /无法编译/);
});

test('查询:保存的查询 —— 结果、互相引用(算完还原当前节点)、循环引用与错误各自报', () => {
  const u = world();
  const q = (name: string, expr: string, extra: Record<string, string> = {}) =>
    apply(u, { op: 'addNode', id: QUERY_PREFIX + name, label: name, attrs: { kind: 'query', expr, ...extra } });
  q('deps', "from('a', 'dependsOn')", { color: '#ff0000' });
  q('leaf', "out('dependsOn') == 0 && into('dependsOn') > 0");
  q('both', "query('deps') && query('leaf')");
  q('notDeps', "type == 'module' && !query('deps')");
  q('loop1', "query('loop2')"); q('loop2', "query('loop1')");
  q('broken', 'nosuch.thing()');
  assert.deepEqual(listQueries(u).map((x) => x.name), ['both', 'broken', 'deps', 'leaf', 'loop1', 'loop2', 'notDeps']);
  const res = Object.fromEntries(compileView(u, {}).queryResults().map((r) => [r.name, r]));
  assert.deepEqual(sorted(res.deps!.members), ['b', 'c', 'd']);
  assert.equal(res.deps!.color, '#ff0000');
  assert.deepEqual(res.leaf!.members, ['d']);
  assert.deepEqual(res.both!.members, ['d']);
  assert.deepEqual(sorted(res.notDeps!.members), ['a', 'e'], '引用别的查询之后,当前节点还原了');
  assert.match(res.loop1!.error!, /循环引用/);
  assert.ok(res.broken!.error);
  assert.deepEqual(res.broken!.members, []);
  // 视图规则里也能用路径条件和查询
  const c2 = compileView(u, { select: { where: "query('deps') || id == 'a'" } });
  assert.deepEqual(sorted(c2.fold().nodes.map((n) => n.id)), ['a', 'b', 'c', 'd']);
  assert.deepEqual(validateSpec({ select: { where: "from('a', 'dependsOn')" } }, u), []);
});

test('查询:CLI —— query-set / query / queries,表达式里能用 stale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-q-'));
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  const run = (cmd: string, args: string[] = [], o: CliOpts = {}) => runKernel(cmd, args, o, { store, author: 'me', root: dir });
  writeFileSync(join(dir, 'f.ts'), 'one\n');
  run('add', ['f'], { ref: 'f.ts', summary: '一号', type: 'module' });
  run('add', ['g'], { type: 'module' });
  run('link', ['g', 'dependsOn', 'f']);
  const set = run('query-set', ['users-of-f'], { expr: "to('f', 'dependsOn')", summary: '谁用了 f', attr: ['color=#00ff00'] });
  assert.ok(set.out.startsWith('+ 查询 users-of-f') && set.out.includes('现在匹配 1 个'), set.out);
  assert.equal(store.load().nodes.get('~query/users-of-f')!.attrs.color, '#00ff00');
  assert.deepEqual(run('query', ['users-of-f']).data, ['g']);
  assert.deepEqual(run('query', ["type == 'module'"]).data, ['f', 'g']);
  assert.deepEqual(run('query', ['stale']).data, []);
  writeFileSync(join(dir, 'f.ts'), 'two\n');
  assert.deepEqual(run('query', ['stale']).data, ['f'], 'stale 也是一个信号');
  run('query-set', ['need-update'], { expr: "stale || query('users-of-f')" });
  const qs = run('queries');
  assert.match(qs.out, /need-update\s+2 个/);
  assert.match(qs.out, /users-of-f\s+1 个/);
  assert.match(run('query-set', ['users-of-f'], { expr: "to('f')" }).out, /~ 查询 users-of-f/, '同名覆盖');
  assert.throws(() => run('query-set', ['bad name'], { expr: 'true' }), /查询名/);
  assert.throws(() => run('query-set', ['x'], { expr: 'type ===' }), /表达式写错了/);
  assert.throws(() => run('query-set', ['x'], { expr: "query('nope')" }), /没有保存的查询/);
  assert.throws(() => run('query', ['type ===']), /表达式写错了/);
});
