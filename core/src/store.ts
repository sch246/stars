// 文件存储:宇宙文件 + 追加式操作日志(<file>.log,一行一个 JSON)。
// 每次 commit 都先重新读盘,所以外部(人、git、别的进程)的修改不会被覆盖掉。
// 写锁(<file>.lock):"读 → 改 → 追加日志 → 写文件"整段持锁,几个进程(CLI、监听、查看器、脚本、agent)同时写也不丢、不乱序。

import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse, readRev, serialize } from './format.ts';
import { type Universe, StarsError, createUniverse } from './model.ts';
import { type Ctx, type Op, apply } from './ops.ts';
import { type DraftEntry, draftPreview } from './draft.ts';

export interface LogEntry {
  n: number;
  t: string;
  author: string;
  op: Op;
  inverse: Op;
  undoOf?: number;
  /** 写进了草稿(DraftStore):草稿里的第几条;没有落进宇宙,也不在日志里 */
  draft?: number;
}

/** 权限钩子:现在恒为允许。将来代码节点/agent 的能力检查放在这里。 */
export type Policy = (ctx: Ctx, op: Op, u: Universe) => void;
export const allowAll: Policy = () => {};

export const fileSig = (file: string): string => { try { const s = statSync(file); return `${s.mtimeMs}:${s.size}:${s.ino}`; } catch { return ''; } };

/** 旁路的"写入签名"文件放在 .git 里(永远不会被提交/参与合并);不在 git 仓库里就放文件旁边。 */
function sigPath(file: string): string {
  const abs = resolve(file);
  for (let dir = dirname(abs); ; dir = dirname(dir)) {
    try { if (statSync(join(dir, '.git')).isDirectory()) return join(dir, '.git', `stars-${createHash('sha1').update(abs).digest('hex').slice(0, 10)}.sig`); } catch { /* 往上找 */ }
    if (dirname(dir) === dir) return `${abs}.sig`;
  }
}

// ---------- 写锁 ----------
export const lockPath = (file: string): string => `${file}.lock`;
/** 本进程持有的锁(可重入):宇宙文件的绝对路径 → 层数 */
const held = new Map<string, number>();
const sleepCell = new Int32Array(new SharedArrayBuffer(4));
const sleepMs = (ms: number) => { Atomics.wait(sleepCell, 0, 0, ms); };
/** 持锁超过这么久就当它是死掉的进程留下的(正常的一次提交远小于这个) */
const STALE_MS = 60_000;
let exitHooked = false;

