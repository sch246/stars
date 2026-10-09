import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { parse } from '../src/format.ts';
import { apply } from '../src/ops.ts';
import { listFiles, planScan, statMeta } from '../src/scan.ts';
import { diffUniverses, gitHistory, gitParentSnapshot, gitSnapshot } from '../src/history.ts';
import { startServer } from '../src/serve.ts';
import { exportHtml } from '../src/exporter.ts';
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

  // 差异以"真实的第一父提交"为准(不依赖历史窗口);根提交没有父
  assert.ok(!gitParentSnapshot(file, expCommit.hash)!.nodes.has('exp-node'));
  assert.equal(gitParentSnapshot(file, genesisCommit.hash), null);
  // 窗口:最多 limit 个,more 表示更早的还有
  const two = gitHistory(file, 2);
  assert.deepEqual([two.commits.length, two.more], [2, true]);
  assert.equal(gitHistory(file).more, false);
  // 没动过宇宙文件的分支与合并不出现在图里(否则真实仓库里会被无关的合并线淹没)
  sh(dir, 'checkout', '-qb', 'docs');
  writeFileSync(join(dir, 'README.md'), 'x\n'); sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'docs only');
  sh(dir, 'checkout', '-q', 'main'); sh(dir, 'merge', '-q', '--no-ff', '-m', 'merge docs', 'docs');
  const after = gitHistory(file);
  assert.equal(after.commits.length, 4, '无关的提交与合并被简化掉');
  assert.equal(after.head, commits[0]!.hash, 'head = HEAD 上最近一次改动宇宙文件的提交');
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

