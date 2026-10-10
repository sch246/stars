// L4:脚本节点、触发、运行记录 —— agent 循环。
//
//   脚本节点:~script/<名字> kind=script,代码直接写在节点里(code="…",小脚本)或指向项目里的文件(file=tools/x.js)。
//     写法和 stars run 的脚本一样:export default async (stars, args) => {…},或者直接写顶层代码(全局有 stars、args);
//     stars.trigger 是这次为什么跑。手动跑:stars run ~script/<名字>、查看器侧栏的 ▶、控制台 script-run <名字>。
//   触发(写在节点上):on="change, file:src/**, stale, start"、every=10m。stars serve 打开着的每个项目、或者 stars agent,
//     在后台按触发跑(每次一个子进程:崩了、死循环了都不连累服务;超时 timeout=2m 就杀掉)。
//     change = 宇宙变了(不算这个脚本自己写的、不算运行记录);file:<glob> = 项目里的文件变了(要开着监听:serve --watch / agent --watch);
//     stale = 有说明新过期了;start = 循环启动时跑一次。enabled=false 停用触发(手动照样能跑);draft=true 写进草稿等你预览。
//   运行记录:每次运行追加一行到 <宇宙文件>.runs;节点 ~run/<名字> 记"最近一次有事的运行"(写了东西、出错、状态变了;
//     record=always 则每次都记)—— 定时检查的脚本不会把操作日志刷满。
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StarsError, type Universe } from './model.ts';
import { type Op } from './ops.ts';
import { runScriptModule } from './script.ts';
import { readRuns, recordRun } from './runlog.ts';
import {
  AGENT_AUTHOR, SCRIPT_PREFIX, describeTriggers, fmtDuration, listScripts, scriptDef,
  type RunRecord, type ScriptDef, type Trigger, type TriggerInfo,
} from './scriptnode.ts';
import { DraftStore, readDraft, Store, type LogEntry } from './store.ts';

// ---------- 跑一个脚本节点(在当前进程里:stars run ~script/<名字>,也是 agent 起的子进程里做的事) ----------
export interface RunNodeOptions {
  store: Store;
  file: string;
  root: string;
  port?: number;
  args?: string[];
  author?: string;
  trigger?: TriggerInfo;
  runId?: string;
}

export async function runScriptNode(name: string, o: RunNodeOptions): Promise<RunRecord> {
  const real = o.store instanceof DraftStore ? new Store(o.file) : o.store;
  const def = scriptDef(real.peek(), name);
  if (!def) throw new StarsError(`没有脚本节点 ${SCRIPT_PREFIX}${name}(stars script-set ${name} --code '…' 或 --ref tools/x.js)`);
  if (!def.code && !def.file) throw new StarsError(`${def.id} 没有代码:写 code="…" 或 file=<脚本文件>`);
  const store = o.store instanceof DraftStore ? o.store : def.draft ? new DraftStore(o.file) : real;
  const author = o.author || `script:${name}`;
  const trigger = o.trigger ?? { kind: 'manual' };
  const n0 = real.logCount(), d0 = readDraft(o.file).length, t0 = Date.now();
  let out = '', status: RunRecord['status'] = 'ok';
  const keys = ['log', 'info', 'warn', 'error'] as const;
  const orig = Object.fromEntries(keys.map((k) => [k, console[k]])) as Record<typeof keys[number], (...a: unknown[]) => void>;
  const fmt = (x: unknown) => (typeof x === 'string' ? x : x instanceof Error ? (x.stack ?? x.message) : (() => { try { return JSON.stringify(x); } catch { return String(x); } })());
  for (const k of keys) console[k] = (...a: unknown[]) => { if (out.length < 200_000) out += a.map(fmt).join(' ') + '\n'; orig[k](...a); };
  try {
    const url = def.file ? pathToFileURL(resolve(o.root, def.file)).href : `data:text/javascript;base64,${Buffer.from(def.code!).toString('base64')}`;
    await runScriptModule(url, def.id, { store, author, root: o.root, file: o.file, port: o.port, args: o.args ?? [], trigger });
  } catch (err) {
    status = 'error';
    console.error(err instanceof StarsError ? `错误: ${err.message}` : err);
  } finally {
    for (const k of keys) console[k] = orig[k];
  }
  const ops = real.readLog().filter((e) => e.n > n0 && e.author === author).length;
  const rec: RunRecord = {
    id: o.runId || randomBytes(6).toString('hex'), script: name, trigger: trigger.kind, t: new Date(t0).toISOString(), ms: Date.now() - t0,
    status, out: out.slice(-4000), ops, draft: Math.max(0, readDraft(o.file).length - d0),
  };
  recordRun(o.file, rec, def);
  return rec;
}

