// 实时查看器的服务端:监听宇宙文件,变化时通过 SSE 推给浏览器。零依赖。
// 视图的计算在浏览器里做(同一份 model.ts / view*.ts,去掉类型后原样提供),
// 所以展开/收起不需要和服务端往返,CLI 与查看器永远是同一套逻辑。
//
// 一个服务可以同时开多个项目(每个项目 = 一个目录里的 universe.stars),查看器里随时切换,
// 也可以浏览服务器上的目录、在没有宇宙的目录里一键建立(init + scan)。
//
// 安全:默认只监听 127.0.0.1;所有请求校验 Host(防 DNS 重绑定);
// /api/* 要求页面里内嵌的一次性 token(随机,每次启动不同),并拒绝跨源请求。
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, relative, resolve } from 'node:path';
import { type LiveSignals } from './activity.ts';
import { handleApi, type HttpCtx } from './api.ts';
import { bridgeInject, bridgeNonceOk, bridgeShim, bridgeStorageShim } from './bridge.ts';
import { pageConfig, registerServer, unregisterServer } from './config.ts';
import { PREVIEW_TYPES, resolveInside } from './files.ts';
import { StarsError } from './model.ts';
import { browserModule, isBrowserModule, isTsModule, stripTs, viewerDir, viewerHtml } from './page.ts';
import { createHub, type HubOptions } from './hub.ts';
import { type Project, type Subscriber } from './project.ts';
import { type Store } from './store.ts';

export type ServerOptions = HubOptions;

/** SSE:一个浏览器连接就是一个订阅者('message' 不带 event 行,和以前一样) */
const sseSubscriber = (res: ServerResponse): Subscriber => ({
  push: (event, data) => { res.write(`${event === 'message' ? '' : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`); },
  end: () => res.end(),
});

export interface ServerHandle {
  token: string;
  /** 只用于 /preview 的 token:预览页能从自己的地址读到它,所以它什么也写不了 */
  previewToken: string;
  close: () => void;
  /** 下面三个作用于启动时的主项目(其它项目在服务内部各自管理) */
  pushLive: (live: LiveSignals) => void;
  gitChanged: () => void;
  setWatching: (on: boolean) => void;
  /** 打开(或在 create 时建立)一个目录里的宇宙,返回项目 id */
  open: (dir: string, create?: boolean) => string;
}

