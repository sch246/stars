import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runKernel } from '../src/commands.ts';
import { parse } from '../src/format.ts';
import { apply, type Op } from '../src/ops.ts';
import { Store } from '../src/store.ts';
import { styleOp, styleTypes, styleKindOf } from '../src/styles.ts';
import { compileView } from '../src/view.ts';
import { BUILTIN_VIEWS, validateSpec, type ViewSpec } from '../src/viewspec.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');

function world() {
  const u = parse(genesis);
  const ops: Op[] = [
    { op: 'addNode', id: 'm', label: 'M', attrs: { type: 'module' } },
    { op: 'addNode', id: 'c', label: 'C', attrs: { type: 'concept' } },
    { op: 'addNode', id: 'w', label: 'W', attrs: { type: 'widget' } },
    { op: 'addNode', id: 'w2', label: 'W2', attrs: { type: 'widget', shape: 'dot', color: '#123456' } },
    { op: 'addEdge', from: 'm', type: 'dependsOn', to: 'c' },
    { op: 'addEdge', from: 'w', type: 'related', to: 'c' },
  ];
  apply(u, { op: 'batch', ops });
  return u;
}
const look = (u: ReturnType<typeof world>, spec: object, id: string) => compileView(u, spec).node(id)!;
const edgeOf = (u: ReturnType<typeof world>, spec: object, type: string) => compileView(u, spec).fold().edges.find((e) => e.type === type)!;

test('类型样式:按类型取形状 = 节点自己 > 类型节点 > 内置默认;视图规则明确写了的优先', () => {
  const u = world();
  const galaxy = BUILTIN_VIEWS.galaxy!;
  assert.equal(look(u, galaxy, 'm').shape, 'ringed', '内置默认:模块带环(和以前写死的一样)');
  assert.equal(look(u, galaxy, 'w').shape, 'star', '没有默认的类型');
  assert.equal(look(u, galaxy, 'w2').shape, 'dot', '节点自己的 shape');
  apply(u, styleOp(u, 'module', { shape: 'pulsar', color: '#ff0000', scale: '2' }));
  apply(u, styleOp(u, 'widget', { shape: 'nebula' }));
  assert.equal(look(u, galaxy, 'm').shape, 'pulsar', '改了类型节点 → 内置视图里立刻生效');
  assert.equal(look(u, galaxy, 'w').shape, 'nebula');
  assert.equal(look(u, galaxy, 'w2').shape, 'dot', '节点自己的还是优先');
  assert.equal(look(u, galaxy, 'm').color, '#ff0000', 'by: type 的颜色取类型节点');
  // 视图规则明确写了形状:规则优先
  const fixed: ViewSpec = { style: [{ when: { type: 'module' }, shape: 'star' }], color: [{ value: '#00ff00' }] };
  assert.equal(look(u, fixed, 'm').shape, 'star');
  assert.equal(look(u, fixed, 'm').color, '#00ff00');
  assert.deepEqual(compileView(u, fixed).explain('m'), { size: -1, color: 0, style: 0 });
  // 视图没写颜色 / 形状规则:类型节点写了就用(以前是统一的默认色、恒星)
  assert.equal(look(u, {}, 'm').shape, 'pulsar');
  assert.equal(look(u, {}, 'm').color, '#ff0000');
  assert.equal(look(u, {}, 'c').color, '#4facfe', '创世文件里 ~concept 的颜色');
  assert.equal(look(u, {}, 'w').color, '#cfd8ff', '类型节点没写颜色:还是默认色');
  assert.deepEqual(compileView(u, {}).explain('m'), { size: -1, color: -1, style: -1 });
  // 大小倍率:节点自己的 scale > 类型节点的 scale
  const r0 = look(u, { size: [{ by: 'degree', range: [4, 4] }] }, 'c').r, r1 = look(u, { size: [{ by: 'degree', range: [4, 4] }] }, 'm').r;
  assert.equal(r1, r0 * 2);
  assert.deepEqual(validateSpec({ style: [{ by: 'type' }] }), []);
  assert.match(validateSpec({ style: [{ by: 'kind' }] }).join(), /style\[0\]\.by 只能是 "type"/);
});

test('类型样式:边类型 = 视图里专门的规则 > 类型节点 > 视图的兜底规则 *', () => {
  const u = world();
  const spec: ViewSpec = { relations: { related: { mode: 'line', color: '#abcdef' }, '*': { mode: 'line', color: '#111111', arrow: true } } };
  assert.equal(edgeOf(u, spec, 'dependsOn').color, '#111111');
  apply(u, styleOp(u, 'dependsOn', { color: '#ff8800', width: '3', arrow: 'false' }));
  apply(u, styleOp(u, 'related', { color: '#00ff00', width: '2' }));
  const d = edgeOf(u, spec, 'dependsOn');
  assert.deepEqual([d.color, d.width, d.arrow], ['#ff8800', 3, false], '类型节点盖过兜底规则');
  const r = edgeOf(u, spec, 'related');
  assert.deepEqual([r.color, r.width], ['#abcdef', 2], '专门的规则写了颜色就用规则的,没写的(线宽)取类型节点');
  apply(u, styleOp(u, 'dependsOn', { mode: 'hidden' }));
  assert.equal(compileView(u, spec).fold().edges.some((e) => e.type === 'dependsOn'), false, 'mode=hidden:不画');
});

