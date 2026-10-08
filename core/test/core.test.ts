import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parse, serialize } from '../src/format.ts';
import { lint } from '../src/lint.ts';
import { createUniverse, StarsError } from '../src/model.ts';
import { apply, type Op } from '../src/ops.ts';
import { filterNodes, neighborhood, shortestPath } from '../src/query.ts';
import { planScan } from '../src/scan.ts';

const genesis = () => parse(readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8'));

test('格式:序列化后再解析得到同一个宇宙(含引号、等号、中文)', () => {
  const u = genesis();
  apply(u, { op: 'addNode', id: 'a', label: '含 "引号" 与 = 号', attrs: { summary: 'x y=z', type: 'concept' } });
  apply(u, { op: 'addNode', id: 'b', label: 'b' });
  apply(u, { op: 'addEdge', from: 'a', type: 'dependsOn', to: 'b', attrs: { status: 'proposed' } });
  const text = serialize(u);
  assert.equal(serialize(parse(text)), text);
  assert.equal(parse(text).nodes.get('a')!.label, '含 "引号" 与 = 号');
  assert.equal(parse(text).nodes.get('a')!.attrs.summary, 'x y=z');
});

test('格式:对称边方向无关,写成 -t- ', () => {
  const u = genesis();
  apply(u, { op: 'addNode', id: 'x', label: 'x' });
  apply(u, { op: 'addNode', id: 'y', label: 'y' });
  apply(u, { op: 'addEdge', from: 'y', type: 'related', to: 'x' });
  assert.match(serialize(u), /^x -related- y$/m);
  assert.throws(() => apply(u, { op: 'addEdge', from: 'x', type: 'related', to: 'y' }), StarsError);
});

test('格式:错误信息带行号', () => {
  assert.throws(() => parse('stars 1\nnode a\n'), /第 2 行/);
  assert.throws(() => parse('hello\n'), /stars 1/);
});

test('操作:每个操作的逆操作都能还原宇宙', () => {
  const u = genesis();
  const base = serialize(u);
  const ops: Op[] = [
    { op: 'addNode', id: 'a', label: 'A' },
    { op: 'addNode', id: 'b', label: 'B', attrs: { type: 'concept' } },
    { op: 'addEdge', from: 'a', type: 'dependsOn', to: 'b' },
  ];
  const inverses = ops.map((op) => apply(u, op));
  const full = serialize(u);
  for (const op of [
    { op: 'setNode', id: 'a', label: 'AA', set: { k: 'v' } },
    { op: 'setEdge', from: 'a', type: 'dependsOn', to: 'b', set: { status: 'proposed' } },
    { op: 'removeNode', id: 'a' },
  ] as Op[]) {
    const inv = apply(u, op);
    apply(u, inv);
    assert.equal(serialize(u), full, `逆操作应还原: ${op.op}`);
  }
  for (const inv of inverses.reverse()) apply(u, inv);
  assert.equal(serialize(u), base);
});

test('操作:batch 中途失败会整体回滚', () => {
  const u = genesis();
  const before = serialize(u);
  assert.throws(() => apply(u, {
    op: 'batch',
    ops: [{ op: 'addNode', id: 'a', label: 'A' }, { op: 'addEdge', from: 'a', type: 'related', to: 'nope' }],
  }), /终点不存在/);
  assert.equal(serialize(u), before);
});

test('lint:环、多上级、未声明类型、孤儿、待确认、文件缺失', () => {
  const u = genesis();
  for (const id of ['a', 'b', 'c', 'lonely']) apply(u, { op: 'addNode', id, label: id, attrs: id === 'c' ? { type: 'ghost', file: 'nope.ts' } : {} });
  apply(u, { op: 'addEdge', from: 'a', type: 'contains', to: 'b' });
  apply(u, { op: 'addEdge', from: 'b', type: 'contains', to: 'a' });
  apply(u, { op: 'addEdge', from: 'c', type: 'contains', to: 'b' });
  apply(u, { op: 'addEdge', from: 'a', type: 'mystery', to: 'c', attrs: { status: 'proposed' } });
  const rules = new Set(lint(u, { baseDir: '/x', fileExists: () => false }).map((i) => i.rule));
  for (const r of ['cycle', 'multiple-parents', 'undeclared-edge-type', 'undeclared-node-type', 'orphan', 'proposed', 'missing-file']) {
    assert.ok(rules.has(r), `应报告 ${r}`);
  }
});

test('lint:干净的创世文件没有 error/warn', () => {
  assert.deepEqual(lint(genesis()).filter((i) => i.severity !== 'info'), []);
});

test('查询:过滤、邻域、最短路径', () => {
  const u = genesis();
  for (const id of ['a', 'b', 'c', 'd']) apply(u, { op: 'addNode', id, label: id, attrs: { type: 'concept' } });
  apply(u, { op: 'addEdge', from: 'a', type: 'dependsOn', to: 'b' });
  apply(u, { op: 'addEdge', from: 'b', type: 'dependsOn', to: 'c' });
  assert.deepEqual(filterNodes(u, { orphans: true }).map((n) => n.id), ['d']);
  assert.deepEqual([...neighborhood(u, 'a', { depth: 2, dir: 'out' }).dist], [['a', 0], ['b', 1], ['c', 2]]);
  assert.deepEqual(shortestPath(u, 'c', 'a')!.map((s) => s.to), ['b', 'a']);
  assert.equal(shortestPath(u, 'a', 'd'), null);
});

test('扫描:生成 dir/file 树,且可重复执行', () => {
  const u = genesis();
  apply(u, planScan(u, ['README.md', 'src/a.ts', 'src/lib/b.ts'], 'repo', 'demo'));
  assert.ok(u.nodes.has('src/lib/'));
  assert.deepEqual(lint(u).filter((i) => i.severity === 'error'), []);
  const again = planScan(u, ['README.md', 'src/a.ts', 'src/lib/b.ts'], 'repo', 'demo');
  assert.equal(again.op === 'batch' && again.ops.length, 0);
  assert.equal(createUniverse().nodes.size, 0);
});