// ---------- 循环:按触发起子进程 ----------
export interface AgentEvent { type: 'run'; phase: 'start' | 'end'; script: string; trigger: TriggerInfo['kind']; runId: string; record?: RunRecord }
export interface AgentOptions {
  store: Store;
  root: string;
  log?: (m: string) => void;
  onEvent?: (e: AgentEvent) => void;
  /** 同时最多跑几个脚本 */
  maxParallel?: number;
}

const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url));
const touchesScripts = (op: Op): boolean => {
  switch (op.op) {
    case 'batch': return op.ops.some(touchesScripts);
    case 'renameNodes': return op.pairs.some(([a, b]) => a.startsWith(SCRIPT_PREFIX) || b.startsWith(SCRIPT_PREFIX));
    case 'addNode': case 'setNode': case 'removeNode': return op.id.startsWith(SCRIPT_PREFIX);
    default: return false;
  }
};
const onlyScripts = (op: Op): boolean => (op.op === 'batch' ? op.ops.length > 0 && op.ops.every(onlyScripts) : touchesScripts(op));
const opBrief = (op: Op): string => {
  switch (op.op) {
    case 'addNode': return `+ ${op.id}`; case 'removeNode': return `- ${op.id}`; case 'setNode': return `~ ${op.id}`;
    case 'addEdge': return `+ ${op.from} -${op.type}-> ${op.to}`; case 'removeEdge': return `- ${op.from} -${op.type}-> ${op.to}`;
    case 'setEdge': return `~ ${op.from} -${op.type}-> ${op.to}`; case 'renameNodes': return `↔ ×${op.pairs.length}`; case 'batch': return `批量 ×${op.ops.length}`;
  }
};
/** 同一个脚本攒着的几次触发合并成一次:路径、节点、操作并起来(最多各 500 条) */
function mergeTrigger(a: TriggerInfo | undefined, b: TriggerInfo): TriggerInfo {
  if (!a) return b;
  const cat = <T>(x?: T[], y?: T[]) => (x || y ? [...new Set([...(x ?? []), ...(y ?? [])])].slice(-500) : undefined);
  const kind = a.kind === b.kind ? a.kind : b.kind === 'manual' ? 'manual' : a.kind;
  const m: TriggerInfo = { kind };
  const paths = cat(a.paths, b.paths), ids = cat(a.ids, b.ids), ops = a.ops || b.ops ? [...(a.ops ?? []), ...(b.ops ?? [])].slice(-500) : undefined;
  if (paths) m.paths = paths; if (ids) m.ids = ids; if (ops) m.ops = ops;
  if (a.by || b.by) m.by = b.by ?? a.by;
  return m;
}

export class AgentLoop {
  private readonly o: AgentOptions;
  private defs = new Map<string, ScriptDef>();
  private timers = new Map<string, { every: number; t: NodeJS.Timeout }>();
  private pending = new Map<string, { info: TriggerInfo; t: NodeJS.Timeout }>();
  private running = new Map<string, { child: ChildProcess; runId: string; trigger: TriggerInfo['kind'] }>();
  private queued = new Map<string, TriggerInfo>();
  private waiters = new Map<string, Array<(r: RunRecord) => void>>();
  private staleSeen: Set<string> | null = null;
  private stopped = false;

  constructor(o: AgentOptions) { this.o = o; }

  private log(m: string): void { this.o.log?.(m); }
  get file(): string { return this.o.store.file; }
  scripts(): ScriptDef[] { return [...this.defs.values()]; }
  isRunning(name: string): boolean { return this.running.has(name); }
  runningNames(): string[] { return [...this.running.keys()]; }

  /** 启动:读脚本节点、排好定时、跑 on=start 的 */
  start(): void {
    this.refresh();
    for (const d of this.defs.values()) {
      for (const p of d.problems) this.log(`脚本 ${d.name}: ${p}`);
      if (d.enabled && d.on.some((t) => t.kind === 'start')) this.trigger(d.name, { kind: 'start' }, 0);
    }
    const auto = [...this.defs.values()].filter((d) => d.enabled && (d.on.length || d.every));
    if (auto.length) this.log(`触发:${auto.map((d) => `${d.name}(${describeTriggers(d)})`).join(',')}`);
  }

  /** 脚本节点变了:重读,定时器按 every 重排 */
  refresh(): void {
    if (this.stopped) return;
    let u: Universe;
    try { u = this.o.store.peek(); } catch { return; }
    this.defs = new Map(listScripts(u).map((d) => [d.name, d]));
    for (const [name, tm] of this.timers) {
      const d = this.defs.get(name);
      if (!d || !d.enabled || d.every !== tm.every) { clearInterval(tm.t); this.timers.delete(name); }
    }
    for (const d of this.defs.values()) {
      if (!d.enabled || !d.every || this.timers.has(d.name)) continue;
      const t = setInterval(() => this.trigger(d.name, { kind: 'every' }, 0), d.every);
      t.unref?.();
      this.timers.set(d.name, { every: d.every, t });
    }
  }

