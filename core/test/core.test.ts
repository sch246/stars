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
  const FLAT_FOLD = { ...BUILTIN_VIEWS.galaxy!, layout: 'flat' as const, expand: { relation: 'contains', depth: 1 } };
  const u = genesis();
  apply(u, planScan(u, ['a/x.ts', 'a/y.md', 'b/z.ts', 'top.txt'], 'repo', 'demo', () => ({ size: 100 })));
  const folded = evaluateView(u, FLAT_FOLD);
  assert.deepEqual(folded.nodes.map((n) => n.id).sort(), ['a/', 'b/', 'repo', 'top.txt', 'universe']);
  const a = folded.nodes.find((n) => n.id === 'a/')!;
  assert.equal(a.container, true);
  assert.equal(a.expanded, false);
  assert.equal(a.descendants, 2);
  assert.equal(a.kids!.length, 2);
  assert.deepEqual(a.kids!.map((k) => k[2]).sort(), ['a/x.ts', 'a/y.md'], '缩影的每颗粒子带着它对应节点的 id(展开时粒子长成那颗节点)');
  assert.equal(a.parent, 'repo');
  const open = evaluateView(u, FLAT_FOLD, { expanded: ['a/'] });
  assert.equal(open.nodes.length, 7);
  assert.equal(open.nodes.find((n) => n.id === 'a/x.ts')!.parent, 'a/');
  assert.equal(open.nodes.find((n) => n.id === 'a/')!.r, a.r, '展开前后大小一致');
  const all = evaluateView(u, FLAT_FOLD, { depth: 99, collapsed: ['b/'] });
  assert.ok(!all.nodes.some((n) => n.id === 'b/z.ts'));
  assert.ok(all.nodes.some((n) => n.id === 'a/x.ts'));
});

test('折叠:节点预算 —— 一层层展开、先展开小的,放不下的保持收起;手动展开不受限;透明容器不会把内容藏起来', async () => {
  const { evaluateView, BUILTIN_VIEWS, DEFAULT_MAX_NODES } = await import('../src/view.ts');
  const u = genesis();
  const files = [...Array.from({ length: 200 }, (_, i) => `big/f${i}.ts`), ...[1, 2, 3, 4, 5].flatMap((k) => [`s${k}/a.ts`, `s${k}/b.ts`, `s${k}/sub/c.ts`])];
  apply(u, planScan(u, files, 'repo', 'demo', () => ({ size: 100 })));
  const orbit = BUILTIN_VIEWS.orbit!;
  const all = evaluateView(u, orbit, { maxNodes: Infinity });
  assert.ok(all.nodes.length > 215, '不限预算时全部展开');
  const cut = evaluateView(u, orbit, { maxNodes: 40 });
  const has = (sc: typeof cut, id: string) => sc.nodes.some((n) => n.id === id);
  assert.ok(cut.nodes.length <= 40, `预算内(实际 ${cut.nodes.length})`);
  assert.equal(cut.nodes.find((n) => n.id === 'big/')!.expanded, false, '大的容器保持收起');
  assert.ok(has(cut, 's1/a.ts') && has(cut, 's5/sub/c.ts'), '小的先展开,预算够就继续往下');
  const forced = evaluateView(u, orbit, { maxNodes: 40, expanded: ['big/'] });
  assert.ok(has(forced, 'big/f199.ts'), '手动展开不受预算限制');
  assert.ok(evaluateView(u, orbit, { depth: 99 }).nodes.length > 215, '显式给了 depth 就不套默认预算');
  assert.ok(DEFAULT_MAX_NODES >= 1000);
  const tags = evaluateView(u, BUILTIN_VIEWS.tags!, { maxNodes: 40 });
  assert.equal(tags.nodes.filter((n) => n.id.endsWith('.ts')).length, 215, 'tags 视图隐藏了目录:目录透明,不能因为预算把文件藏掉');
});