interface LockInfo { pid?: number; host?: string; t?: number; who?: string }
function readLock(p: string): { text: string; info: LockInfo } | null {
  try { const text = readFileSync(p, 'utf8'); let info: LockInfo = {}; try { info = JSON.parse(text) as LockInfo; } catch { /* 正写到一半 */ } return { text, info }; } catch { return null; }
}
/** 锁的主人还在不在:本机的看进程,别的机器(网络盘)只能看时间 */
function lockIsStale(p: string, l: { text: string; info: LockInfo }): boolean {
  const { pid, host, t } = l.info;
  let age = typeof t === 'number' ? Date.now() - t : NaN;
  if (Number.isNaN(age)) { try { age = Date.now() - statSync(p).mtimeMs; } catch { return true; } }
  if (age > STALE_MS) return true;
  if (host === hostname() && typeof pid === 'number') {
    if (pid === process.pid) return !held.has(p);
    try { process.kill(pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; }
  }
  return false;
}

/**
 * 持有宇宙文件的写锁执行 fn(同步)。同一进程里可以重入。等不到(别的进程一直占着)就报错;
 * 占着锁的进程死了(本机进程不在了,或锁的时间超过一分钟)就接手。
 */
export function withLock<T>(file: string, fn: () => T, opts: { timeoutMs?: number; who?: string } = {}): T {
  const p = lockPath(resolve(file));
  const depth = held.get(p) ?? 0;
  if (depth > 0) {
    held.set(p, depth + 1);
    try { return fn(); } finally { held.set(p, depth); }
  }
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  for (let wait = 1; ; wait = Math.min(wait * 2, 40)) {
    try {
      const fd = openSync(p, 'wx');
      try { writeSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), t: Date.now(), who: opts.who ?? process.argv.slice(1, 3).join(' ').slice(-80) })); } finally { closeSync(fd); }
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const l = readLock(p);
      if (!l) continue;                                     // 刚被放掉
      if (lockIsStale(p, l)) {
        if (readLock(p)?.text === l.text) { try { unlinkSync(p); } catch { /* 别人先删了 */ } }
        continue;
      }
      if (Date.now() > deadline) {
        const who = [l.info.who, l.info.pid && `pid ${l.info.pid}`, l.info.host].filter(Boolean).join(' · ');
        throw new StarsError(`宇宙文件被另一个进程锁着(${who || '不知道是谁'}),等了 ${((opts.timeoutMs ?? 10_000) / 1000).toFixed(1)} 秒还没放开。确定没有别的 stars 在写,可以删掉 ${p}`);
      }
      sleepMs(wait + Math.random() * wait);
    }
  }
  held.set(p, 1);
  if (!exitHooked) { exitHooked = true; process.on('exit', () => { for (const k of held.keys()) { try { unlinkSync(k); } catch { /* ignore */ } } }); }
  try { return fn(); } finally {
    held.delete(p);
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

const logSize = (logFile: string): number => { try { return statSync(logFile).size; } catch { return 0; } };

export class Store {
  readonly file: string;
  readonly logFile: string;
  policy: Policy = allowAll;
  /** 长期运行的进程(监听、查看器)反复提交时,文件和日志都没被别人动过就不必重新解析 */
  private cached: { sig: string; u: Universe } | null = null;
  private logMeta: { size: number; count: number } | null = null;

  constructor(file: string) {
    this.file = file;
    this.logFile = `${file}.log`;
  }

  /** 每次现算:Store 可能先于 git init 创建 */
  get sigFile(): string { return sigPath(this.file); }

  exists(): boolean {
    return existsSync(this.file);
  }

  load(): Universe {
    if (!this.exists()) throw new StarsError(`找不到宇宙文件 ${this.file}(先运行 stars init)`);
    const text = readFileSync(this.file, 'utf8');
    const u = parse(text);
    // 文件可能落后于日志(延迟写入):回放文件之后的日志条目,让任何进程读到的都是最新、一致的宇宙
    const rev = readRev(text);
    if (rev !== undefined && this.logCount() > rev) {
      for (const e of this.readLog()) {
        if (e.n <= rev) continue;
        try { apply(u, e.op); } catch { break; } // 日志与文件对不上(被手工改过):保守地停在这里
      }
    }
    return u;
  }

  /** 缓存的钥匙:文件签名 + 日志大小(别的进程延迟落盘时文件不变、日志变长,也要认出来) */
  private stamp(): string { return `${fileSig(this.file)}|${logSize(this.logFile)}`; }

  /** 提交路径专用:文件和日志自上次以来没变就复用内存里的宇宙(调用方会修改它)。 */
  private loadForWrite(): Universe {
    const sig = this.stamp();
    if (this.cached && this.cached.sig === sig && !sig.startsWith('|')) return this.cached.u;
    const u = this.load();
    this.cached = { sig, u };
    return u;
  }

  save(u: Universe): void {
    withLock(this.file, () => {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, serialize(u, this.logCount()));
      renameSync(tmp, this.file); // 原子替换,查看器不会读到半截文件
      this.cached = { sig: this.stamp(), u };
      writeFileSync(this.sigFile, fileSig(this.file)); // 记下"这是 Store 写的":查看器据此区分"延迟落盘"和"别人手改了文件"
    });
  }

  /** 最近一次由 Store(任何进程)写入后的文件签名;与当前文件签名一致才说明文件没有被外部改过 */
  readWrittenSig(): string {
    try { return readFileSync(this.sigFile, 'utf8'); } catch { return ''; }
  }

  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private exitHook = false;

  private scheduleFlush(ms = 800): void {
    this.dirty = true;
    if (!this.exitHook) { this.exitHook = true; process.on('exit', () => this.flush()); }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, ms);
    this.flushTimer.unref();
  }

  /** 把延迟的修改写进宇宙文件。如果期间别的进程写过文件,先重新读(文件+日志已含全部修改)再写,不会丢更新。 */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    withLock(this.file, () => {
      if (this.cached && this.cached.sig !== this.stamp()) this.cached = null; // 别的进程写过
      this.save(this.loadForWrite());
    });
  }

  /** 只读用:文件没被别人改过就直接给缓存里的宇宙(调用方不得修改),否则解析一次。 */
  peek(): Universe {
    const sig = this.stamp();
    if (this.cached && this.cached.sig === sig && !sig.startsWith('|')) return this.cached.u;
    return this.loadForWrite();
  }

  /** 日志条数(带缓存:日志只追加,大小没变就不必重新数) */
  logCount(): number {
    if (!existsSync(this.logFile)) return 0;
    const size = statSync(this.logFile).size;
    if (this.logMeta && this.logMeta.size === size) return this.logMeta.count;
    const count = readFileSync(this.logFile, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
    this.logMeta = { size, count };
    return count;
  }

  create(text: string): void {
    withLock(this.file, () => {
      if (this.exists()) throw new StarsError(`${this.file} 已存在`);
      this.save(parse(text));
    });
  }

  readLog(): LogEntry[] {
    if (!existsSync(this.logFile)) return [];
    return readFileSync(this.logFile, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as LogEntry);
  }

  /** 从字节偏移起读新追加的日志(供查看器的增量推送使用)。日志被截断/替换时返回 reset。 */
  readLogSince(offset: number): { entries: LogEntry[]; offset: number; reset: boolean } {
    if (!existsSync(this.logFile)) return { entries: [], offset: 0, reset: offset !== 0 };
    const size = statSync(this.logFile).size;
    if (size < offset) return { entries: [], offset: size, reset: true };
    if (size === offset) return { entries: [], offset, reset: false };
    const buf = readFileSync(this.logFile);
    const text = buf.subarray(offset).toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return { entries: [], offset, reset: false }; // 最后一行还没写完
    const entries = text.slice(0, lastNl).split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as LogEntry);
    return { entries, offset: offset + Buffer.byteLength(text.slice(0, lastNl + 1)), reset: false };
  }

  /** 应用一个操作并落盘 + 记日志。 */
  commit(op: Op, ctx: Ctx, undoOf?: number, opts: { defer?: boolean } = {}): { universe: Universe; entry: LogEntry } {
    return withLock(this.file, () => {
      const u = this.loadForWrite();
      this.policy(ctx, op, u);
      const inverse = apply(u, op);
      const n = this.logCount() + 1;
      const entry: LogEntry = { n, t: new Date().toISOString(), author: ctx.author, op, inverse };
      if (undoOf !== undefined) entry.undoOf = undoOf;
      // 日志是权威的提交记录:先追加日志(很便宜),再写宇宙文件。
      // defer=true(监听器这类高频写入者)时,宇宙文件延迟、合并地写,文件头的 rev 保证读取方仍然一致。
      appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
      this.logMeta = { size: statSync(this.logFile).size, count: n };
      if (opts.defer) { this.cached = { sig: this.stamp(), u }; this.scheduleFlush(); }
      else this.save(u);
      return { universe: u, entry };
    });
  }

  /** 撤销最近一条尚未被撤销的操作。 */
  undo(ctx: Ctx): LogEntry {
    return withLock(this.file, () => {
      const log = this.readLog();
      const undone = new Set(log.filter((e) => e.undoOf !== undefined).map((e) => e.undoOf!));
      const target = [...log].reverse().find((e) => e.undoOf === undefined && !undone.has(e.n));
      if (!target) throw new StarsError('没有可撤销的操作');
      return this.commit(target.inverse, ctx, target.n).entry;
    });
  }
}

