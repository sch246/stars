// 服务端的接口(/api/*):一张"方法 + 路径 → 处理函数"的表,和怎么通信无关。
// 处理函数拿到参数(查询参数 q、请求体 body)和服务的核心(hub.ts),返回一个对象(= 200 + JSON)或 RawReply(图片这类);
// 抛 HttpError = 指定的状态码。dispatch() 是不带传输的入口;handleApi() 是 HTTP 的接法(token、跨源检查,见 serve.ts 开头),
// localApi() 是进程内的接法(测试、以后的 VS Code 宿主)。
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type Hub } from './hub.ts';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { isConfigName, readUserConfig, writeUserConfig } from './config.ts';
import { draftPreview } from './draft.ts';
import { FileConflict, IMAGE_TYPES, patchProjectFile, readProjectFile, resolveInside, writeProjectFile } from './files.ts';
import { diffUniverses, gitFirstParent, gitHistory, gitParentSnapshot, gitSnapshot, universeAtOp, withGhosts, type HistoryScope } from './history.ts';
import { moduleGraph } from './imports.ts';
import { KERNEL_NAMES } from './cmdspec.ts';
import { execKernel, summarize } from './commands.ts';
import { StarsError, type Universe } from './model.ts';
import { apply, type Op } from './ops.ts';
import { expandHome, readRecent, type Project } from './project.ts';
import { selfRel } from './scan.ts';
import { seenDiff, stampOnSummary } from './stale.ts';
import { updateDraft } from './store.ts';
import { arrange, saveUploads } from './fsops.ts';
import { readRuns } from './runlog.ts';

/** HTTP 接法要的:服务的核心 + 页面里内嵌的 token + 信任的主机名 */
export interface HttpCtx {
  hub: Hub;
  token: string;
  allowedHosts: Set<string>;
}

/** POST 请求体里可能出现的字段(各接口自己检查需要的那几个) */
export interface Body {
  op?: Op; author?: string; dir?: string; create?: boolean; path?: string; content?: string; mtime?: number | null;
  name?: string; line?: string; file?: string; from?: string; id?: string; wait?: number; ids?: string[];
  action?: string; args?: string[]; draft?: boolean;
  patch?: { start: number; end: number; insert: string }; baseHash?: string;
  /** 整理(/api/arrange) */
  mode?: string; target?: string | null; rel?: string; fromMap?: Record<string, string | null>;
  /** 外面来的文件(/api/upload):base64 */
  files?: Array<{ name: string; b64: string; dir?: boolean }>; container?: string | null;
  /** 打包 / 解散 */
  type?: string; force?: boolean;
}

/** 查询参数:URLSearchParams 就是一种 */
export type Query = Pick<URLSearchParams, 'get' | 'has'>;