test('文件:在查看器里读写项目文件 —— 出不了项目目录、存储只读、并发修改报 409、CRLF 保持、图片走 raw', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-file-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'win.txt'), 'l1\r\nl2\r\n');
  writeFileSync(join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
  writeFileSync(join(dir, 'blob.bin'), Buffer.from([1, 2, 0, 3]));
  const store = new Store(join(dir, 'universe.stars')); store.create(genesis);
  const port = await freePort();
  const srv = startServer(store, port, dir, '127.0.0.1', () => {});
  const base = `http://127.0.0.1:${port}`;
  const h = { 'x-stars-token': srv.token, 'content-type': 'application/json' };
  const get = async (path: string) => { const r = await fetch(base + path, { headers: h }); return { status: r.status, body: await r.json() as any }; };
  const save = async (body: unknown) => { const r = await fetch(base + '/api/file', { method: 'POST', headers: h, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() as any }; };
  try {
    // 轻量打开:head 只给开头一段,切在换行处;超过 2 MB 的文本也能预览开头,但不能编辑
    writeFileSync(join(dir, 'long.txt'), Array.from({ length: 400 }, (_, i) => `第 ${i} 行`).join('\n') + '\n');
    const head = await get('/api/file?path=long.txt&head=100');
    assert.equal(head.body.partial, true);
    assert.ok(head.body.content.endsWith('\n') && Buffer.byteLength(head.body.content) <= 100 && head.body.content.startsWith('第 0 行\n'));
    assert.equal((await get('/api/file?path=long.txt')).body.partial, undefined, '不带 head 给全文');
    writeFileSync(join(dir, 'huge.log'), 'x'.repeat(3 << 20));
    const huge = await get('/api/file?path=huge.log&head=1000');
    assert.deepEqual([huge.body.kind, huge.body.partial, huge.body.editable, huge.body.content.length], ['text', true, false, 1000]);
    assert.equal((await get('/api/file?path=huge.log')).body.kind, 'large');

    const a = await get('/api/file?path=src/a.ts');
    assert.deepEqual([a.status, a.body.kind, a.body.content, a.body.readonly, a.body.editable], [200, 'text', 'export const a = 1;\n', false, true]);
    assert.equal((await get('/api/file?path=../etc/passwd')).status, 400, '出不了项目目录');
    assert.equal((await get('/api/file?path=blob.bin')).body.kind, 'binary');
    assert.equal((await get('/api/file?path=pic.png')).body.kind, 'image');
    assert.equal((await get('/api/file?path=universe.stars')).body.readonly, true, '宇宙文件可以看,不能在这里改');
    assert.equal((await save({ path: 'universe.stars', content: 'x', mtime: null })).status, 400);

    const ok = await save({ path: 'src/a.ts', content: 'export const a = 2;\n', mtime: a.body.mtime });
    assert.equal(ok.status, 200);
    assert.equal(readFileSync(join(dir, 'src/a.ts'), 'utf8'), 'export const a = 2;\n');
    // 别处改了文件 → 用旧的修改时间保存会被拒绝;带 mtime: null 表示"用我的覆盖"
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(join(dir, 'src/a.ts'), 'export const a = 3; // 别处改的\n');
    const conflict = await save({ path: 'src/a.ts', content: 'export const a = 4;\n', mtime: ok.body.mtime });
    assert.equal(conflict.status, 409);
    assert.equal(readFileSync(join(dir, 'src/a.ts'), 'utf8'), 'export const a = 3; // 别处改的\n', '冲突时不写');
    assert.equal((await save({ path: 'src/a.ts', content: 'export const a = 4;\n', mtime: null })).status, 200);

    const w = await get('/api/file?path=win.txt');
    await save({ path: 'win.txt', content: w.body.content.replace(/\r\n/g, '\n').replace('l2', 'L2'), mtime: w.body.mtime });
    assert.equal(readFileSync(join(dir, 'win.txt'), 'utf8'), 'l1\r\nL2\r\n', 'CRLF 文件保存后仍是 CRLF');

    assert.equal((await fetch(`${base}/api/raw?path=pic.png`)).status, 403, 'raw 也要 token');
    const img = await fetch(`${base}/api/raw?path=pic.png&t=${srv.token}`);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${base}/api/raw?path=src/a.ts&t=${srv.token}`)).status, 415, 'raw 只给图片');
  } finally { srv.close(); }
});

test('历史:宇宙文件还没提交过时,时间线退回到所在文件夹的 git 历史,每个提交的宇宙由那时的文件树长出来', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-repo-hist-'));
  sh(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.md'), '# a\n');
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'first');
  mkdirSync(join(dir, 'src')); writeFileSync(join(dir, 'src/b.ts'), 'export {};\n');
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'second');
  // 宇宙是后来才建的(没提交):扫描 + 一条语义关系
  const store = new Store(join(dir, 'universe.stars')); store.create(genesis);
  const u = store.load();
  apply(u, planScan(u, listFiles(dir, 'universe.stars'), 'repo', 'proj', statMeta(dir)));
  store.save(u);
  store.commit({ op: 'addNode', id: 'idea', label: '想法' }, { author: 't' });
  store.commit({ op: 'addEdge', from: 'idea', type: 'describes', to: 'a.md' }, { author: 't' });
  const port = await freePort();
  const srv = startServer(store, port, dir, '127.0.0.1', () => {});
  const get = async (path: string) => (await (await fetch(`http://127.0.0.1:${port}${path}`, { headers: { 'x-stars-token': srv.token } })).json()) as any;
  try {
    assert.equal((await get('/api/history?scope=file')).commits.length, 0, '宇宙文件自己没有历史');
    const h = await get('/api/history?scope=auto');
    assert.equal(h.scope, 'repo');
    assert.deepEqual(h.commits.map((c: { subject: string }) => c.subject), ['second', 'first']);
    assert.equal(h.dirty, false, '宇宙文件自己的改动不算"工作区有改动"');
    const first = await get(`/api/state?scope=repo&commit=${h.commits[1].hash}`);
    const ids = (s: { nodes: Array<{ id: string }> }) => s.nodes.map((n) => n.id);
    assert.ok(ids(first).includes('a.md') && !ids(first).includes('src/b.ts'), '第一个提交时还没有 src/b.ts');
    assert.ok(first.edges.some((e: { from: string; to: string }) => e.from === 'idea' && e.to === 'a.md'), '现在的语义关系挂在那时也存在的文件上');
    assert.deepEqual(first.diff.removedNodes, []);
    const second = await get(`/api/state?scope=repo&commit=${h.commits[0].hash}`);
    assert.deepEqual(second.diff.addedNodes.sort(), ['src/', 'src/b.ts']);
    assert.ok(!ids(second).some((id: string) => id.includes('universe.stars')), '宇宙自己的存储不算居民');
  } finally { srv.close(); }
});

test('共享模块:浏览器拿到的 /core/*.js 去掉了类型、能直接 import;静态导出把它们拼进同一个作用域后脚本仍然合法', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-mod-'));
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  const port = await freePort();
  const srv = startServer(store, port, dir, '127.0.0.1', () => {});
  await new Promise((r) => setTimeout(r, 150));
  const out = mkdtempSync(join(tmpdir(), 'stars-js-'));
  try {
    for (const name of ['model', 'expr', 'view', 'ops', 'proposals', 'query', 'llf']) {
      const r = await fetch(`http://127.0.0.1:${port}/core/${name}.js`);
      assert.equal(r.status, 200, name);
      const js = await r.text();
      assert.ok(!/from '\.\/\w+\.ts'/.test(js) && !/from 'node:/.test(js), `${name}.js 不能再引用 .ts 或 node:*`);
      writeFileSync(join(out, `${name}.js`), js);
    }
    writeFileSync(join(out, 'package.json'), '{"type":"module"}');
    const llf = await import(pathToFileURL(join(out, 'llf.js')).href);
    assert.deepEqual(llf.llfToJson(llf.llfParse('a !color - #fff\n--LLF-END\n', { tags: true })), { a: { $tag: 'color', $value: '#fff' } });
    const q = await import(pathToFileURL(join(out, 'query.js')).href);
    assert.equal(typeof q.shortestPath, 'function');
  } finally { srv.close(); }
  // 静态导出:内核模块去掉 import/export 后拼进查看器的模块脚本;名字撞了或语法坏了这里会报
  const html = exportHtml(store, dir);
  const mod = /<script type="module">([\s\S]*?)<\/script>/.exec(html)![1]!;
  const file = join(out, 'export-check.mjs');
  writeFileSync(file, mod);
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
});

/** 读 SSE:把收到的具名事件交给 onEvent;返回关闭函数 */
function sse(port: number, onEvent: (event: string, data: unknown) => void): () => void {
  let buf = '';
  const req = request({ host: '127.0.0.1', port, path: '/events' }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(block)?.[1] ?? 'message', data = /^data: (.*)$/m.exec(block)?.[1];
        if (data !== undefined) onEvent(ev, JSON.parse(data));
      }
    });
  });
  req.on('error', () => {});
  req.end();
  return () => req.destroy();
}

