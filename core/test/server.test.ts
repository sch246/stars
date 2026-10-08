import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from '../src/format.ts';
import { diffUniverses, gitHistory, gitSnapshot } from '../src/history.ts';
import { startServer } from '../src/serve.ts';
import { Store } from '../src/store.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');
const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
});
/** fetch 不允许改 Host / Origin,这里用底层 http 构造"恶意页面"的请求。 */
const raw = (port: number, path: string, headers: Record<string, string>, method = 'GET', body?: string) =>
  new Promise<number>((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
    req.on('error', fail);
    req.end(body);
  });
const sh = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('服务端:没有 token / 主机头不对 / 跨源 一律拒绝;带 token 的写入走操作日志', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-srv-'));
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  const port = await freePort();
  const srv = startServer(store, port, dir, '127.0.0.1', () => {});
  await new Promise((r) => setTimeout(r, 150));
  const base = `http://127.0.0.1:${port}`;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/op`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const page = await (await fetch(`${base}/`)).text();
    assert.ok(page.includes(srv.token), '页面里内嵌了本次启动的 token');
    assert.equal((await post({ op: { op: 'addNode', id: 'x', label: 'x' } })).status, 403, '没有 token');
    assert.equal((await post({ op: { op: 'addNode', id: 'x', label: 'x' } }, { 'x-stars-token': 'nope' })).status, 403);
    assert.equal(await raw(port, '/', { host: 'evil.example' }), 403, 'Host 不对(DNS 重绑定)');
    assert.equal(await raw(port, '/api/op', { host: `127.0.0.1:${port}`, origin: 'http://evil.example', 'x-stars-token': srv.token, 'content-type': 'application/json' },
      'POST', JSON.stringify({ op: { op: 'addNode', id: 'y', label: 'y' } })), 403, '跨源');
    assert.ok(!parse(readFileSync(store.file, 'utf8')).nodes.has('y'), '被拒绝的写入没有落盘');
    const ok = await post({ op: { op: 'addNode', id: 'x', label: 'X' }, author: 'tester' }, { 'x-stars-token': srv.token });
    assert.equal(ok.status, 200);
    assert.ok(parse(readFileSync(store.file, 'utf8')).nodes.has('x'));
    assert.equal(store.readLog().at(-1)!.author, 'tester');
    const bad = await post({ op: { op: 'rm -rf' } }, { 'x-stars-token': srv.token });
    assert.equal(bad.status, 400);
    const dup = await post({ op: { op: 'addNode', id: 'x', label: 'X' } }, { 'x-stars-token': srv.token });
    assert.equal(dup.status, 400, '业务错误是 400 而不是 500');
  } finally { srv.close(); }
});

test('历史:提交图是 DAG(分叉与合并),能还原任意提交时的宇宙并计算差异', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-git-'));
  const file = join(dir, 'universe.stars');
  const store = new Store(file);
  sh(dir, 'init', '-q', '-b', 'main');
  store.create(genesis);
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'genesis');
  sh(dir, 'checkout', '-qb', 'exp');
  store.commit({ op: 'addNode', id: 'exp-node', label: 'E' }, { author: 'a' });
  sh(dir, 'commit', '-qam', 'exp: add node');
  sh(dir, 'checkout', '-q', 'main');
  store.commit({ op: 'addNode', id: 'main-node', label: 'M' }, { author: 'b' });
  sh(dir, 'commit', '-qam', 'main: add node');
  // 两边在同一处插入 —— git 的文本合并会冲突,这里直接用一个"合并提交"表示两个分支汇合
  const merged = store.load();
  merged.nodes.set('exp-node', { id: 'exp-node', label: 'E', attrs: {} });
  writeFileSync(file, readFileSync(file, 'utf8').replace('node main-node', 'node exp-node "E"\nnode main-node'));
  sh(dir, 'merge', '-q', '--no-commit', '--no-ff', '-s', 'ours', 'exp');
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'merge exp');

  const { commits, head, dirty } = gitHistory(file);
  assert.equal(dirty, false);
  assert.equal(commits[0]!.hash, head);
  assert.equal(commits.length, 4);
  assert.equal(commits[0]!.parents.length, 2, '合并提交有两个父节点');
  assert.ok(commits.some((c) => c.refs.includes('exp')));
  const genesisCommit = commits.find((c) => c.subject === 'genesis')!;
  assert.equal(genesisCommit.parents.length, 0);

  const expCommit = commits.find((c) => c.subject === 'exp: add node')!;
  const snap = gitSnapshot(file, expCommit.hash);
  assert.ok(snap.nodes.has('exp-node') && !snap.nodes.has('main-node'));
  const d = diffUniverses(gitSnapshot(file, genesisCommit.hash), snap);
  assert.deepEqual(d.addedNodes, ['exp-node']);
  assert.deepEqual(d.removedNodes, []);
  assert.throws(() => gitSnapshot(file, '../etc/passwd'), /非法/);
});

test('反向代理:--allow-host 放行代理的域名(Host 与 Origin),其他主机仍被拒绝', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-proxy-'));
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  const port = await freePort();
  const srv = startServer(store, port, dir, '127.0.0.1', () => {}, ['stars.example.com']);
  await new Promise((r) => setTimeout(r, 150));
  const op = JSON.stringify({ op: { op: 'addNode', id: 'p', label: 'P' } });
  const h = (host: string, origin?: string) => ({ host, 'x-stars-token': srv.token, 'content-type': 'application/json', ...(origin ? { origin } : {}) });
  try {
    assert.equal(await raw(port, '/', { host: 'stars.example.com' }), 200, '代理域名可访问');
    assert.equal(await raw(port, '/', { host: 'other.example.com' }), 403, '其他域名仍被拒绝');
    // nginx 默认把 Host 改写成上游地址,而浏览器的 Origin 是代理的域名
    assert.equal(await raw(port, '/api/op', h(`127.0.0.1:${port}`, 'https://stars.example.com'), 'POST', op), 200, '信任的代理域名作为 Origin 可写');
    assert.equal(await raw(port, '/api/op', h(`127.0.0.1:${port}`, 'https://evil.example.com'), 'POST',
      JSON.stringify({ op: { op: 'addNode', id: 'q', label: 'Q' } })), 403, '不信任的 Origin 仍被拒绝');
    assert.ok(parse(readFileSync(store.file, 'utf8')).nodes.has('p') && !parse(readFileSync(store.file, 'utf8')).nodes.has('q'));
  } finally { srv.close(); }
});
