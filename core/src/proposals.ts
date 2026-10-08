// 待确认的提议边:谁、何时提的。纯逻辑,浏览器和 Node 共用(浏览器里随日志增量更新)。
import { type Op } from './ops.ts';

export interface Proposal { author: string; t: number; n: number }
export interface EntryLike { n: number; t: string; author: string; op: Op }

const key = (f: string, t: string, to: string) => `${f}|${t}|${to}`;

/** 把一条日志对"待确认集合"的影响应用上去(原地修改 map)。 */
export function trackProposals(map: Record<string, Proposal>, e: EntryLike): void {
  const visit = (op: Op): void => {
    switch (op.op) {
      case 'batch': for (const sub of op.ops) visit(sub); break;
      case 'addEdge':
        if (op.attrs?.status === 'proposed') map[key(op.from, op.type, op.to)] = { author: e.author, t: Date.parse(e.t), n: e.n };
        else delete map[key(op.from, op.type, op.to)];
        break;
      case 'removeEdge': delete map[key(op.from, op.type, op.to)]; break;
      case 'setEdge':
        if (op.unset?.includes('status')) delete map[key(op.from, op.type, op.to)];
        if (op.set?.status === 'proposed') map[key(op.from, op.type, op.to)] = { author: e.author, t: Date.parse(e.t), n: e.n };
        break;
      case 'renameNodes': {
        const m = new Map(op.pairs);
        for (const k of Object.keys(map)) {
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
