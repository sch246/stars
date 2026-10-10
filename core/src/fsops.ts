// 整理(arrange.ts)里动磁盘的那一半:在写锁里先动文件、再提交图的操作;任何一步失败就把已经做的倒回去。
// 日志里记下这次动了哪些文件(LogEntry.fs),撤销时先把文件搬回去(复制出来的删掉),再撤销图的操作。
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { type ArrangeMode, type ArrangeOpts, type ArrangePlan, type FsAct, arrangeRevertFs, planArrange } from './arrange.ts';
import { StarsError } from './model.ts';
import { DraftStore, type LogEntry, type Store, withLock } from './store.ts';

/** 项目根下的绝对路径;跑出项目根的一律拒绝 */
function inside(root: string, rel: string): string {
  const abs = resolve(root, rel.replace(/\/$/, ''));
  const r = relative(resolve(root), abs);
  if (!r || r.startsWith('..') || r.split(sep)[0] === '..' || resolve(root, r) !== abs) throw new StarsError(`路径不在项目里: ${rel}`);
  return abs;
}

function doAct(root: string, a: FsAct): void {
  const to = inside(root, a.to), from = inside(root, a.from);
  if (a.act === 'delete') { rmSync(from, { recursive: true, force: true }); return; }
  if (!existsSync(from)) throw new StarsError(`磁盘上没有 ${a.from}`);
  if (existsSync(to)) throw new StarsError(`磁盘上已经有 ${a.to} 了`);
  mkdirSync(dirname(to), { recursive: true });
  if (a.act === 'move') renameSync(from, to);
  else cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
}

/** 依次做;中途失败就把做过的倒回去再抛出 */
export function applyFsActs(root: string, acts: FsAct[]): void {
  const done: FsAct[] = [];
  try { for (const a of acts) { doAct(root, a); done.push(a); } }
  catch (e) {
    for (const a of arrangeRevertFs(done)) { try { doAct(root, a); } catch { /* 尽力而为 */ } }
    throw e;
  }
}

/** 规划 + 动磁盘 + 提交,整段持锁(监听器同进程:同步做完,它的事件晚到也只会对出「没变化」) */
export function arrange(store: Store, root: string, mode: ArrangeMode, ids: string[], target: string | null, opts: ArrangeOpts, author: string): { plan: ArrangePlan; entry: LogEntry | null } {
  return withLock(store.file, () => {
    const plan = planArrange(store.peek(), mode, ids, target, opts);
    if (!plan.op) return { plan, entry: null };
    if (plan.fs.length && store instanceof DraftStore) throw new StarsError('动磁盘上文件的整理不能写进草稿');
    for (const a of plan.fs) { inside(root, a.from); inside(root, a.to); if (existsSync(join(root, a.to.replace(/\/$/, '')))) throw new StarsError(`磁盘上已经有 ${a.to} 了`); }
    applyFsActs(root, plan.fs);
    try { return { plan, entry: store.commit(plan.op, { author }, undefined, plan.fs.length ? { fs: plan.fs } : {}).entry }; }
    catch (e) { applyFsActs(root, arrangeRevertFs(plan.fs)); throw e; }
  });
}

/** 撤销:最近那一步动过磁盘的话,先把文件倒回去 */
export function undoWithFs(store: Store, root: string, author: string): LogEntry {
  return store.undo({ author }, (acts) => { const back = arrangeRevertFs(acts); applyFsActs(root, back); return back; });
}
