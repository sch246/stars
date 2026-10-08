// 所有对宇宙的修改都走这里。每个操作可逆(apply 返回逆操作),
// 并且带 author —— 将来的权限检查、审计、撤销都挂在这个入口上。

import {
  type Attrs, type Universe, StarsError, assertValidId, assertValidType,
  canonicalEnds, edgeKey, getEdge,
} from './model.ts';

export type Op =
  | { op: 'addNode'; id: string; label: string; attrs?: Attrs }
  | { op: 'setNode'; id: string; label?: string; set?: Attrs; unset?: string[] }
  | { op: 'removeNode'; id: string }
  /** 批量改 id(一遍扫描,O(节点+边)):节点的所有关系跟着走;逆操作是把每一对反过来 */
  | { op: 'renameNodes'; pairs: Array<[string, string]> }
  | { op: 'addEdge'; from: string; type: string; to: string; attrs?: Attrs }
  | { op: 'setEdge'; from: string; type: string; to: string; set?: Attrs; unset?: string[] }
  | { op: 'removeEdge'; from: string; type: string; to: string }
  | { op: 'batch'; ops: Op[] };

export interface Ctx {
  author: string;
}

/** 执行操作,原地修改 u,返回逆操作。失败时 u 保持不变。 */
export function apply(u: Universe, op: Op): Op {
  switch (op.op) {
    case 'addNode': {
      assertValidId(op.id);
      if (u.nodes.has(op.id)) throw new StarsError(`节点已存在: ${op.id}`);
      u.nodes.set(op.id, { id: op.id, label: op.label, attrs: { ...op.attrs } });
      return { op: 'removeNode', id: op.id };
    }
    case 'setNode': {
      const n = u.nodes.get(op.id);
      if (!n) throw new StarsError(`节点不存在: ${op.id}`);
      const prevLabel = n.label;
      const prev = pickPrev(n.attrs, op.set, op.unset);
      if (op.label !== undefined) n.label = op.label;
      patchAttrs(n.attrs, op.set, op.unset);
      return { op: 'setNode', id: op.id, label: prevLabel, set: prev.set, unset: prev.unset };
    }
    case 'removeNode': {
      const n = u.nodes.get(op.id);
      if (!n) throw new StarsError(`节点不存在: ${op.id}`);
      const incident = [...u.edges.values()].filter((e) => e.from === op.id || e.to === op.id);
      for (const e of incident) u.edges.delete(edgeKey(e.from, e.type, e.to));
      u.nodes.delete(op.id);
      return {
        op: 'batch',
        ops: [
          { op: 'addNode', id: n.id, label: n.label, attrs: n.attrs },
          ...incident.map((e): Op => ({ op: 'addEdge', from: e.from, type: e.type, to: e.to, attrs: e.attrs })),
        ],
      };
    }
    case 'renameNodes': {
      const map = new Map(op.pairs);
      if (map.size !== op.pairs.length) throw new StarsError('renameNodes: 源 id 重复');
      const targets = new Set<string>();
      for (const [from, to] of map) {
        if (!u.nodes.has(from)) throw new StarsError(`节点不存在: ${from}`);
        assertValidId(to);
        if (targets.has(to)) throw new StarsError(`renameNodes: 目标 id 重复: ${to}`);
        targets.add(to);
        if (u.nodes.has(to) && !map.has(to)) throw new StarsError(`节点已存在: ${to}`);
      }
      const nodes = [...u.nodes.entries()], edges = [...u.edges.values()];
      u.nodes.clear();
      for (const [id, n] of nodes) { const nid = map.get(id) ?? id; u.nodes.set(nid, nid === id ? n : { ...n, id: nid }); }
      u.edges.clear();
      for (const e of edges) {
        const a = map.get(e.from) ?? e.from, b = map.get(e.to) ?? e.to;
        const [from, to] = canonicalEnds(u, a, e.type, b);
        u.edges.set(edgeKey(from, e.type, to), { ...e, from, to });
      }
      return { op: 'renameNodes', pairs: op.pairs.map(([a, b]): [string, string] => [b, a]) };
    }
    case 'addEdge': {
      assertValidType(op.type);
      if (!u.nodes.has(op.from)) throw new StarsError(`起点不存在: ${op.from}`);
      if (!u.nodes.has(op.to)) throw new StarsError(`终点不存在: ${op.to}`);
      if (op.from === op.to) throw new StarsError(`不允许自环: ${op.from}`);
      const [from, to] = canonicalEnds(u, op.from, op.type, op.to);
      const key = edgeKey(from, op.type, to);
      if (u.edges.has(key)) throw new StarsError(`边已存在: ${from} -${op.type}-> ${to}`);
      u.edges.set(key, { from, type: op.type, to, attrs: { ...op.attrs } });
      return { op: 'removeEdge', from, type: op.type, to };
    }
    case 'setEdge': {
      const e = getEdge(u, op.from, op.type, op.to);
      if (!e) throw new StarsError(`边不存在: ${op.from} -${op.type}-> ${op.to}`);
      const prev = pickPrev(e.attrs, op.set, op.unset);
      patchAttrs(e.attrs, op.set, op.unset);
      return { op: 'setEdge', from: e.from, type: e.type, to: e.to, set: prev.set, unset: prev.unset };
    }
    case 'removeEdge': {
      const e = getEdge(u, op.from, op.type, op.to);
      if (!e) throw new StarsError(`边不存在: ${op.from} -${op.type}-> ${op.to}`);
      u.edges.delete(edgeKey(e.from, e.type, e.to));
      return { op: 'addEdge', from: e.from, type: e.type, to: e.to, attrs: e.attrs };
    }
    case 'batch': {
      const inverses: Op[] = [];
      try {
        for (const sub of op.ops) inverses.push(apply(u, sub));
      } catch (err) {
        for (const inv of inverses.reverse()) apply(u, inv);
        throw err;
      }
      return { op: 'batch', ops: inverses.reverse() };
    }
  }
}

function pickPrev(attrs: Attrs, set?: Attrs, unset?: string[]): { set: Attrs; unset: string[] } {
  const prevSet: Attrs = {};
  const prevUnset: string[] = [];
  for (const k of [...Object.keys(set ?? {}), ...(unset ?? [])]) {
    if (k in attrs) prevSet[k] = attrs[k]!;
    else prevUnset.push(k);
  }
  return { set: prevSet, unset: prevUnset };
}

function patchAttrs(attrs: Attrs, set?: Attrs, unset?: string[]): void {
  for (const k of unset ?? []) delete attrs[k];
  Object.assign(attrs, set);
}
