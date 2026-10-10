import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runKernel, type CliOpts } from '../src/commands.ts';
import { lint } from '../src/lint.ts';
import { startServer } from '../src/serve.ts';
import { blobId, fileHash, seenBody, seenState, stampOnSummary } from '../src/stale.ts';
import { Store } from '../src/store.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'stars-cfg-'));
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function project(withGit: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'stars-stale-'));
  if (withGit) git(dir, 'init', '-q');
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  const run = (cmd: string, args: string[] = [], o: CliOpts = {}) => runKernel(cmd, args, o, { store, author: 'me', root: dir });
  const staleIds = () => lint(store.load(), { baseDir: dir }).filter((i) => i.rule === 'stale').map((i) => i.nodes[0]);
  return { dir, store, run, staleIds };
}

test('过期检测:哈希就是 git 的 blob id(文本统一成 LF);换行风格不同不算改动', () => {
  const { dir } = project(true);
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
  assert.equal(fileHash(dir, 'a.txt'), git(dir, 'hash-object', 'a.txt').trim());
  assert.equal(blobId(seenBody(Buffer.from('one\r\ntwo\r\n'))), fileHash(dir, 'a.txt'));
  const bin = Buffer.from([0, 13, 10, 1]);
  assert.equal(seenBody(bin), bin, '二进制原样');
  assert.equal(fileHash(dir, 'nope.txt'), null);
  assert.equal(fileHash(dir, '.'), null, '目录不算');
});

test('过期检测:写说明自动记版本 → 文件改了报 stale → 看改动 → 确认仍然有效', () => {
  const { dir, store, run, staleIds } = project(true);
  writeFileSync(join(dir, 'auth.ts'), 'export function login() {}\n');
  run('add', ['auth'], { summary: '登录', ref: 'auth.ts', type: 'module' });
  const seen = store.load().nodes.get('auth')!.attrs.seen!;
  assert.match(seen, /^[0-9a-f]{12}$/);
  run('add', ['plain'], { ref: 'auth.ts' });
  assert.equal(store.load().nodes.get('plain')!.attrs.seen, undefined, '没写说明就不记');
  assert.deepEqual(staleIds(), []);

  writeFileSync(join(dir, 'auth.ts'), 'export function login() {}\r\n');
  assert.deepEqual(staleIds(), [], '只是换行风格变了');
  writeFileSync(join(dir, 'auth.ts'), 'export function login() {}\nexport function logout() {}\n');
  assert.deepEqual(staleIds(), ['auth']);
  assert.match(lint(store.load(), { baseDir: dir }).find((i) => i.rule === 'stale')!.message, /auth 的说明写于文件改动之前: auth\.ts/);

  const st = run('stale', [], { diff: true });
  const item = (st.data as Array<{ id: string; diff: { old: boolean; diff: string } }>)[0]!;
  assert.equal(item.id, 'auth');
  assert.ok(item.diff.old);
  assert.match(item.diff.diff, /^@@/);
  assert.match(item.diff.diff, /^\+export function logout\(\) \{\}$/m);
  assert.match(st.out, /^ {4}\+export function logout/m);

  // 改说明 = 对着新版本重写:自动重新记
  run('set', ['auth'], { summary: '登录与登出' });
  assert.deepEqual(staleIds(), []);
  assert.notEqual(store.load().nodes.get('auth')!.attrs.seen, seen);

  // 说明不用改:stamp
  writeFileSync(join(dir, 'auth.ts'), '// 注释\nexport function login() {}\nexport function logout() {}\n');
  assert.deepEqual(staleIds(), ['auth']);
  const r = run('stamp', ['auth', 'plain', 'ghost']);
  assert.deepEqual((r.data as { stamped: string[] }).stamped, ['auth', 'plain']);
  assert.deepEqual((r.data as { skipped: string[] }).skipped, ['ghost']);
  assert.deepEqual(staleIds(), []);
  run('undo');
  assert.deepEqual(staleIds(), ['auth'], 'stamp 可以撤销');
});

