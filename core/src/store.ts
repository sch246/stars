// 文件存储:宇宙文件 + 追加式操作日志(<file>.log,一行一个 JSON)。
// 每次 commit 都先重新读盘,所以外部(人、git、别的进程)的修改不会被覆盖掉。

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse, readRev, serialize } from './format.ts';
import { type Universe, StarsError, createUniverse } from './model.ts';
import { type Ctx, type Op, apply } from './ops.ts';

export interface LogEntry {
  n: number;
  t: string;
  author: string;
  op: Op;
  inverse: Op;
  undoOf?: number;
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

export class Store {
  readonly file: string;
  readonly logFile: string;
  policy: Policy = allowAll;
  /** 长期运行的进程(监听、查看器)反复提交时,文件没被别人改过就不必重新解析 */
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

  /** 提交路径专用:文件自上次保存后没变就复用内存里的宇宙(调用方会修改它)。 */
  private loadForWrite(): Universe {
    const sig = fileSig(this.file);
    if (this.cached && this.cached.sig === sig && sig !== '') return this.cached.u;
    const u = this.load();
    this.cached = { sig, u };
    return u;
  }

  save(u: Universe): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, serialize(u, this.logCount()));
    renameSync(tmp, this.file); // 原子替换,查看器不会读到半截文件
    const sig = fileSig(this.file);
    this.cached = { sig, u };
    writeFileSync(this.sigFile, sig); // 记下"这是 Store 写的":查看器据此区分"延迟落盘"和"别人手改了文件"
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
    if (this.cached && this.cached.sig !== fileSig(this.file)) this.cached = null; // 别的进程写过
    this.save(this.loadForWrite());
  }

  /** 只读用:文件没被别人改过就直接给缓存里的宇宙(调用方不得修改),否则解析一次。 */
  peek(): Universe {
    const sig = fileSig(this.file);
    if (this.cached && this.cached.sig === sig && sig !== '') return this.cached.u;
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
    if (this.exists()) throw new StarsError(`${this.file} 已存在`);
    this.save(parse(text));
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
    if (opts.defer) this.scheduleFlush();
    else this.save(u);
    return { universe: u, entry };
  }

  /** 撤销最近一条尚未被撤销的操作。 */
  undo(ctx: Ctx): LogEntry {
    const log = this.readLog();
    const undone = new Set(log.filter((e) => e.undoOf !== undefined).map((e) => e.undoOf!));
    const target = [...log].reverse().find((e) => e.undoOf === undefined && !undone.has(e.n));
    if (!target) throw new StarsError('没有可撤销的操作');
    return this.commit(target.inverse, ctx, target.n).entry;
  }
}

export function emptyUniverse(): Universe {
  return createUniverse();
}
