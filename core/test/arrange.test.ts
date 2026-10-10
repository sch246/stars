import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { planArrange } from '../src/arrange.ts';
import { arrange, saveUploads, undoWithFs } from '../src/fsops.ts';
import { edgeKey } from '../src/model.ts';
import { listFiles, planScan, statMeta } from '../src/scan.ts';
import { Store } from '../src/store.ts';
import { runKernel } from '../src/commands.ts';

/** 一个小项目:src/a.ts src/b.ts docs/r.md + 概念 ideas ⊃ x ⊃ y,ideas 还装着 src/a.ts */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'stars-arrange-'));
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src/b.ts'), 'import { a } from "./a";\n');
  writeFileSync(join(dir, 'docs/r.md'), '# r\n');
  const file = join(dir, 'universe.stars');
  const store = new Store(file);
  store.create('');
  store.commit(planScan(store.load(), listFiles(dir, 'universe.stars'), 'repo', 'proj', statMeta(dir)), { author: 't' });
  for (const [id, label] of [['ideas', '想法'], ['x', 'X'], ['y', 'Y']]) store.commit({ op: 'addNode', id: id!, label: label!, attrs: { type: 'concept', summary: label! } }, { author: 't' });
  for (const [a, b] of [['ideas', 'x'], ['x', 'y'], ['ideas', 'src/a.ts'], ['repo', 'ideas']]) store.commit({ op: 'addEdge', from: a!, type: 'contains', to: b! }, { author: 't' });
  store.commit({ op: 'addEdge', from: 'src/b.ts', type: 'dependsOn', to: 'src/a.ts' }, { author: 't' });
  store.commit({ op: 'addEdge', from: 'y', type: 'describes', to: 'src/b.ts' }, { author: 't' });
  store.commit({ op: 'addEdge', from: 'docs/r.md', type: 'describes', to: 'x' }, { author: 't' });
  return { dir, file, store };
}
const has = (s: Store, a: string, t: string, b: string) => s.load().edges.has(edgeKey(a, t, b));

test('整理:概念移动 = 换上级;放进自己里面被拒绝;有几个上级时要指明从哪个移出', () => {
  const { dir, store } = project();
  const r = arrange(store, dir, 'move', ['y'], 'ideas', {}, 't');
  assert.deepEqual(r.plan.result, ['y']);
  assert.ok(has(store, 'ideas', 'contains', 'y') && !has(store, 'x', 'contains', 'y'));
  assert.ok(has(store, 'y', 'describes', 'src/b.ts'), '别的关系跟着它');
  assert.throws(() => planArrange(store.load(), 'move', ['ideas'], 'x'), /放进它自己里面/);
  assert.throws(() => planArrange(store.load(), 'move', ['x'], 'x'), /它自己身上/);
  store.commit({ op: 'addEdge', from: 'docs/', type: 'contains', to: 'x' }, { author: 't' });
  assert.throws(() => planArrange(store.load(), 'move', ['x'], 'repo'), /2 个容器里/);
  const p = planArrange(store.load(), 'move', ['x'], 'repo', { from: { x: 'docs/' } });
  assert.ok(p.op);
  // 选中里互相包含:只动最外层
  const q = planArrange(store.load(), 'ref', ['ideas', 'x'], 'docs/');
  assert.deepEqual(q.result, ['ideas']);
});

