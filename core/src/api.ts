// 服务端的 HTTP 接口(/api/*):一张"方法 + 路径 → 处理函数"的表。
// 处理函数返回一个对象 = 200 + JSON;抛 HttpError = 指定的状态码;自己写了响应(图片)就返回 undefined。
// 所有接口都要求页面里内嵌的 token,并拒绝跨源请求(见 serve.ts 开头的说明)。
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { isConfigName, readUserConfig, writeUserConfig } from './config.ts';
import { draftPreview } from './draft.ts';
import { FileConflict, IMAGE_TYPES, patchProjectFile, readProjectFile, resolveInside, writeProjectFile } from './files.ts';
import { diffUniverses, gitFirstParent, gitHistory, gitParentSnapshot, gitSnapshot, type HistoryScope } from './history.ts';
import { StarsError } from './model.ts';
import { apply, type Op } from './ops.ts';
import { expandHome, readRecent, type Project } from './project.ts';
import { selfRel } from './scan.ts';
import { planStamp, seenDiff, stampOnSummary } from './stale.ts';
import { applyDraft, updateDraft } from './store.ts';
import { arrange, undoWithFs } from './fsops.ts';
import { readRuns } from './runlog.ts';

/** 服务的共享状态(serve.ts 建好后交给接口) */
export interface ServerCtx {
  token: string;
  projects: Map<string, Project>;
  main: Project;
  mountId: string;
  allowedHosts: Set<string>;
  openProject(dir: string, create?: boolean): Project;
  /** 推给所有打开着的页面(或指定项目的);返回推给了几个连接 */
  broadcast(event: string, obj: unknown, only?: Project[]): number;
  /** 遥控(stars ui)等待页面回报的结果 */
  pendingUi: Map<string, (r: unknown) => void>;
}

/** POST 请求体里可能出现的字段(各接口自己检查需要的那几个) */
export interface Body {
  op?: Op; author?: string; dir?: string; create?: boolean; path?: string; content?: string; mtime?: number | null;
  name?: string; line?: string; file?: string; from?: string; id?: string; wait?: number; ids?: string[];
  action?: string; indices?: number[]; args?: string[]; draft?: boolean;
  patch?: { start: number; end: number; insert: string }; baseHash?: string;
  /** 整理(/api/arrange) */
  mode?: string; target?: string | null; rel?: string; fromMap?: Record<string, string | null>;
}

export interface ApiCall {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  q: URLSearchParams;
  /** ?p=<项目 id>,不给 = 主项目 */
  proj: Project;
  body: Body;
  /** 写操作记在日志里的作者(请求体的 author,不给 = viewer) */
  author: string;
  s: ServerCtx;
}

export class HttpError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) { super(message); this.status = status; this.extra = extra; }
}

type Handler = (c: ApiCall) => unknown | Promise<unknown>;

const OPS = new Set(['addNode', 'setNode', 'removeNode', 'addEdge', 'setEdge', 'removeEdge', 'renameNodes', 'batch']);
const validOp = (op: unknown): op is Op => !!op && typeof op === 'object' && OPS.has((op as { op: string }).op);
const conflict = (err: unknown): never => {
  if (err instanceof FileConflict) throw new HttpError(409, err.message, { mtime: err.mtime });
  if (err instanceof RangeError) throw new HttpError(400, err.message);
  throw err;
};
const selfOf = (p: Project) => selfRel(p.baseDir, p.store.file);

