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

test('视图:大小来自属性,目录大小沿 contains 汇总,规则按顺序匹配', async () => {
  const { evaluateView, BUILTIN_VIEWS } = await import('../src/view.ts');
  const u = genesis();
  apply(u, planScan(u, ['a/x.ts', 'a/y.md', 'b/z.ts'], 'repo', 'demo', (p) => ({ size: { 'a/x.ts': 100, 'a/y.md': 900, 'b/z.ts': 10 }[p]! })));
  const scene = evaluateView(u, BUILTIN_VIEWS.orbit!);
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  assert.equal(byId.get('a/')!.value, 1000); // 汇总 = 100 + 900
  assert.equal(byId.get('repo')!.value, 1010);
  assert.ok(byId.get('a/y.md')!.r > byId.get('a/x.ts')!.r, '文件越大节点越大');
  assert.ok(byId.get('a/x.ts')!.r > byId.get('b/z.ts')!.r);
  assert.equal(byId.get('a/')!.shape, 'nebula');
  assert.equal(byId.get('a/x.ts')!.color, byId.get('b/z.ts')!.color, '同扩展名同色');
  assert.notEqual(byId.get('a/x.ts')!.color, byId.get('a/y.md')!.color, '不同扩展名不同色');
  assert.ok(scene.edges.every((e) => e.mode === 'orbit'), 'contains 在银河视图里是轨道');
});

test('视图:同一份关系,换视图就换了表达(隐藏 contains、按关系筛节点)', async () => {
  const { evaluateView, BUILTIN_VIEWS } = await import('../src/view.ts');
  const u = genesis();
  apply(u, planScan(u, ['a/x.ts'], 'repo', 'demo'));
  apply(u, { op: 'addNode', id: 'goal', label: 'goal', attrs: { type: 'concept' } });
  apply(u, { op: 'addEdge', from: 'goal', type: 'dependsOn', to: 'a/x.ts' });
  const deps = evaluateView(u, BUILTIN_VIEWS.deps!);
  assert.deepEqual(deps.nodes.map((n) => n.id).sort(), ['a/x.ts', 'goal']);
  assert.equal(deps.edges.length, 1, 'contains 被隐藏');
  const tree = evaluateView(u, BUILTIN_VIEWS.tree!);
  assert.equal(tree.nodes.length, 5); // universe、repo、a/、a/x.ts、goal
  assert.equal(tree.look, 'plain');
});

test('视图:宇宙里的 kind=view 节点覆盖内置视图,坏 JSON 只报错不崩', async () => {
  const { listViews } = await import('../src/view.ts');
  const u = genesis();
  apply(u, { op: 'addNode', id: '~view/galaxy', label: '我的银河', attrs: { kind: 'view', spec: '{"look":"plain"}' } });
  apply(u, { op: 'addNode', id: '~view/bad', label: 'bad', attrs: { kind: 'view', spec: '{oops' } });
  const { specs, errors } = listViews(u);
  assert.equal(specs.galaxy!.look, 'plain');
  assert.ok(specs.deps);
  assert.match(errors.bad!, /不是合法 JSON/);
});

test('视图:color by group —— 同一子树继承同一个颜色', async () => {
  const { evaluateView, BUILTIN_VIEWS } = await import('../src/view.ts');
  const u = genesis();
  apply(u, planScan(u, ['a/b/x.ts', 'a/c/y.ts', 'z/w.ts'], 'repo', 'demo'));
  const c = new Map(evaluateView(u, BUILTIN_VIEWS.orbit!).nodes.map((n) => [n.id, n.color]));
  assert.equal(c.get('a/b/'), c.get('a/c/'));
  assert.equal(c.get('a/b/'), c.get('a/'));
  assert.notEqual(c.get('a/'), c.get('z/'));
});

