// 视图的层(base / script / 自己的键)和视图脚本:合并、逐层往下找规则、脚本函数拿到下面的值、出错退回规则、列、依赖
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runKernel } from '../src/commands.ts';
import { listFiles, planScan, statMeta } from '../src/scan.ts';
import { parse } from '../src/format.ts';
import { importsOf, moduleGraph, resolveImport } from '../src/imports.ts';
import { apply, type Op } from '../src/ops.ts';
import { Store } from '../src/store.ts';
import { compileView } from '../src/view.ts';
import { resolveView } from '../src/viewlayers.ts';
import { loadViewModules, viewModulesFor } from '../src/viewload.ts';
import type { NodeRef, ViewModule } from '../src/viewscript.ts';
import { BUILTIN_VIEWS, validateSpec, type ViewSpec } from '../src/viewspec.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');

/** repo 下:src/(a.ts 300 字节、b.ts 100、c.md 50)、docs/(r.md);概念 idea;a → b 依赖 */
function world() {
  const u = parse(genesis);
  const node = (id: string, attrs: Record<string, string>, label = id) => ({ op: 'addNode', id, label, attrs });
  const link = (from: string, type: string, to: string) => ({ op: 'addEdge', from, type, to });
  apply(u, { op: 'batch', ops: [
    node('repo', { type: 'dir' }), node('src/', { type: 'dir', file: 'src/' }), node('docs/', { type: 'dir', file: 'docs/' }),
    node('src/a.ts', { type: 'file', file: 'src/a.ts', ext: 'ts', size: '300' }), node('src/b.ts', { type: 'file', file: 'src/b.ts', ext: 'ts', size: '100' }),
    node('src/c.md', { type: 'file', file: 'src/c.md', ext: 'md', size: '50' }), node('docs/r.md', { type: 'file', file: 'docs/r.md', ext: 'md', size: '20' }),
    node('idea', { type: 'concept' }, '想法'),
    link('repo', 'contains', 'src/'), link('repo', 'contains', 'docs/'), link('src/', 'contains', 'src/a.ts'), link('src/', 'contains', 'src/b.ts'),
    link('src/', 'contains', 'src/c.md'), link('docs/', 'contains', 'docs/r.md'), link('repo', 'contains', 'idea'), link('src/a.ts', 'dependsOn', 'src/b.ts'),
  ] as Op[] });
  return u;
}
const mods = (entries: Record<string, ViewModule | Error>) => new Map(Object.entries(entries));

test('base:垫在下面;上层的规则不匹配的节点照旧用下面的;relations 按字段合并', () => {
  const u = world();
  const g = compileView(u, BUILTIN_VIEWS.galaxy!);
  const red: ViewSpec = { base: 'galaxy', color: [{ when: "ext == 'md'", value: '#ff0000' }], relations: { dependsOn: { color: '#00ff00' } as never } };
  assert.deepEqual(validateSpec(red, u), [], '有 base 时关系规则可以只写颜色');
  const c = compileView(u, red);
  assert.equal(c.node('src/c.md')!.color, '#ff0000', '上层的规则管到的');
  assert.equal(c.node('src/a.ts')!.color, g.node('src/a.ts')!.color, '上层没管到的:galaxy 的颜色');
  assert.equal(c.node('src/a.ts')!.r, g.node('src/a.ts')!.r, '大小规则全在 galaxy 那层');
  assert.deepEqual(c.explain('src/c.md'), { size: 1, color: 0, style: 0, layer: { size: 'galaxy', color: '', style: 'galaxy' } });
  assert.deepEqual(c.explain('src/a.ts')!.layer, { size: 'galaxy', color: 'galaxy', style: 'galaxy' });
  const e = c.fold().edges.find((x) => x.type === 'dependsOn')!;
  assert.equal(e.color, '#00ff00'); assert.equal(e.mode, 'line', 'mode 还是 galaxy 的');
  assert.equal(c.spec.layout, 'spaces', '配置合并:layout 来自 galaxy');
  assert.deepEqual(c.layers.map((l) => l.name), ['galaxy', '']);
});

