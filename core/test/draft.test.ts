import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runKernel, type CliOpts } from '../src/commands.ts';
import { draftPreview, draftSummary } from '../src/draft.ts';
import { parse } from '../src/format.ts';
import { apply } from '../src/ops.ts';
import { isStorage } from '../src/scan.ts';
import { startServer } from '../src/serve.ts';
import { DraftStore, draftPath, readDraft, Store } from '../src/store.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'stars-cfg-'));
const cli = new URL('../src/cli.ts', import.meta.url).pathname;

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'stars-draft-'));
  const file = join(dir, 'universe.stars');
  const store = new Store(file);
  store.create(genesis);
  const run = (cmd: string, args: string[] = [], o: CliOpts = {}, draft = false) =>
    runKernel(cmd, args, o, { store: draft ? new DraftStore(file) : store, author: 'me', root: dir });
  return { dir, file, store, run };
}

test('草稿:预览 = 叠上草稿的副本;删掉的节点留在原位好画出来;做不了的条目单独报', () => {
  const u = parse(genesis);
  apply(u, { op: 'batch', ops: [
    { op: 'addNode', id: 'd', label: 'd', attrs: { type: 'dir' } },
    { op: 'addNode', id: 'f', label: 'f', attrs: { type: 'file', note: 'x' } },
    { op: 'addNode', id: 'g', label: 'g' },
    { op: 'addEdge', from: 'd', type: 'contains', to: 'f' },
    { op: 'addEdge', from: 'f', type: 'dependsOn', to: 'g' },
  ] });
  const before = JSON.stringify([...u.nodes.values()]);
  const entries = [
    { t: '', author: 'a', op: { op: 'addNode', id: 'n', label: 'N' } as const },
    { t: '', author: 'a', op: { op: 'setNode', id: 'g', set: { note: 'y' } } as const },
    { t: '', author: 'a', op: { op: 'removeNode', id: 'f' } as const },
    { t: '', author: 'b', op: { op: 'addNode', id: 'g', label: 'dup' } as const },
  ];
  const p = draftPreview(u, entries);
  assert.equal(JSON.stringify([...u.nodes.values()]), before, '原来的宇宙没被碰到');
  assert.deepEqual([[...p.added], [...p.changed], [...p.removed]], [['n'], ['g'], ['f']]);
  assert.deepEqual(p.failed, [{ i: 3, error: '节点已存在: g' }]);
  assert.equal([p.addedEdges, p.removedEdges].join(), '0,2');
  assert.ok(p.u.nodes.has('f') && p.u.edges.has('d\u0000contains\u0000f'), '删掉的节点挂回原来的容器');
  assert.ok(!p.u.edges.has('f\u0000dependsOn\u0000g'), '别的被删的边不放回');
  const real = draftPreview(u, entries, { keepRemoved: false });
  assert.ok(!real.u.nodes.has('f'));
  assert.equal(draftSummary({ op: 'setNode', id: 'g', set: { a: '1' }, unset: ['b'] }), '~ 节点 g a −b');
});

