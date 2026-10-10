// 整理:把节点移动 / 复制 / 引用进另一个容器(查看器里 Shift / Ctrl / Alt 拖,CLI 的 mv / cp / ln)。
//   移动 = 换上级:去掉从原来容器来的那条容器关系,加一条从目标来的。文件 / 文件夹是真的在磁盘上搬,
//          节点 id(= 路径)跟着改,它的所有关系一起走(renameNodes),文件夹里的东西一起改名。
//   复制 = 一份新的:节点和它容器里的东西(沿容器关系递归)都复制,里面之间的边、指向外面的边一起复制,
//          外面指向它的不复制(像复制文件:它引用别人照旧,没人引用副本)。文件 / 文件夹在磁盘上真的复制一份。
//          概念里装着的文件不复制文件本身,副本照样装着原来那个文件。
//   引用 = 也放进这里:只加一条容器关系(一个节点可以在几个容器里),什么都不搬。
//   打包 = 新建一个域,把同一层的几个放进去(在文件夹里 = 真的新建文件夹、把文件搬进去;在概念里 = 一个概念域)。
//   解散 = 域里的东西放回上一层,再删掉这个域;会丢东西(域自己的说明、关系)或有冲突(重名、磁盘上还有图里没有的文件)时先报出来。
//   删除 = 节点连同它的边删掉;文件 / 文件夹挪进回收站(git 仓库里是 .git/stars-trash/,否则 .stars-trash/),撤销时搬回来。
//          只删节点、文件留着的话,开着同步时它马上又会被加回来(没有说明和关系),所以默认连文件一起。
// 放进它自己或它里面的东西,一律拒绝。这里只算「要做什么」(图的操作 + 磁盘动作),真正动磁盘的是 fsops.ts。
// 这个文件同时在 Node 和浏览器里运行;静态导出拼进同一个作用域:顶层名字都以 arrange 开头。
import { type Node, type Universe, StarsError, edgeKey, isSchemaId } from './model.ts';
import { type Op } from './ops.ts';

export type ArrangeMode = 'move' | 'copy' | 'ref' | 'delete' | 'group' | 'ungroup';
/** 回收站目录(相对项目根);扫描和同步都跳过它 */
export const ARRANGE_TRASH = '.stars-trash/';
/** 磁盘上的动作(路径相对项目根;文件夹以 / 结尾)。create = 新写了一个文件(粘贴、拖进来的),撤销时删掉;
 *  mkdir = 新建空文件夹(打包),rmdir = 删掉空文件夹(解散;不空就失败,整步倒回) */
export interface FsAct { act: 'move' | 'copy' | 'delete' | 'create' | 'mkdir' | 'rmdir'; from: string; to: string }
export interface ArrangeOpts {
  /** 容器关系(视图的 expand.relation),默认 contains;文件系统的结构永远是 contains */
  rel?: string;
  /** 移动时每个节点从哪个容器移出(节点有几个上级时要指明);不给 = 文件按所在文件夹,别的按唯一的上级 */
  from?: Record<string, string | null>;
  /** 文件系统的挂载根(扫描时的根目录节点);不给 = 找没有 file 属性的 dir 节点 */
  mountId?: string;
  /** 删除:回收站目录(以 / 结尾)与这一次的子目录名;nodeOnly = 只删节点,文件留着 */
  trash?: string;
  stamp?: string;
  nodeOnly?: boolean;
  /** 打包:新域的名字与类型(概念域的 type,默认 concept);inferParent = 上一层没给时自己找(共同的上级) */
  name?: string;
  type?: string;
  inferParent?: boolean;
  /** 解散:有会丢东西的冲突(域自己的说明、关系)也照做 */
  force?: boolean;
  /** 磁盘上这个路径有没有东西(起新名字时避开;fsops 传进来) */
  exists?: (path: string) => boolean;
}
export interface ArrangePlan {
  op: Op | null;
  fs: FsAct[];
  summary: string;
  /** 结果里对应原来每个(根)节点的 id:移动后可能改了名,复制后是副本;打包 = 新域;解散 = 放回去的那些 */
  result: string[];
  skipped: string[];
  /** 解散时的冲突:hard = 做不了(重名……),soft = 会丢东西(force 才做);有冲突时 op 为 null */
  conflicts?: { hard: string[]; soft: string[] };
}

