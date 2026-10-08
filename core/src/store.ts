// 文件存储:宇宙文件 + 追加式操作日志(<file>.log,一行一个 JSON)。
// 每次 commit 都先重新读盘,所以外部(人、git、别的进程)的修改不会被覆盖掉。

import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parse, serialize } from './format.ts';
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

export class Store {
  readonly file: string;
  readonly logFile: string;
  policy: Policy = allowAll;

  constructor(file: string) {
    this.file = file;
    this.logFile = `${file}.log`;
  }

  exists(): boolean {
    return existsSync(this.file);
  }

  load(): Universe {
    if (!this.exists()) throw new StarsError(`找不到宇宙文件 ${this.file}(先运行 stars init)`);
    return parse(readFileSync(this.file, 'utf8'));
  }

  save(u: Universe): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, serialize(u));
    renameSync(tmp, this.file); // 原子替换,查看器不会读到半截文件
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

  /** 应用一个操作并落盘 + 记日志。 */
  commit(op: Op, ctx: Ctx, undoOf?: number): { universe: Universe; entry: LogEntry } {
    const u = this.load();
    this.policy(ctx, op, u);
    const inverse = apply(u, op);
    const n = this.readLog().length + 1;
    const entry: LogEntry = { n, t: new Date().toISOString(), author: ctx.author, op, inverse };
    if (undoOf !== undefined) entry.undoOf = undoOf;
    this.save(u);
    appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
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