  /** 新的日志条目(Project 的推送路径上调用):脚本节点变了就重读;有 on=change 的脚本就触发(不算它自己和运行记录写的) */
  onOps(entries: LogEntry[]): void {
    if (!entries.length) return;
    if (entries.some((e) => touchesScripts(e.op))) this.refresh();
    // 文件同步(作者 fs)新增、删除、改名的文件也算"文件变了"(内容改了的由监听器的实时信号报,见 onFiles)
    const fsPaths: string[] = [];
    const collect = (op: Op): void => {
      if (op.op === 'batch') op.ops.forEach(collect);
      else if (op.op === 'addNode' || op.op === 'removeNode') fsPaths.push(op.id);
      else if (op.op === 'renameNodes') for (const [a, b] of op.pairs) fsPaths.push(a, b);
    };
    for (const e of entries) if (e.author === 'fs') collect(e.op);
    if (fsPaths.length) this.onFiles(fsPaths.filter((x) => !x.startsWith('~')));
    // 改脚本节点本身(写代码、改触发)不算"宇宙变了"
    const outside = entries.filter((e) => e.author !== AGENT_AUTHOR && !onlyScripts(e.op));
    if (!outside.length) return;
    for (const d of this.defs.values()) {
      if (!d.enabled || !d.on.some((t) => t.kind === 'change')) continue;
      const mine = `script:${d.name}`;
      const others = outside.filter((e) => e.author !== mine);
      if (others.length) this.trigger(d.name, { kind: 'change', ops: others.map((e) => ({ n: e.n, author: e.author, op: opBrief(e.op) })) });
    }
  }

  /** 项目里的文件变了(相对路径) */
  onFiles(paths: string[]): void {
    if (!paths.length) return;
    for (const d of this.defs.values()) {
      if (!d.enabled) continue;
      const fts = d.on.filter((t): t is Extract<Trigger, { kind: 'file' }> => t.kind === 'file');
      if (!fts.length) continue;
      const hit = paths.filter((p) => fts.some((t) => !t.re || t.re.test(p)));
      if (hit.length) this.trigger(d.name, { kind: 'file', paths: hit });
    }
  }

  /** 体检结果(服务端每次重新体检后调用):有说明新过期了就触发 on=stale(第一次看到的过期也算) */
  onIssues(issues: Array<{ rule: string; nodes: string[] }>): void {
    const now = new Set(issues.filter((i) => i.rule === 'stale' && i.nodes[0]).map((i) => i.nodes[0]!));
    const fresh = [...now].filter((id) => !this.staleSeen?.has(id));
    this.staleSeen = now;
    if (!fresh.length) return;
    for (const d of this.defs.values()) if (d.enabled && d.on.some((t) => t.kind === 'stale')) this.trigger(d.name, { kind: 'stale', ids: fresh });
  }

  /** 攒一下(debounce)再跑;同一个脚本的几次触发合并成一次 */
  trigger(name: string, info: TriggerInfo, delay?: number): void {
    if (this.stopped) return;
    const d = this.defs.get(name);
    if (!d) return;
    const p = this.pending.get(name);
    if (p) clearTimeout(p.t);
    const merged = mergeTrigger(p?.info, info);
    const t = setTimeout(() => { this.pending.delete(name); this.launch(name, merged); }, delay ?? d.debounceMs);
    this.pending.set(name, { info: merged, t });
  }

  /** 手动跑(查看器的 ▶、/api/run):跑完返回记录;正在跑就等这一次跑完之后再跑 */
  runNow(name: string, info: TriggerInfo = { kind: 'manual' }, args: string[] = []): Promise<RunRecord> {
    if (!scriptDef(this.o.store.peek(), name)) return Promise.reject(new StarsError(`没有脚本节点 ${SCRIPT_PREFIX}${name}`));
    return new Promise((ok) => {
      const runId = this.launch(name, info, args, true);
      const list = this.waiters.get(runId) ?? [];
      list.push(ok);
      this.waiters.set(runId, list);
    });
  }