test('base:~view/ 优先;~view/galaxy 里 base: galaxy 指向内置的;循环引用报错', () => {
  const u = world();
  apply(u, { op: 'addNode', id: '~view/galaxy', label: 'galaxy', attrs: { kind: 'view', spec: JSON.stringify({ base: 'galaxy', color: [{ value: '#123456' }] }) } });
  apply(u, { op: 'addNode', id: '~view/mine', label: 'mine', attrs: { kind: 'view', spec: JSON.stringify({ base: 'galaxy' }) } });
  assert.equal(compileView(u, { base: 'galaxy', color: [{ value: '#123456' }] }, { name: 'galaxy' }).node('src/a.ts')!.color, '#123456');
  const mine = compileView(u, { base: 'galaxy' }, { name: 'mine' });
  assert.equal(mine.node('src/a.ts')!.color, '#123456', 'mine 垫的是 ~view/galaxy');
  assert.deepEqual(mine.layers.map((l) => l.name), ['galaxy', 'galaxy', 'mine']);
  apply(u, { op: 'addNode', id: '~view/x', label: 'x', attrs: { kind: 'view', spec: JSON.stringify({ base: 'y' }) } });
  apply(u, { op: 'addNode', id: '~view/y', label: 'y', attrs: { kind: 'view', spec: JSON.stringify({ base: 'x' }) } });
  assert.throws(() => compileView(u, { base: 'y' }, { name: 'x' }), /循环引用: x → y → x/);
  assert.throws(() => compileView(u, { base: 'nope' }), /没有视图 "nope"/);
  assert.match(validateSpec({ base: 'nope' }, u).join(), /没有视图/);
});

test('视图脚本:函数拿到规则的值再改;不返回 = 不改;参数;视图自己的规则盖在脚本上面', () => {
  const u = world();
  const seen: string[] = [];
  const heat: ViewModule = {
    spec: { base: 'galaxy' },
    params: { hot: '#ffaa00', big: 2 },
    select: (n) => (n.id === 'idea' ? false : undefined),
    size(n, v, r) { return n.type === 'dir' ? r * (v.params.big as number) : undefined; },
    color(n, v, c) { seen.push(c); return n.ext === 'ts' ? v.params.hot as string : undefined; },
    label: (n) => (n.type === 'file' ? `${n.label} · ${n.size}B` : undefined),
    edge: (type) => (type === 'dependsOn' ? { width: 4, color: 'nope' } : undefined),
  };
  const base = compileView(u, BUILTIN_VIEWS.galaxy!);
  const spec: ViewSpec = { script: 'views/heat.js', params: { big: 3 }, color: [{ when: "id == 'src/b.ts'", value: '#0000ff' }] };
  const c = compileView(u, spec, { modules: mods({ 'views/heat.js': heat }) });
  assert.deepEqual(c.space('repo').nodes.map((n) => n.id).sort(), ['docs/', 'src/'], 'select 去掉了想法');
  assert.equal(c.node('src/a.ts')!.color, '#ffaa00', '脚本改了 ts 的颜色');
  assert.equal(c.node('src/b.ts')!.color, '#0000ff', '视图自己的规则在脚本上面');
  assert.equal(c.node('src/c.md')!.color, base.node('src/c.md')!.color, '不返回 = 用 galaxy 的');
  assert.ok(seen.includes(base.node('src/c.md')!.color), '函数拿到的 c 是下面算出的颜色');
  assert.ok(Math.abs(c.node('src/')!.r - base.node('src/')!.r * 3) < 0.05, '参数:视图的 big=3 盖掉默认的 2');
  assert.equal(c.node('src/a.ts')!.label, 'src/a.ts · 300B');
  const e = c.fold().edges.find((x) => x.type === 'dependsOn')!;
  assert.equal(e.width, 4); assert.notEqual(e.color, 'nope', '不认识的颜色不要');
  assert.deepEqual(c.params, { hot: '#ffaa00', big: 3 });
  assert.deepEqual(c.layers, [{ name: 'galaxy' }, { name: 'views/heat.js', script: 'views/heat.js' }, { name: '' }]);
  assert.deepEqual(c.explain('src/a.ts')!.script, { color: 'views/heat.js', label: 'views/heat.js' }, 'explain:哪个脚本改过它');
  assert.deepEqual(c.scripts, ['views/heat.js']);
  assert.deepEqual(c.warnings, []);
});

