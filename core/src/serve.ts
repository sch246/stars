// 实时查看器的服务端:监听宇宙文件,变化时通过 SSE 推给浏览器。零依赖。
// 视图的计算在浏览器里做(同一份 model.ts / view.ts,去掉类型后原样提供),
// 所以展开/收起不需要和服务端往返,CLI 与查看器永远是同一套逻辑。
//
// 一个服务可以同时开多个项目(每个项目 = 一个目录里的 universe.stars),查看器里随时切换,
// 也可以浏览服务器上的目录、在没有宇宙的目录里一键建立(init + scan)。
//
// 安全:默认只监听 127.0.0.1;所有请求校验 Host(防 DNS 重绑定);
// /api/* 要求页面里内嵌的一次性 token(随机,每次启动不同),并拒绝跨源请求。
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invalidateSignals, loadSignals, type LiveSignals } from './activity.ts';
import { configDir, isConfigName, pageConfig, readUserConfig, registerServer, unregisterServer, writeUserConfig } from './config.ts';
import { FileConflict, IMAGE_TYPES, PREVIEW_TYPES, patchProjectFile, readProjectFile, resolveInside, writeProjectFile } from './files.ts';
import { diffUniverses, gitFirstParent, gitHistory, gitParentSnapshot, gitSnapshot, gitTreeUniverse, type HistoryScope } from './history.ts';
import { lint } from './lint.ts';
import { StarsError, type Universe } from './model.ts';
import { apply, type Op } from './ops.ts';
import { listFiles, planScan, selfRel, statMeta } from './scan.ts';
import { buildSnapshot } from './snapshot.ts';
import { fileSig, Store } from './store.ts';
import { FsWatcher } from './watch.ts';

const here = dirname(fileURLToPath(import.meta.url));
const viewerDir = resolve(here, '..', 'viewer');

/** 浏览器能直接 import 的共享模块(都不依赖 Node)。 */
const SHARED = new Set(['model', 'view', 'expr', 'ops', 'proposals', 'query', 'llf', 'format', 'textsync']);

function sharedModule(name: string): string {
  const ts = readFileSync(resolve(here, `${name}.ts`), 'utf8');
  return stripTypeScriptTypes(ts).replace(/from '\.\/(\w+)\.ts'/g, "from './$1.js'");
}

const OPS = new Set(['addNode', 'setNode', 'removeNode', 'addEdge', 'setEdge', 'removeEdge', 'renameNodes', 'batch']);

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

/** 浏览器里输入的路径:支持 ~ 开头 */
const expandHome = (d: string) => (d === '~' || d.startsWith('~/') || d.startsWith('~\\') ? join(homedir(), d.slice(1)) : d);
const projectId = (file: string) => createHash('sha1').update(resolve(file)).digest('hex').slice(0, 10);

/** 一个打开着的项目:一个宇宙文件、它的查看器连接、实时信号、增量推送的状态。 */
class Project {
  readonly id: string;
  readonly name: string;
  readonly clients = new Set<ServerResponse>();
  readonly live: LiveSignals = { size: {}, changed: {} };
  watching = false;
  fsw: FsWatcher | null = null;
  private logOffset: number;
  private lastSig: string;
  private delivered: number;
  private timer: NodeJS.Timeout | undefined;
  private issueTimer: NodeJS.Timeout | undefined;
  private liveTimer: NodeJS.Timeout | undefined;
  private gitTimer: NodeJS.Timeout | undefined;
  private pending: LiveSignals | null = null;
  private readonly dirWatcher: FSWatcher;
  readonly store: Store;
  readonly baseDir: string;