test('过期检测:stamp --all 只记"有说明、还没记过版本"的;目录、锚点、缺失的文件', () => {
  const { dir, store, run, staleIds } = project(false);
  writeFileSync(join(dir, 'a.md'), '# A\n');
  writeFileSync(join(dir, 'b.md'), '# B\n');
  store.commit({ op: 'batch', ops: [
    { op: 'addNode', id: 'a', label: 'a', attrs: { file: 'a.md#A', summary: '旧的说明' } },
    { op: 'addNode', id: 'b', label: 'b', attrs: { file: 'b.md' } },
    { op: 'addNode', id: 'd', label: 'd', attrs: { file: './', summary: '目录' } },
    { op: 'addNode', id: 'gone', label: 'gone', attrs: { file: 'gone.md', summary: 'x' } },
  ] }, { author: 'old' });
  assert.equal(seenState(dir, store.load().nodes.get('a')!.attrs), 'untracked');
  assert.equal(seenState(dir, store.load().nodes.get('d')!.attrs), 'none', '目录不管');
  const r = run('stamp', [], { all: true });
  assert.deepEqual((r.data as { stamped: string[] }).stamped, ['a']);
  writeFileSync(join(dir, 'a.md'), '# A\n\nmore\n');
  assert.deepEqual(staleIds(), ['a'], '锚点只看文件部分');
  const d = run('stale', [], { diff: true }).data as Array<{ diff: { old: boolean } }>;
  assert.equal(d[0]!.diff.old, false, '不是 git 仓库:能检测,看不到改动');
  assert.equal(run('stamp', [], { all: true }).out, '没有要记的', '已经过期的不会被 --all 一笔勾销');
});

test('过期检测:stampOnSummary 只补写了 summary、指向文件、自己没碰 seen 的', () => {
  const { dir, store } = project(false);
  writeFileSync(join(dir, 'f.ts'), 'x\n');
  const u = store.load();
  const op = stampOnSummary(u, { op: 'batch', ops: [
    { op: 'addNode', id: 'p', label: 'p', attrs: { file: 'f.ts', summary: 's' } },
    { op: 'addNode', id: 'q', label: 'q', attrs: { file: 'f.ts', summary: 's', seen: 'deadbeefdead' } },
    { op: 'addNode', id: 'r', label: 'r', attrs: { summary: 's' } },
  ] }, dir);
  assert.ok(op.op === 'batch');
  const attrs = op.ops.map((o) => (o.op === 'addNode' ? o.attrs! : {}));
  assert.equal(attrs[0]!.seen, fileHash(dir, 'f.ts')!.slice(0, 12));
  assert.equal(attrs[1]!.seen, 'deadbeefdead');
  assert.equal(attrs[2]!.seen, undefined);
  const same = { op: 'setNode', id: 'x', set: { color: 'red' } } as const;
  assert.equal(stampOnSummary(u, same, dir), same, '没写 summary:原样返回');
});

test('过期检测:服务端 —— 查看器写说明自动记版本;/api/stamp、/api/seen-diff;保存文件后体检推送 stale', async () => {
  const { dir, store, staleIds } = project(true);
  writeFileSync(join(dir, 'm.ts'), 'a\n');
  const port = await new Promise<number>((ok) => { const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });
  const srv = startServer(store, port, dir, '127.0.0.1', () => {});
  const base = `http://127.0.0.1:${port}`;
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-stars-token': srv.token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, j: await r.json() as Record<string, unknown> };
  };
  try {
    await new Promise((r) => setTimeout(r, 150));
    await call('/api/op', { op: { op: 'addNode', id: 'm', label: 'm', attrs: { file: 'm.ts', summary: '模块' } } });
    assert.match(store.load().nodes.get('m')!.attrs.seen ?? '', /^[0-9a-f]{12}$/, '经 /api/op 写的说明也记版本');
    // 订阅事件,保存文件后应当收到带 stale 的体检结果
    const ctl = new AbortController();
    const events = await fetch(`${base}/events`, { signal: ctl.signal });
    const reader = events.body!.getReader();
    let buf = '';
    const waitStale = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return false;
        buf += new TextDecoder().decode(value);
        if (/"type":"issues"[^\n]*"rule":"stale"/.test(buf)) return true;
      }
    })();
    const w = await call('/api/file', { path: 'm.ts', content: 'a\nb\n', mtime: null });
    assert.equal(w.status, 200);
    assert.equal(await Promise.race([waitStale, new Promise((r) => setTimeout(() => r('timeout'), 4000))]), true);
    ctl.abort();
    const d = await call('/api/seen-diff?id=m');
    assert.equal(d.j.old, true);
    assert.match(String(d.j.diff), /^\+b$/m);
    const s = await call('/api/stamp', { ids: ['m', 'zz'], author: 'tester' });
    assert.deepEqual([s.j.stamped, s.j.skipped], [['m'], ['zz']]);
    assert.deepEqual(staleIds(), []);
    assert.equal(store.readLog().at(-1)!.author, 'tester');
    assert.equal((await call('/api/seen-diff?id=nope')).status, 404);
  } finally { srv.close(); }
});
