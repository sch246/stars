// 服务端里的"项目":一个目录里的 universe.stars、看着它的查看器连接、实时信号、增量推送的状态。
// 一个服务(serve.ts)可以同时开多个项目;HTTP 接口在 api.ts。
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { invalidateSignals, loadSignals, type LiveSignals } from './activity.ts';
import { AgentLoop } from './agent.ts';
import { configDir } from './config.ts';
import { gitTreeUniverse } from './history.ts';
import { lint } from './lint.ts';
import { type Universe } from './model.ts';
import { buildSnapshot } from './snapshot.ts';
import { draftPath, fileSig, readDraft, type Store } from './store.ts';
import { FsWatcher } from './watch.ts';

/** 浏览器里输入的路径:支持 ~ 开头 */
export const expandHome = (d: string) => (d === '~' || d.startsWith('~/') || d.startsWith('~\\') ? join(homedir(), d.slice(1)) : d);
export const projectId = (file: string) => createHash('sha1').update(resolve(file)).digest('hex').slice(0, 10);

/** 一个打开着的项目:一个宇宙文件、它的查看器连接、实时信号、增量推送的状态。 */
export class Project {
  readonly id: string;
  readonly name: string;
  readonly clients = new Set<ServerResponse>();
  readonly live: LiveSignals = { size: {}, changed: {} };
  watching = false;
  fsw: FsWatcher | null = null;
  /** 脚本节点的触发循环(L4,见 agent.ts):serve 给每个打开的项目都开,stars agent 也用它 */
  agent: AgentLoop | null = null;
  private logOffset: number;
  private lastSig: string;
  private delivered: number;
  private timer: NodeJS.Timeout | undefined;
  private issueTimer: NodeJS.Timeout | undefined;
  private liveTimer: NodeJS.Timeout | undefined;
  private gitTimer: NodeJS.Timeout | undefined;
  private draftTimer: NodeJS.Timeout | undefined;
  private draftSent = '';
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
    const target = basename(store.file), draftName = basename(draftPath(store.file));
    // 监听目录而不是文件:原子保存(写临时文件再 rename)会让文件级监听失效
    this.dirWatcher = watch(dirname(store.file), (_event, name) => {
      if (name === draftName) { clearTimeout(this.draftTimer); this.draftTimer = setTimeout(() => this.sendDraft(), 60); return; }
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
      if (r.reset) { this.lastSig = sig; this.delivered = this.store.logCount(); this.send(JSON.parse(this.snapshotLine())); this.agent?.refresh(); return; }
      if (r.entries.length > 0) {
        this.lastSig = sig;
        this.delivered = r.entries[r.entries.length - 1]!.n;
        this.send({ type: 'ops', entries: r.entries, n: this.delivered });
        this.scheduleIssues();
        this.agent?.onOps(r.entries);
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

  /** 草稿变了(CLI / 脚本写进去、应用、丢弃):整份推给查看器(草稿一般不大) */
  sendDraft(): void {
    let entries;
    try { entries = readDraft(this.store.file); } catch { return; } // 正写到一半
    const key = JSON.stringify(entries);
    if (key === this.draftSent) return;
    this.draftSent = key;
    this.send({ type: 'draft', entries });
  }

  /** 这些文件(相对路径)的内容变了(监听器发现 / 查看器保存):有节点对着它记了版本的话,过期与否可能变了,重新体检 */
  filesChanged(rels: Iterable<string>): void {
    const set = new Set(rels);
    if (set.size === 0) return;
    this.agent?.onFiles([...set]);
    for (const n of this.store.peek().nodes.values()) {
      if (n.attrs.seen && set.has(n.attrs.file?.split('#')[0] ?? '')) { this.scheduleIssues(); return; }
    }
  }

  scheduleIssues(): void {
    if (this.issueTimer) return;
    this.issueTimer = setTimeout(() => {
      this.issueTimer = undefined;
      try {
        const issues = lint(this.store.peek(), { baseDir: this.baseDir, skipFileStat: this.watching });
        this.send({ type: 'issues', issues });
        this.agent?.onIssues(issues);
      } catch { /* 文件正被写 */ }
    }, 1500);
  }

  /** 监听器报告的文件实时状态(大小/修改时间):合并后单独推送(100ms 合并一次) */
  pushLive(l: LiveSignals): void {
    if (Object.keys(l.size).length + Object.keys(l.changed).length === 0) return;
    Object.assign(this.live.size, l.size); Object.assign(this.live.changed, l.changed);
    const u = this.store.peek();
    this.filesChanged(Object.keys(l.changed).map((id) => u.nodes.get(id)?.attrs.file ?? id));
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

  /** 开始按触发跑脚本节点(见 agent.ts);运行的开始、结束推给查看器(type: run) */
  startAgent(log: (m: string) => void): AgentLoop {
    if (this.agent) return this.agent;
    this.agent = new AgentLoop({ store: this.store, root: this.baseDir, log: (m) => log(`[${this.name}] ${m}`), onEvent: (e) => this.send(e) });
    this.agent.start();
    if (this.agent.scripts().some((d) => d.enabled && d.on.some((t) => t.kind === 'stale'))) this.scheduleIssues();   // 先体检一次:已经过期的也触发
    return this.agent;
  }

  close(): void {
    this.agent?.stop();
    for (const t of [this.timer, this.issueTimer, this.liveTimer, this.gitTimer, this.draftTimer]) clearTimeout(t);
    this.dirWatcher.close();
    this.fsw?.stop();
    for (const c of this.clients) c.end();
  }
}

// ---------- 最近打开的目录(尽力而为地记在 ~/.config/stars) ----------
const recentFile = () => join(configDir(), 'recent.json');
export function readRecent(): string[] {
  try { return (JSON.parse(readFileSync(recentFile(), 'utf8')) as string[]).filter((d) => typeof d === 'string'); } catch { return []; }
}
export function rememberRecent(dir: string): void {
  try {
    const list = [dir, ...readRecent().filter((d) => d !== dir)].slice(0, 20);
    mkdirSync(dirname(recentFile()), { recursive: true });
    writeFileSync(recentFile(), JSON.stringify(list, null, 2));
  } catch { /* 只读的家目录等 */ }
}