test('整理:文件移动在磁盘上真的搬,id 跟着改、关系都在;撤销把文件搬回去', () => {
  const { dir, store } = project();
  const r = arrange(store, dir, 'move', ['src/a.ts'], 'docs/', {}, 't');
  assert.deepEqual(r.plan.fs, [{ act: 'move', from: 'src/a.ts', to: 'docs/a.ts' }]);
  assert.ok(existsSync(join(dir, 'docs/a.ts')) && !existsSync(join(dir, 'src/a.ts')));
  const u = store.load();
  assert.ok(u.nodes.has('docs/a.ts') && !u.nodes.has('src/a.ts'));
  assert.equal(u.nodes.get('docs/a.ts')!.attrs.file, 'docs/a.ts');
  assert.ok(has(store, 'docs/', 'contains', 'docs/a.ts') && !has(store, 'src/', 'contains', 'docs/a.ts'));
  assert.ok(has(store, 'src/b.ts', 'dependsOn', 'docs/a.ts') && has(store, 'ideas', 'contains', 'docs/a.ts'), '依赖、概念的包含都跟着改名');
  // 文件不能移进概念
  assert.throws(() => planArrange(store.load(), 'move', ['docs/a.ts'], 'x'), /只能移到文件夹里/);
  // 撤销:文件回去
  undoWithFs(store, dir, 't');
  assert.ok(existsSync(join(dir, 'src/a.ts')) && !existsSync(join(dir, 'docs/a.ts')));
  assert.ok(store.load().nodes.has('src/a.ts') && has(store, 'src/', 'contains', 'src/a.ts'));
  // 不给 fsUndo 的撤销(比如别的地方)要拒绝,不能只撤图不撤文件
  arrange(store, dir, 'move', ['src/'], 'docs/', {}, 't');
  assert.ok(existsSync(join(dir, 'docs/src/b.ts')));
  assert.ok(store.load().nodes.has('docs/src/b.ts') && has(store, 'docs/src/', 'contains', 'docs/src/b.ts'), '文件夹里的一起改名');
  assert.throws(() => store.undo({ author: 't' }), /磁盘上的文件/);
  undoWithFs(store, dir, 't');
  assert.ok(existsSync(join(dir, 'src/b.ts')) && store.load().nodes.has('src/b.ts'));
});

test('整理:复制 = 连同里面的东西一份新的;外面指向它的不复制;概念里的文件不复制;文件在磁盘上复制一份', () => {
  const { dir, store } = project();
  const r = arrange(store, dir, 'copy', ['x'], 'docs/', {}, 't');
  const [cx] = r.plan.result;
  assert.equal(cx, 'x-copy');
  const u = store.load();
  assert.ok(u.nodes.has('y-copy'), '里面的 y 也复制了');
  assert.ok(has(store, 'docs/', 'contains', 'x-copy') && has(store, 'x-copy', 'contains', 'y-copy'));
  assert.ok(has(store, 'y-copy', 'describes', 'src/b.ts'), '指向外面的边复制');
  assert.ok(!has(store, 'docs/r.md', 'describes', 'x-copy'), '外面指向它的不复制');
  assert.equal(u.nodes.get('x-copy')!.attrs.summary, 'X');
  // 概念里装着文件:复制概念不复制文件,副本照样装着原来那个
  const r2 = arrange(store, dir, 'copy', ['ideas'], 'repo', {}, 't');
  assert.equal(r2.plan.fs.length, 0);
  assert.ok(has(store, r2.plan.result[0]!, 'contains', 'src/a.ts'));
  // 文件:磁盘上复制一份,同名就加 -copy
  const r3 = arrange(store, dir, 'copy', ['src/a.ts'], 'src/', {}, 't');
  assert.deepEqual(r3.plan.result, ['src/a-copy.ts']);
  assert.equal(readFileSync(join(dir, 'src/a-copy.ts'), 'utf8'), 'export const a = 1;\n');
  assert.ok(has(store, 'src/', 'contains', 'src/a-copy.ts') && has(store, 'src/a-copy.ts', 'dependsOn', 'src/a.ts') === false);
  // 撤销复制 = 删掉复制出来的文件
  undoWithFs(store, dir, 't');
  assert.ok(!existsSync(join(dir, 'src/a-copy.ts')) && !store.load().nodes.has('src/a-copy.ts'));
  // 文件夹复制
  const r4 = arrange(store, dir, 'copy', ['src/'], 'docs/', {}, 't');
  assert.deepEqual(r4.plan.result, ['docs/src/']);
  assert.ok(existsSync(join(dir, 'docs/src/b.ts')) && store.load().nodes.has('docs/src/b.ts'));
  assert.ok(has(store, 'docs/src/b.ts', 'dependsOn', 'docs/src/a.ts'), '里面之间的边指向副本');
});