test('视图脚本:select 先于大小,归一化按最后入选的算;looks 整列改', () => {
  const u = world();
  const only: ViewSpec = { size: [{ when: { type: 'file' }, attr: 'size', scale: 'linear', range: [1, 10] }] };
  const all = compileView(u, only);
  assert.equal(all.node('src/a.ts')!.r, 10); assert.equal(all.node('src/b.ts')!.r, 4);
  const noA: ViewModule = { spec: only, select: (n, _v, b) => b && n.id !== 'src/a.ts' };
  const c = compileView(u, { script: 's.js' }, { modules: mods({ 's.js': noA }) });
  assert.equal(c.node('src/b.ts')!.r, 10, 'a 不在了,b 成了最大的');
  const fat: ViewModule = { looks(g, v, base) { for (let i = 0; i < g.N; i++) if (base.selected[i]) { base.rad[i] = 7; base.shape[i] = v.shapes.indexOf('pulsar'); base.label[i] = g.ids[i]!.toUpperCase(); } } };
  const f = compileView(u, { script: 'f.js' }, { modules: mods({ 'f.js': fat }) }).node('src/b.ts')!;
  assert.deepEqual([f.r, f.shape, f.label], [7, 'pulsar', 'SRC/B.TS']);
});

test('视图脚本:edge() 藏起来的边类型不算度数', () => {
  const u = world();
  let seen = -1;
  const hide: ViewModule = {
    spec: { base: 'galaxy', size: [{ by: 'degree' }] },
    edge: (type) => (type === 'dependsOn' ? { mode: 'hidden' } : undefined),
    size: (n) => { if (n.id === 'src/a.ts') seen = n.degree as number; return undefined; },
  };
  const c = compileView(u, { script: 'h.js' }, { modules: mods({ 'h.js': hide }) });
  assert.equal(seen, 1, 'a 只剩 src/ 装着它的那条(dependsOn 藏了)');
  assert.equal(c.fold().edges.find((e) => e.type === 'dependsOn'), undefined);
  assert.equal(compileView(u, { base: 'galaxy', size: [{ by: 'degree' }] }).node('src/a.ts')!.r > c.node('src/a.ts')!.r, true, '按度数的大小跟着变小');
  assert.deepEqual(c.warnings, []);
});

test('视图脚本:n 的列与结构;v 的辅助函数', () => {
  const u = world();
  const now = Date.UTC(2026, 0, 10), got: Record<string, unknown> = {};
  const probe: ViewModule = {
    color(n, v) {
      if (n.id === 'src/a.ts') Object.assign(got, {
        size: n.size, ext: n.ext, degree: n.degree, depth: n.depth, fileChanged: n.fileChanged, stale: n.stale, parent: n.parent!.id,
        deps: n.edges('dependsOn').map((e) => [e.node.id, e.out]), siblings: n.parent!.kids.map((k) => k.id), str: String(n),
        days: v.days(n.fileChanged as number), hash: v.hash('x') === v.hash('x'), q: v.expr("ext == 'ts'")(n), maxSize: v.max((m: NodeRef) => Number(m.size) || 0),
        node: v.node('idea')!.label, mix: v.mix('#000000', '#ffffff', 0.5),
      });
      if (n.id === 'src/') got.dirSize = n.size;
      if (n.id === 'src/') got.children = n.children;
    },
  };
  compileView(u, { script: 'p.js' }, { modules: mods({ 'p.js': probe }), now, signals: { fileChanged: { 'src/a.ts': now - 2 * 86_400_000 }, size: { 'src/a.ts': 333 } } });
  assert.deepEqual(got, {
    size: 333, ext: 'ts', degree: 2, depth: 2, fileChanged: now - 2 * 86_400_000, stale: 0, parent: 'src/',
    deps: [['src/b.ts', true]], siblings: ['src/a.ts', 'src/b.ts', 'src/c.md'], str: 'src/a.ts',
    days: 2, hash: true, q: true, maxSize: 333, node: '想法', mix: '#808080', dirSize: 0, children: 3,
  });
});

