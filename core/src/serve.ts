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
import { existsSync, mkdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { basename, extname, join, relative, resolve } from 'node:path';
import { type LiveSignals } from './activity.ts';
import { handleApi, type ServerCtx } from './api.ts';
import { bridgeInject, bridgeNonceOk, bridgeShim } from './bridge.ts';
import { configDir, isConfigName, pageConfig, readUserConfig, registerServer, unregisterServer } from './config.ts';
import { PREVIEW_TYPES, resolveInside } from './files.ts';
import { StarsError } from './model.ts';
import { apply } from './ops.ts';
import { browserModule, isBrowserModule, viewerDir, viewerHtml } from './page.ts';
import { expandHome, Project, projectId, rememberRecent } from './project.ts';
import { listFiles, planScan, statMeta } from './scan.ts';
import { Store } from './store.ts';

const genesisFile = resolve(viewerDir, '..', 'genesis.stars');

export interface ServerOptions {
  /** 每个打开的项目都实时同步文件系统(serve --watch) */
  watch?: boolean;
  mountId?: string;
  debounceMs?: number;
  pollSec?: number;
  /** 按触发跑脚本节点(默认开;false = 只能手动跑) */
  agent?: boolean;
}

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
  const genesis = readFileSync(genesisFile, 'utf8');

  const projects = new Map<string, Project>();
  const main = new Project(store, baseDir);
  main.primary = true;
  projects.set(main.id, main);
  const mountId = options.mountId ?? 'repo';
  if (options.watch) main.startWatch(mountId, log, options);
  if (options.agent !== false) main.startAgent(log);

  const openProject = (dir: string, create = false): Project => {
    const abs = resolve(expandHome(dir));
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new StarsError(`不是目录: ${abs}`);
    const file = join(abs, 'universe.stars');
    const id = projectId(file);
    const existing = projects.get(id);
    if (existing) return existing;
    if (!existsSync(file)) {
      if (!create) throw new StarsError('这个目录里还没有 universe.stars(可以选择"在这里建立宇宙")');
      const st = new Store(file);
      st.create(genesis);
      const u = st.load();
      apply(u, planScan(u, listFiles(abs, 'universe.stars'), mountId, basename(abs), statMeta(abs)));
      st.save(u);
      log(`在 ${abs} 建立了宇宙(扫描 ${u.nodes.size} 个节点)`);
    }
    const p = new Project(new Store(file), abs);
    projects.set(p.id, p);
    if (options.watch) p.startWatch(mountId, log, options);
    if (options.agent !== false) p.startAgent(log);
    rememberRecent(abs);
    return p;
  };
  rememberRecent(baseDir);

  /** 推给所有打开着的查看器页面(或指定项目的):SSE 的具名事件,和宇宙的增量消息走同一条连接 */
  const broadcast = (event: string, obj: unknown, only?: Project[]): number => {
    const line = `event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`;
    let n = 0;
    for (const p of only ?? projects.values()) for (const c of p.clients) { c.write(line); n++; }
    return n;
  };

  // 个人配置(设置、快捷键)在别处被改了(编辑器、另一个标签页、stars ui):推给所有页面,它们立即生效
  let cfgWatcher: FSWatcher | null = null;
  const cfgTimers = new Map<string, NodeJS.Timeout>();
  try {
    mkdirSync(configDir(), { recursive: true });
    cfgWatcher = watch(configDir(), (_ev, name) => {
      const n = String(name ?? '').replace(/\.llf$/, '');
      if (!isConfigName(n)) return;
      clearTimeout(cfgTimers.get(n));
      cfgTimers.set(n, setTimeout(() => broadcast('config', readUserConfig(n)), 60));
    });
  } catch { /* 只读的家目录:设置只能存在浏览器里 */ }

  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (host !== '0.0.0.0' && host !== '::') allowedHosts.add(host);
  for (const h of extraHosts) allowedHosts.add(h.replace(/:\d+$/, '')); // 反向代理转发过来的主机名
  const hostOk = (req: IncomingMessage): boolean => {
    const h = (req.headers.host ?? '').replace(/:\d+$/, '');
    // 监听所有网卡时无法枚举合法主机名,只能退而求其次靠 token(并在启动时警告)
    return host === '0.0.0.0' || host === '::' || allowedHosts.has(h);
  };

  const ctx: ServerCtx = { token, projects, main, mountId, allowedHosts, openProject, broadcast, pendingUi: new Map() };
  const projectOf = (url: URL): Project => projects.get(url.searchParams.get('p') ?? '') ?? main;

  const server = createServer((req, res) => {
    if (!hostOk(req)) { res.writeHead(403).end('forbidden host'); return; }
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    if (path.startsWith('/api/')) { void handleApi(req, res, url, ctx); return; }
    if (path === '/events') {
      const proj = projectOf(url);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' }); // 最后一项让 nginx 不要缓冲事件流
      res.write(`data: ${proj.snapshotLine()}\n\n`);
      proj.clients.add(res);
      req.on('close', () => proj.clients.delete(res));
      return;
    }
    // 预览(侧栏的 HTML 预览、新标签页打开):/preview/<预览 token>/<项目 id 或 _>/<路径>。iframe 带不了请求头,token 放在路径里,
    // 页面里的相对路径(css / js / 图片)自然落在同一个前缀下。预览 token 和 /api 的 token 是两个:页面能从自己的地址读到它,
    // 但它只能读项目里的文件。HTML / SVG 带 CSP sandbox:就算在新标签页里直接打开也是不同源的,碰不到查看器;
    // 允许跨源读(预览里的脚本 fetch 同目录的 json)。?bridge=<暗号>:往 HTML 里注入 window.stars(页面桥,见 bridge.ts)。
    const pv = /^\/preview\/([0-9a-f]+)\/([0-9a-f]+|_)\/(.*)$/.exec(path);
    if (pv) {
      const proj = pv[2] === '_' ? main : projects.get(pv[2]!);
      if (pv[1] !== previewToken) { res.writeHead(403).end('forbidden'); return; }
      if (!proj) { res.writeHead(404).end('没有这个项目'); return; }
      try {
        let abs = resolveInside(proj.baseDir, decodeURIComponent(pv[3]!));
        if (/(^|[\\/])\.git([\\/]|$)/.test(relative(proj.baseDir, abs))) throw new StarsError('.git 不提供');
        if (statSync(abs).isDirectory()) abs = join(abs, 'index.html');
        const type = PREVIEW_TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream';
        const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'no-cache', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
        if (/html|svg|xml/.test(type)) headers['content-security-policy'] = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox';
        const body = readFileSync(abs), nonce = url.searchParams.get('bridge');
        res.writeHead(200, headers).end(type.startsWith('text/html') && bridgeNonceOk(nonce) ? bridgeInject(body.toString('utf8'), bridgeShim(nonce)) : body);
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
  const keepalive = setInterval(() => { for (const p of projects.values()) for (const c of p.clients) c.write(': ping\n\n'); }, 20_000);
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
      clearInterval(keepalive); cfgWatcher?.close();
      onExit(); process.off('exit', onExit);
      for (const p of projects.values()) p.close();
      server.close();
    },
    pushLive: (l) => main.pushLive(l),
    gitChanged: () => main.gitChanged(),
    setWatching: (on) => { main.watching = on; },
    open: (dir, create) => openProject(dir, create).id,
  };
}
