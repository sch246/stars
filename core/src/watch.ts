// 实时同步:监听文件系统,把变化对账进宇宙(见 fssync.ts)。
//
// 平台策略(和 VS Code 的思路一致,但零依赖):
//   · Windows / macOS:系统原生的递归监听(一个句柄管整棵树,几乎没有成本),事件里滤掉 .git 与 node_modules;
//   · Linux:每个目录一个 inotify 监听,**只给宇宙里已知的、没被忽略的目录加**,不会去监听 node_modules 之类。
//     监听数达到系统上限(ENOSPC)时降级为定时对账,不会崩。
// 事件处理:攒一小段时间(默认 80ms,最长 500ms)去重合并 → 一批脏目录 → 对账 → 一次提交。
// 事件风暴保护:脏目录太多(默认 > 300,比如切分支、npm install)就放弃逐个对账,做一次全量对账。
// 兜底:每隔 pollSec 秒做一次全量对账,事件丢了/溢出了也能自愈。
import { type FSWatcher, watch } from 'node:fs';
import { join } from 'node:path';
import { reconcile, type SyncResult } from './fssync.ts';
import { liveFs, snapshotFs } from './nodefs.ts';
import { type Op } from './ops.ts';
import { type Store } from './store.ts';

export interface WatchOptions {
  root: string;            // 挂载根对应的磁盘目录
  mountId: string;         // 挂载根节点的 id(默认 repo)
  store: Store;
  author?: string;
  debounceMs?: number;
  maxWaitMs?: number;
  stormDirs?: number;
  pollSec?: number;        // 0 = 关闭兜底
  onSync?: (r: SyncResult & { full: boolean; ms: number }) => void;
  onGit?: () => void;      // .git/HEAD 或 .git/index 变了(提交、切分支):git 派生的信号需要刷新
  log?: (m: string) => void;
}

export class FsWatcher {
  private readonly o: Required<Omit<WatchOptions, 'onSync' | 'onGit'>> & Pick<WatchOptions, 'onSync' | 'onGit'>;
  private watchers = new Map<string, FSWatcher>();
  private recursive: FSWatcher | null = null;
  private gitWatcher: FSWatcher | null = null;
  private dirty = new Set<string>();
  private touched = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private firstAt = 0;
  private poller: NodeJS.Timeout | null = null;
  private degraded = false;
  private stopped = false;
  private started = false;
  stats = { events: 0, flushes: 0, fullSyncs: 0 };