  constructor(store: Store, baseDir: string) {
    this.store = store;
    this.baseDir = baseDir;
    this.id = projectId(store.file);
    this.name = basename(baseDir) || baseDir;
    this.logOffset = store.exists() ? store.readLogSince(0).offset : 0;
    this.lastSig = fileSig(store.file);
    this.delivered = store.logCount();
    const target = basename(store.file);
    // 监听目录而不是文件:原子保存(写临时文件再 rename)会让文件级监听失效
    this.dirWatcher = watch(dirname(store.file), (_event, name) => {
      if (name !== target && name !== basename(store.logFile)) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.onFiles(), 40); // 提交是"先追加日志、再写文件",合并到同一次处理
    });
  }

  /** 启动时指定的那个项目(查看器不带 ?p= 时连到它) */
  primary = false;
  private trees = new Map<string, Universe | null>();

  /** 目录历史里某个提交时的宇宙(ls-tree 现场长出来;最近几个缓存,单步回放时父提交正好是上一个) */
  treeAt(hash: string, mountId: string): Universe | null {
    if (this.trees.has(hash)) return this.trees.get(hash)!;
    const u = gitTreeUniverse(this.baseDir, hash, this.store.peek(), this.store.file, mountId);
    this.trees.set(hash, u);
    if (this.trees.size > 8) this.trees.delete(this.trees.keys().next().value!);
    return u;
  }

  info() { return { id: this.id, name: this.name, dir: this.baseDir, file: this.store.file, watching: this.watching, primary: this.primary }; }

  snapshotLine(): string {
    try { return JSON.stringify({ ...buildSnapshot(this.store, this.baseDir, this.live, { skipFileStat: this.watching }), project: this.info() }); }
    catch (err) { return JSON.stringify({ type: 'snapshot', t: Date.now(), error: (err as Error).message, project: this.info() }); }
  }

  send(obj: unknown): void {
    const line = `data: ${JSON.stringify(obj)}\n\n`;
    for (const c of this.clients) c.write(line);
  }

  // 宇宙文件或日志变了:优先把"新追加的日志条目"推给查看器(浏览器本地 apply),
  // 只有日志没动、宇宙文件却变了(git 切分支、手改文件),才推整份快照。
  private onFiles(): void {
    try {
      const r = this.store.readLogSince(this.logOffset);
      this.logOffset = r.offset;
      const sig = fileSig(this.store.file);
      if (r.reset) { this.lastSig = sig; this.delivered = this.store.logCount(); this.send(JSON.parse(this.snapshotLine())); return; }
      if (r.entries.length > 0) {
        this.lastSig = sig;
        this.delivered = r.entries[r.entries.length - 1]!.n;
        this.send({ type: 'ops', entries: r.entries, n: this.delivered });
        this.scheduleIssues();
        return;
      }
      if (sig !== this.lastSig) {
        this.lastSig = sig;
        if (this.store.readWrittenSig() === sig) return; // 是 Store 自己写的(延迟落盘),内容查看器早就通过日志拿到了
        this.delivered = this.store.logCount();
        this.send(JSON.parse(this.snapshotLine()));
      }
    } catch { this.send(JSON.parse(this.snapshotLine())); }
  }

  private scheduleIssues(): void {
    if (this.issueTimer) return;
    this.issueTimer = setTimeout(() => {
      this.issueTimer = undefined;
      try { this.send({ type: 'issues', issues: lint(this.store.peek(), { baseDir: this.baseDir, skipFileStat: this.watching }) }); } catch { /* 文件正被写 */ }
    }, 1500);
  }

  /** 监听器报告的文件实时状态(大小/修改时间):合并后单独推送(100ms 合并一次) */
  pushLive(l: LiveSignals): void {
    if (Object.keys(l.size).length + Object.keys(l.changed).length === 0) return;
    Object.assign(this.live.size, l.size); Object.assign(this.live.changed, l.changed);
    this.pending ??= { size: {}, changed: {} };
    Object.assign(this.pending.size, l.size); Object.assign(this.pending.changed, l.changed);
    this.liveTimer ??= setTimeout(() => {
      this.liveTimer = undefined;
      if (this.pending) { this.send({ type: 'signals', ...this.pending }); this.pending = null; }
    }, 100);
  }

  /** git 提交/切分支之后:取一次完整的 fileChanged,让查看器整体替换 */
  gitChanged(): void {
    invalidateSignals(this.baseDir);
    clearTimeout(this.gitTimer);
    this.gitTimer = setTimeout(() => {
      try { this.send({ type: 'signals', replace: true, ...loadSignals(this.store.readLog(), this.store.peek(), this.baseDir, 0, this.live) }); } catch { /* ignore */ }
    }, 300);
  }

  /** 实时同步文件系统(serve --watch 时,每个打开的项目都会开) */
  startWatch(mountId: string, log: (m: string) => void, opts: { debounceMs?: number; pollSec?: number } = {}): void {
    if (this.fsw || !this.store.load().nodes.has(mountId)) return;
    this.watching = true;
    this.fsw = new FsWatcher({
      root: this.baseDir, mountId, store: this.store, log, ...opts,
      onSync: (r) => { this.pushLive(r.live); if (r.op) log(`[${this.name}] ${r.full ? '全量' : '增量'}对账 ${r.ms.toFixed(0)}ms`); },
      onGit: () => this.gitChanged(),
    });
    const first = this.fsw.start();
    log(`[${this.name}] 实时同步已开启:启动对账 ${first.ms.toFixed(0)}ms`);
  }

  close(): void {
    for (const t of [this.timer, this.issueTimer, this.liveTimer, this.gitTimer]) clearTimeout(t);
    this.dirWatcher.close();
    this.fsw?.stop();
    for (const c of this.clients) c.end();
  }
}

