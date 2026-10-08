import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from '../src/format.ts';
import { reconcile, type FsView } from '../src/fssync.ts';
import { lint } from '../src/lint.ts';
import { apply } from '../src/ops.ts';
import { planScan } from '../src/scan.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');

/** 内存里的假文件系统。 */
class FakeFs implements FsView {
  files = new Map<string, { size: number; mtimeMs: number }>();
  ignore = new Set<string>();
  reads = 0;
  constructor(init: Record<string, number>) { for (const [p, s] of Object.entries(init)) this.files.set(p, { size: s, mtimeMs: 1 }); }
  readdir(rel: string) {
    this.reads++;
    const seen = new Map<string, boolean>(); let any = rel === '';
    for (const f of this.files.keys()) {
      if (!f.startsWith(rel)) continue;
      any = true;
      const rest = f.slice(rel.length), i = rest.indexOf('/');
      seen.set(i < 0 ? rest : rest.slice(0, i), i >= 0);
    }
    return any ? [...seen].map(([name, dir]) => ({ name, dir })) : null;
  }
  stat(rel: string) { return this.files.get(rel) ?? null; }
  ignored(rels: string[]) { return new Set(rels.filter((r) => this.ignore.has(r.replace(/\/$/, '').split('/').pop()!))); }
}
const setup = (init: Record<string, number>) => {
  const fsv = new FakeFs(init);
  const u = parse(genesis);
  apply(u, planScan(u, Object.keys(init), 'repo', 'demo', (p) => ({ size: init[p]! })));
  return { fsv, u };
};
const sync = (u: ReturnType<typeof setup>['u'], fsv: FakeFs, dirs: string[] | 'all', touched?: string[]) => {
  const r = reconcile(u, fsv, { mountId: 'repo', dirs, touched });
  if (r.op) apply(u, r.op);
  return r;
};
const ids = (u: ReturnType<typeof setup>['u']) => [...u.nodes.keys()].filter((k) => !k.startsWith('~') && k !== 'universe').sort();

test('对账:新增文件与目录(递归发现整棵新子树),节点属性与 scan 一致', () => {
  const { fsv, u } = setup({ 'a/x.ts': 10 });
  fsv.files.set('a/y.md', { size: 5, mtimeMs: 2 });
  fsv.files.set('b/c/z.json', { size: 7, mtimeMs: 2 });
  const r = sync(u, fsv, ['', 'a/']);
  assert.equal(r.stats.added, 4); // a/y.md, b/, b/c/, b/c/z.json
  assert.deepEqual(ids(u), ['a/', 'a/x.ts', 'a/y.md', 'b/', 'b/c/', 'b/c/z.json', 'repo']);
  assert.deepEqual(u.nodes.get('a/y.md')!.attrs, { type: 'file', file: 'a/y.md', ext: 'md', size: '5' });
  assert.ok(u.edges.has('b/\u0000contains\u0000b/c/'));
  assert.deepEqual(lint(u).filter((i) => i.severity === 'error'), []);
});

test('对账:再对账一次不产生任何操作(幂等),只读脏目录', () => {
  const { fsv, u } = setup({ 'a/x.ts': 10, 'b/y.ts': 20, 'c/z.ts': 30 });
  fsv.reads = 0;
  const r = sync(u, fsv, ['a/']);
  assert.equal(r.op, null);
  assert.equal(fsv.reads, 1, '只读了被标脏的一个目录');
});

test('对账:删除 —— 纯结构节点被删,带语义关系的保留并标记 missing,文件回来自动取消', () => {
  const { fsv, u } = setup({ 'a/x.ts': 10, 'a/y.ts': 20, 'a/z.ts': 30 });
  apply(u, { op: 'addNode', id: 'goal', label: 'goal' });
  apply(u, { op: 'addEdge', from: 'goal', type: 'describes', to: 'a/y.ts' });
  fsv.files.delete('a/x.ts'); fsv.files.delete('a/y.ts');
  const r = sync(u, fsv, ['a/']);
  assert.ok(!u.nodes.has('a/x.ts'), '没有任何语义关系:直接删除');
  assert.equal(u.nodes.get('a/y.ts')!.attrs.missing, 'true', '有语义关系:保留并标记 missing');
  assert.ok(u.edges.has('goal\u0000describes\u0000a/y.ts'), '关系还在');
  assert.deepEqual([r.stats.removed, r.stats.missing], [1, 1]);
  assert.ok(lint(u, { baseDir: '/nowhere', fileExists: () => false }).some((i) => i.rule === 'missing-file'));
  fsv.files.set('a/y.ts', { size: 20, mtimeMs: 9 });
  const r2 = sync(u, fsv, ['a/']);
  assert.equal(u.nodes.get('a/y.ts')!.attrs.missing, undefined);
  assert.equal(r2.stats.revived, 1);
});

test('对账:整个目录被删,子树自底向上处理;含语义关系的文件会让祖先目录一并保留', () => {
  const { fsv, u } = setup({ 'd/e/f.ts': 1, 'd/g.ts': 2, 'k/h.ts': 3 });
  apply(u, { op: 'addNode', id: 'note', label: 'n' });
  apply(u, { op: 'addEdge', from: 'note', type: 'describes', to: 'd/e/f.ts' });
  for (const f of ['d/e/f.ts', 'd/g.ts']) fsv.files.delete(f);
  sync(u, fsv, ['']);
  assert.ok(!u.nodes.has('d/g.ts'));
  for (const id of ['d/', 'd/e/', 'd/e/f.ts']) assert.equal(u.nodes.get(id)!.attrs.missing, 'true', id);
  assert.ok(u.nodes.has('k/h.ts'));
  assert.deepEqual(lint(u).filter((i) => i.severity === 'error'), []);
});

