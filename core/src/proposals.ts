// 待确认的提议:谁、何时提的。纯逻辑,浏览器和 Node 共用(浏览器里随日志增量更新)。
//   · 提议的边:attrs.status = proposed,键是 from|type|to
//   · 提议的节点:attrs.status = proposed,键是 #id(id 不能以 # 开头,所以和边的键不会撞)
import { type Op } from './ops.ts';

export interface Proposal { author: string; t: number; n: number }
export interface EntryLike { n: number; t: string; author: string; op: Op }

const key = (f: string, t: string, to: string) => `${f}|${t}|${to}`;
export const nodeProposalKey = (id: string) => '#' + id;

/** 把一条日志对"待确认集合"的影响应用上去(原地修改 map)。 */
export function trackProposals(map: Record<string, Proposal>, e: EntryLike): void {
  const mark = (k: string) => { map[k] = { author: e.author, t: Date.parse(e.t), n: e.n }; };
  const visit = (op: Op): void => {
    switch (op.op) {
      case 'batch': for (const sub of op.ops) visit(sub); break;
      case 'addNode':
        if (op.attrs?.status === 'proposed') mark(nodeProposalKey(op.id));
        else delete map[nodeProposalKey(op.id)];
        break;
      case 'setNode':
        if (op.unset?.includes('status') || (op.set?.status !== undefined && op.set.status !== 'proposed')) delete map[nodeProposalKey(op.id)];
        if (op.set?.status === 'proposed') mark(nodeProposalKey(op.id));
        break;
      case 'removeNode': delete map[nodeProposalKey(op.id)]; break;
      case 'addEdge':
        if (op.attrs?.status === 'proposed') mark(key(op.from, op.type, op.to));
        else delete map[key(op.from, op.type, op.to)];
        break;
      case 'removeEdge': delete map[key(op.from, op.type, op.to)]; break;
      case 'setEdge':
        if (op.unset?.includes('status') || (op.set?.status !== undefined && op.set.status !== 'proposed')) delete map[key(op.from, op.type, op.to)];
        if (op.set?.status === 'proposed') mark(key(op.from, op.type, op.to));
        break;
      case 'renameNodes': {
        const m = new Map(op.pairs);
        for (const k of Object.keys(map)) {
          if (k.startsWith('#')) {
            const id = k.slice(1);
            if (m.has(id)) { const v = map[k]!; delete map[k]; map[nodeProposalKey(m.get(id)!)] = v; }
            continue;
          }
          const [f, t, to] = k.split('|');
          if (m.has(f!) || m.has(to!)) { const v = map[k]!; delete map[k]; map[key(m.get(f!) ?? f!, t!, m.get(to!) ?? to!)] = v; }
        }
        break;
      }
      default: break;
    }
  };
  visit(e.op);
}