test('视图脚本:出错退回规则、返回值不对当没返回、没加载 / 加载失败、打错导出名,都记进 warnings', () => {
  const u = world();
  const base = compileView(u, BUILTIN_VIEWS.galaxy!);
  let calls = 0;
  const bad: ViewModule = {
    spec: { base: 'galaxy' },
    color(n) { calls++; if (n.type === 'file') throw new Error('炸了'); return 'red'; },
    shape: () => 'triangle' as never,
  };
  (bad as Record<string, unknown>).colour = () => '#fff';
  const c = compileView(u, { script: 'bad.js' }, { modules: mods({ 'bad.js': bad }) });
  for (const id of ['src/a.ts', 'src/', 'docs/r.md']) assert.equal(c.node(id)!.color, base.node(id)!.color, `${id}:退回规则`);
  assert.equal(c.node('src/a.ts')!.shape, base.node('src/a.ts')!.shape);
  assert.ok(calls < 8, '抛错之后这一步不再调它');
  const w = c.warnings.join('\n');
  assert.match(w, /bad\.js: 导出了不认识的 "colour"/);
  assert.match(w, /bad\.js 的 color\(\) 在 \S+ 上出错: 炸了/);
  assert.match(w, /bad\.js 的 shape\(\) 有 \d+ 次返回了不认识的值\(如 "triangle"/);
  const m = compileView(u, { base: 'galaxy', script: 'gone.js' });
  assert.match(m.warnings.join(), /视图脚本 gone\.js 还没加载/); assert.deepEqual(m.scripts, ['gone.js']);
  assert.equal(m.node('src/a.ts')!.color, base.node('src/a.ts')!.color, '没加载:只用规则算');
  assert.match(compileView(u, { script: 'x.js' }, { modules: mods({ 'x.js': new Error('SyntaxError: 意外的 }') }) }).warnings.join(), /x\.js 加载失败: SyntaxError/);
});

test('视图脚本:Node 里加载(含它 import 的文件)、stars view / view-set --script(骨架)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-vs-'));
  const file = join(dir, 'universe.stars'), store = new Store(file);
  store.create(genesis);
  store.commit({ op: 'batch', ops: [{ op: 'addNode', id: 'a', label: 'A', attrs: { type: 'concept' } }, { op: 'addNode', id: 'b', label: 'B', attrs: { type: 'note' } }] } as never, { author: 't' });
  const ctx = { store, author: 't', root: dir };
  const made = runKernel('view-set', ['热力'], { script: 'views/热力.js' }, ctx);
  assert.match(made.out, /新建了骨架 views\/热力\.js/);
  assert.match(readFileSync(join(dir, 'views/热力.js'), 'utf8'), /export const spec = \{ base: "galaxy" \}/);
  mkdirSync(join(dir, 'views'), { recursive: true });
  writeFileSync(join(dir, 'views/pal.js'), "export const hot = '#ff00ff';\n");
  writeFileSync(join(dir, 'views/热力.js'), "import { hot } from './pal.js';\nexport const spec = { base: 'galaxy' };\nexport function color(n) { return n.type === 'note' ? hot : undefined; }\n");
  const ms = await viewModulesFor(store.load(), '热力', dir);
  assert.ok(ms.get('views/热力.js') && !(ms.get('views/热力.js') instanceof Error));
  const r = runKernel('view', ['热力'], { json: true }, { ...ctx, modules: ms });
  const scene = r.data as { nodes: Array<{ id: string; color: string }>; warnings: string[] };
  assert.equal(scene.nodes.find((n) => n.id === 'b')!.color, '#ff00ff');
  assert.deepEqual(scene.warnings, []);
  assert.match(runKernel('views', [], {}, ctx).out, /热力 {2}\(galaxy · 脚本 views\/热力\.js\)/);
  assert.throws(() => runKernel('view-set', ['坏'], { base: 'nope' }, ctx), /没有视图 "nope"/);
  writeFileSync(join(dir, 'views/坏.js'), 'export function color( {');
  const broken = await loadViewModules(store.load(), { script: 'views/坏.js' }, dir);
  assert.ok(broken.get('views/坏.js') instanceof Error);
  // 参数:--params 盖掉脚本里的默认值
  runKernel('view-set', ['热力2'], { script: 'views/热力.js', params: '{"x":1}' }, ctx);
  assert.deepEqual(JSON.parse(store.load().nodes.get('~view/热力2')!.attrs.spec!), { script: 'views/热力.js', params: { x: 1 } });
  // .ts:Node 自己去类型;import 别的 .ts 写上扩展名
  writeFileSync(join(dir, 'views/pal2.ts'), "export const hot: string = '#00ffaa';\n");
  writeFileSync(join(dir, 'views/typed.ts'), "import { hot } from './pal2.ts';\ntype N = { type: string };\nexport function color(n: N): string | undefined { return n.type === 'note' ? hot : undefined; }\n");
  runKernel('view-set', ['typed'], { script: 'views/typed.ts', base: 'galaxy' }, ctx);
  const tm = await viewModulesFor(store.load(), 'typed', dir);
  const ts = runKernel('view', ['typed'], { json: true }, { ...ctx, modules: tm }).data as { nodes: Array<{ id: string; color: string }>; warnings: string[] };
  assert.equal(ts.nodes.find((n) => n.id === 'b')!.color, '#00ffaa');
  assert.deepEqual(ts.warnings, []);
});

