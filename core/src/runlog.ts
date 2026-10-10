// 脚本节点的运行记录(L4):<宇宙文件>.runs 一行一条;节点 ~run/<名字> 记最近一次"有事"的运行
// (写了东西、出错、状态变了;record=always 则每次都记)—— 定时检查的脚本不会把操作日志刷满。
import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { type Op } from './ops.ts';
import { AGENT_AUTHOR, RUN_PREFIX, type RunRecord, type ScriptDef } from './scriptnode.ts';
import { Store, withLock } from './store.ts';

export const runsPath = (file: string): string => `${file}.runs`;
const RUNS_MAX_BYTES = 2 << 20, RUNS_KEEP = 2000;

export function readRuns(file: string, opts: { script?: string; id?: string; limit?: number } = {}): RunRecord[] {
  let text: string;
  try { text = readFileSync(runsPath(file), 'utf8'); } catch { return []; }
  const out: RunRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r: RunRecord;
    try { r = JSON.parse(line) as RunRecord; } catch { continue; }
    if (opts.script && r.script !== opts.script) continue;
    if (opts.id && r.id !== opts.id) continue;
    out.push(r);
  }
  return opts.limit ? out.slice(-opts.limit) : out;
}

/** 追加一条运行记录;文件太大时只留最近的 2000 条 */
export function appendRun(file: string, rec: RunRecord): void {
  withLock(file, () => {
    const p = runsPath(file);
    appendFileSync(p, JSON.stringify(rec) + '\n');
    try {
      if (statSync(p).size > RUNS_MAX_BYTES) {
        const lines = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
        writeFileSync(`${p}.tmp`, lines.slice(-RUNS_KEEP).join('\n') + '\n');
        renameSync(`${p}.tmp`, p);
      }
    } catch { /* 下次再修剪 */ }
  });
}

/** 记下一次运行:追加到 .runs;有事(写了东西 / 出错 / 状态变了 / record=always / 第一次)才更新节点 ~run/<名字> */
export function recordRun(file: string, rec: RunRecord, def: ScriptDef | null): boolean {
  appendRun(file, rec);
  const store = new Store(file);
  return withLock(file, () => {
    const u = store.peek(), id = RUN_PREFIX + rec.script, prev = u.nodes.get(id);
    const notable = def?.record === 'always' || !prev || rec.status !== 'ok' || rec.ops > 0 || rec.draft > 0 || prev.attrs.status !== rec.status;
    if (!notable) return false;
    const attrs: Record<string, string> = {
      kind: 'run', script: rec.script, status: rec.status, t: rec.t, ms: String(rec.ms), trigger: rec.trigger, ops: String(rec.ops),
      ...(rec.draft ? { draft: String(rec.draft) } : {}), ...(rec.out.trim() ? { out: rec.out.trim().slice(-600) } : {}),
    };
    const unset = prev ? ['draft', 'out'].filter((k) => k in prev.attrs && !(k in attrs)) : [];
    const op: Op = prev ? { op: 'setNode', id, set: attrs, unset } : { op: 'addNode', id, label: `${rec.script} 的运行`, attrs };
    store.commit(op, { author: AGENT_AUTHOR });
    return true;
  });
}