// ---------- 最近打开的目录(尽力而为地记在 ~/.config/stars) ----------
const recentFile = () => join(configDir(), 'recent.json');
function readRecent(): string[] {
  try { return (JSON.parse(readFileSync(recentFile(), 'utf8')) as string[]).filter((d) => typeof d === 'string'); } catch { return []; }
}
function rememberRecent(dir: string): void {
  try {
    const list = [dir, ...readRecent().filter((d) => d !== dir)].slice(0, 20);
    mkdirSync(dirname(recentFile()), { recursive: true });
    writeFileSync(recentFile(), JSON.stringify(list, null, 2));
  } catch { /* 只读的家目录等 */ }
}

export interface ServerOptions {
  /** 每个打开的项目都实时同步文件系统(serve --watch) */
  watch?: boolean;
  mountId?: string;
  debounceMs?: number;
  pollSec?: number;
}

export interface ServerHandle {
  token: string;
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
  process.removeAllListeners('warning'); // stripTypeScriptTypes 的实验性提示对用户是噪音
  const genesis = readFileSync(resolve(here, '..', 'genesis.stars'), 'utf8');

  const projects = new Map<string, Project>();
  const main = new Project(store, baseDir);
  main.primary = true;
  projects.set(main.id, main);
  const mountId = options.mountId ?? 'repo';
  if (options.watch) main.startWatch(mountId, log, options);

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

  // 遥控:`stars ui <命令>` → 推给页面执行 → 第一个回报结果的页面的输出交回给 CLI
  const pendingUi = new Map<string, (r: unknown) => void>();

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
  const projectOf = (url: URL): Project => projects.get(url.searchParams.get('p') ?? '') ?? main;

