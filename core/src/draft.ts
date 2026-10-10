// 草稿:一批还没落进宇宙的改动(批量改动的预览)。
//   stars --draft link a dependsOn b、stars run --draft fix.js、stars scan --draft …… 写进 <宇宙文件>.draft(一行一条),
//   查看器把"应用之后的样子"画出来(新增 / 修改 / 删除各有记号,删掉的节点也看得到),
//   stars draft apply(或查看器里「应用」)把整批作为一次提交落进宇宙 —— 一次 undo 就全部撤回。
// 这个文件同时在 Node 和浏览器里运行(纯函数,只依赖 model / ops);静态导出拼进同一个作用域:顶层名字都以 draft 开头。

import { type Universe, edgeKey } from './model.ts';
import { apply, type Op } from './ops.ts';

export interface DraftEntry { t: string; author: string; op: Op }

export interface DraftPreview {
  /** 应用了草稿之后的宇宙(keepRemoved 时删掉的节点和它们的 contains 边也放回来了,见 removed) */
  u: Universe;
  added: Set<string>;
  changed: Set<string>;
  /** 草稿会删掉的节点:为了看得见,留在 u 里(连同把它挂在原位的那条 contains 边) */
  removed: Set<string>;
  addedEdges: number;
  removedEdges: number;
  /** 现在做不了的条目(宇宙在写草稿之后变了):下标与原因;预览时跳过它们 */
  failed: Array<{ i: number; error: string }>;
}

/** 深拷贝(apply 会原地改节点的 attrs,预览不能碰到实时的宇宙) */
export function draftCopy(u: Universe): Universe {
  const nodes = new Map(), edges = new Map();
  for (const [k, n] of u.nodes) nodes.set(k, { ...n, attrs: { ...n.attrs } });
  for (const [k, e] of u.edges) edges.set(k, { ...e, attrs: { ...e.attrs } });
  return { nodes, edges };
}

/** keepRemoved:把要删掉的节点留在结果里好画出来(查看器);读命令要的是真正"应用之后"的宇宙,传 false */
export function draftPreview(base: Universe, entries: DraftEntry[], opts: { keepRemoved?: boolean; relation?: string } = {}): DraftPreview {
  const keep = opts.keepRemoved ?? true, relation = opts.relation ?? 'contains';
  const u = draftCopy(base);
  const failed: DraftPreview['failed'] = [];
  entries.forEach((e, i) => { try { apply(u, e.op); } catch (err) { failed.push({ i, error: (err as Error).message }); } });
  const added = new Set<string>(), changed = new Set<string>(), removed = new Set<string>();
  for (const [id, n] of u.nodes) {
    const old = base.nodes.get(id);
    if (!old) added.add(id);
    else if (old.label !== n.label || JSON.stringify(old.attrs) !== JSON.stringify(n.attrs)) changed.add(id);
  }
  let addedEdges = 0, removedEdges = 0;
  for (const k of u.edges.keys()) if (!base.edges.has(k)) addedEdges++;
  const goneEdges = [];
  for (const [k, e] of base.edges) if (!u.edges.has(k)) { removedEdges++; goneEdges.push(e); }
  for (const [id, n] of base.nodes) if (!u.nodes.has(id)) { removed.add(id); if (keep) u.nodes.set(id, { ...n, attrs: { ...n.attrs } }); }
  // 删掉的节点放回原位:只放回把它挂在容器树上的边(两头都还在),别的删掉的边只计数
  if (keep) for (const e of goneEdges) {
    if (e.type === relation && removed.has(e.to) && u.nodes.has(e.from)) u.edges.set(edgeKey(e.from, e.type, e.to), { ...e, attrs: { ...e.attrs } });
  }
  return { u, added, changed, removed, addedEdges, removedEdges, failed };
}

/** 一条改动的简短描述(给人看) */
export function draftSummary(op: Op): string {
  switch (op.op) {
    case 'addNode': return `+ 节点 ${op.id}`;
    case 'removeNode': return `− 节点 ${op.id}`;
    case 'setNode': return `~ 节点 ${op.id}${op.set ? ' ' + Object.keys(op.set).join(',') : ''}${op.unset?.length ? ' −' + op.unset.join(',') : ''}${op.label !== undefined ? ' 标签' : ''}`;
    case 'renameNodes': return `↔ 改名 ×${op.pairs.length}`;
    case 'addEdge': return `+ ${op.from} -${op.type}-> ${op.to}`;
    case 'removeEdge': return `− ${op.from} -${op.type}-> ${op.to}`;
    case 'setEdge': return `~ ${op.from} -${op.type}-> ${op.to}`;
    case 'batch': return `批量 ×${op.ops.length}`;
  }
}

/** 这条改动碰到的节点(查看器里点一条改动就选中它) */
export function draftNodeOf(op: Op): string | null {
  switch (op.op) {
    case 'addNode': case 'removeNode': case 'setNode': return op.id;
    case 'addEdge': case 'removeEdge': case 'setEdge': return op.from;
    case 'renameNodes': return op.pairs[0]?.[1] ?? null;
    case 'batch': { for (const o of op.ops) { const id = draftNodeOf(o); if (id) return id; } return null; }
  }
}
