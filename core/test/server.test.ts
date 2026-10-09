import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'stars-cfg-')); // "最近打开"别写进真实的家目录
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

test('增量协议:提交只推新增的日志条目;延迟写入落盘不推快照;外部改动文件才推快照;实时信号单独推', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-sse-'));
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  const port = await freePort();
  const srv = startServer(store, port, dir, '127.0.0.1', () => {});
  const ctl = new AbortController();
  const msgs: Array<Record<string, unknown>> = [];
  const res = await fetch(`http://127.0.0.1:${port}/events`, { signal: ctl.signal });
  void (async () => {
    const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) return;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); if (chunk.startsWith('data: ')) msgs.push(JSON.parse(chunk.slice(6))); }
      }
    } catch { /* 中止 */ }
  })();
  const waitFor = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 15)); assert.ok(cond(), '等待消息超时;已收到: ' + JSON.stringify(msgs.map((m) => m.type + ':' + (m.n ?? '')))); };
  try {
    await waitFor(() => msgs.length >= 1);
    assert.equal(msgs[0]!.type, 'snapshot');
    assert.equal(msgs[0]!.n, 0);
    // 1) 一次普通提交 → 一条 ops,不是快照
    store.commit({ op: 'addNode', id: 'k1', label: 'k1' }, { author: 'human' });
    await waitFor(() => msgs.some((m) => m.type === 'ops'));
    const ops = msgs.find((m) => m.type === 'ops') as { entries: Array<{ n: number; author: string }>; n: number };
    assert.deepEqual([ops.entries.length, ops.entries[0]!.n, ops.entries[0]!.author, ops.n], [1, 1, 'human', 1]);
    // 2) 延迟写入:日志先到(ops),之后文件落盘不应触发整份快照
    store.commit({ op: 'addNode', id: 'k2', label: 'k2' }, { author: 'fs' }, undefined, { defer: true });
    await waitFor(() => msgs.filter((m) => m.type === 'ops').length === 2);
    const snapsBefore = msgs.filter((m) => m.type === 'snapshot').length;
    store.flush();
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(msgs.filter((m) => m.type === 'snapshot').length, snapsBefore, '文件落盘(rev 追上已投递的 n)不重发快照');
    // 3) 外部直接改了宇宙文件、日志没动(比如 git checkout)→ 才推完整快照
    writeFileSync(store.file, readFileSync(store.file, 'utf8').replace('node k1 "k1"', 'node k1 "被外部改了"'));
    await waitFor(() => msgs.filter((m) => m.type === 'snapshot').length === snapsBefore + 1);
    // 4) 监听器报告的实时信号:合并后单独推送
    srv.pushLive({ size: { k1: 123 }, changed: { k1: 456 } });
    await waitFor(() => msgs.some((m) => m.type === 'signals'));
    assert.deepEqual((msgs.find((m) => m.type === 'signals') as { size: object }).size, { k1: 123 });
  } finally { ctl.abort(); srv.close(); }
});

test('多项目:列目录、打开已有宇宙、在空目录建立宇宙;事件流和接口按 ?p= 路由到各自的项目', async () => {
  const root = mkdtempSync(join(tmpdir(), 'stars-multi-'));
  const a = join(root, 'a'); const b = join(root, 'b'); const c = join(root, 'c');
  for (const d of [a, b, c]) mkdirSync(d);
  writeFileSync(join(c, 'hello.md'), '# hi\n');
  const sa = new Store(join(a, 'universe.stars')); sa.create(genesis);
  const sb = new Store(join(b, 'universe.stars')); sb.create(genesis);
  sb.commit({ op: 'addNode', id: 'only-in-b', label: 'B' }, { author: 't' });
  const port = await freePort();
  const srv = startServer(sa, port, a, '127.0.0.1', () => {});
  const base = `http://127.0.0.1:${port}`;
  const h = { 'x-stars-token': srv.token, 'content-type': 'application/json' };
  const get = async (path: string) => { const r = await fetch(base + path, { headers: h }); return { status: r.status, body: await r.json() as any }; };
  const post = async (path: string, body: unknown) => { const r = await fetch(base + path, { method: 'POST', headers: h, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as any }; };
  const firstEvent = async (path: string) => {
    const ctl = new AbortController();
    const res = await fetch(base + path, { signal: ctl.signal });
    const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
    while (!buf.includes('\n\n')) buf += dec.decode((await reader.read()).value, { stream: true });
    ctl.abort();
    return JSON.parse(buf.slice(6, buf.indexOf('\n\n')));
  };
  try {
    const ls = await get(`/api/ls?dir=${encodeURIComponent(root)}`);
    assert.equal(ls.status, 200);
    assert.deepEqual(ls.body.entries.map((e: { name: string; hasUniverse: boolean }) => [e.name, e.hasUniverse]), [['a', true], ['b', true], ['c', false]], '有宇宙的目录排在前面');
    assert.equal((await get('/api/projects')).body.open.length, 1);

    const pb = await post('/api/open', { dir: b });
    assert.equal(pb.status, 200);
    assert.equal((await post('/api/open', { dir: b })).body.id, pb.body.id, '重复打开得到同一个项目');
    assert.equal((await post('/api/open', { dir: c })).status, 400, '没有宇宙时不会擅自建立');
    const pc = await post('/api/open', { dir: c, create: true });
    assert.equal(pc.status, 200);
    assert.ok(existsSync(join(c, 'universe.stars')), '确认后才建立');

    const snapA = await firstEvent('/events');
    const snapB = await firstEvent(`/events?p=${pb.body.id}`);
    const snapC = await firstEvent(`/events?p=${pc.body.id}`);
    assert.equal(snapA.project.dir, a);
    assert.equal(snapB.project.id, pb.body.id);
    assert.ok(snapB.nodes.some((n: { id: string }) => n.id === 'only-in-b'));
    assert.ok(!snapA.nodes.some((n: { id: string }) => n.id === 'only-in-b'), '项目之间互不串');
    assert.ok(snapC.nodes.some((n: { label: string }) => n.label === 'hello.md'), '新建的宇宙扫描了目录里的文件');

    assert.equal((await post(`/api/op?p=${pb.body.id}`, { op: { op: 'addNode', id: 'via-p', label: 'p' } })).status, 200);
    assert.ok(new Store(join(b, 'universe.stars')).load().nodes.has('via-p'), '写入落到 ?p= 指定的项目');
    assert.ok(!sa.load().nodes.has('via-p'));

    const projects = (await get('/api/projects')).body;
    assert.equal(projects.open.length, 3);
    assert.equal(projects.main, snapA.project.id);
  } finally { srv.close(); }
});