  const api = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    // <img> 没法带请求头,只读的 /api/raw 允许把 token 放在查询参数里
    const tok = req.headers['x-stars-token'] ?? (url.pathname === '/api/raw' ? url.searchParams.get('t') : undefined);
    if (tok !== token) return json(res, 403, { error: '缺少或错误的 token' });
    const origin = req.headers.origin;
    if (origin) { // 同源,或来自明确信任的主机名(反向代理时 Origin 是代理的域名)
      let o: URL | null = null;
      try { o = new URL(origin); } catch { /* Origin: null(沙箱里的预览页、file://)解析不了,一样算跨源 */ }
      if (!o || (o.host !== req.headers.host && !allowedHosts.has(o.hostname))) return json(res, 403, { error: '跨源请求被拒绝' });
    }
    try {
      const proj = projectOf(url);
      if (req.method === 'GET' && url.pathname === '/api/projects') {
        const open = [...projects.values()].map((p) => p.info());
        const openDirs = new Set(open.map((p) => p.dir));
        const recent = readRecent().filter((d) => !openDirs.has(d)).map((d) => ({ dir: d, name: basename(d), hasUniverse: existsSync(join(d, 'universe.stars')) }));
        return json(res, 200, { open, recent, main: main.id });
      }
      if (req.method === 'GET' && url.pathname === '/api/config') {
        const name = url.searchParams.get('name');
        if (!isConfigName(name)) return json(res, 400, { error: '需要 name(settings / keys)' });
        return json(res, 200, readUserConfig(name));
      }
      if (req.method === 'GET' && url.pathname === '/api/ls') {
        const dir = resolve(expandHome(url.searchParams.get('dir') || dirname(main.baseDir)));
        const entries = readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
          .slice(0, 500)
          .map((d) => ({ name: d.name, path: join(dir, d.name), hasUniverse: existsSync(join(dir, d.name, 'universe.stars')), isGit: existsSync(join(dir, d.name, '.git')) }))
          .sort((a, b) => Number(b.hasUniverse) - Number(a.hasUniverse) || a.name.localeCompare(b.name));
        return json(res, 200, { dir, parent: dirname(dir) === dir ? null : dirname(dir), hasUniverse: existsSync(join(dir, 'universe.stars')), entries });
      }
      const self = selfRel(proj.baseDir, proj.store.file);
      if (req.method === 'GET' && url.pathname === '/api/file') {
        const head = Number(url.searchParams.get('head')) || undefined;
        return json(res, 200, readProjectFile(proj.baseDir, url.searchParams.get('path') ?? '', { self, statOnly: url.searchParams.has('stat'), head }));
      }
      if (req.method === 'GET' && url.pathname === '/api/raw') { // 图片预览
        const abs = resolveInside(proj.baseDir, url.searchParams.get('path') ?? '');
        const type = IMAGE_TYPES[extname(abs).toLowerCase()];
        if (!type) return json(res, 415, { error: '只提供图片' });
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
        res.end(readFileSync(abs));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/history') {
        // scope=auto:宇宙文件有历史就看它的,没有(新建的宇宙)就看所在文件夹的
        const limit = Math.min(20000, Math.max(1, Number(url.searchParams.get('limit')) || 300));
        const want = url.searchParams.get('scope');
        const h = gitHistory(proj.store.file, limit, want === 'repo' ? 'repo' : 'file', proj.baseDir);
        return json(res, 200, want === 'auto' && !h.commits.length ? gitHistory(proj.store.file, limit, 'repo', proj.baseDir) : h);
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const hash = url.searchParams.get('commit') ?? '';
        if ((url.searchParams.get('scope') as HistoryScope) === 'repo') {
          const snap = proj.treeAt(hash, mountId);
          if (!snap) return json(res, 404, { error: '这个提交里没有这个文件夹' });
          const ph = gitFirstParent(proj.baseDir, hash);
          const parent = ph ? proj.treeAt(ph, mountId) : null;
          return json(res, 200, { nodes: [...snap.nodes.values()], edges: [...snap.edges.values()], diff: diffUniverses(parent, snap) });
        }
        const snap = gitSnapshot(proj.store.file, hash);
        const diff = diffUniverses(gitParentSnapshot(proj.store.file, hash), snap);
        return json(res, 200, { nodes: [...snap.nodes.values()], edges: [...snap.edges.values()], diff });
      }
      if (req.method === 'POST') {
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: '需要 application/json' });
        const body = JSON.parse(await readBody(req, url.pathname === '/api/file' ? 8 << 20 : 1 << 20) || '{}') as {
          op?: Op; author?: string; dir?: string; create?: boolean; path?: string; content?: string; mtime?: number | null;
          name?: string; line?: string; file?: string; from?: string; id?: string; wait?: number;
          patch?: { start: number; end: number; insert: string }; baseHash?: string;
        };
        if (url.pathname === '/api/file') {
          // 两种写法:{ path, patch: { start, end, insert }, baseHash }(只传改动的一段)或 { path, content, mtime }(整份;mtime: null = 覆盖)
          if (typeof body.path !== 'string' || (typeof body.content !== 'string' && !(body.patch && typeof body.baseHash === 'string'))) return json(res, 400, { error: '需要 path,以及 content 或 patch + baseHash' });
          try {
            if (body.patch) return json(res, 200, patchProjectFile(proj.baseDir, body.path, body.patch, body.baseHash!, { self }));
            return json(res, 200, writeProjectFile(proj.baseDir, body.path, body.content!, typeof body.mtime === 'number' ? body.mtime : null, { self }));
          } catch (err) {
            if (err instanceof FileConflict) return json(res, 409, { error: err.message, mtime: err.mtime });
            if (err instanceof RangeError) return json(res, 400, { error: err.message });
            throw err;
          }
        }
        if (url.pathname === '/api/config') {
          if (!isConfigName(body.name) || typeof body.content !== 'string') return json(res, 400, { error: '需要 name(settings / keys)与 content' });
          try { return json(res, 200, writeUserConfig(body.name, body.content, typeof body.mtime === 'number' ? body.mtime : null)); }
          catch (err) { if (err instanceof FileConflict) return json(res, 409, { error: err.message, mtime: err.mtime }); throw err; }
        }
        if (url.pathname === '/api/ui') {
          if (typeof body.line !== 'string' || !body.line.trim()) return json(res, 400, { error: '需要 line(一行命令)' });
          // 指定了宇宙文件就只发给看着那个项目的页面,否则发给所有页面
          const target = body.file ? [...projects.values()].filter((p) => resolve(p.store.file) === resolve(body.file!)) : [];
          const id = randomBytes(6).toString('hex');
          const wait = Math.min(Math.max(Number(body.wait ?? 4000), 0), 30_000);
          let delivered = 0;
          const result = await new Promise<unknown>((ok) => {
            const t = setTimeout(() => { pendingUi.delete(id); ok(null); }, wait);
            pendingUi.set(id, (r) => { clearTimeout(t); pendingUi.delete(id); ok(r); });
            delivered = broadcast('ui', { id, line: body.line, from: String(body.from ?? 'cli').slice(0, 40) }, target.length ? target : undefined);
            if (!delivered) { clearTimeout(t); pendingUi.delete(id); ok(null); }
          });
          return json(res, 200, { delivered, result });
        }
        if (url.pathname === '/api/ui-result') {
          if (typeof body.id === 'string') pendingUi.get(body.id)?.(body);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/open') {
          if (typeof body.dir !== 'string' || !body.dir) return json(res, 400, { error: '需要 dir' });
          return json(res, 200, openProject(body.dir, !!body.create).info());
        }
        const author = typeof body.author === 'string' && body.author.trim() ? body.author.trim().slice(0, 40) : 'viewer';
        if (url.pathname === '/api/undo') return json(res, 200, { ok: true, n: proj.store.undo({ author }).n });
        if (url.pathname === '/api/op') {
          if (!body.op || typeof body.op !== 'object' || !OPS.has((body.op as { op: string }).op)) return json(res, 400, { error: '无效的操作' });
          return json(res, 200, { ok: true, n: proj.store.commit(body.op, { author }).entry.n });
        }
      }
      return json(res, 404, { error: 'not found' });
    } catch (err) {
      const known = err instanceof StarsError || err instanceof SyntaxError || ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((err as NodeJS.ErrnoException).code ?? '');
      return json(res, known ? 400 : 500, { error: (err as Error).message });
    }
  };

  const server = createServer((req, res) => {
    if (!hostOk(req)) { res.writeHead(403).end('forbidden host'); return; }
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    if (path.startsWith('/api/')) { void api(req, res, url); return; }
    if (path === '/events') {
      const proj = projectOf(url);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' }); // 最后一项让 nginx 不要缓冲事件流
      res.write(`data: ${proj.snapshotLine()}\n\n`);
      proj.clients.add(res);
      req.on('close', () => proj.clients.delete(res));
      return;
    }
    // 预览(侧栏的 HTML 预览、新标签页打开):/preview/<token>/<项目 id 或 _>/<路径>。iframe 带不了请求头,token 放在路径里,
    // 页面里的相对路径(css / js / 图片)自然落在同一个前缀下。HTML / SVG 带 CSP sandbox:就算在新标签页里直接打开也是不同源的,
    // 碰不到查看器和 token;允许跨源读(预览里的脚本 fetch 同目录的 json),反正要先知道 token 才能拼出地址。
    const pv = /^\/preview\/([0-9a-f]+)\/([0-9a-f]+|_)\/(.*)$/.exec(path);
    if (pv) {
      const proj = pv[2] === '_' ? main : projects.get(pv[2]!);
      if (pv[1] !== token) { res.writeHead(403).end('forbidden'); return; }
      if (!proj) { res.writeHead(404).end('没有这个项目'); return; }
      try {
        let abs = resolveInside(proj.baseDir, decodeURIComponent(pv[3]!));
        if (/(^|[\\/])\.git([\\/]|$)/.test(relative(proj.baseDir, abs))) throw new StarsError('.git 不提供');
        if (statSync(abs).isDirectory()) abs = join(abs, 'index.html');
        const type = PREVIEW_TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream';
        const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'no-cache', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
        if (/html|svg|xml/.test(type)) headers['content-security-policy'] = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox';
        const body = readFileSync(abs);
        res.writeHead(200, headers).end(body);
      } catch { res.writeHead(404).end('not found'); }
      return;
    }
    const mod = /^\/core\/(\w+)\.js$/.exec(path);
    if (mod && SHARED.has(mod[1]!)) {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
      res.end(sharedModule(mod[1]!));
      return;
    }
    if (path === '/') {
      const html = readFileSync(resolve(viewerDir, 'index.html'), 'utf8').replace('__STARS_TOKEN__', token)
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
