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
import { loadSignals } from './activity.ts';
import { diffUniverses, gitHistory, gitSnapshot } from './history.ts';
import { lint } from './lint.ts';
import { StarsError } from './model.ts';
import { type Op } from './ops.ts';
import { type Store } from './store.ts';

const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = resolve(here, '..', 'viewer');

/** 浏览器能直接 import 的共享模块(只有这两个,且都不依赖 Node)。 */
const SHARED = new Set(['model', 'view']);

function sharedModule(name: string): string {
  const ts = readFileSync(resolve(here, `${name}.ts`), 'utf8');
  return stripTypeScriptTypes(ts).replace(/from '\.\/(\w+)\.ts'/g, "from './$1.js'");
}

function snapshot(store: Store, baseDir: string): string {
  try {
    const u = store.load();
    const log = store.readLog();
    return JSON.stringify({
      t: Date.now(),
      nodes: [...u.nodes.values()],
      edges: [...u.edges.values()],
      issues: lint(u, { baseDir }),
      log: log.slice(-60),
      signals: loadSignals(log, u, baseDir),
    });
  } catch (err) {
    return JSON.stringify({ t: Date.now(), error: (err as Error).message });
  }
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

export function startServer(
  store: Store, port: number, baseDir: string, host = '127.0.0.1', log: (message: string) => void = console.log,
): { token: string; close: () => void } {
  const token = randomBytes(16).toString('hex');
  const clients = new Set<ServerResponse>();
  process.removeAllListeners('warning'); // stripTypeScriptTypes 的实验性提示对用户是噪音

  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (host !== '0.0.0.0' && host !== '::') allowedHosts.add(host);
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
    if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: '跨源请求被拒绝' });
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
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${snapshot(store, baseDir)}\n\n`);
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

  // 监听目录而不是文件:原子保存(写临时文件再 rename)会让文件级监听失效
  let timer: NodeJS.Timeout | undefined;
  const target = basename(store.file);
  const watcher = watch(dirname(store.file), (_event, name) => {
    if (name !== target && name !== basename(store.logFile)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const payload = `data: ${snapshot(store, baseDir)}\n\n`;
      for (const c of clients) c.write(payload);
    }, 40);
  });

  server.listen(port, host, () => {
    log(`宇宙查看器: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}   (监听 ${store.file})`);
    if (host === '0.0.0.0' || host === '::') log('警告:监听了所有网卡,局域网内的人都能访问这个宇宙;写入接口仍受 token 保护。');
  });
  return { token, close: () => { watcher.close(); for (const c of clients) c.end(); server.close(); } };
}