test('折叠:内部关系消失,跨容器关系提升到容器上并汇总计数', async () => {
  const { evaluateView, BUILTIN_VIEWS } = await import('../src/view.ts');
  const FLAT_FOLD = { ...BUILTIN_VIEWS.galaxy!, layout: 'flat' as const, expand: { relation: 'contains', depth: 1 } };
  const u = genesis();
  apply(u, planScan(u, ['a/x.ts', 'a/y.ts', 'b/z.ts', 'b/w.ts'], 'repo', 'demo'));
  apply(u, { op: 'addEdge', from: 'a/x.ts', type: 'dependsOn', to: 'b/z.ts' });
  apply(u, { op: 'addEdge', from: 'a/y.ts', type: 'dependsOn', to: 'b/w.ts' });
  apply(u, { op: 'addEdge', from: 'a/x.ts', type: 'dependsOn', to: 'a/y.ts' }); // 内部关系
  const folded = evaluateView(u, FLAT_FOLD);
  const dep = folded.edges.filter((e) => e.type === 'dependsOn');
  assert.equal(dep.length, 1, '内部那条被折叠掉,两条跨容器的汇总成一条');
  assert.deepEqual([dep[0]!.from, dep[0]!.to, dep[0]!.count, dep[0]!.lifted], ['a/', 'b/', 2, true]);
  // 只展开 a/:一端是真实文件,一端仍是提升到 b/ 的容器
  const half = evaluateView(u, FLAT_FOLD, { expanded: ['a/'] }).edges.filter((e) => e.type === 'dependsOn');
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

test('信号:recency 把时间戳变成新鲜度,颜色/大小随之变化,目录取后代里最新的', async () => {
  const { evaluateView, BUILTIN_VIEWS, recencyWeight, validateSpec } = await import('../src/view.ts');
  const DAY = 86_400_000, now = Date.UTC(2026, 9, 1);
  assert.equal(recencyWeight(now, 10, now), 1);
  assert.ok(Math.abs(recencyWeight(now - 10 * DAY, 10, now) - 0.5) < 1e-9);
  assert.equal(recencyWeight(undefined, 10, now), 0);

  const u = genesis();
  apply(u, planScan(u, ['a/new.ts', 'a/old.ts', 'b/older.ts'], 'repo', 'demo'));
  const fileChanged = { 'a/new.ts': now - DAY, 'a/old.ts': now - 60 * DAY, 'b/older.ts': now - 200 * DAY };
  const scene = evaluateView(u, BUILTIN_VIEWS.recent!, { signals: { fileChanged, touched: {} }, now, depth: 9 });
  const c = new Map(scene.nodes.map((n) => [n.id, n.color]));
  assert.notEqual(c.get('a/new.ts'), c.get('a/old.ts'));
  assert.notEqual(c.get('a/old.ts'), c.get('b/older.ts'));
  // 越新越接近"热色"(红通道更高:#ffcf70 vs #2f3b6e)
  const red = (h: string) => parseInt(h.slice(1, 3), 16);
  assert.ok(red(c.get('a/new.ts')!) > red(c.get('a/old.ts')!));
  assert.equal(c.get('a/'), c.get('a/new.ts'), '目录取后代里最新的那个');
  assert.ok(red(c.get('a/')!) > red(c.get('b/')!));

  assert.deepEqual(validateSpec(BUILTIN_VIEWS.recent), []);
  assert.deepEqual(Object.values(BUILTIN_VIEWS).flatMap((v) => validateSpec(v)), []);
  assert.ok(validateSpec({ colour: [] }).length > 0);
  assert.ok(validateSpec({ style: [{ shape: 'cube' }] }).length > 0);
  assert.ok(validateSpec({ relations: { x: { mode: 'wavy' } } }).length > 0);
});

test('信号:操作日志里每个节点最近被触及的时间', async () => {
  const { touchedFromLog } = await import('../src/activity.ts');
  const t = (s: string) => new Date(s).toISOString();
  const log = [
    { n: 1, t: t('2026-01-01'), author: 'h', op: { op: 'addNode', id: 'a', label: 'a' }, inverse: { op: 'removeNode', id: 'a' } },
    { n: 2, t: t('2026-02-01'), author: 'h', op: { op: 'batch', ops: [{ op: 'addEdge', from: 'a', type: 'x', to: 'b' }] }, inverse: { op: 'batch', ops: [] } },
  ] as never;
  const out = touchedFromLog(log);
  assert.equal(out.a, Date.parse('2026-02-01'));
  assert.equal(out.b, Date.parse('2026-02-01'));
});

test('校验:能指出写错的规则取值,给 AI 和编辑器明确的反馈', async () => {
  const { validateSpec } = await import('../src/view.ts');
  assert.match(validateSpec({ size: [{ by: 'degre' }] }).join('\n'), /degree/);
  assert.match(validateSpec({ color: [{ by: 'colour' }] }).join('\n'), /attr:/);
  assert.match(validateSpec({ size: [{ rollup: { relation: 'contains', op: 'avg' } }] }).join('\n'), /rollup/);
  assert.deepEqual(validateSpec({ color: [{ by: 'attr:ext' }, { by: 'recency', signal: 'touched' }] }), []);
});

test('表达式:大小/颜色/样式/筛选都能写成表达式,信号与度数可用,函数节点可被调用', async () => {
  const { evaluateView, validateSpec } = await import('../src/view.ts');
  const DAY = 86_400_000, now = Date.UTC(2026, 9, 1);
  const u = genesis();
  apply(u, planScan(u, ['a/hot.ts', 'a/cold.ts', 'a/big.md', 'b/x.ts'], 'repo', 'demo', (p) => ({ size: { 'a/hot.ts': 100, 'a/cold.ts': 100, 'a/big.md': 9000, 'b/x.ts': 100 }[p]! })));
  apply(u, { op: 'addEdge', from: 'a/hot.ts', type: 'dependsOn', to: 'b/x.ts' });
  apply(u, { op: 'addNode', id: '~fn/boost', label: 'boost', attrs: { kind: 'function', code: '(t, s) => log1p(s) * (days(t) < 7 ? 3 : 1)' } });
  const signals = { fileChanged: { 'a/hot.ts': now - DAY, 'a/cold.ts': now - 90 * DAY, 'a/big.md': now - 90 * DAY, 'b/x.ts': now - 90 * DAY } };
  const spec = {
    select: { where: "type == 'file' && size > 50" },
    size: [{ expr: 'fn.boost(fileChanged, size)', scale: 'linear', range: [1, 10] }],
    color: [{ when: "ext == 'md'", value: '#112233' }, { expr: 'recent(fileChanged, 7)', from: '#000000', to: '#ffffff' }],
    style: [{ when: 'degree > 1', expr: "size > 50 ? 'pulsar' : 'dot'" }, { shape: 'ringed' }],
    expand: { depth: 99 },
  };
  assert.deepEqual(validateSpec(spec, u), []);
  const scene = evaluateView(u, spec, { signals, now });
  const n = new Map(scene.nodes.map((x) => [x.id, x]));
  assert.deepEqual([...n.keys()].sort(), ['a/big.md', 'a/cold.ts', 'a/hot.ts', 'b/x.ts'], 'where:只留 size>50 的文件');
  assert.ok(n.get('a/hot.ts')!.r > n.get('a/cold.ts')!.r, '函数节点给最近改过的加权');
  assert.ok(n.get('a/big.md')!.r > n.get('a/cold.ts')!.r, 'log1p(size) 让大文件更大');
  assert.equal(n.get('a/big.md')!.color, '#112233', 'when 也可以是表达式');
  const red = (h: string) => parseInt(h.slice(1, 3), 16);
  assert.ok(red(n.get('a/hot.ts')!.color) > red(n.get('a/cold.ts')!.color), 'recent() 越新越亮');
  assert.equal(n.get('a/hot.ts')!.shape, 'pulsar');
  assert.equal(n.get('a/cold.ts')!.shape, 'ringed', '第一条 when 不匹配,落到下一条');

  assert.match(validateSpec({ size: [{ expr: '1 +* 2' }] }).join(), /表达式/);
  assert.match(validateSpec({ select: { where: 'degree >' } }).join(), /表达式/);
  assert.match(validateSpec({ size: [{ expr: 'fn.nope(1)' }] }, u).join(), /fn\.nope/);
  assert.throws(() => evaluateView(u, { size: [{ expr: 'fn.boost(' }] }), /无法编译/);
});

test('审阅:从操作日志回溯每条待确认边是谁提的,接受/拒绝后就不再算', async () => {
  const { proposalsFromLog } = await import('../src/activity.ts');
  const u = genesis();
  for (const id of ['a', 'b', 'c']) apply(u, { op: 'addNode', id, label: id });
  const ts = (n: number) => new Date(2026, 0, n).toISOString();
  const log = [
    { n: 1, t: ts(1), author: 'claude', op: { op: 'addEdge', from: 'a', type: 'dependsOn', to: 'b', attrs: { status: 'proposed' } }, inverse: {} },
    { n: 2, t: ts(2), author: 'gpt', op: { op: 'batch', ops: [{ op: 'addEdge', from: 'b', type: 'dependsOn', to: 'c', attrs: { status: 'proposed' } }] }, inverse: {} },
  ] as never;
  apply(u, { op: 'addEdge', from: 'a', type: 'dependsOn', to: 'b', attrs: { status: 'proposed' } });
  apply(u, { op: 'addEdge', from: 'b', type: 'dependsOn', to: 'c', attrs: { status: 'proposed' } });
  assert.deepEqual(Object.entries(proposalsFromLog(log, u)).map(([k, v]) => [k, v.author]).sort(), [['a|dependsOn|b', 'claude'], ['b|dependsOn|c', 'gpt']]);
  apply(u, { op: 'setEdge', from: 'a', type: 'dependsOn', to: 'b', unset: ['status'] });
  assert.deepEqual(Object.keys(proposalsFromLog(log, u)), ['b|dependsOn|c'], '已接受的不再出现');
});

test('存储:延迟写入 —— 日志先落盘,别的进程读到的仍然是最新一致的宇宙,期间别人的写入不会被覆盖', async () => {
  const { mkdtempSync, readFileSync: rf } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { Store } = await import('../src/store.ts');
  const { readRev } = await import('../src/format.ts');
  const dir = mkdtempSync(join(tmpdir(), 'stars-defer-'));
  const file = join(dir, 'universe.stars');
  const a = new Store(file);
  a.create(rf(new URL('../genesis.stars', import.meta.url), 'utf8'));
  a.commit({ op: 'addNode', id: 'w1', label: 'w1' }, { author: 'fs' }, undefined, { defer: true });
  a.commit({ op: 'addNode', id: 'w2', label: 'w2' }, { author: 'fs' }, undefined, { defer: true });
  assert.ok(!rf(file, 'utf8').includes('node w1'), '宇宙文件还没写(延迟)');
  assert.equal(readRev(rf(file, 'utf8')), 0);
  // 另一个进程(CLI)此刻读,应当看到延迟写入的修改
  const b = new Store(file);
  assert.ok(b.load().nodes.has('w1') && b.load().nodes.has('w2'), '读时回放日志,看到最新状态');
  // 另一个进程在延迟写入期间提交:不能被后来的 flush 覆盖掉
  b.commit({ op: 'addNode', id: 'cli', label: 'cli' }, { author: 'human' });
  a.commit({ op: 'addNode', id: 'w3', label: 'w3' }, { author: 'fs' }, undefined, { defer: true });
  a.flush();
  const final = new Store(file).load();
  for (const id of ['w1', 'w2', 'w3', 'cli']) assert.ok(final.nodes.has(id), `${id} 没有丢`);
  assert.equal(readRev(rf(file, 'utf8')), a.logCount(), '落盘后文件头的 rev 追上日志');
  // 没有 rev 的旧文件不做任何回放
  const legacy = join(dir, 'legacy.stars');
  const text = rf(file, 'utf8').replace(/^stars 1 rev=\d+/, 'stars 1');
  (await import('node:fs')).writeFileSync(legacy, text);
  assert.ok(new Store(legacy).load().nodes.has('cli'));
});


test('空间:每个容器是独立的小世界 —— 只含直接子节点;子节点之间的关系被汇总;通向外面的关系成为"外部链接"', async () => {
  const { compileView, BUILTIN_VIEWS } = await import('../src/view.ts');
  const u = genesis();
  apply(u, planScan(u, ['a/x.ts', 'a/lib/y.ts', 'a/lib/z.ts', 'b/w.ts', 'top.txt'], 'repo', 'demo', () => ({ size: 10 })));
  apply(u, { op: 'addNode', id: 'goal', label: 'goal', attrs: { type: 'concept' } });
  apply(u, { op: 'addEdge', from: 'a/x.ts', type: 'dependsOn', to: 'a/lib/y.ts' });   // a 内部,跨一层
  apply(u, { op: 'addEdge', from: 'a/lib/z.ts', type: 'dependsOn', to: 'b/w.ts' });    // 通向 a 之外
  apply(u, { op: 'addEdge', from: 'goal', type: 'describes', to: 'a/lib/y.ts' });      // 来自整个 repo 之外
  const c = compileView(u, BUILTIN_VIEWS.galaxy!);
  assert.equal(c.layout, 'spaces');
  assert.equal(c.enterAt, 0.42);

  const root = c.space(null);
  assert.deepEqual(root.nodes.map((n) => n.id).sort(), ['goal', 'repo', 'universe']);
  const repo = root.nodes.find((n) => n.id === 'repo')!;
  assert.equal(repo.container, true);
  assert.ok(repo.kids!.length > 0, '收起的容器带内容缩影,用来画成小星系');
  const toRepo = root.edges.find((e) => e.from === 'goal');
  assert.deepEqual([toRepo!.to, toRepo!.lifted, toRepo!.count], ['repo', true, 1], '顶层空间里,goal 的关系被汇总到 repo 上');

  const repoSpace = c.space('repo');
  assert.deepEqual(repoSpace.nodes.map((n) => n.id).sort(), ['a/', 'b/', 'top.txt'], '只有直接子节点,没有孙子');
  const dep = repoSpace.edges.find((e) => e.type === 'dependsOn')!;
  assert.deepEqual([dep.from, dep.to, dep.lifted], ['a/', 'b/', true]);
  assert.deepEqual(repoSpace.external.map((x) => [x.node, x.other, x.type, x.out]), [['a/', 'goal', 'describes', false]], '来自 goal 的关系是通向外面的桩');

  const a = c.space('a/');
  assert.deepEqual(a.nodes.map((n) => n.id).sort(), ['a/lib/', 'a/x.ts']);
  assert.equal(a.edges.find((e) => e.type === 'dependsOn')!.to, 'a/lib/', 'x.ts → lib/ 内的 y.ts,被汇总到 lib/ 上');
  assert.deepEqual(a.external.map((x) => `${x.node}|${x.out ? '→' : '←'}|${x.other}|${x.type}`).sort(), ['a/lib/|←|goal|describes', 'a/lib/|→|b/|dependsOn'], '通向外面的桩:分叉处的对象 + 方向');
  assert.deepEqual(c.space('a/lib/').nodes.map((n) => n.id).sort(), ['a/lib/y.ts', 'a/lib/z.ts']);
  assert.deepEqual(c.ancestors('a/lib/y.ts'), ['repo', 'a/', 'a/lib/', 'a/lib/y.ts']);
  assert.equal(c.parentOf('a/lib/'), 'a/');
  assert.equal(c.space('nope').nodes.length, 0);
  assert.equal(c.space('a/') , c.space('a/'), '结果被缓存');
});

test('tag:容器不显示为节点,而是作为 tag 打在节点上', async () => {
  const { evaluateView, BUILTIN_VIEWS, validateSpec } = await import('../src/view.ts');
  const u = genesis();
  apply(u, planScan(u, ['a/b/x.ts', 'a/y.ts', 'c/z.ts', 'top.md'], 'repo', 'demo', () => ({ size: 10 })));
  const scene = evaluateView(u, BUILTIN_VIEWS.tags!);
  const n = new Map(scene.nodes.map((x) => [x.id, x]));
  assert.ok(!n.has('a/') && !n.has('a/b/'), '文件夹本身不显示');
  assert.deepEqual(n.get('a/b/x.ts')!.tags, ['a/', 'a/b/']);
  assert.deepEqual(n.get('a/y.ts')!.tags, ['a/']);
  assert.equal(n.get('top.md')!.tags, undefined, '挂载根不算 tag');
  assert.equal(n.get('a/b/x.ts')!.color, n.get('a/y.ts')!.color, '颜色 = 顶层文件夹');
  assert.deepEqual(validateSpec(BUILTIN_VIEWS.tags), []);
});