test('个人配置:设置 / 快捷键是 ~/.config/stars 下的 LLF 文件 —— 页面内嵌默认值与个人文件,写入带 409,不合法拒收,别处改了推给页面', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-cfgsrv-'));
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  const port = await freePort();
  const srv = startServer(store, port, dir, '127.0.0.1', () => {});
  await new Promise((r) => setTimeout(r, 150));
  const base = `http://127.0.0.1:${port}`, H = { 'x-stars-token': srv.token, 'content-type': 'application/json' };
  const cfgFile = join(process.env.XDG_CONFIG_HOME!, 'stars', 'settings.llf');
  const events: Array<[string, unknown]> = [];
  const stop = sse(port, (e, d) => events.push([e, d]));
  try {
    const page = await (await fetch(`${base}/`)).text();
    const cfg = JSON.parse(/<script type="application\/json" id="stars-config">([\s\S]*?)<\/script>/.exec(page)![1]!) as { defaults: Record<string, string> };
    assert.match(cfg.defaults.settings!, /heatLevel !range\(/, '页面里内嵌了带标签的默认设置');
    assert.match(cfg.defaults.keys!, /ctrl\+k - palette/);
    const get = async () => (await fetch(`${base}/api/config?name=settings`, { headers: H })).json() as Promise<{ content: string | null; mtime: number | null }>;
    const before = await get();
    const post = (content: string, mtime: number | null) => fetch(`${base}/api/config`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'settings', content, mtime }) });
    const r1 = await post('motion {}\n  heatLevel - 0.05\n--LLF-END\n', before.mtime);
    assert.equal(r1.status, 200);
    const { mtime } = await r1.json() as { mtime: number };
    assert.equal(readFileSync(cfgFile, 'utf8'), 'motion {}\n  heatLevel - 0.05\n--LLF-END\n');
    assert.equal((await post('motion {}\n  heatLevel - 0.06\n--LLF-END\n', mtime - 5000)).status, 409, '读到之后别处改过 → 409');
    assert.equal((await post('motion {\n--LLF-END\n', mtime)).status, 400, '不合法的 LLF 不写');
    assert.equal((await fetch(`${base}/api/config`, { method: 'POST', headers: H, body: JSON.stringify({ name: '../x', content: '--LLF-END\n' }) })).status, 400);
    // 在别处改(编辑器):推给页面
    writeFileSync(cfgFile, 'motion {}\n  spin - 2\n--LLF-END\n');
    for (let i = 0; i < 40 && !events.some(([e, d]) => e === 'config' && (d as { content: string }).content.includes('spin - 2')); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(events.some(([e, d]) => e === 'config' && (d as { name: string }).name === 'settings' && (d as { content: string }).content.includes('spin - 2')), '页面收到 config 事件');
  } finally { stop(); srv.close(); }
});