test('import:静态 / export from / 动态;注释里的不算;按目录解出路径;整串依赖', () => {
  const src = `import a from './a.js';\nimport { b } from "../lib/b.js";\nimport './side.css';\nimport type { T } from './t.ts';\nexport * from './re.js';\nexport { x as y } from './x.js';\nconst m = await import('./lazy.js');\n// import z from './commented.js';\n/* import w from './block.js' */\nconst s = "import q from './in-string.js'";\nimport fs from 'node:fs';\n`;
  assert.deepEqual(importsOf(src), ['./a.js', '../lib/b.js', './side.css', './t.ts', 'node:fs', './re.js', './x.js', './lazy.js']);
  assert.equal(resolveImport('views/heat.js', './pal.js'), 'views/pal.js');
  assert.equal(resolveImport('views/deep/heat.js', '../pal.js'), 'views/pal.js');
  assert.equal(resolveImport('heat.js', '../out.js'), null, '跑出项目根');
  assert.equal(resolveImport('heat.js', 'node:fs'), null);
  const files: Record<string, string> = { 'v/a.js': "import './b.js'; import './c.js';", 'v/b.js': "import './c.js'; import './gone.js';", 'v/c.js': "import './a.js';", 'src/x.ts': "import { y } from './y';", 'src/y.ts': '' };
  assert.deepEqual(moduleGraph('v/a.js', (p) => files[p] ?? null), { files: ['v/a.js', 'v/b.js', 'v/c.js'], missing: ['v/gone.js'] });
  assert.deepEqual(moduleGraph('src/x.ts', (p) => files[p] ?? null, true).files, ['src/x.ts', 'src/y.ts'], 'TS 省略扩展名');
});

test('resolveView:参数从下往上合并,脚本自己的 spec 也能有 base', () => {
  const u = world();
  const m: ViewModule = { spec: { base: 'tree', params: { a: 1, b: 1 } }, params: { b: 2, c: 2 } };
  const r = resolveView(u, { script: './m.js', params: { c: 3 } }, mods({ 'm.js': m }));
  assert.deepEqual(r.layers.map((l) => l.name), ['tree', 'm.js', '']);
  assert.deepEqual(r.params, { b: 1, c: 3, a: 1 });
  assert.equal(r.spec.layout, BUILTIN_VIEWS.tree!.layout);
});

test('import 边:stars imports on 把相对 import 写成 dependsOn(via=import);scan 跟着更新;off 只删扫描得来的', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-imp-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/app.ts'), "import { login } from './auth';\nimport { ok } from './util.js';\nimport fs from 'node:fs';\n");
  writeFileSync(join(dir, 'src/auth.ts'), "export const login = 1;\n");
  writeFileSync(join(dir, 'src/util.ts'), "export const ok = 1;\n");
  writeFileSync(join(dir, 'src/view.js'), "import './util.js';\n");
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  store.commit(planScan(store.load(), listFiles(dir, 'universe.stars'), 'repo', 'p', statMeta(dir)), { author: 't' });
  store.commit({ op: 'addEdge', from: 'src/app.ts', type: 'dependsOn', to: 'src/auth.ts' }, { author: 't' });   // 手画的
  const ctx = { store, author: 't', root: dir };
  const deps = () => [...store.load().edges.values()].filter((e) => e.type === 'dependsOn').map((e) => `${e.from}>${e.to}${e.attrs.via ? '*' : ''}`).sort();
  assert.match(runKernel('imports', [], {}, ctx).out, /关/);
  runKernel('imports', ['on'], {}, ctx);
  assert.deepEqual(deps(), ['src/app.ts>src/auth.ts', 'src/app.ts>src/util.ts*', 'src/view.js>src/util.ts*'], '省略扩展名、TS 的 .js 写法都认得;手画的那条不重复加');
  assert.equal(store.load().nodes.get('repo')!.attrs.imports, 'true');
  writeFileSync(join(dir, 'src/view.js'), "// 不再 import\n");
  writeFileSync(join(dir, 'src/new.ts'), "import { login } from './auth';\n");
  runKernel('scan', [dir], {}, ctx);
  assert.deepEqual(deps(), ['src/app.ts>src/auth.ts', 'src/app.ts>src/util.ts*', 'src/new.ts>src/auth.ts*'], 'scan:新文件的 import 进来,不再 import 的删掉');
  runKernel('imports', ['off'], {}, ctx);
  assert.deepEqual(deps(), ['src/app.ts>src/auth.ts'], 'off:只删扫描得来的');
  assert.equal(store.load().nodes.get('repo')!.attrs.imports, undefined);
});
