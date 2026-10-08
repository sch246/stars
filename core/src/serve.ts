// 实时查看器的服务端:监听宇宙文件,变化时通过 SSE 推给浏览器。零依赖。
// 视图的计算在浏览器里做(同一份 model.ts / view.ts,去掉类型后原样提供),
// 所以展开/收起不需要和服务端往返,CLI 与查看器永远是同一套逻辑。
//
// 安全:默认只监听 127.0.0.1;所有请求校验 Host(防 DNS 重绑定);
// 会修改宇宙的 /api/* 还要求页面里内嵌的一次性 token(随机,每次启动不同)。
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, watch } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffUniverses, gitHistory, gitSnapshot } from './history.ts';
import { StarsError } from './model.ts';
import { type Op } from './ops.ts';
import { buildSnapshot } from './snapshot.ts';
import { invalidateSignals, loadSignals, type LiveSignals } from './activity.ts';
import { lint } from './lint.ts';
import { fileSig, type Store } from './store.ts';

const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = resolve(here, '..', 'viewer');

/** 浏览器能直接 import 的共享模块(都不依赖 Node)。 */
const SHARED = new Set(['model', 'view', 'expr', 'ops', 'proposals']);

function sharedModule(name: string): string {
  const ts = readFileSync(resolve(here, `${name}.ts`), 'utf8');
  return stripTypeScriptTypes(ts).replace(/from '\.\/(\w+)\.ts'/g, "from './$1.js'");
}

const OPS = new Set(['addNode', 'setNode', 'removeNode', 'addEdge', 'setEdge', 'removeEdge', 'batch']);