test('草稿:--draft 写进草稿不落盘,读看到应用之后;undo 去掉最后一条;apply 一次提交、一次撤回', () => {
  const { file, store, run } = project();
  run('add', ['a']);
  const n0 = store.logCount();
  assert.match(run('add', ['b'], { type: 'module', summary: '说明' }, true).out, /\+ b {3}\(草稿 #1\)/);
  run('link', ['a', 'related', 'b'], {}, true);
  run('rm', ['a'], {}, true);
  run('add', ['c'], {}, true);
  assert.equal(store.logCount(), n0, '日志没动');
  assert.ok(!store.load().nodes.has('b'), '宇宙没动');
  assert.ok(existsSync(draftPath(file)) && isStorage('universe.stars.draft'), '草稿文件不算宇宙里的文件');
  const view = new DraftStore(file).load();
  assert.deepEqual(['a', 'b', 'c'].map((id) => view.nodes.has(id)), [false, true, true], '读 = 应用之后(删掉的就是没了)');
  assert.throws(() => run('link', ['a', 'related', 'c'], {}, true), /起点不存在: a/, '在应用之后的宇宙上试:做不了就不进草稿');
  assert.match(run('undo', [], {}, true).out, /已从草稿里去掉第 4 条/);
  assert.equal(readDraft(file).length, 3);
  const show = run('draft');
  assert.match(show.out, /草稿:3 条改动\(me\),应用之后 \+1 节点 ~0 −1/);
  const r = run('draft', ['apply']);
  assert.match(r.out, /3 条改动作为一次提交/);
  assert.equal(store.logCount(), n0 + 1, '一次提交');
  assert.ok(!existsSync(draftPath(file)), '草稿清空了');
  assert.ok(store.load().nodes.has('b') && !store.load().nodes.has('a'));
  run('undo');
  assert.ok(store.load().nodes.has('a') && !store.load().nodes.has('b'), '一次 undo 全撤回');
});

test('草稿:宇宙变了导致做不了 → apply 一条也不落,drop 序号去掉它', () => {
  const { store, run } = project();
  run('add', ['x'], {}, true);
  run('add', ['y'], {}, true);
  run('add', ['x']);
  const n = store.logCount();
  assert.throws(() => run('draft', ['apply']), /1 条现在做不了[\s\S]*#1 节点已存在: x[\s\S]*stars draft drop 1/);
  assert.equal(store.logCount(), n, '一条也没落');
  assert.match(run('draft').out, /1 {2}\+ 节点 x {3}✗ 现在做不了:节点已存在: x/);
  assert.throws(() => run('draft', ['drop', '9']), /没有第 9 条/);
  assert.match(run('draft', ['drop', '1']).out, /还剩 1 条/);
  run('draft', ['apply']);
  assert.ok(store.load().nodes.has('y'));
  assert.equal(run('draft', ['drop']).out, '草稿是空的');
});

test('草稿:stars run --draft 脚本 —— 脚本的写入进草稿,脚本自己读得到;run 和脚本名之间可以写选项', () => {
  const { dir, file } = project();
  writeFileSync(join(dir, 'fix.mjs'), `export default async (stars, args) => {
    await stars.cmd.add('s1', { type: 'module' });
    await stars.cmd.link('s1', 'related', 'universe');
    const g = await stars.graph();
    return g.nodes.some((n) => n.id === 's1') + ' ' + JSON.stringify(args);
  };`);
  const out = execFileSync('node', [cli, 'run', '--draft', 'fix.mjs', '--x', '1'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(out.trim(), 'true ["--x","1"]');
  assert.deepEqual(readDraft(file).map((e) => [e.op.op, e.author]), [['addNode', 'script:fix.mjs'], ['addEdge', 'script:fix.mjs']]);
  assert.ok(!new Store(file).load().nodes.has('s1'));
});

test('草稿:服务端 —— 快照带草稿、草稿变了推 draft 事件、/api/draft 的 add / drop / apply', async () => {
  const { dir, file, store, run } = project();
  run('add', ['a']);
  run('add', ['b'], {}, true);
  const port = await new Promise<number>((ok) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });
  const srv = startServer(store, port, dir, '127.0.0.1', () => {});
  const base = `http://127.0.0.1:${port}`;
  const call = async (body: unknown) => {
    const r = await fetch(`${base}/api/draft`, { method: 'POST', headers: { 'x-stars-token': srv.token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json() as Record<string, unknown> };
  };
  try {
    await new Promise((r) => setTimeout(r, 150));
    const ctl = new AbortController();
    const events = await fetch(`${base}/events`, { signal: ctl.signal });
    const reader = events.body!.getReader();
    let buf = '';
    const until = async (re: RegExp) => {
      const t = Date.now();
      while (Date.now() - t < 4000) {
        const { value, done } = await Promise.race([reader.read(), new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), 4000))]);
        if (value) buf += new TextDecoder().decode(value);
        if (re.test(buf)) return true;
        if (done) return false;
      }
      return false;
    };
    assert.ok(await until(/"type":"snapshot"[^\n]*"draft":\[\{[^\n]*"id":"b"/), '快照里带着草稿');
    buf = '';
    run('link', ['a', 'related', 'b'], {}, true);   // CLI 写草稿 → 推送
    assert.ok(await until(/"type":"draft"[^\n]*"op":"addEdge"/), '草稿变了推 draft 事件');
    assert.equal((await call({ action: 'add', op: { op: 'addNode', id: 'a', label: 'dup' } })).status, 400, '做不了的不进草稿');
    assert.equal((await call({ action: 'add', op: { op: 'addNode', id: 'c', label: 'c' }, author: 'viewer' })).j.draft, 3);
    assert.equal((await call({ action: 'drop', indices: [3] })).j.dropped, 1);
    const n = store.logCount();
    const a = await call({ action: 'apply', author: 'tester' });
    assert.equal(a.j.count, 2);
    assert.equal(store.logCount(), n + 1);
    assert.equal(store.readLog().at(-1)!.author, 'tester');
    assert.deepEqual(readDraft(file), []);
    buf = '';
    assert.ok(await until(/"type":"draft","entries":\[\]/), '应用之后推空草稿');
    assert.equal((await call({ action: 'apply' })).status, 400, '空草稿');
    ctl.abort();
  } finally { srv.close(); }
});