export const GET: Record<string, Handler> = {
  '/api/projects': ({ s }) => {
    const open = [...s.projects.values()].map((p) => p.info());
    const openDirs = new Set(open.map((p) => p.dir));
    const recent = readRecent().filter((d) => !openDirs.has(d)).map((d) => ({ dir: d, name: basename(d), hasUniverse: existsSync(join(d, 'universe.stars')) }));
    return { open, recent, main: s.main.id };
  },
  '/api/config': ({ q }) => {
    const name = q.get('name');
    if (!isConfigName(name)) throw new HttpError(400, '需要 name(settings / keys / grants)');
    return readUserConfig(name);
  },
  '/api/ls': ({ q, s }) => {
    const dir = resolve(expandHome(q.get('dir') || dirname(s.main.baseDir)));
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .slice(0, 500)
      .map((d) => ({ name: d.name, path: join(dir, d.name), hasUniverse: existsSync(join(dir, d.name, 'universe.stars')), isGit: existsSync(join(dir, d.name, '.git')) }))
      .sort((a, b) => Number(b.hasUniverse) - Number(a.hasUniverse) || a.name.localeCompare(b.name));
    return { dir, parent: dirname(dir) === dir ? null : dirname(dir), hasUniverse: existsSync(join(dir, 'universe.stars')), entries };
  },
  '/api/file': ({ q, proj }) => {
    const head = Number(q.get('head')) || undefined;
    return readProjectFile(proj.baseDir, q.get('path') ?? '', { self: selfOf(proj), statOnly: q.has('stat'), head, since: q.get('since') ?? undefined });
  },
  '/api/seen-diff': ({ q, proj }) => {   // 写说明之后文件改了什么
    const n = proj.store.peek().nodes.get(q.get('id') ?? '');
    if (!n) throw new HttpError(404, '没有这个节点');
    const d = seenDiff(proj.baseDir, n.attrs);
    if (!d) throw new HttpError(400, '这个节点没记文件版本,或文件不在');
    return d;
  },
  '/api/raw': ({ q, proj, res }) => {   // 图片预览(<img> 带不了请求头,token 可以放在查询参数 t 里)
    const abs = resolveInside(proj.baseDir, q.get('path') ?? '');
    const type = IMAGE_TYPES[extname(abs).toLowerCase()];
    if (!type) throw new HttpError(415, '只提供图片');
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
    res.end(readFileSync(abs));
    return undefined;
  },
  '/api/history': ({ q, proj }) => {
    // scope=auto:宇宙文件有历史就看它的,没有(新建的宇宙)就看所在文件夹的
    const limit = Math.min(20000, Math.max(1, Number(q.get('limit')) || 300));
    const want = q.get('scope');
    const h = gitHistory(proj.store.file, limit, want === 'repo' ? 'repo' : 'file', proj.baseDir);
    return want === 'auto' && !h.commits.length ? gitHistory(proj.store.file, limit, 'repo', proj.baseDir) : h;
  },
  '/api/runs': ({ q, proj }) => ({   // 脚本节点的运行记录(最近的在后)与正在跑的
    runs: readRuns(proj.store.file, { script: q.get('script') ?? undefined, limit: Math.min(500, Number(q.get('limit')) || 30) }),
    running: proj.agent?.runningNames() ?? [],
  }),
  '/api/state': ({ q, proj, s }) => {
    const hash = q.get('commit') ?? '';
    if ((q.get('scope') as HistoryScope) === 'repo') {
      const snap = proj.treeAt(hash, s.mountId);
      if (!snap) throw new HttpError(404, '这个提交里没有这个文件夹');
      const ph = gitFirstParent(proj.baseDir, hash);
      const parent = ph ? proj.treeAt(ph, s.mountId) : null;
      return { nodes: [...snap.nodes.values()], edges: [...snap.edges.values()], diff: diffUniverses(parent, snap) };
    }
    const snap = gitSnapshot(proj.store.file, hash);
    const diff = diffUniverses(gitParentSnapshot(proj.store.file, hash), snap);
    return { nodes: [...snap.nodes.values()], edges: [...snap.edges.values()], diff };
  },
};