export function startServer(
  store: Store, port: number, baseDir: string, host = '127.0.0.1', log: (message: string) => void = console.log,
  extraHosts: string[] = [], options: ServerOptions = {},
): ServerHandle {
  const token = randomBytes(16).toString('hex');
  const previewToken = randomBytes(16).toString('hex');
  process.removeAllListeners('warning'); // stripTypeScriptTypes 的实验性提示对用户是噪音
  const hub = createHub(store, baseDir, log, options);
  const { projects, main } = hub;

  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (host !== '0.0.0.0' && host !== '::') allowedHosts.add(host);
  for (const h of extraHosts) allowedHosts.add(h.replace(/:\d+$/, '')); // 反向代理转发过来的主机名
  const hostOk = (req: IncomingMessage): boolean => {
    const h = (req.headers.host ?? '').replace(/:\d+$/, '');
    // 监听所有网卡时无法枚举合法主机名,只能退而求其次靠 token(并在启动时警告)
    return host === '0.0.0.0' || host === '::' || allowedHosts.has(h);
  };

  const ctx: HttpCtx = { hub, token, allowedHosts };
  const sse = new Set<ServerResponse>();   // 打开着的事件流(保活用)
  const projectOf = (url: URL): Project => projects.get(url.searchParams.get('p') ?? '') ?? main;

  const server = createServer((req, res) => {
    if (!hostOk(req)) { res.writeHead(403).end('forbidden host'); return; }
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    if (path.startsWith('/api/')) { void handleApi(req, res, url, ctx); return; }
    if (path === '/events') {
      const proj = projectOf(url);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' }); // 最后一项让 nginx 不要缓冲事件流
      const off = hub.subscribe(sseSubscriber(res), proj.id);   // 先发一份完整快照,之后是增量
      sse.add(res);
      req.on('close', () => { off(); sse.delete(res); });
      return;
    }
    // 预览(侧栏的 HTML 预览、新标签页打开):/preview/<预览 token>/<项目 id 或 _>/<路径>。iframe 带不了请求头,token 放在路径里,
    // 页面里的相对路径(css / js / 图片)自然落在同一个前缀下。预览 token 和 /api 的 token 是两个:页面能从自己的地址读到它,
    // 但它只能读项目里的文件。HTML / SVG 带 CSP sandbox:就算在新标签页里直接打开也是不同源的,碰不到查看器;
    // 允许跨源读(预览里的脚本 fetch 同目录的 json)。HTML 里垫上 localStorage 等的替身;?bridge=<暗号>:再注入 window.stars(页面桥,见 bridge.ts)。
    // 视图脚本从 /preview/…/~v<版本>/<路径> 加载:版本那一段只是让浏览器换个地址重新加载整串模块,这里去掉。
    // .ts / .mts 去掉类型再给(浏览器只认 JS);去不掉(enum 这类)就给一个抛出原因的模块,import() 的报错里看得到
    const pv = /^\/preview\/([0-9a-f]+)\/([0-9a-f]+|_)\/(?:~v[0-9a-f]+\/)?(.*)$/.exec(path);
    if (pv) {
      const proj = pv[2] === '_' ? main : projects.get(pv[2]!);
      if (pv[1] !== previewToken) { res.writeHead(403).end('forbidden'); return; }
      if (!proj) { res.writeHead(404).end('没有这个项目'); return; }
      try {
        let abs = resolveInside(proj.baseDir, decodeURIComponent(pv[3]!));
        if (/(^|[\\/])\.git([\\/]|$)/.test(relative(proj.baseDir, abs))) throw new StarsError('.git 不提供');
        if (statSync(abs).isDirectory()) abs = join(abs, 'index.html');
        const ts = isTsModule(abs);
        const type = ts ? 'text/javascript; charset=utf-8' : PREVIEW_TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream';
        const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'no-cache', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
        if (ts) {
          let js: string;
          try { js = stripTs(readFileSync(abs, 'utf8')); } catch (err) { js = `throw new SyntaxError(${JSON.stringify(`${pv[3]}: ${(err as Error).message}`)});\n`; }
          res.writeHead(200, headers).end(js);
          return;
        }
        if (/html|svg|xml/.test(type)) headers['content-security-policy'] = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox';
        const body = readFileSync(abs), nonce = url.searchParams.get('bridge');
        // HTML 都垫上存储的替身(沙箱里没有 localStorage,很多页面一读就整段脚本挂掉,见 bridgeStorageShim)
        res.writeHead(200, headers).end(type.startsWith('text/html') ? bridgeInject(body.toString('utf8'), bridgeStorageShim() + (bridgeNonceOk(nonce) ? bridgeShim(nonce) : '')) : body);
      } catch { res.writeHead(404).end('not found'); }
      return;
    }
    const mod = /^\/core\/(\w+)\.js$/.exec(path);
    if (mod && isBrowserModule(mod[1]!)) {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
      res.end(browserModule(mod[1]!));
      return;
    }
    if (path === '/') {
      const html = viewerHtml().replace('__STARS_TOKEN__', token).replace('__STARS_PREVIEW__', previewToken)
        .replace('__STARS_CONFIG__', () => pageConfig(true));
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

  let listening = 0;
  const onExit = () => { if (listening) unregisterServer(listening); };
  process.once('exit', onExit);

  // 反向代理/负载均衡常在连接空闲 30~60 秒后断开,定期发一条注释行保活
  const keepalive = setInterval(() => { for (const r of sse) r.write(': ping\n\n'); }, 20_000);
  keepalive.unref();

  server.listen(port, host, () => {
    const real = (server.address() as { port: number } | null)?.port ?? port;
    registerServer({ port: real, host, token, pid: process.pid, file: resolve(store.file), dir: resolve(baseDir), started: Date.now() });
    listening = real;
    log(`宇宙查看器: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}   (监听 ${store.file})`);
    if (host === '0.0.0.0' || host === '::') log('警告:监听了所有网卡,局域网内的人都能访问这个宇宙;写入接口仍受 token 保护。');
  });
  return {
    token,
    previewToken,
    close: () => {
      clearInterval(keepalive);
      onExit(); process.off('exit', onExit);
      hub.close();
      server.close();
    },
    pushLive: (l) => main.pushLive(l),
    gitChanged: () => main.gitChanged(),
    setWatching: (on) => { main.watching = on; },
    open: (dir, create) => hub.openProject(dir, create).id,
  };
}
