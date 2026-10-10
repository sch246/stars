// 整理(arrange.ts)里动磁盘的那一半:在写锁里先动文件、再提交图的操作;任何一步失败就把已经做的倒回去。
// 日志里记下这次动了哪些文件(LogEntry.fs),撤销时先把文件搬回去(复制出来的删掉),再撤销图的操作。
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { type ArrangeMode, type ArrangeOpts, type ArrangePlan, type FsAct, arrangeCleanName, arrangeFreePath, arrangeIsFs, arrangeMount, arrangeRevertFs, planArrange } from './arrange.ts';
import { StarsError, edgeKey } from './model.ts';
import { type Op } from './ops.ts';
import { DraftStore, type LogEntry, type Store, withLock } from './store.ts';

/** 项目根下的绝对路径;跑出项目根的一律拒绝 */
function inside(root: string, rel: string): string {
  const abs = resolve(root, rel.replace(/\/$/, ''));
  const r = relative(resolve(root), abs);
  if (!r || r.startsWith('..') || r.split(sep)[0] === '..' || resolve(root, r) !== abs) throw new StarsError(`路径不在项目里: ${rel}`);
  return abs;
}

function doAct(root: string, a: FsAct): void {
  if (a.act === 'create') return;   // 新写的文件只能由 saveUploads 写;重做不了
  const from = inside(root, a.from);
  if (a.act === 'delete') { rmSync(from, { recursive: true, force: true }); return; }
  const to = inside(root, a.to);
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

/** 外面来的文件(粘贴、拖进查看器的)存进一个文件夹:不覆盖同名的(改名 a-copy.png),建好文件节点;
 *  container 是概念之类不是文件夹的节点时,文件存进项目根,再让 container 也装着它。一步撤回(文件删掉) */
export function saveUploads(store: Store, root: string, dirId: string | null, files: Array<{ name: string; data: Buffer }>, opts: { container?: string | null; rel?: string; mountId?: string }, author: string): { entry: LogEntry; created: string[] } {
  return withLock(store.file, () => {
    const u = store.peek(), mount = arrangeMount(u, opts.mountId);
    if (!mount) throw new StarsError('这个宇宙没有对应的文件夹(没有扫描过的根目录),存不了文件');
    const dir = dirId ?? mount, dn = u.nodes.get(dir);
    if (!arrangeIsFs(dn, mount) || !(dir === mount || dn!.attrs.type === 'dir')) throw new StarsError(`${dir} 不是文件夹`);
    const dirPath = dir === mount ? '' : dn!.attrs.file!, container = opts.container ?? null, rel = opts.rel ?? 'contains';
    if (container !== null && !u.nodes.has(container)) throw new StarsError(`节点不存在: ${container}`);
    if (!files.length) throw new StarsError('没有文件');
    if (store instanceof DraftStore) throw new StarsError('存文件不能写进草稿');
    const taken = new Set<string>(), ops: Op[] = [], acts: FsAct[] = [], created: string[] = [];
    for (const f of files) {
      const name = arrangeCleanName(f.name);
      const path = arrangeFreePath(dirPath, name, false, (p) => u.nodes.has(p) || taken.has(p) || existsSync(join(root, p)));
      taken.add(path); created.push(path);
      const dot = name.lastIndexOf('.'), attrs: Record<string, string> = { type: 'file', file: path, size: String(f.data.length) };
      if (dot > 0) attrs.ext = name.slice(dot + 1).toLowerCase();
      ops.push({ op: 'addNode', id: path, label: path.slice(dirPath.length), attrs }, { op: 'addEdge', from: dir, type: 'contains', to: path });
      if (container !== null && container !== dir && !u.edges.has(edgeKey(container, rel, path))) ops.push({ op: 'addEdge', from: container, type: rel, to: path });
      acts.push({ act: 'create', from: path, to: path });
    }
    const written: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) { writeFileSync(inside(root, created[i]!), files[i]!.data, { flag: 'wx' }); written.push(created[i]!); }
      return { entry: store.commit({ op: 'batch', ops }, { author }, undefined, { fs: acts }).entry, created };
    } catch (e) {
      for (const p of written) { try { rmSync(inside(root, p), { force: true }); } catch { /* 尽力而为 */ } }
      throw e;
    }
  });
}