  constructor(opts: WatchOptions) {
    const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)); // 显式的 undefined 不覆盖默认值
    this.o = {
      author: 'fs', debounceMs: 80, maxWaitMs: 500, stormDirs: 300, pollSec: 120, log: () => {}, ...given,
    } as WatchOptions & never;
  }

  /** 启动:先做一次全量对账(追上"服务没开着的时候发生的变化"),再开始监听。 */
  start(): SyncResult & { full: boolean; ms: number } {
    const first = this.syncAll();
    if (process.platform === 'win32' || process.platform === 'darwin') this.watchRecursive();
    else this.syncDirWatchers();
    this.watchGit();
    this.started = true;
    if (this.o.pollSec > 0) { this.poller = setInterval(() => this.syncAll(), this.o.pollSec * 1000); this.poller.unref(); }
    return first;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.poller) clearInterval(this.poller);
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    this.recursive?.close();
    this.gitWatcher?.close();
    this.o.store.flush();
  }

  // ---------- 事件 → 脏目录 ----------
  private hit(dirRel: string, type: string, name: string | null): void {
    if (!name) { this.dirty.add(dirRel); this.schedule(); return; }
    const rel = (dirRel + name).replace(/\\/g, '/');
    if (/(^|\/)(\.git|node_modules)(\/|$)/.test(rel)) return;
    this.stats.events++;
    const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
    if (type === 'rename') this.dirty.add(parent);   // 创建/删除/改名:这个目录的内容可能变了
    this.touched.add(rel);                          // 同时可能是内容变化:更新它的大小与修改时间
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped) return;
    const now = Date.now();
    if (!this.firstAt) this.firstAt = now;
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.min(this.o.debounceMs, Math.max(0, this.firstAt + this.o.maxWaitMs - now));
    this.timer = setTimeout(() => this.flush(), wait);
  }

  private flush(): void {
    this.timer = null; this.firstAt = 0;
    if (this.stopped || (this.dirty.size === 0 && this.touched.size === 0)) return;
    const dirs = [...this.dirty], touched = [...this.touched];
    this.dirty.clear(); this.touched.clear();
    this.stats.flushes++;
    if (dirs.length > this.o.stormDirs) { this.syncAll(); return; } // 事件风暴:不逐个对账了
    this.run(dirs, touched, false);
  }

  // ---------- 对账 ----------
  private syncAll(): SyncResult & { full: boolean; ms: number } {
    this.stats.fullSyncs++;
    return this.run('all', [], true);
  }

  private run(dirs: string[] | 'all', touched: string[], full: boolean): SyncResult & { full: boolean; ms: number } {
    const t0 = performance.now();
    const u = this.o.store.peek(); // 只读;提交时复用同一份内存里的宇宙,不用每次重新解析
    const r = reconcile(u, full ? snapshotFs(this.o.root) : liveFs(this.o.root), { mountId: this.o.mountId, dirs, touched });
    if (r.op) {
      this.o.store.commit(r.op, { author: this.o.author }, undefined, { defer: true });
      if (this.watchers.size > 0 || this.recursive === null) this.syncDirWatchers();
    }
    const out = { ...r, full, ms: performance.now() - t0 };
    this.o.onSync?.(out);
    return out;
  }

  // ---------- 监听器 ----------
  private watchRecursive(): void {
    try {
      this.recursive = watch(this.o.root, { recursive: true }, (type, name) => this.hit('', type, name?.toString() ?? null));
      this.recursive.on('error', (e) => this.degrade(e));
    } catch (e) { this.degrade(e as Error); }
  }

  /** Linux:让"被监听的目录集合"与宇宙里的目录节点保持一致(新增的加监听,没了的关掉)。 */
  private syncDirWatchers(): void {
    if (this.recursive || this.stopped || this.degraded) return;
    const u = this.o.store.peek();
    const want = new Set<string>(['']);
    for (const n of u.nodes.values()) if (n.attrs.type === 'dir' && n.attrs.file && n.attrs.missing !== 'true') want.add(n.attrs.file);
    for (const [rel, w] of this.watchers) if (!want.has(rel)) { w.close(); this.watchers.delete(rel); }
    for (const rel of want) {
      if (this.watchers.has(rel)) continue;
      try {
        const w = watch(join(this.o.root, rel), (type, name) => this.hit(rel, type, name?.toString() ?? null));
        w.on('error', () => { w.close(); this.watchers.delete(rel); this.dirty.add(rel); this.schedule(); }); // 目录被删了
        this.watchers.set(rel, w);
        // 监听器是在目录出现之后才加的:加上之前落进去的文件不会有事件,补读一次堵住这个竞态
        if (this.started && rel !== '') { this.dirty.add(rel); this.schedule(); }
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOSPC' || code === 'EMFILE') { this.degrade(e as Error); return; }
      }
    }
  }

  private degrade(e: Error): void {
    if (this.degraded) return;
    this.degraded = true;
    this.o.log(`监听器受限(${(e as NodeJS.ErrnoException).code ?? e.message}):降级为每 10 秒一次的定时对账。Linux 上可调大 fs.inotify.max_user_watches。`);
    if (this.poller) clearInterval(this.poller);
    this.poller = setInterval(() => this.syncAll(), 10_000);
    this.poller.unref();
  }

  /** 提交、切分支、pull 都会改 .git/HEAD 或 .git/index:相当于不用在仓库里装钩子就拿到了 git 事件。 */
  private watchGit(): void {
    try {
      this.gitWatcher = watch(join(this.o.root, '.git'), (_t, name) => {
        if (name === 'HEAD' || name === 'index') this.o.onGit?.();
      });
      this.gitWatcher.on('error', () => {});
    } catch { /* 不是 git 仓库 */ }
  }
}

export type { Op };
