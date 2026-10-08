// 文件系统对账:把"磁盘上现在有什么"同步进宇宙里的 dir/file 节点。
//
// 设计原则(也是 VS Code 一类编辑器的做法):**事件只是线索,真相是重新读目录**。
// 监听器只负责告诉我们"哪些目录可能变了",这里对这些目录重新 readdir、与宇宙对账,算出一批操作。
// 所以不依赖各平台事件语义的差异(创建/删除/重命名/覆盖写),事件丢了、重复了、乱序了,下次对账都会自愈。
//
// 对用户数据的态度:文件被删不等于关系应该消失。
//   · 只有"纯结构"的节点(只有 contains 边)才会被删除;
//   · 带有任何语义关系(依赖、描述、AI 提议……)的节点保留并标记 missing=true,文件回来时自动取消;
//   · 重命名/移动会被识别出来(大小+文件名,或整个目录的内容签名一致),节点连同它的所有关系一起改名。
// 文件的大小、修改时间这类高频变化的状态不写进宇宙(会让 git diff 全是噪音),只作为"实时信号"返回。

import { type Attrs, type Universe } from './model.ts';
import { type Op } from './ops.ts';

export interface FsEntry { name: string; dir: boolean }
export interface FsView {
  /** rel 为 '' (挂载根) 或以 / 结尾的目录路径;不存在返回 null */
  readdir(rel: string): FsEntry[] | null;
  stat(rel: string): { size: number; mtimeMs: number } | null;
  /** 返回被忽略的路径子集(目录以 / 结尾);用 git check-ignore 实现,和 .gitignore 语义完全一致 */
  ignored(rels: string[]): Set<string>;
}

export interface SyncResult {
  op: Op | null;
  /** 实时信号:不写进宇宙。size = 与宇宙里记录不同的当前大小;changed = 被事件触及的文件的修改时间 */
  live: { size: Record<string, number>; changed: Record<string, number> };
  stats: { added: number; removed: number; renamed: number; missing: number; revived: number; dirs: number };
}

const baseName = (rel: string) => rel.replace(/\/$/, '').split('/').pop()!;
const parentRel = (rel: string) => { const t = rel.replace(/\/$/, ''); const i = t.lastIndexOf('/'); return i < 0 ? '' : t.slice(0, i + 1); };
const extOf = (name: string) => { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; };