export interface ApiCall {
  q: Query;
  /** ?p=<项目 id>,不给 = 主项目 */
  proj: Project;
  body: Body;
  /** 写操作记在日志里的作者(请求体的 author,不给 = viewer) */
  author: string;
  s: Hub;
}
/** 不是 JSON 的回复(图片预览):HTTP 原样写出去,带上 type 和不许执行任何东西的 CSP */
export class RawReply {
  readonly body: Buffer;
  readonly type: string;
  constructor(body: Buffer, type: string) { this.body = body; this.type = type; }
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
  // 视图脚本的整串依赖(入口 + 它 import 的,只认相对路径):查看器按 version 换加载地址,依赖里哪个改了都重新加载
  '/api/viewdeps': ({ q, proj }) => {
    const path = (q.get('path') ?? '').replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
    if (!path) throw new HttpError(400, '需要 path');
    const stat = new Map<string, string>();
    const g = moduleGraph(path, (p) => {
      try { const abs = resolveInside(proj.baseDir, p), st = statSync(abs); if (!st.isFile()) return null; stat.set(p, `${st.size}:${st.mtimeMs}`); return readFileSync(abs, 'utf8'); }
      catch { return null; }
    });
    const version = createHash('sha1').update(g.files.map((f) => `${f}=${stat.get(f)}`).join('\n')).digest('hex').slice(0, 12);
    return { files: g.files, missing: g.missing, version };
  },
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
  '/api/raw': ({ q, proj }) => {   // 图片预览(<img> 带不了请求头,token 可以放在查询参数 t 里)
    const abs = resolveInside(proj.baseDir, q.get('path') ?? '');
    const type = IMAGE_TYPES[extname(abs).toLowerCase()];
    if (!type) throw new HttpError(415, '只提供图片');
    return new RawReply(readFileSync(abs), type);
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
  // 回放:某个提交(commit=…,scope=repo 时由那时的文件树长出来)或操作日志里的某一条(op=n)刚做完时的宇宙;
  // diff 是和前一刻比的;删掉的节点也放在里面(diff.removedNodes,查看器画成红圈)
  '/api/state': ({ q, proj, s }) => {
    const reply = (snap: Universe, prev: Universe | null, extra: Record<string, unknown> = {}) => {
      const diff = diffUniverses(prev, snap);
      withGhosts(prev, snap);
      return { nodes: [...snap.nodes.values()], edges: [...snap.edges.values()], diff, ...extra };
    };
    if (q.has('op')) {
      const { at, before, entry } = universeAtOp(proj.store.peek(), proj.store.readLog(), Number(q.get('op')));
      return reply(at, before, { entry: { n: entry.n, t: entry.t, author: entry.author, summary: entry.undoOf ? `撤销 #${entry.undoOf}` : summarize(entry.op) } });
    }
    const hash = q.get('commit') ?? '';
    if ((q.get('scope') as HistoryScope) === 'repo') {
      const snap = proj.treeAt(hash, s.mountId);
      if (!snap) throw new HttpError(404, '这个提交里没有这个文件夹');
      const ph = gitFirstParent(proj.baseDir, hash);
      return reply(snap, ph ? proj.treeAt(ph, s.mountId) : null);
    }
    return reply(gitSnapshot(proj.store.file, hash), gitParentSnapshot(proj.store.file, hash));
  },
  // 操作日志(时间线的「操作」):最近 limit 条(before = 只要编号小于它的,往前翻)
  '/api/oplog': ({ q, proj }) => {
    const limit = Math.min(20000, Math.max(1, Number(q.get('limit')) || 300)), before = Number(q.get('before')) || Infinity;
    const all = proj.store.readLog().filter((e) => e.n < before);
    return { entries: all.slice(-limit).map((e) => ({ n: e.n, t: e.t, author: e.author, summary: e.undoOf ? `撤销 #${e.undoOf}` : summarize(e.op) })), more: all.length > limit };
  },
};

export const POST: Record<string, Handler> = {
  // 两种写法:{ path, patch: { start, end, insert }, baseHash }(只传改动的一段)或 { path, content, mtime }(整份;mtime: null = 覆盖)
  '/api/file': ({ body, proj }) => {
    if (typeof body.path !== 'string' || (typeof body.content !== 'string' && !(body.patch && typeof body.baseHash === 'string'))) throw new HttpError(400, '需要 path,以及 content 或 patch + baseHash');
    try {
      const self = selfOf(proj);
      const r = body.patch ? patchProjectFile(proj.baseDir, body.path, body.patch, body.baseHash!, { self })
        : writeProjectFile(proj.baseDir, body.path, body.content!, typeof body.mtime === 'number' ? body.mtime : null, { self, create: body.create === true });
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
  // 外面来的文件(粘贴、拖进查看器):存进 dir 这个文件夹(不给 = 项目根),建好节点;container 也装着它们
  '/api/upload': ({ body, s, proj, author }) => {
    const files = Array.isArray(body.files) ? body.files.filter((f) => f && typeof f.name === 'string' && typeof f.b64 === 'string').map((f) => ({ name: f.name, data: Buffer.from(f.b64, 'base64'), dir: f.dir === true })) : [];
    const r = saveUploads(proj.store, proj.baseDir, typeof body.dir === 'string' ? body.dir : null, files, { container: typeof body.container === 'string' ? body.container : null, rel: typeof body.rel === 'string' ? body.rel : undefined, mountId: s.mountId }, author);
    return { ok: true, n: r.entry.n, created: r.created };
  },
  // 整理:移动 / 复制 / 引用进另一个容器(见 arrange.ts);文件真的在磁盘上搬,一步撤回
  '/api/arrange': ({ body, s, proj, author }) => {
    const mode = body.mode;
    if (mode !== 'move' && mode !== 'copy' && mode !== 'ref' && mode !== 'delete' && mode !== 'group' && mode !== 'ungroup') throw new HttpError(400, 'mode 应为 move / copy / ref / delete / group / ungroup');
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : [];
    const target = typeof body.target === 'string' ? body.target : null;
    const from = body.fromMap && typeof body.fromMap === 'object' ? body.fromMap : undefined;
    const r = arrange(proj.store, proj.baseDir, mode, ids, target, {
      rel: typeof body.rel === 'string' ? body.rel : undefined, from, mountId: s.mountId,
      name: typeof body.name === 'string' ? body.name : undefined, type: typeof body.type === 'string' ? body.type : undefined, force: body.force === true,
    }, author);
    return { ok: true, n: r.entry?.n ?? null, summary: r.plan.summary, result: r.plan.result, skipped: r.plan.skipped, fs: r.plan.fs, conflicts: r.plan.conflicts ?? null };
  },
  // 一行内核命令(和 CLI 同名同参数,见 cmdspec.ts):查看器里的写命令都走这里,作者是请求里的 author;--draft 写进草稿。
  // 返回命令的 { out, data, exitCode },外加 n(执行完日志的条数:页面等推送追到它再算完成)
  '/api/cmd': async ({ body, proj, author }) => {
    if (typeof body.name !== 'string' || !KERNEL_NAMES.has(body.name)) throw new HttpError(400, `不是内核命令: ${String(body.name)}`);
    const args = Array.isArray(body.args) ? body.args.map(String) : [];
    const r = await execKernel(body.name, args, { store: proj.store, author, root: proj.baseDir, cwd: proj.baseDir });
    if (args.includes('--draft') || body.name === 'draft') proj.sendDraft();
    return { ok: true, out: r.out, data: r.data ?? null, exitCode: r.exitCode ?? 0, n: proj.store.logCount() };
  },
  '/api/op': ({ body, proj, author }) => {
    if (!validOp(body.op)) throw new HttpError(400, '无效的操作');
    const op = stampOnSummary(proj.store.peek(), body.op, proj.baseDir);   // 写了 summary 的节点顺手记下文件版本
    return { ok: true, n: proj.store.commit(op, { author }).entry.n };
  },
  // 草稿里追加一条操作(界面上的写入进草稿用;整批应用 / 丢弃是 draft apply / drop 命令,走 /api/cmd)
  '/api/draft': ({ body, proj, author }) => {
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
    throw new HttpError(400, 'action 应为 add(应用、丢弃用 draft apply / drop 命令)');
  },
  // 跑一个脚本节点(子进程,和触发的一样);跑完返回运行记录
  '/api/run': async ({ body, proj, author }) => {
    if (typeof body.name !== 'string' || !body.name) throw new HttpError(400, '需要 name(脚本节点 ~script/<名字> 的名字)');
    const agent = proj.agent ?? proj.startAgent(() => {});
    const args = Array.isArray(body.args) ? body.args.map(String) : [];
    return { ok: true, record: await agent.runNow(body.name, { kind: 'manual', by: author }, args) };
  },
};

/** 请求体可以大一些的接口(文件内容、遥控的输出) */
const BIG_BODY = new Set(['/api/file', '/api/ui-result']);
const UPLOAD_LIMIT = 64 << 20;   // /api/upload:粘贴、拖进来的文件(base64)

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

/** 不带传输的入口:按方法和路径找处理函数,出错换成状态码。q 里的 p = 项目 id(不给 = 主项目) */
export async function dispatch(method: string, path: string, q: Query, body: Body, s: Hub): Promise<{ status: number; json?: unknown; raw?: RawReply }> {
  try {
    const handler = (method === 'GET' ? GET : method === 'POST' ? POST : {})[path];
    if (!handler) return { status: 404, json: { error: 'not found' } };
    const proj = s.projects.get(q.get('p') ?? '') ?? s.main;
    const author = typeof body.author === 'string' && body.author.trim() ? body.author.trim().slice(0, 40) : 'viewer';
    const out = await handler({ q, proj, body, author, s });
    return out instanceof RawReply ? { status: 200, raw: out } : { status: 200, json: out ?? { ok: true } };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, json: { error: err.message, ...err.extra } };
    const known = err instanceof StarsError || err instanceof SyntaxError || ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes((err as NodeJS.ErrnoException).code ?? '');
    return { status: known ? 400 : 500, json: { error: (err as Error).message } };
  }
}

/** HTTP 的接法:token、跨源检查,读请求体,写回复 */
export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, h: HttpCtx): Promise<void> {
  // <img> 没法带请求头,只读的 /api/raw 允许把 token 放在查询参数里
  const tok = req.headers['x-stars-token'] ?? (url.pathname === '/api/raw' ? url.searchParams.get('t') : undefined);
  if (tok !== h.token) return json(res, 403, { error: '缺少或错误的 token' });
  const origin = req.headers.origin;
  if (origin) { // 同源,或来自明确信任的主机名(反向代理时 Origin 是代理的域名)
    let o: URL | null = null;
    try { o = new URL(origin); } catch { /* Origin: null(沙箱里的预览页、file://)解析不了,一样算跨源 */ }
    if (!o || (o.host !== req.headers.host && !h.allowedHosts.has(o.hostname))) return json(res, 403, { error: '跨源请求被拒绝' });
  }
  let body: Body = {};
  if (req.method === 'POST') {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: '需要 application/json' });
    try { body = JSON.parse(await readBody(req, url.pathname === '/api/upload' ? UPLOAD_LIMIT : BIG_BODY.has(url.pathname) ? 8 << 20 : 1 << 20) || '{}') as Body; }
    catch (err) { return json(res, 400, { error: (err as Error).message }); }
  }
  const r = await dispatch(req.method ?? 'GET', url.pathname, url.searchParams, body, h.hub);
  if (r.raw) {
    res.writeHead(r.status, { 'content-type': r.raw.type, 'cache-control': 'no-cache', 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
    res.end(r.raw.body);
  } else json(res, r.status, r.json);
}

/**
 * 进程内的接法:和 HTTP 同一张表、同样的状态码,只是没有 token、不过网络(测试、以后的 VS Code 宿主)。
 * 出错抛 HttpError(带状态码);图片这类给 RawReply。
 */
export function localApi(hub: Hub) {
  const call = async (method: string, path: string, body: Body = {}, query: Record<string, string> = {}): Promise<unknown> => {
    const r = await dispatch(method, path, new URLSearchParams(query), JSON.parse(JSON.stringify(body)) as Body, hub);   // 和过网络一样:请求体是一份拷贝
    if (r.status >= 400) { const j = r.json as { error?: string } & Record<string, unknown>; const { error, ...extra } = j; throw new HttpError(r.status, error ?? `状态 ${r.status}`, extra); }
    return r.raw ?? r.json;
  };
  return {
    get: (path: string, query?: Record<string, string>) => call('GET', path, {}, query),
    post: (path: string, body?: Body, query?: Record<string, string>) => call('POST', path, body, query),
  };
}