test('折叠:默认只展开到第一层,收起的容器带"缩影",大小不因折叠而变', async () => {
  const { evaluateView, BUILTIN_VIEWS } = await import('../src/view.ts');
  const u = genesis();
  apply(u, planScan(u, ['a/x.ts', 'a/y.md', 'b/z.ts', 'top.txt'], 'repo', 'demo', () => ({ size: 100 })));
  const folded = evaluateView(u, BUILTIN_VIEWS.galaxy!);
  assert.deepEqual(folded.nodes.map((n) => n.id).sort(), ['a/', 'b/', 'repo', 'top.txt', 'universe']);
  const a = folded.nodes.find((n) => n.id === 'a/')!;
  assert.equal(a.container, true);
  assert.equal(a.expanded, false);
  assert.equal(a.descendants, 2);
  assert.equal(a.kids!.length, 2);
  assert.equal(a.parent, 'repo');
  const open = evaluateView(u, BUILTIN_VIEWS.galaxy!, { expanded: ['a/'] });
  assert.equal(open.nodes.length, 7);
  assert.equal(open.nodes.find((n) => n.id === 'a/x.ts')!.parent, 'a/');
  assert.equal(open.nodes.find((n) => n.id === 'a/')!.r, a.r, '展开前后大小一致');
  const all = evaluateView(u, BUILTIN_VIEWS.galaxy!, { depth: 99, collapsed: ['b/'] });
  assert.ok(!all.nodes.some((n) => n.id === 'b/z.ts'));
  assert.ok(all.nodes.some((n) => n.id === 'a/x.ts'));
});

test('折叠:内部关系消失,跨容器关系提升到容器上并汇总计数', async () => {
  const { evaluateView, BUILTIN_VIEWS } = await import('../src/view.ts');
  const u = genesis();
  apply(u, planScan(u, ['a/x.ts', 'a/y.ts', 'b/z.ts', 'b/w.ts'], 'repo', 'demo'));
  apply(u, { op: 'addEdge', from: 'a/x.ts', type: 'dependsOn', to: 'b/z.ts' });
  apply(u, { op: 'addEdge', from: 'a/y.ts', type: 'dependsOn', to: 'b/w.ts' });
  apply(u, { op: 'addEdge', from: 'a/x.ts', type: 'dependsOn', to: 'a/y.ts' }); // 内部关系
  const folded = evaluateView(u, BUILTIN_VIEWS.galaxy!);
  const dep = folded.edges.filter((e) => e.type === 'dependsOn');
  assert.equal(dep.length, 1, '内部那条被折叠掉,两条跨容器的汇总成一条');
  assert.deepEqual([dep[0]!.from, dep[0]!.to, dep[0]!.count, dep[0]!.lifted], ['a/', 'b/', 2, true]);
  // 只展开 a/:一端是真实文件,一端仍是提升到 b/ 的容器
  const half = evaluateView(u, BUILTIN_VIEWS.galaxy!, { expanded: ['a/'] }).edges.filter((e) => e.type === 'dependsOn');
  assert.deepEqual(half.map((e) => `${e.from}>${e.to}:${e.count}:${e.lifted}`).sort(),
    ['a/x.ts>a/y.ts:1:false', 'a/x.ts>b/:1:true', 'a/y.ts>b/:1:true']);
  // 全部展开:全是真实的边
  const full = evaluateView(u, BUILTIN_VIEWS.orbit!).edges.filter((e) => e.type === 'dependsOn');
  assert.ok(full.every((e) => !e.lifted && e.count === 1));
  assert.equal(full.length, 3);
});

test('折叠:contains 里有环也不会让节点消失', async () => {
  const { evaluateView, BUILTIN_VIEWS } = await import('../src/view.ts');
  const u = genesis();
  for (const id of ['p', 'q']) apply(u, { op: 'addNode', id, label: id });
  apply(u, { op: 'addEdge', from: 'p', type: 'contains', to: 'q' });
  apply(u, { op: 'addEdge', from: 'q', type: 'contains', to: 'p' });
  const ids = evaluateView(u, BUILTIN_VIEWS.orbit!, { depth: 9 }).nodes.map((n) => n.id);
  assert.ok(ids.includes('p') && ids.includes('q'));
});