test('整理:引用 = 只加一条 contains;CLI 的 mv / cp / ln', () => {
  const { dir, store } = project();
  const r = arrange(store, dir, 'ref', ['src/b.ts'], 'x', {}, 't');
  assert.equal(r.plan.fs.length, 0);
  assert.ok(has(store, 'x', 'contains', 'src/b.ts') && has(store, 'src/', 'contains', 'src/b.ts'));
  assert.throws(() => planArrange(store.load(), 'ref', ['ideas'], 'y'), /放进它自己里面/);
  store.commit({ op: 'addNode', id: '~contains', label: '包含', attrs: { kind: 'edgeType', 'single-parent': 'true' } }, { author: 't' });
  assert.throws(() => planArrange(store.load(), 'ref', ['x'], 'docs/'), /只能有一个上级/);
  store.commit({ op: 'removeNode', id: '~contains' }, { author: 't' });
  const k = (cmd: string, ...args: string[]) => runKernel(cmd, args, {} as never, { store, author: 't', root: dir });
  assert.match(k('ln', 'docs/r.md', 'y').out, /引用 1 个/);
  assert.match(k('mv', 'docs/r.md', 'src/').out, /搬 docs\/r\.md → src\/r\.md/);
  assert.ok(existsSync(join(dir, 'src/r.md')) && has(store, 'y', 'contains', 'src/r.md'));
  assert.match(k('undo').out, /已撤销/);
  assert.ok(existsSync(join(dir, 'docs/r.md')));
  assert.match(k('cp', 'y', 'repo').out, /复制 1 个/);
});

test('外面来的文件:存进文件夹(不覆盖、空白换成 -),概念也装着;撤销删掉文件', () => {
  const { dir, store } = project();
  const r = saveUploads(store, dir, 'docs/', [{ name: 'my note.txt', data: Buffer.from('hi') }, { name: 'r.md', data: Buffer.from('x') }], { container: null }, 't');
  assert.deepEqual(r.created, ['docs/my-note.txt', 'docs/r-copy.md']);
  assert.equal(readFileSync(join(dir, 'docs/r.md'), 'utf8'), '# r\n', '同名的不覆盖');
  assert.ok(has(store, 'docs/', 'contains', 'docs/my-note.txt'));
  assert.equal(store.load().nodes.get('docs/my-note.txt')!.attrs.size, '2');
  const r2 = saveUploads(store, dir, null, [{ name: '../evil.png', data: Buffer.from([1]) }], { container: 'x' }, 't');
  assert.deepEqual(r2.created, ['evil.png'], '去掉路径,存进项目根');
  assert.ok(has(store, 'repo', 'contains', 'evil.png') && has(store, 'x', 'contains', 'evil.png'));
  undoWithFs(store, dir, 't');
  assert.ok(!existsSync(join(dir, 'evil.png')) && !store.load().nodes.has('evil.png'));
  undoWithFs(store, dir, 't');
  assert.ok(!existsSync(join(dir, 'docs/my-note.txt')));
  assert.throws(() => saveUploads(store, dir, 'x', [{ name: 'a', data: Buffer.from('') }], {}, 't'), /不是文件夹/);
});

test('删除:文件 / 文件夹挪进回收站,撤销搬回来、关系都回来;--node-only 只删节点;回收站不进扫描', () => {
  const { dir, store } = project();
  const r = arrange(store, dir, 'delete', ['src/', 'src/a.ts', 'x'], null, {}, 't');
  assert.equal(r.plan.fs.length, 1, '文件夹里的文件跟着文件夹挪,不单独挪');
  assert.match(r.plan.fs[0]!.to, /^\.stars-trash\/.+\/src\/$/);
  assert.ok(!existsSync(join(dir, 'src')) && existsSync(join(dir, r.plan.fs[0]!.to, 'a.ts')));
  const u = store.load();
  assert.ok(!u.nodes.has('src/') && !u.nodes.has('src/a.ts') && !u.nodes.has('src/b.ts') && !u.nodes.has('x'));
  assert.ok(u.nodes.has('y'), '概念里的东西不跟着删');
  assert.deepEqual(listFiles(dir, 'universe.stars').filter((f) => f.includes('stars-trash')), [], '回收站不进扫描');
  undoWithFs(store, dir, 't');
  assert.ok(existsSync(join(dir, 'src/a.ts')));
  assert.ok(has(store, 'src/b.ts', 'dependsOn', 'src/a.ts') && has(store, 'ideas', 'contains', 'src/a.ts') && has(store, 'x', 'contains', 'y'), '关系都回来了');
  const k = runKernel('rm', ['docs/r.md', '--node-only'].slice(0, 1), { 'node-only': true } as never, { store, author: 't', root: dir });
  assert.match(k.out, /- docs\/r\.md/);
  assert.ok(existsSync(join(dir, 'docs/r.md')) && !store.load().nodes.has('docs/r.md'));
  assert.throws(() => planArrange(store.load(), 'delete', ['repo'], null), /根目录/);
});