const arrangeBase = (p: string) => p.replace(/\/$/, '').split('/').pop()!;
const arrangeParentPath = (p: string) => { const t = p.replace(/\/$/, ''); const i = t.lastIndexOf('/'); return i < 0 ? '' : t.slice(0, i + 1); };

/** 文件夹 dir(以 / 结尾或空 = 根)里不和别人重名的路径:a.ts → a-copy.ts → a-copy2.ts(文件夹 x/ → x-copy/;id 里不能有空白) */
export function arrangeFreePath(dir: string, name: string, isDir: boolean, taken: (p: string) => boolean): string {
  const dot = isDir ? -1 : name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '', tail = isDir ? '/' : '';
  let p = dir + name + tail;
  for (let i = 1; taken(p); i++) p = `${dir}${stem}-copy${i > 1 ? i : ''}${ext}${tail}`;
  return p;
}
/** 外面来的文件名(粘贴、拖进来的)变成能当 id 的:去掉路径,空白换成 -,控制字符和引号去掉 */
export function arrangeCleanName(name: string): string {
  const base = String(name).split(/[\\/]/).pop()!.replace(/[\u0000-\u001f"]/g, '').replace(/\s+/g, '-').replace(/^#+/, '');
  return base && base !== '.' && base !== '..' ? base : 'file';
}

/** 文件系统节点:扫描出来的 dir / file(id 就是路径),或者挂载根 */
export function arrangeIsFs(n: Node | undefined, mountId?: string): boolean {
  if (!n) return false;
  if (n.id === mountId) return true;
  const t = n.attrs.type;
  if (t === 'dir' && !n.attrs.file) return mountId === undefined;
  return (t === 'dir' || t === 'file') && n.attrs.file === n.id;
}
export function arrangeMount(u: Universe, mountId?: string): string | undefined {
  if (mountId) return mountId;
  for (const n of u.nodes.values()) if (n.attrs.type === 'dir' && !n.attrs.file && !isSchemaId(n.id)) return n.id;
  return undefined;
}

export function planArrange(u: Universe, mode: ArrangeMode, ids: string[], target: string | null, opts: ArrangeOpts = {}): ArrangePlan {
  const rel = opts.rel ?? 'contains';
  const mount = arrangeMount(u, opts.mountId);
  const isFs = (id: string) => arrangeIsFs(u.nodes.get(id), mount);
  const pathOf = (id: string) => (id === mount ? '' : u.nodes.get(id)!.attrs.file!);
  const isDir = (id: string) => isFs(id) && (id === mount || u.nodes.get(id)!.attrs.type === 'dir');
  const idOfPath = (p: string) => (p === '' ? mount! : p);
  const kids = new Map<string, string[]>(), parents = new Map<string, string[]>();
  for (const e of u.edges.values()) {
    if (e.type !== rel && e.type !== 'contains') continue;
    if (e.type === rel) { (kids.get(e.from) ?? kids.set(e.from, []).get(e.from)!).push(e.to); (parents.get(e.to) ?? parents.set(e.to, []).get(e.to)!).push(e.from); }
    else if (isFs(e.from) && isFs(e.to)) { (kids.get(e.from) ?? kids.set(e.from, []).get(e.from)!).push(e.to); (parents.get(e.to) ?? parents.set(e.to, []).get(e.to)!).push(e.from); }
  }
  const under = (x: string, top: string): boolean => {   // x 是不是 top 自己或在它里面(沿容器关系往下)
    const seen = new Set([top]), stack = [top];
    while (stack.length) { const c = stack.pop()!; if (c === x) return true; for (const k of kids.get(c) ?? []) if (!seen.has(k)) { seen.add(k); stack.push(k); } }
    return false;
  };
  const label = (id: string) => u.nodes.get(id)?.label ?? id;

  // ---- 检查 ----
  const uniq = [...new Set(ids)];
  if (!uniq.length && mode !== 'group') throw new StarsError('没有要整理的节点');
  for (const id of uniq) {
    if (!u.nodes.has(id)) throw new StarsError(`节点不存在: ${id}`);
    if (isSchemaId(id)) throw new StarsError(`模式节点不能整理: ${id}`);
    if (id === mount) throw new StarsError('不能动项目的根目录');
  }
  if (target !== null && !u.nodes.has(target)) throw new StarsError(`目标不存在: ${target}`);
  // 选中里互相包含的:只留最外层(外层动了,里面的跟着走)
  const roots = uniq.filter((id) => !uniq.some((o) => o !== id && under(id, o)));
  if (target !== null) for (const id of roots) {
    if (id === target) throw new StarsError(`不能把「${label(id)}」放到它自己身上`);
    if (under(target, id)) throw new StarsError(`不能把「${label(id)}」放进它自己里面(「${label(target)}」在它里面)`);
  }
  const ops: Op[] = [], fs: FsAct[] = [], result: string[] = [], skipped: string[] = [];
  const tLabel = target === null ? '顶层' : label(target);
  const onDisk = opts.exists ?? (() => false);
  /** 文件 / 文件夹搬进 destPath(以 / 结尾或空)这个文件夹:节点按路径改名(文件夹里的一起),换 contains 的上级,记一条磁盘搬动 */
  const fsRelocate = (id: string, destPath: string, destId: string, oldParent: string | null): string => {
    const old = pathOf(id), nu = destPath + arrangeBase(old) + (isDir(id) ? '/' : '');
    const pairs: Array<[string, string]> = [];
    for (const n of u.nodes.values()) if (n.id === id || (isDir(id) && isFs(n.id) && n.id !== mount && pathOf(n.id).startsWith(old))) pairs.push([n.id, nu + pathOf(n.id).slice(old.length)]);
    ops.push({ op: 'renameNodes', pairs });
    for (const [a, b] of pairs) { const n = u.nodes.get(a)!; ops.push({ op: 'setNode', id: b, ...(n.label === arrangeBase(a) ? { label: arrangeBase(b) } : {}), set: { file: b } }); }
    if (oldParent !== null && u.edges.has(edgeKey(oldParent, 'contains', id))) ops.push({ op: 'removeEdge', from: oldParent, type: 'contains', to: nu });
    ops.push({ op: 'addEdge', from: destId, type: 'contains', to: nu });
    fs.push({ act: 'move', from: old, to: nu });
    return nu;
  };
  const fsParentOf = (id: string) => idOfPath(arrangeParentPath(pathOf(id)));
  /** 节点在 parent 这一层吗(文件按所在文件夹;别的按容器关系;parent = null 是顶层 = 没有上级) */
  const inLayer = (id: string, parent: string | null) => (isFs(id) ? fsParentOf(id) === parent : parent === null ? !(parents.get(id) ?? []).length : u.edges.has(edgeKey(parent, rel, id)));

  if (mode === 'group') {
    let parent = target;
    if (parent === null && opts.inferParent && roots.length) {   // 共同的上级:每个节点的上级集合取交集
      const sets = roots.map((id) => new Set(isFs(id) ? [fsParentOf(id)] : parents.get(id) ?? []));
      const common = [...sets[0]!].filter((p) => sets.every((s) => s.has(p)));
      if (common.length > 1) throw new StarsError(`这几个同时在 ${common.map(label).join('、')} 里,要指明打包在哪一层(--from)`);
      parent = common[0] ?? null;
      if (parent === null && !roots.every((id) => inLayer(id, null))) throw new StarsError('不是同一层的,打包不了(打包只能打包同一层的几个)');
    }
    for (const id of roots) if (!inLayer(id, parent)) throw new StarsError(`「${label(id)}」不在「${parent === null ? '顶层' : label(parent)}」这一层(打包只能打包同一层的几个)`);
    const name = (opts.name ?? '').trim() || '新域';
    const folder = parent !== null && isDir(parent) && (roots.length === 0 || roots.some(isFs));   // 在文件夹里:域就是文件夹
    let cid: string;
    if (folder) {
      cid = arrangeFreePath(pathOf(parent!), arrangeCleanName(name), true, (p) => u.nodes.has(p) || onDisk(p));
      ops.push({ op: 'addNode', id: cid, label: arrangeBase(cid), attrs: { type: 'dir', file: cid } }, { op: 'addEdge', from: parent!, type: 'contains', to: cid });
      fs.push({ act: 'mkdir', from: cid, to: cid });
    } else {
      const base = arrangeCleanName(name);
      cid = base; for (let i = 2; u.nodes.has(cid); i++) cid = `${base}-${i}`;
      ops.push({ op: 'addNode', id: cid, label: name, attrs: { type: opts.type || 'concept' } });
      if (parent !== null) ops.push({ op: 'addEdge', from: parent, type: rel, to: cid });
    }
    for (const id of roots) {
      if (isFs(id)) fsRelocate(id, cid, cid, parent);
      else {
        if (parent !== null) ops.push({ op: 'removeEdge', from: parent, type: rel, to: id });
        ops.push({ op: 'addEdge', from: cid, type: rel, to: id });
      }
    }
    result.push(cid);
    return done(roots.length ? `打包 ${roots.length} 个 → ${folder ? '新文件夹' : '新域'}「${arrangeBase(cid) === cid ? name : arrangeBase(cid)}」` : `新建${folder ? '文件夹' : '域'}「${folder ? arrangeBase(cid) : name}」`);
  }

  if (mode === 'ungroup') {
    if (uniq.length !== 1) throw new StarsError('一次解散一个域');
    const c = uniq[0]!, kidsOf = [...new Set(kids.get(c) ?? [])];
    let parent: string | null;
    if (isFs(c)) parent = fsParentOf(c);
    else if (target !== null || !opts.inferParent) parent = target;
    else {
      const ps = parents.get(c) ?? [];
      if (ps.length > 1) throw new StarsError(`「${label(c)}」在 ${ps.length} 个容器里(${ps.map(label).join('、')}),要指明放回哪一层(--from)`);
      parent = ps[0] ?? null;
    }
    if (parent !== null && !inLayer(c, parent)) throw new StarsError(`「${label(c)}」不在「${label(parent)}」里`);
    const hard: string[] = [], soft: string[] = [];
    if (!kidsOf.length && !isFs(c)) soft.push(`「${label(c)}」里面是空的,解散就是删掉它`);
    for (const k of kidsOf) {
      if (!isFs(k)) continue;
      if (parent === null || !isDir(parent)) { hard.push(`「${label(k)}」是文件,只能放进文件夹`); continue; }
      const nu = pathOf(parent) + arrangeBase(pathOf(k)) + (isDir(k) ? '/' : '');
      if (u.nodes.has(nu)) hard.push(`「${label(parent)}」里已经有 ${arrangeBase(nu)} 了`);
    }
    if (u.nodes.get(c)!.attrs.summary) soft.push(`「${label(c)}」自己的说明会丢掉`);
    const own = [...u.edges.values()].filter((e) => (e.from === c || e.to === c)
      && !(e.to === c && (e.type === rel || e.type === 'contains') && e.from === parent)
      && !(e.from === c && (e.type === rel || e.type === 'contains') && kidsOf.includes(e.to)));
    if (own.length) soft.push(`「${label(c)}」还有 ${own.length} 条别的关系会丢掉(${[...new Set(own.map((e) => e.type))].slice(0, 4).join('、')}${own.length > 4 ? '…' : ''})`);
    if (hard.length || (soft.length && !opts.force)) return { op: null, fs: [], summary: `解散「${label(c)}」有冲突`, result: [], skipped: [], conflicts: { hard, soft } };
    for (const k of kidsOf) {
      if (isFs(k)) result.push(fsRelocate(k, pathOf(parent!), parent!, null));
      else { if (parent !== null && !u.edges.has(edgeKey(parent, rel, k))) ops.push({ op: 'addEdge', from: parent, type: rel, to: k }); result.push(k); }
    }
    ops.push({ op: 'removeNode', id: c });
    if (isFs(c)) fs.push({ act: 'rmdir', from: pathOf(c), to: pathOf(c) });
    return done(`解散「${label(c)}」:${kidsOf.length} 个放回「${parent === null ? '顶层' : label(parent)}」`);
  }

  if (mode === 'delete') {   // 选中的每一个都删(不只最外层);文件夹连同里面的文件节点
    const trash = opts.trash ?? ARRANGE_TRASH, stamp = opts.stamp ?? new Date().toISOString().replace(/[:.]/g, '-');
    const gone = new Set<string>();
    for (const id of uniq) {
      if (gone.has(id)) continue;
      if (isFs(id) && !opts.nodeOnly) {
        const old = pathOf(id);
        fs.push({ act: 'move', from: old, to: `${trash}${stamp}/${old}` });
        for (const n of u.nodes.values()) if (n.id === id || (isDir(id) && isFs(n.id) && n.id !== mount && pathOf(n.id).startsWith(old))) gone.add(n.id);
      } else gone.add(id);
    }
    // 外层文件夹挪走时里面的已经跟着走了:里面的那几条不再单独挪
    for (let i = fs.length - 1; i >= 0; i--) if (fs.some((a, j) => j !== i && a.from.endsWith('/') && fs[i]!.from !== a.from && fs[i]!.from.startsWith(a.from))) fs.splice(i, 1);
    for (const id of gone) ops.push({ op: 'removeNode', id });
    const files = [...gone].filter((id) => isFs(id)).length;
    return done(`删除 ${gone.size} 个节点${fs.length ? `(${files} 个文件 / 文件夹挪进回收站 ${trash}${stamp}/)` : ''}`);
  }

  if (mode === 'ref') {
    if (target === null) throw new StarsError('引用要放进一个容器里');
    if (u.nodes.get(`~${rel}`)?.attrs['single-parent'] === 'true') throw new StarsError(`这个宇宙规定了 ${rel} 只能有一个上级(~${rel} single-parent=true),引用不了;要放开:stars set '~${rel}' --unset single-parent`);
    for (const id of roots) {
      if (u.edges.has(edgeKey(target, rel, id))) { skipped.push(id); result.push(id); continue; }
      ops.push({ op: 'addEdge', from: target, type: rel, to: id });
      result.push(id);
    }
    return done(`引用 ${roots.length - skipped.length} 个 → ${tLabel}`);
  }

  if (mode === 'move') {
    const taken = new Set<string>();
    for (const id of roots) {
      if (isFs(id)) {
        if (target === null || !isDir(target)) throw new StarsError(`「${label(id)}」是${isDir(id) ? '文件夹' : '文件'},只能移到文件夹里(想让它也出现在「${tLabel}」:Alt 拖 = 引用)`);
        const old = pathOf(id), nu = pathOf(target) + arrangeBase(old) + (isDir(id) ? '/' : '');
        if (nu === old) { skipped.push(id); result.push(id); continue; }
        if (u.nodes.has(nu) || taken.has(nu)) throw new StarsError(`「${tLabel}」里已经有 ${arrangeBase(nu)} 了`);
        taken.add(nu);
        result.push(fsRelocate(id, pathOf(target), target, fsParentOf(id)));
        continue;
      }
      const ps = parents.get(id) ?? [];
      let from: string | null;
      if (opts.from && id in opts.from) from = opts.from[id] ?? null;
      else if (ps.length <= 1) from = ps[0] ?? null;
      else throw new StarsError(`「${label(id)}」在 ${ps.length} 个容器里(${ps.map(label).join('、')}),要指明从哪个移出(--from)`);
      if (from === target) { skipped.push(id); result.push(id); continue; }
      if (from !== null && u.edges.has(edgeKey(from, rel, id))) ops.push({ op: 'removeEdge', from, type: rel, to: id });
      if (target !== null && !u.edges.has(edgeKey(target, rel, id))) ops.push({ op: 'addEdge', from: target, type: rel, to: id });
      result.push(id);
    }
    return done(`移动 ${roots.length - skipped.length} 个 → ${tLabel}`);
  }

  // ---- 复制 ----
  const map = new Map<string, string>(), used = new Set<string>();
  const free = (id: string) => !u.nodes.has(id) && !used.has(id);
  const copyId = (id: string) => { let c = `${id}-copy`; for (let i = 2; !free(c); i++) c = `${id}-copy${i}`; used.add(c); return c; };
  const copyPath = (dir: string, name: string, isD: boolean) => { const p = arrangeFreePath(dir, name, isD, (x) => !free(x) || onDisk(x)); used.add(p); return p; };
  const order: string[] = [];
  for (const id of roots) {
    let base: string;
    if (isFs(id)) {
      if (target === null || !isDir(target)) throw new StarsError(`「${label(id)}」是${isDir(id) ? '文件夹' : '文件'},只能复制到文件夹里`);
      base = copyPath(pathOf(target), arrangeBase(pathOf(id)), isDir(id));
      fs.push({ act: 'copy', from: pathOf(id), to: base });
    } else base = copyId(id);
    map.set(id, base); order.push(id); result.push(base);
    // 容器里的东西:文件夹的子孙按路径;概念里装着的文件不复制(副本照样装着原来那个)
    const stack = [id];
    while (stack.length) {
      const c = stack.pop()!;
      for (const k of kids.get(c) ?? []) {
        if (map.has(k) || roots.includes(k) && k !== id) continue;
        if (isFs(k) && !isFs(c)) continue;
        if (isFs(k)) { if (!isFs(id)) continue; map.set(k, base + pathOf(k).slice(pathOf(id).length)); used.add(map.get(k)!); }
        else map.set(k, copyId(k));
        order.push(k); stack.push(k);
      }
    }
  }
  for (const id of order) {
    const n = u.nodes.get(id)!, nid = map.get(id)!, attrs = { ...n.attrs };
    delete attrs.missing;
    if (isFs(id)) attrs.file = nid;
    let lb = n.label;
    if (isFs(id)) { if (n.label === arrangeBase(id)) lb = arrangeBase(nid); }
    else if (roots.includes(id) && target !== null && (kids.get(target) ?? []).some((k) => u.nodes.get(k)?.label === n.label)) lb = `${n.label} 副本`;
    ops.push({ op: 'addNode', id: nid, label: lb, attrs });
  }
  for (const e of u.edges.values()) {
    if (!map.has(e.from)) continue;
    const to = map.get(e.to) ?? e.to;
    ops.push({ op: 'addEdge', from: map.get(e.from)!, type: e.type, to, attrs: { ...e.attrs } });
  }
  if (target !== null) for (const id of roots) ops.push({ op: 'addEdge', from: target, type: isFs(id) ? 'contains' : rel, to: map.get(id)! });
  return done(`复制 ${roots.length} 个${order.length > roots.length ? `(连同里面的 ${order.length - roots.length} 个)` : ''} → ${tLabel}`);

  function done(summary: string): ArrangePlan {
    return { op: ops.length ? (ops.length === 1 ? ops[0]! : { op: 'batch', ops }) : null, fs, summary, result, skipped };
  }
}

/** 撤销一组磁盘动作要做的动作(倒序):搬回去;复制出来的删掉 */
export function arrangeRevertFs(acts: FsAct[]): FsAct[] {
  return [...acts].reverse().map((a): FsAct => (a.act === 'move' ? { act: 'move', from: a.to, to: a.from }
    : a.act === 'copy' || a.act === 'create' ? { act: 'delete', from: a.to, to: a.act === 'copy' ? a.from : a.to }
    : a.act === 'mkdir' ? { act: 'rmdir', from: a.to, to: a.to } : a.act === 'rmdir' ? { act: 'mkdir', from: a.from, to: a.from }
    : { act: 'copy', from: a.to, to: a.from }));
}