// ---------- 草稿(见 draft.ts):<宇宙文件>.draft,一行一条 { t, author, op } ----------
export const draftPath = (file: string): string => `${file}.draft`;

export function readDraft(file: string): DraftEntry[] {
  let text: string;
  try { text = readFileSync(draftPath(file), 'utf8'); } catch { return []; }
  return text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as DraftEntry);
}

/** 整个替换(空了就删掉文件) */
export function writeDraft(file: string, entries: DraftEntry[]): void {
  withLock(file, () => {
    const p = draftPath(file);
    if (!entries.length) { try { unlinkSync(p); } catch { /* 本来就没有 */ } return; }
    writeFileSync(`${p}.tmp`, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    renameSync(`${p}.tmp`, p);
  });
}

/** 读 → 改 → 写回草稿,整段持锁(两个进程同时往草稿里加、删不会互相盖掉) */
export function updateDraft<T>(file: string, fn: (entries: DraftEntry[]) => { entries: DraftEntry[]; result: T }): T {
  return withLock(file, () => {
    const before = readDraft(file);
    const r = fn([...before]);
    writeDraft(file, r.entries);
    return r.result;
  });
}

/**
 * 写进草稿的 Store:commit 不落进宇宙,而是先在"应用了草稿的宇宙"上试一遍(做不了照样报错),再追加到草稿;
 * 读(load / peek)看到的是应用了草稿之后的样子;undo 去掉草稿的最后一条。日志、宇宙文件都不动。
 */
export class DraftStore extends Store {
  override load(): Universe {
    const base = super.load();
    const entries = readDraft(this.file);
    return entries.length ? draftPreview(base, entries, { keepRemoved: false }).u : base;
  }

  override peek(): Universe {
    return this.load();
  }

  override commit(op: Op, ctx: Ctx): { universe: Universe; entry: LogEntry } {
    return withLock(this.file, () => {
      const entries = readDraft(this.file);
      const base = super.load();
      const p = draftPreview(base, entries, { keepRemoved: false });
      this.policy(ctx, op, p.u);
      const inverse = apply(p.u, op);
      const entry: DraftEntry = { t: new Date().toISOString(), author: ctx.author, op };
      appendFileSync(draftPath(this.file), JSON.stringify(entry) + '\n');
      return { universe: p.u, entry: { n: this.logCount(), t: entry.t, author: entry.author, op, inverse, draft: entries.length + 1 } };
    });
  }

  override undo(ctx: Ctx): LogEntry {
    return updateDraft(this.file, (entries) => {
      const last = entries.pop();
      if (!last) throw new StarsError('草稿是空的');
      return { entries, result: { n: this.logCount(), t: new Date().toISOString(), author: ctx.author, op: last.op, inverse: last.op, undoOf: -(entries.length + 1), draft: entries.length + 1 } };
    });
  }
}

/** 草稿整批落进宇宙:一次提交(一次 undo 就全撤回),然后清空草稿。有现在做不了的条目就一条也不落,报出来 */
export function applyDraft(store: Store, ctx: Ctx): { n: number; count: number } {
  if (store instanceof DraftStore) store = new Store(store.file);   // 落进真正的宇宙
  const real = store;
  return withLock(real.file, () => applyDraftLocked(real, ctx));
}
function applyDraftLocked(store: Store, ctx: Ctx): { n: number; count: number } {
  const entries = readDraft(store.file);
  if (!entries.length) throw new StarsError('草稿是空的');
  const p = draftPreview(store.load(), entries);
  if (p.failed.length) {
    throw new StarsError(`草稿里有 ${p.failed.length} 条现在做不了(宇宙在写草稿之后变了),一条也没有应用:\n`
      + p.failed.map((f) => `  #${f.i + 1} ${f.error}`).join('\n') + '\n去掉它们:stars draft drop ' + p.failed.map((f) => f.i + 1).join(' '));
  }
  const op: Op = entries.length === 1 ? entries[0]!.op : { op: 'batch', ops: entries.map((e) => e.op) };
  const n = store.commit(op, ctx).entry.n;
  writeDraft(store.file, []);
  return { n, count: entries.length };
}

export function emptyUniverse(): Universe {
  return createUniverse();
}