test('打包 / 解散:文件夹里打包 = 真的新建文件夹;概念里 = 概念域;解散有冲突先报出来', () => {
  const { dir, store } = project();
  const g = arrange(store, dir, 'group', ['src/a.ts', 'src/b.ts'], null, { name: 'lib', inferParent: true }, 't');
  assert.deepEqual(g.plan.result, ['src/lib/']);
  assert.ok(existsSync(join(dir, 'src/lib/a.ts')) && !existsSync(join(dir, 'src/a.ts')));
  assert.ok(has(store, 'src/', 'contains', 'src/lib/') && has(store, 'src/lib/', 'contains', 'src/lib/a.ts'));
  assert.ok(has(store, 'src/lib/b.ts', 'dependsOn', 'src/lib/a.ts') && has(store, 'ideas', 'contains', 'src/lib/a.ts'), '关系跟着走');
  undoWithFs(store, dir, 't');
  assert.ok(existsSync(join(dir, 'src/a.ts')) && !existsSync(join(dir, 'src/lib')), '撤销:文件回去,文件夹删掉');
  // 不同层的不能打包;空的 = 新建一个空域(在文件夹里就是空文件夹)
  assert.throws(() => planArrange(store.load(), 'group', ['src/a.ts', 'docs/r.md'], null, { inferParent: true }), /同一层/);
  const e = arrange(store, dir, 'group', [], 'docs/', { name: '草稿 箱' }, 't');
  assert.deepEqual(e.plan.result, ['docs/草稿-箱/']);
  assert.ok(existsSync(join(dir, 'docs/草稿-箱')));
  // 概念:打包成概念域
  const c = arrange(store, dir, 'group', ['x'], 'ideas', { name: '一组' }, 't');
  assert.deepEqual(c.plan.result, ['一组']);
  assert.ok(has(store, 'ideas', 'contains', '一组') && has(store, '一组', 'contains', 'x') && !has(store, 'ideas', 'contains', 'x'));
  // 解散概念域:放回上一层
  const u1 = arrange(store, dir, 'ungroup', ['一组'], null, { inferParent: true }, 't');
  assert.ok(u1.entry && has(store, 'ideas', 'contains', 'x') && !store.load().nodes.has('一组'));
  // 解散文件夹:有图里没有的文件 → 冲突,什么都不做
  arrange(store, dir, 'group', ['src/a.ts'], 'src/', { name: 'lib' }, 't');
  writeFileSync(join(dir, 'src/lib/notes.txt'), 'x');
  const u2 = arrange(store, dir, 'ungroup', ['src/lib/'], null, {}, 't');
  assert.equal(u2.entry, null);
  assert.match(u2.plan.conflicts!.hard.join(), /图里没有的 notes\.txt/);
  assert.ok(existsSync(join(dir, 'src/lib/a.ts')));
  // 重名 → 冲突
  writeFileSync(join(dir, 'src/a.ts'), 'other');
  store.commit({ op: 'addNode', id: 'src/a.ts', label: 'a.ts', attrs: { type: 'file', file: 'src/a.ts' } }, { author: 't' });
  rmSync(join(dir, 'src/lib/notes.txt'));
  const u3 = arrange(store, dir, 'ungroup', ['src/lib/'], null, {}, 't');
  assert.match(u3.plan.conflicts!.hard.join(), /已经有 a\.ts/);
  // 域自己有说明 = 会丢东西:要 force
  store.commit({ op: 'removeNode', id: 'src/a.ts' }, { author: 't' }); rmSync(join(dir, 'src/a.ts'));
  store.commit({ op: 'setNode', id: 'src/lib/', set: { summary: '库' } }, { author: 't' });
  const u4 = arrange(store, dir, 'ungroup', ['src/lib/'], null, {}, 't');
  assert.match(u4.plan.conflicts!.soft.join(), /说明会丢掉/);
  const u5 = arrange(store, dir, 'ungroup', ['src/lib/'], null, { force: true }, 't');
  assert.ok(u5.entry && existsSync(join(dir, 'src/a.ts')) && !existsSync(join(dir, 'src/lib')));
  undoWithFs(store, dir, 't');
  assert.ok(existsSync(join(dir, 'src/lib/a.ts')) && store.load().nodes.get('src/lib/')!.attrs.summary === '库', '撤销解散:文件夹和说明都回来');
});