test('类型样式:styleOp 校验、新建类型节点、去掉样式;styleTypes 列出用量', () => {
  const u = world();
  assert.equal(styleKindOf(u, 'module'), 'nodeType');
  assert.equal(styleKindOf(u, 'dependsOn'), 'edgeType');
  assert.equal(styleKindOf(u, 'widget'), 'nodeType', '没声明、没有边用它 → 节点类型');
  assert.throws(() => styleOp(u, 'module', { shape: 'box' }), /shape 只能是/);
  assert.throws(() => styleOp(u, 'module', { color: 'red' }), /#rrggbb/);
  assert.throws(() => styleOp(u, 'module', { width: '2' }), /节点类型的样式只有/);
  assert.throws(() => styleOp(u, 'dependsOn', { shape: 'dot' }), /边类型的样式只有/);
  assert.throws(() => styleOp(u, 'dependsOn', { arrow: 'yes' }), /arrow/);
  assert.throws(() => styleOp(u, '~x', {}), /不要带/);
  assert.deepEqual(styleOp(u, 'widget', { shape: 'dot' }), { op: 'addNode', id: '~widget', label: 'widget', attrs: { kind: 'nodeType', shape: 'dot' } });
  apply(u, styleOp(u, 'module', { scale: '1.5' }));
  assert.deepEqual(styleOp(u, 'module', {}, ['scale', 'shape']), { op: 'setNode', id: '~module', set: {}, unset: ['scale'] }, '只去掉写着的');
  const t = styleTypes(u);
  assert.deepEqual(t.nodes.slice(0, 3).map((x) => [x.name, x.count]), [['widget', 2], ['concept', 1], ['module', 1]]);
  assert.equal(t.nodes.find((x) => x.name === 'widget')!.declared, false);
  assert.deepEqual(t.nodes.find((x) => x.name === 'module')!.style, { color: '#bd00ff', scale: '1.5' });
  assert.ok(t.edges.some((x) => x.name === 'contains' && x.count === 0), '声明了、还没用到的也列出来');
});

test('类型样式:CLI types / type-set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-sty-'));
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  const run = (cmd: string, args: string[] = [], o: Record<string, unknown> = {}) => runKernel(cmd, args, o, { store, author: 'me', root: dir });
  run('add', ['a'], { type: 'gadget' });
  assert.match(run('type-set', ['gadget'], { attr: ['color=#00aa00', 'shape=ringed'], label: '小器件' }).out, /\+ 节点类型 gadget/);
  assert.deepEqual(store.load().nodes.get('~gadget'), { id: '~gadget', label: '小器件', attrs: { kind: 'nodeType', color: '#00aa00', shape: 'ringed' } });
  assert.match(run('type-set', ['gadget'], { unset: ['shape'] }).out, /~ 节点类型 gadget/);
  assert.equal(store.load().nodes.get('~gadget')!.attrs.shape, undefined);
  assert.match(run('type-set', ['flows'], { attr: ['kind=edgeType', 'width=2'] }).out, /\+ 边类型 flows/);
  assert.throws(() => run('type-set', ['gadget'], { attr: ['shape=cube'] }), /shape 只能是/);
  assert.throws(() => run('type-set', ['gadget']), /要改什么/);
  const t = run('types');
  assert.match(t.out, /gadget\s+1\s+color=#00aa00\s+小器件/);
  assert.match(t.out, /flows\s+0\s+width=2/);
});

test('自定义体检规则:~rule/<名字> 节点,命中表达式的节点各报一条;写错了报在规则节点上', async () => {
  const { lint } = await import('../src/lint.ts');
  const dir = mkdtempSync(join(tmpdir(), 'stars-rule-'));
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  const run = (cmd: string, args: string[] = [], o: Record<string, unknown> = {}) => runKernel(cmd, args, o, { store, author: 'me', root: dir });
  run('add', ['a'], { type: 'module' });
  run('add', ['b'], { type: 'module', summary: '有说明' });
  run('add', ['c'], { type: 'concept' });
  run('link', ['c', 'dependsOn', 'a']);
  assert.match(run('rule-set', ['nosum'], { expr: "type == 'module' && !summary", summary: '模块没有说明' }).out, /\+ 规则 nosum\(现在命中 1 个/);
  run('rule-set', ['unused'], { expr: "type == 'module' && into('dependsOn') == 0", attr: ['level=info'] });
  const issues = lint(store.load()).filter((i) => i.rule.startsWith('rule'));
  assert.deepEqual(issues.map((i) => [i.rule, i.severity, i.nodes.join()]), [['rule:nosum', 'warn', 'a'], ['rule:unused', 'info', 'b']]);
  assert.equal(issues[0]!.message, 'a: 模块没有说明');
  assert.match(run('rules').out, /nosum\s+1\s+warn\s+模块没有说明/);
  assert.throws(() => run('rule-set', ['x'], { expr: 'type ===' }), /表达式写错了/);
  assert.throws(() => run('rule-set', ['x'], { expr: 'true', attr: ['level=fatal'] }), /level 只能是/);
  run('set', ['~rule/unused'], { attr: ['expr=nosuch.x()'] });
  const bad = lint(store.load()).find((i) => i.rule === 'rule-error')!;
  assert.deepEqual([bad.severity, bad.nodes], ['error', ['~rule/unused']]);
});