export function reconcile(
  u: Universe, fsv: FsView, opts: { mountId: string; dirs: string[] | 'all'; touched?: string[] },
): SyncResult {
  const { mountId } = opts;
  if (!u.nodes.has(mountId)) throw new Error(`挂载根节点 ${mountId} 不存在`);
  const isFsNode = (id: string) => { const n = u.nodes.get(id); return !!n && (id === mountId || ((n.attrs.type === 'dir' || n.attrs.type === 'file') && !!n.attrs.file)); };
  const relOf = (id: string) => (id === mountId ? '' : u.nodes.get(id)!.attrs.file!);
  const idOfRel = (rel: string) => (rel === '' ? mountId : rel);

  // contains 的孩子表 + 每个节点有没有"非结构"的边
  const kids = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  const semantic = new Set<string>();
  for (const e of u.edges.values()) {
    if (e.type === 'contains') { const l = kids.get(e.from); if (l) l.push(e.to); else kids.set(e.from, [e.to]); if (!parentOf.has(e.to)) parentOf.set(e.to, e.from); }
    else { semantic.add(e.from); semantic.add(e.to); }
  }
  const subtree = (id: string): string[] => { // 含自己,先序
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const k of kids.get(out[i]!) ?? []) if (isFsNode(k)) out.push(k);
    return out;
  };

  interface Added { rel: string; dir: boolean; size: number; parent: string }
  const added: Added[] = [];
  const removedTop: string[] = [];           // 被删(或搬走)的子树根
  const live: SyncResult['live'] = { size: {}, changed: {} };
  const revive: string[] = [];
  const queue = opts.dirs === 'all'
    ? [...u.nodes.values()].filter((n) => n.id === mountId || (n.attrs.type === 'dir' && n.attrs.file)).map((n) => relOf(n.id))
    : [...new Set(opts.dirs)];
  const seen = new Set<string>();
  const fresh = new Set<string>();           // 本轮新发现的目录(宇宙里还没有)
  let dirsRead = 0;

  for (let qi = 0; qi < queue.length; qi++) {
    const drel = queue[qi]!;
    if (seen.has(drel)) continue;
    seen.add(drel);
    const did = idOfRel(drel);
    const known = isFsNode(did);
    if (!known && !fresh.has(drel)) continue; // 宇宙里没有、也不是新发现的:由父目录的对账去发现它
    const entries = fsv.readdir(drel);
    dirsRead++;
    if (entries === null) { if (known && drel !== '') queue.push(parentRel(drel)); continue; } // 目录没了:让父目录来处理
    const cands = entries.filter((e) => e.name !== '.git').map((e) => ({ name: e.name, dir: e.dir, rel: drel + e.name + (e.dir ? '/' : '') }));
    const ign = fsv.ignored(cands.map((c) => c.rel));
    const desired = new Map(cands.filter((c) => !ign.has(c.rel)).map((c) => [c.rel, c]));
    const existing = known ? (kids.get(did) ?? []).filter(isFsNode) : [];
    const existingRels = new Set(existing.map(relOf));

    for (const [rel, c] of desired) {
      if (existingRels.has(rel)) continue;
      const st = c.dir ? null : fsv.stat(rel);
      added.push({ rel, dir: c.dir, size: st?.size ?? 0, parent: did });
      if (c.dir) { fresh.add(rel); queue.push(rel); }
    }
    for (const id of existing) if (!desired.has(relOf(id))) removedTop.push(id);
    for (const id of existing) {
      const rel = relOf(id);
      if (!desired.has(rel)) continue;
      const n = u.nodes.get(id)!;
      if (n.attrs.missing === 'true') revive.push(id);
      if (n.attrs.type === 'file' && (opts.dirs === 'all' || opts.touched?.includes(rel))) {
        const st = fsv.stat(rel);
        if (st) {
          if (String(st.size) !== n.attrs.size) live.size[id] = st.size;
          if (opts.touched?.includes(rel)) live.changed[id] = st.mtimeMs;
        }
      }
    }
  }
  for (const rel of opts.touched ?? []) { // 被事件触及但所在目录没被对账到的文件:只更新实时信号
    const id = idOfRel(rel), n = u.nodes.get(id);
    if (!n || n.attrs.type !== 'file' || live.changed[id] !== undefined) continue;
    const st = fsv.stat(rel);
    if (st) { live.changed[id] = st.mtimeMs; if (String(st.size) !== n.attrs.size) live.size[id] = st.size; }
  }

  // ---- 重命名/移动识别 ----
  const ops: Op[] = [];
  const pairs: Array<[string, string]> = [];
  const newAttrs = new Map<string, { file: string; label: string; size?: number }>();
  const parentFix: Array<{ id: string; oldParent: string; newParent: string }> = [];

  const removedFiles = removedTop.filter((id) => u.nodes.get(id)!.attrs.type === 'file');
  const removedDirs = removedTop.filter((id) => u.nodes.get(id)!.attrs.type === 'dir');
  const addedTopDirs = added.filter((a) => a.dir && !fresh.has(parentRel(a.rel)) );
  const addedFilesFlat = added.filter((a) => !a.dir);
  const usedAdded = new Set<string>(), usedRemoved = new Set<string>();

  // 目录:内容签名(子树里每个文件的 相对路径:大小)一致才算同一个目录
  const sigOfRemoved = (id: string) => {
    const base = relOf(id);
    return subtree(id).filter((x) => u.nodes.get(x)!.attrs.type === 'file')
      .map((x) => `${relOf(x).slice(base.length)}:${u.nodes.get(x)!.attrs.size ?? ''}`).sort().join('|');
  };
  const sigOfAdded = (a: Added) => addedFilesFlat.filter((f) => f.rel.startsWith(a.rel))
    .map((f) => `${f.rel.slice(a.rel.length)}:${f.size}`).sort().join('|');
  const addedBySig = new Map<string, Added[]>();
  for (const a of addedTopDirs) { const sg = sigOfAdded(a); if (sg) addedBySig.set(sg, [...(addedBySig.get(sg) ?? []), a]); }
  const removedBySig = new Map<string, string[]>();
  for (const id of removedDirs) { const sg = sigOfRemoved(id); if (sg) removedBySig.set(sg, [...(removedBySig.get(sg) ?? []), id]); }
  for (const [sg, rs] of removedBySig) {
    const as = addedBySig.get(sg);
    if (rs.length !== 1 || as?.length !== 1) continue; // 有歧义就不猜
    const oldId = rs[0]!, a = as[0]!, oldRel = relOf(oldId);
    usedRemoved.add(oldId); usedAdded.add(a.rel);
    for (const x of subtree(oldId)) {
      const nrel = a.rel + relOf(x).slice(oldRel.length);
      pairs.push([x, nrel]);
      newAttrs.set(x, { file: nrel, label: u.nodes.get(x)!.label === baseName(relOf(x)) ? baseName(nrel) : u.nodes.get(x)!.label });
    }
    parentFix.push({ id: a.rel, oldParent: parentOf.get(oldId) ?? '', newParent: a.parent });
    for (const f of addedFilesFlat) if (f.rel.startsWith(a.rel)) usedAdded.add(f.rel);
    for (const d of added) if (d.dir && d.rel.startsWith(a.rel)) usedAdded.add(d.rel);
  }

  // 文件:同名同大小;其次同扩展名同大小;都要求一一对应
  const freeAdded = addedFilesFlat.filter((a) => !usedAdded.has(a.rel));
  const freeRemoved = removedFiles.filter((id) => !usedRemoved.has(id));
  const matchBy = (keyR: (id: string) => string, keyA: (a: Added) => string) => {
    const rm = new Map<string, string[]>(), am = new Map<string, Added[]>();
    for (const id of freeRemoved) if (!usedRemoved.has(id)) { const k = keyR(id); rm.set(k, [...(rm.get(k) ?? []), id]); }
    for (const a of freeAdded) if (!usedAdded.has(a.rel)) { const k = keyA(a); am.set(k, [...(am.get(k) ?? []), a]); }
    for (const [k, rs] of rm) {
      const as = am.get(k);
      if (!as || rs.length !== 1 || as.length !== 1) continue;
      const id = rs[0]!, a = as[0]!, n = u.nodes.get(id)!;
      usedRemoved.add(id); usedAdded.add(a.rel);
      pairs.push([id, a.rel]);
      newAttrs.set(id, { file: a.rel, label: n.label === baseName(relOf(id)) ? baseName(a.rel) : n.label, size: a.size });
      const oldParent = parentOf.get(id) ?? '';
      if (oldParent !== a.parent) parentFix.push({ id: a.rel, oldParent, newParent: a.parent });
    }
  };
  matchBy((id) => `${baseName(relOf(id))}|${u.nodes.get(id)!.attrs.size ?? ''}`, (a) => `${baseName(a.rel)}|${a.size}`);
  matchBy((id) => `${extOf(baseName(relOf(id)))}|${u.nodes.get(id)!.attrs.size ?? ''}`, (a) => (a.size > 0 ? `${extOf(baseName(a.rel))}|${a.size}` : `#${a.rel}`));

  if (pairs.length > 0) {
    ops.push({ op: 'renameNodes', pairs });
    for (const [from, to] of pairs) {
      const na = newAttrs.get(from);
      if (na) ops.push({ op: 'setNode', id: to, label: na.label, set: { file: na.file, ...(na.size !== undefined ? { size: String(na.size) } : {}) } });
    }
    for (const f of parentFix) {
      if (f.oldParent && f.oldParent !== f.newParent) {
        ops.push({ op: 'removeEdge', from: f.oldParent, type: 'contains', to: f.id });
        ops.push({ op: 'addEdge', from: f.newParent, type: 'contains', to: f.id });
      }
    }
  }

  // ---- 删除/标记缺失(自底向上) ----
  let nMissing = 0, nRemoved = 0;
  const dead = new Set<string>();
  for (const root of removedTop) {
    if (usedRemoved.has(root)) continue;
    const nodes = subtree(root).reverse();                       // 叶子在前
    for (const id of nodes) {
      const n = u.nodes.get(id)!;
      const blocked = semantic.has(id) || (kids.get(id) ?? []).some((k) => isFsNode(k) && !dead.has(k));
      if (blocked) { if (n.attrs.missing !== 'true') { ops.push({ op: 'setNode', id, set: { missing: 'true' } }); nMissing++; } }
      else { ops.push({ op: 'removeNode', id }); dead.add(id); nRemoved++; }
    }
  }
  for (const id of revive) ops.push({ op: 'setNode', id, unset: ['missing'] });

  // ---- 新增 ----
  const addedNow = added.filter((a) => !usedAdded.has(a.rel));
  for (const a of addedNow) {
    const name = baseName(a.rel);
    const attrs: Attrs = { type: a.dir ? 'dir' : 'file', file: a.rel };
    if (!a.dir) { const ext = extOf(name); if (ext) attrs.ext = ext; attrs.size = String(a.size); }
    ops.push({ op: 'addNode', id: a.rel, label: name, attrs });
  }
  for (const a of addedNow) ops.push({ op: 'addEdge', from: a.parent, type: 'contains', to: a.rel });

  return {
    op: ops.length ? { op: 'batch', ops } : null,
    live,
    stats: { added: addedNow.length, removed: nRemoved, renamed: pairs.length, missing: nMissing, revived: revive.length, dirs: dirsRead },
  };
}