function readBody(req: IncomingMessage, limit = 1 << 20): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { fail(new StarsError('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

export interface ServerHandle {
  token: string;
  close: () => void;
  /** 监听器报告了文件的实时状态(大小/修改时间):合并并推给所有查看器 */
  pushLive: (live: LiveSignals) => void;
  /** git 提交/切分支:git 派生的"最近修改"信号需要刷新 */
  gitChanged: () => void;
  /** 有监听器在维护 missing 标记,issues 不必再逐个 stat 文件 */
  setWatching: (on: boolean) => void;
}

export function startServer(
  store: Store, port: number, baseDir: string, host = '127.0.0.1', log: (message: string) => void = console.log,
  extraHosts: string[] = [],
): ServerHandle {
  const token = randomBytes(16).toString('hex');
  const clients = new Set<ServerResponse>();
  const live: LiveSignals = { size: {}, changed: {} };
  let watching = false;
  let logOffset = store.exists() ? store.readLogSince(0).offset : 0;
  let lastSig = fileSig(store.file);
  let delivered = store.logCount();   // 已经投递给查看器的最后一条日志序号
  const send = (obj: unknown) => { const line = `data: ${JSON.stringify(obj)}\n\n`; for (const c of clients) c.write(line); };
  const snapshotLine = (): string => {
    try { return JSON.stringify(buildSnapshot(store, baseDir, live, { skipFileStat: watching })); }
    catch (err) { return JSON.stringify({ type: 'snapshot', t: Date.now(), error: (err as Error).message }); }
  };
  process.removeAllListeners('warning'); // stripTypeScriptTypes 的实验性提示对用户是噪音

  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (host !== '0.0.0.0' && host !== '::') allowedHosts.add(host);
  for (const h of extraHosts) allowedHosts.add(h.replace(/:\d+$/, '')); // 反向代理转发过来的主机名
  const hostOk = (req: IncomingMessage): boolean => {
    const h = (req.headers.host ?? '').replace(/:\d+$/, '');
    // 监听所有网卡时无法枚举合法主机名,只能退而求其次靠 token(并在启动时警告)
    return host === '0.0.0.0' || host === '::' || allowedHosts.has(h);
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const api = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (req.headers['x-stars-token'] !== token) return json(res, 403, { error: '缺少或错误的 token' });
    const origin = req.headers.origin;
    if (origin) { // 同源,或来自明确信任的主机名(反向代理时 Origin 是代理的域名)
      const o = new URL(origin);
      if (o.host !== req.headers.host && !allowedHosts.has(o.hostname)) return json(res, 403, { error: '跨源请求被拒绝' });
    }
    try {
      if (req.method === 'GET' && url.pathname === '/api/history') {
        const h = gitHistory(store.file);
        return json(res, 200, h);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const hash = url.searchParams.get('commit') ?? '';
        const snap = gitSnapshot(store.file, hash);
        const parent = gitHistory(store.file).commits.find((c) => c.hash === hash)?.parents[0];
        const diff = diffUniverses(parent ? gitSnapshot(store.file, parent) : null, snap);
        return json(res, 200, { nodes: [...snap.nodes.values()], edges: [...snap.edges.values()], diff });
      }
      if (req.method === 'POST' && (url.pathname === '/api/op' || url.pathname === '/api/undo')) {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: '需要 application/json' });
        const body = JSON.parse(await readBody(req) || '{}') as { op?: Op; author?: string };
        const author = typeof body.author === 'string' && body.author.trim() ? body.author.trim().slice(0, 40) : 'viewer';
        if (url.pathname === '/api/undo') return json(res, 200, { ok: true, n: store.undo({ author }).n });
        if (!body.op || typeof body.op !== 'object' || !OPS.has((body.op as { op: string }).op)) return json(res, 400, { error: '无效的操作' });
        return json(res, 200, { ok: true, n: store.commit(body.op, { author }).entry.n });
      }
      return json(res, 404, { error: 'not found' });
    } catch (err) {
      const known = err instanceof StarsError || err instanceof SyntaxError;
      return json(res, known ? 400 : 500, { error: (err as Error).message });
    }
  };

  const server = createServer((req, res) => {
    if (!hostOk(req)) { res.writeHead(403).end('forbidden host'); return; }
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    if (path.startsWith('/api/')) { void api(req, res, url); return; }
    if (path === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' }); // 最后一项让 nginx 不要缓冲事件流
      res.write(`data: ${snapshotLine()}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const mod = /^\/core\/(\w+)\.js$/.exec(path);
    if (mod && SHARED.has(mod[1]!)) {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
      res.end(sharedModule(mod[1]!));
      return;
    }
    if (path === '/') {
      const html = readFileSync(resolve(viewerDir, 'index.html'), 'utf8').replace('__STARS_TOKEN__', token);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    if (path === '/d3.js' && existsSync(resolve(viewerDir, 'd3.v7.min.js'))) {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
      res.end(readFileSync(resolve(viewerDir, 'd3.v7.min.js')));
      return;
    }
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    res.writeHead(404).end('not found');
  });

  // ---------- 增量推送 ----------
  // 宇宙文件或日志变了:优先把"新追加的日志条目"推给查看器(浏览器本地 apply),
  // 只有日志没动、宇宙文件却变了(git 切分支、手改文件),才推整份快照。
  let issueTimer: NodeJS.Timeout | undefined;
  const scheduleIssues = () => {
    if (issueTimer) return;
    issueTimer = setTimeout(() => {
      issueTimer = undefined;
      try { send({ type: 'issues', issues: lint(store.peek(), { baseDir, skipFileStat: watching }) }); } catch { /* 文件正被写 */ }
    }, 1500);
  };
  const onFiles = () => {
    try {
      const r = store.readLogSince(logOffset);
      logOffset = r.offset;
      const sig = fileSig(store.file);
      if (r.reset) { lastSig = sig; delivered = store.logCount(); send(JSON.parse(snapshotLine())); return; }
      if (r.entries.length > 0) {
        lastSig = sig;
        delivered = r.entries[r.entries.length - 1]!.n;
        send({ type: 'ops', entries: r.entries, n: delivered });
        scheduleIssues();
        return;
      }
      if (sig !== lastSig) {
        lastSig = sig;
        if (store.readWrittenSig() === sig) return; // 是 Store 自己写的(延迟落盘),内容查看器早就通过日志拿到了
        delivered = store.logCount();
        send(JSON.parse(snapshotLine()));
      }
    } catch { send(JSON.parse(snapshotLine())); }
  };

  let timer: NodeJS.Timeout | undefined;
  const target = basename(store.file);
  const watcher = watch(dirname(store.file), (_event, name) => {
    if (name !== target && name !== basename(store.logFile)) return; // .sig 旁路文件的变化不关心
    clearTimeout(timer);
    timer = setTimeout(onFiles, 40); // 提交是"先写文件、再追加日志",合并到同一次处理
  });

  // ---------- 实时信号(文件大小/修改时间)----------
  let pending: LiveSignals | null = null, liveTimer: NodeJS.Timeout | undefined;
  const flushLive = () => { liveTimer = undefined; if (pending) { send({ type: 'signals', ...pending }); pending = null; } };
  const pushLive = (l: LiveSignals) => {
    if (Object.keys(l.size).length + Object.keys(l.changed).length === 0) return;
    Object.assign(live.size, l.size); Object.assign(live.changed, l.changed);
    pending ??= { size: {}, changed: {} };
    Object.assign(pending.size, l.size); Object.assign(pending.changed, l.changed);
    liveTimer ??= setTimeout(flushLive, 100);
  };
  let gitTimer: NodeJS.Timeout | undefined;
  const gitChanged = () => {
    invalidateSignals(baseDir);
    clearTimeout(gitTimer);
    gitTimer = setTimeout(() => { // 取一次完整的 fileChanged,让查看器整体替换
      try { send({ type: 'signals', replace: true, ...loadSignals(store.readLog(), store.peek(), baseDir, 0, live) }); } catch { /* ignore */ }
    }, 300);
  };

  // 反向代理/负载均衡常在连接空闲 30~60 秒后断开,定期发一条注释行保活
  const keepalive = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20_000);
  keepalive.unref();

  server.listen(port, host, () => {
    log(`宇宙查看器: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}   (监听 ${store.file})`);
    if (host === '0.0.0.0' || host === '::') log('警告:监听了所有网卡,局域网内的人都能访问这个宇宙;写入接口仍受 token 保护。');
  });
  return {
    token,
    close: () => { clearInterval(keepalive); clearTimeout(timer); clearTimeout(issueTimer); clearTimeout(liveTimer); clearTimeout(gitTimer); watcher.close(); for (const c of clients) c.end(); server.close(); },
    pushLive, gitChanged, setWatching: (on) => { watching = on; },
  };
}