test('遥控:stars ui 找到正在运行的服务,命令推给页面执行,页面回报的输出交回 CLI;服务关了登记也删掉', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-ui-'));
  const file = join(dir, 'universe.stars');
  const store = new Store(file);
  store.create(genesis);
  const port = await freePort();
  const srv = startServer(store, port, dir, '127.0.0.1', () => {});
  await new Promise((r) => setTimeout(r, 150));
  const reg = join(process.env.XDG_CONFIG_HOME!, 'stars', 'servers', `${port}.json`);
  const cli = (...args: string[]) => new Promise<{ code: number | null; out: string; err: string }>((ok) => {
    execFile(process.execPath, [new URL('../src/cli.ts', import.meta.url).pathname, '-f', file, 'ui', ...args], { env: process.env }, (e, out, err) => ok({ code: e ? (e as { code?: number }).code ?? 1 : 0, out, err }));
  });
  try {
    assert.ok(existsSync(reg), '服务登记在 servers/<端口>.json');
    assert.equal(statSync(reg).mode & 0o777, 0o600, '含 token,只有自己能读');
    assert.match((await cli('fit')).err, /没有打开着的查看器页面/);
    // 假装是一个页面:收到 ui 事件就回报
    const got: string[] = [];
    const stop = sse(port, (e, d) => {
      if (e !== 'ui') return;
      const m = d as { id: string; line: string; from: string };
      got.push(`${m.line} ← ${m.from}`);
      const result = m.line === 'nope' ? { ok: false, error: '没有这个命令:nope' } : { ok: true, out: `做了 ${m.line}` };
      void fetch(`http://127.0.0.1:${port}/api/ui-result`, { method: 'POST', headers: { 'x-stars-token': srv.token, 'content-type': 'application/json' }, body: JSON.stringify({ id: m.id, ...result }) });
    });
    await new Promise((r) => setTimeout(r, 100));
    try {
      const a = await cli('select', 'a b');
      assert.equal(a.code, 0); assert.equal(a.out.trim(), '做了 select "a b"', '多个参数按需加引号拼回一行');
      const bad = await cli('nope');
      assert.equal(bad.code, 1); assert.match(bad.err, /没有这个命令/);
      assert.deepEqual(got, ['select "a b" ← human', 'nope ← human']);
    } finally { stop(); }
  } finally { srv.close(); }
  assert.ok(!existsSync(reg), '关掉服务后登记删除');
});