  private launch(name: string, info: TriggerInfo, args: string[] = [], force = false): string {
    const runId = randomBytes(6).toString('hex');
    if (this.stopped) return runId;
    const max = this.o.maxParallel ?? 2;
    if (this.running.has(name) || (!force && this.running.size >= max)) {
      // 正在跑:跑完再来一次(合并)。手动的那次也排进去,记录照样交回
      this.queued.set(name, mergeTrigger(this.queued.get(name), info));
      if (force) { const q = this.forcedIds.get(name) ?? []; q.push(runId); this.forcedIds.set(name, q); }
      return runId;
    }
    this.spawnRun(name, info, args, runId);
    return runId;
  }
  private forcedIds = new Map<string, string[]>();

  private spawnRun(name: string, info: TriggerInfo, args: string[], runId: string): void {
    const def = this.defs.get(name) ?? scriptDef(this.o.store.peek(), name);
    const timeoutMs = def?.timeoutMs ?? 120_000;
    const file = this.o.store.file, author = `script:${name}`;
    const n0 = this.o.store.logCount(), d0 = readDraft(file).length, t0 = Date.now();
    const env = { ...process.env, STARS_FILE: file, STARS_ROOT: this.o.root, STARS_AUTHOR: author, STARS_TRIGGER: JSON.stringify(info), STARS_RUN_ID: runId };
    const child = spawn(process.execPath, [CLI, 'run', SCRIPT_PREFIX + name, ...args], { cwd: this.o.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', timedOut = false;
    const grab = (b: Buffer) => { out += b.toString('utf8'); if (out.length > 64_000) out = out.slice(-32_000); };
    child.stdout?.on('data', grab); child.stderr?.on('data', grab);
    const killer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 2000).unref(); }, timeoutMs);
    this.running.set(name, { child, runId, trigger: info.kind });
    this.o.onEvent?.({ type: 'run', phase: 'start', script: name, trigger: info.kind, runId });
    child.on('close', (code) => {
      clearTimeout(killer);
      this.running.delete(name);
      // 子进程自己记了就用它的;被杀掉、process.exit() 了没来得及记,这里补一条
      let rec = readRuns(file, { id: runId }).at(-1);
      if (!rec) {
        let ops = 0;
        try { ops = this.o.store.readLog().filter((e) => e.n > n0 && e.author === author).length; } catch { /* ignore */ }
        rec = {
          id: runId, script: name, trigger: info.kind, t: new Date(t0).toISOString(), ms: Date.now() - t0,
          status: timedOut ? 'timeout' : code === 0 ? 'ok' : 'error',
          out: (out + (timedOut ? `\n(超过 ${fmtDuration(timeoutMs)},已停止)` : '')).slice(-4000), ops, draft: Math.max(0, readDraft(file).length - d0),
        };
        try { recordRun(file, rec, def); } catch (err) { this.log(`记录运行失败: ${(err as Error).message}`); }
      }
      this.log(`脚本 ${name}(${info.kind}):${rec.status === 'ok' ? '完成' : rec.status === 'timeout' ? '超时' : '出错'} ${rec.ms}ms${rec.ops ? ` · 写了 ${rec.ops} 处` : ''}${rec.draft ? ` · 草稿 +${rec.draft}` : ''}`);
      this.o.onEvent?.({ type: 'run', phase: 'end', script: name, trigger: info.kind, runId, record: rec });
      for (const w of this.waiters.get(runId) ?? []) w(rec);
      this.waiters.delete(runId);
      const q = this.queued.get(name);
      if (q && !this.stopped) {
        this.queued.delete(name);
        const forced = this.forcedIds.get(name) ?? [];
        this.forcedIds.delete(name);
        const next = randomBytes(6).toString('hex');
        // 排队等着的手动运行:它们的记录就是下一次运行的记录
        for (const id of forced) { const ws = this.waiters.get(id) ?? []; this.waiters.delete(id); if (ws.length) this.waiters.set(next, [...(this.waiters.get(next) ?? []), ...ws]); }
        this.spawnRun(name, q, [], next);
      } else this.drainGlobal();
    });
  }

  /** 因为"同时最多几个"而排队的其它脚本 */
  private drainGlobal(): void {
    for (const [name, info] of this.queued) {
      if (this.running.size >= (this.o.maxParallel ?? 2)) return;
      if (this.running.has(name)) continue;
      this.queued.delete(name);
      const forced = this.forcedIds.get(name) ?? [];
      this.forcedIds.delete(name);
      const id = randomBytes(6).toString('hex');
      for (const f of forced) { const ws = this.waiters.get(f) ?? []; this.waiters.delete(f); if (ws.length) this.waiters.set(id, [...(this.waiters.get(id) ?? []), ...ws]); }
      this.spawnRun(name, info, [], id);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const tm of this.timers.values()) clearInterval(tm.t);
    for (const p of this.pending.values()) clearTimeout(p.t);
    for (const r of this.running.values()) r.child.kill('SIGTERM');
    this.timers.clear(); this.pending.clear(); this.queued.clear();
  }
}