export const POST: Record<string, Handler> = {
  // 两种写法:{ path, patch: { start, end, insert }, baseHash }(只传改动的一段)或 { path, content, mtime }(整份;mtime: null = 覆盖)
  '/api/file': ({ body, proj }) => {
    if (typeof body.path !== 'string' || (typeof body.content !== 'string' && !(body.patch && typeof body.baseHash === 'string'))) throw new HttpError(400, '需要 path,以及 content 或 patch + baseHash');
    try {
      const self = selfOf(proj);
      const r = body.patch ? patchProjectFile(proj.baseDir, body.path, body.patch, body.baseHash!, { self })
        : writeProjectFile(proj.baseDir, body.path, body.content!, typeof body.mtime === 'number' ? body.mtime : null, { self });
      if (!proj.watching) proj.filesChanged([body.path.replace(/\\/g, '/').replace(/^\.\//, '')]);   // 开着监听器时由它发现
      return r;
    } catch (err) { return conflict(err); }
  },
  '/api/config': ({ body }) => {
    if (!isConfigName(body.name) || typeof body.content !== 'string') throw new HttpError(400, '需要 name(settings / keys / grants)与 content');
    try { return writeUserConfig(body.name, body.content, typeof body.mtime === 'number' ? body.mtime : null); } catch (err) { return conflict(err); }
  },
  // 遥控:`stars ui <命令>` → 推给页面执行 → 第一个回报结果的页面的输出交回给 CLI
  '/api/ui': async ({ body, s }) => {
    if (typeof body.line !== 'string' || !body.line.trim()) throw new HttpError(400, '需要 line(一行命令)');
    // 指定了宇宙文件就只发给看着那个项目的页面,否则发给所有页面
    const target = body.file ? [...s.projects.values()].filter((p) => resolve(p.store.file) === resolve(body.file!)) : [];
    const id = randomBytes(6).toString('hex');
    const wait = Math.min(Math.max(Number(body.wait ?? 4000), 0), 30_000);
    let delivered = 0;
    const result = await new Promise<unknown>((ok) => {
      const t = setTimeout(() => { s.pendingUi.delete(id); ok(null); }, wait);
      s.pendingUi.set(id, (r) => { clearTimeout(t); s.pendingUi.delete(id); ok(r); });
      delivered = s.broadcast('ui', { id, line: body.line, from: String(body.from ?? 'cli').slice(0, 40) }, target.length ? target : undefined);
      if (!delivered) { clearTimeout(t); s.pendingUi.delete(id); ok(null); }
    });
    return { delivered, result };
  },
  '/api/ui-result': ({ body, s }) => {
    if (typeof body.id === 'string') s.pendingUi.get(body.id)?.(body);
    return { ok: true };
  },
  '/api/close': ({ body, s }) => {   // 关掉一个打开着的项目(不删任何文件);看着它的页面收到 closed,回到主项目
    const p = typeof body.id === 'string' ? s.projects.get(body.id) : undefined;
    if (!p) throw new HttpError(404, '没有这个项目');
    if (p === s.main) throw new HttpError(400, '主项目(启动服务时的那个)不能关');
    s.broadcast('closed', { id: p.id }, [p]);
    s.projects.delete(p.id);
    p.close();
    return { ok: true };
  },
  '/api/open': ({ body, s }) => {
    if (typeof body.dir !== 'string' || !body.dir) throw new HttpError(400, '需要 dir');
    return s.openProject(body.dir, !!body.create).info();
  },
  '/api/undo': ({ proj, author }) => ({ ok: true, n: undoWithFs(proj.store, proj.baseDir, author).n }),
  // 整理:移动 / 复制 / 引用进另一个容器(见 arrange.ts);文件真的在磁盘上搬,一步撤回
  '/api/arrange': ({ body, s, proj, author }) => {
    const mode = body.mode;
    if (mode !== 'move' && mode !== 'copy' && mode !== 'ref') throw new HttpError(400, 'mode 应为 move / copy / ref');
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
    const target = typeof body.target === 'string' ? body.target : null;
    const from = body.fromMap && typeof body.fromMap === 'object' ? body.fromMap : undefined;
    const r = arrange(proj.store, proj.baseDir, mode, ids, target, { rel: typeof body.rel === 'string' ? body.rel : undefined, from, mountId: s.mountId }, author);
    return { ok: true, n: r.entry?.n ?? null, summary: r.plan.summary, result: r.plan.result, skipped: r.plan.skipped, fs: r.plan.fs };
  },
  '/api/op': ({ body, proj, author }) => {
    if (!validOp(body.op)) throw new HttpError(400, '无效的操作');
    const op = stampOnSummary(proj.store.peek(), body.op, proj.baseDir);   // 写了 summary 的节点顺手记下文件版本
    return { ok: true, n: proj.store.commit(op, { author }).entry.n };
  },
  // 草稿:apply 整批落进宇宙(一次提交)· drop 丢弃(indices 从 1 数;不给 = 全部)· add 追加一条
  '/api/draft': ({ body, proj, author }) => {
    if (body.action === 'apply') { const r = applyDraft(proj.store, { author }); proj.sendDraft(); return { ok: true, ...r }; }
    if (body.action === 'drop') {
      const dropped = updateDraft(proj.store.file, (entries) => {
        const idx = new Set(Array.isArray(body.indices) ? body.indices : entries.map((_, i) => i + 1));
        const kept = entries.filter((_, i) => !idx.has(i + 1));
        return { entries: kept, result: entries.length - kept.length };
      });
      proj.sendDraft();
      return { ok: true, dropped };
    }
    if (body.action === 'add') {
      const op0 = body.op;
      if (!validOp(op0)) throw new HttpError(400, '无效的操作');
      const draft = updateDraft(proj.store.file, (entries) => {
        const p = draftPreview(proj.store.load(), entries, { keepRemoved: false });
        const op = stampOnSummary(p.u, op0, proj.baseDir);
        apply(p.u, op);   // 现在做不了就报错,不进草稿
        return { entries: [...entries, { t: new Date().toISOString(), author, op }], result: entries.length + 1 };
      });
      proj.sendDraft();
      return { ok: true, draft };
    }
    throw new HttpError(400, 'action 应为 apply / drop / add');
  },
  // 跑一个脚本节点(子进程,和触发的一样);跑完返回运行记录
  '/api/run': async ({ body, proj, author }) => {
    if (typeof body.name !== 'string' || !body.name) throw new HttpError(400, '需要 name(脚本节点 ~script/<名字> 的名字)');
    const agent = proj.agent ?? proj.startAgent(() => {});
    const args = Array.isArray(body.args) ? body.args.map(String) : [];
    return { ok: true, record: await agent.runNow(body.name, { kind: 'manual', by: author }, args) };
  },
  '/api/stamp': ({ body, proj, author }) => {   // 说明仍然有效:记下这些节点指向的文件现在的版本
    if (!Array.isArray(body.ids) || !body.ids.every((x) => typeof x === 'string')) throw new HttpError(400, '需要 ids');
    const p = planStamp(proj.store.peek(), body.ids, proj.baseDir);
    const n = p.op ? proj.store.commit(p.op, { author }).entry.n : proj.store.logCount();
    if (!p.op) proj.scheduleIssues();
    return { ok: true, n, stamped: p.stamped, skipped: p.skipped };
  },
};

/** 请求体可以大一些的接口(文件内容、遥控的输出) */
const BIG_BODY = new Set(['/api/file', '/api/ui-result']);

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

export const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, s: ServerCtx): Promise<void> {
  // <img> 没法带请求头,只读的 /api/raw 允许把 token 放在查询参数里
  const tok = req.headers['x-stars-token'] ?? (url.pathname === '/api/raw' ? url.searchParams.get('t') : undefined);
  if (tok !== s.token) return json(res, 403, { error: '缺少或错误的 token' });
  const origin = req.headers.origin;
  if (origin) { // 同源,或来自明确信任的主机名(反向代理时 Origin 是代理的域名)
    let o: URL | null = null;
    try { o = new URL(origin); } catch { /* Origin: null(沙箱里的预览页、file://)解析不了,一样算跨源 */ }
    if (!o || (o.host !== req.headers.host && !s.allowedHosts.has(o.hostname))) return json(res, 403, { error: '跨源请求被拒绝' });
  }
  try {
    const handler = (req.method === 'GET' ? GET : req.method === 'POST' ? POST : {})[url.pathname];
    if (!handler) return json(res, 404, { error: 'not found' });
    let body: Body = {};
    if (req.method === 'POST') {
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: '需要 application/json' });
      body = JSON.parse(await readBody(req, BIG_BODY.has(url.pathname) ? 8 << 20 : 1 << 20) || '{}') as Body;
    }
    const proj = s.projects.get(url.searchParams.get('p') ?? '') ?? s.main;
    const author = typeof body.author === 'string' && body.author.trim() ? body.author.trim().slice(0, 40) : 'viewer';
    const out = await handler({ req, res, url, q: url.searchParams, proj, body, author, s });
    if (out !== undefined) json(res, 200, out);
  } catch (err) {
    if (err instanceof HttpError) return json(res, err.status, { error: err.message, ...err.extra });
    const known = err instanceof StarsError || err instanceof SyntaxError || ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((err as NodeJS.ErrnoException).code ?? '');
    return json(res, known ? 400 : 500, { error: (err as Error).message });
  }
}