test('对账:重命名文件(同目录改名、跨目录移动)识别为同一节点,关系跟着走', () => {
  const { fsv, u } = setup({ 'a/old.ts': 100, 'a/other.ts': 7, 'b/keep.ts': 9 });
  apply(u, { op: 'addNode', id: 'note', label: 'n' });
  apply(u, { op: 'addEdge', from: 'note', type: 'describes', to: 'a/old.ts' });
  fsv.files.delete('a/old.ts'); fsv.files.set('a/new.ts', { size: 100, mtimeMs: 5 });
  let r = sync(u, fsv, ['a/']);
  assert.equal(r.stats.renamed, 1);
  assert.ok(!u.nodes.has('a/old.ts') && u.nodes.has('a/new.ts'));
  assert.equal(u.nodes.get('a/new.ts')!.label, 'new.ts');
  assert.equal(u.nodes.get('a/new.ts')!.attrs.file, 'a/new.ts');
  assert.ok(u.edges.has('note\u0000describes\u0000a/new.ts'), '关系没有丢');
  // 跨目录移动
  fsv.files.delete('a/new.ts'); fsv.files.set('b/new.ts', { size: 100, mtimeMs: 6 });
  r = sync(u, fsv, ['a/', 'b/']);
  assert.equal(r.stats.renamed, 1);
  assert.ok(u.edges.has('b/\u0000contains\u0000b/new.ts') && !u.edges.has('a/\u0000contains\u0000b/new.ts'), '归属的目录也跟着变');
  assert.ok(u.edges.has('note\u0000describes\u0000b/new.ts'));
  assert.deepEqual(lint(u).filter((i) => i.severity === 'error'), []);
});

test('对账:重命名整个目录 —— 内容签名一致,所有后代连同关系一起改名', () => {
  const { fsv, u } = setup({ 'src/a.ts': 11, 'src/lib/b.ts': 22, 'other/c.ts': 3 });
  apply(u, { op: 'addNode', id: 'note', label: 'n' });
  apply(u, { op: 'addEdge', from: 'note', type: 'describes', to: 'src/lib/b.ts' });
  fsv.files.delete('src/a.ts'); fsv.files.delete('src/lib/b.ts');
  fsv.files.set('app/a.ts', { size: 11, mtimeMs: 2 }); fsv.files.set('app/lib/b.ts', { size: 22, mtimeMs: 2 });
  const r = sync(u, fsv, ['']);
  assert.equal(r.stats.renamed, 4, 'src/、src/lib/、两个文件');
  assert.deepEqual(ids(u), ['app/', 'app/a.ts', 'app/lib/', 'app/lib/b.ts', 'note', 'other/', 'other/c.ts', 'repo']);
  assert.ok(u.edges.has('note\u0000describes\u0000app/lib/b.ts'));
  assert.ok(u.edges.has('repo\u0000contains\u0000app/'));
  assert.equal(u.nodes.get('app/lib/')!.attrs.file, 'app/lib/');
  assert.deepEqual(lint(u).filter((i) => i.severity === 'error'), []);
});

test('对账:有歧义就不猜 —— 两个同名同大小的文件一删一增是两件事', () => {
  const { fsv, u } = setup({ 'a/x.ts': 5, 'b/x.ts': 5 });
  fsv.files.delete('a/x.ts'); fsv.files.delete('b/x.ts');
  fsv.files.set('c/x.ts', { size: 5, mtimeMs: 1 }); fsv.files.set('d/x.ts', { size: 5, mtimeMs: 1 });
  const r = sync(u, fsv, ['', 'a/', 'b/']);
  assert.equal(r.stats.renamed, 0);
});

test('对账:被忽略的路径不进宇宙;文件大小变化只进实时信号,不写宇宙', () => {
  const { fsv, u } = setup({ 'a/x.ts': 10 });
  fsv.files.set('node_modules/p/i.js', { size: 1, mtimeMs: 1 }); fsv.ignore.add('node_modules');
  fsv.files.set('a/x.ts', { size: 999, mtimeMs: 77 });
  const r = sync(u, fsv, ['', 'a/'], ['a/x.ts']);
  assert.ok(!u.nodes.has('node_modules/'));
  assert.equal(r.op, null, '只是内容变了:不产生任何对宇宙的写入');
  assert.deepEqual(r.live.size, { 'a/x.ts': 999 });
  assert.deepEqual(r.live.changed, { 'a/x.ts': 77 });
  assert.equal(u.nodes.get('a/x.ts')!.attrs.size, '10', '宇宙里的 size 保持 scan 时的值,没有 git 噪音');
});

test('操作:renameNodes 可逆,对称边重新规范化', () => {
  const { u } = setup({ 'a/x.ts': 1 });
  apply(u, { op: 'addNode', id: 'z', label: 'z' });
  apply(u, { op: 'addEdge', from: 'a/x.ts', type: 'related', to: 'z' });
  const before = JSON.stringify([...u.edges.keys()].sort());
  const inv = apply(u, { op: 'renameNodes', pairs: [['z', 'a0']] });
  assert.ok(u.edges.has('a/x.ts\u0000related\u0000a0') || u.edges.has('a0\u0000related\u0000a/x.ts'));
  assert.equal([...u.edges.keys()].filter((k) => k.includes('related')).length, 1);
  apply(u, inv);
  assert.equal(JSON.stringify([...u.edges.keys()].sort()), before);
  assert.throws(() => apply(u, { op: 'renameNodes', pairs: [['z', 'repo']] }), /已存在/);
});
