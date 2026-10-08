// "信号":关于每个节点的、宇宙文件本身没有记录的时间信息。
//   touched      图里最近被编辑(来自操作日志)
//   fileChanged  节点指向的文件最近被提交过,或工作区里正有未提交的修改(来自 git)
// 视图规则可以用它们给节点上色/定大小(见 view.ts 的 recency)。仅 Node 端使用。

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { type Universe } from './model.ts';
import { type Op } from './ops.ts';
import { type LogEntry } from './store.ts';

export interface Signals {
  touched: Record<string, number>;
  fileChanged: Record<string, number>;
}

function opIds(op: Op, out: string[]): void {
  switch (op.op) {
    case 'addNode': case 'setNode': case 'removeNode': out.push(op.id); break;
    case 'addEdge': case 'setEdge': case 'removeEdge': out.push(op.from, op.to); break;
    case 'batch': for (const sub of op.ops) opIds(sub, out); break;
  }
}

/** 每个节点最近一次被操作触及的时间(毫秒)。边的变动算在两个端点头上。 */
export function touchedFromLog(log: LogEntry[]): Record<string, number> {
  const touched: Record<string, number> = {};
  for (const e of log) {
    const t = Date.parse(e.t);
    if (!Number.isFinite(t)) continue;
    const ids: string[] = [];
    opIds(e.op, ids);
    for (const id of ids) if (!(touched[id] >= t)) touched[id] = t;
  }
  return touched;
}

function git(baseDir: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotePath=false', '-C', baseDir, ...args], {
    encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function bump(map: Map<string, number>, path: string, t: number): void {
  if (!(map.get(path)! >= t)) map.set(path, t);
  // 沿路径往上,给每一级目录也记上最近时间(目录节点的 file 以 / 结尾)
  for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) {
    const dir = path.slice(0, i + 1);
    if (!(map.get(dir)! >= t)) map.set(dir, t);
  }
}

/** 路径(相对 baseDir)-> 最近一次变动的时间(毫秒)。不在 git 仓库里就返回空。 */
export function fileTimes(baseDir: string, maxCommits = 5000): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const out = git(baseDir, ['log', '--relative', '--name-only', '--no-renames', '--format=%x00%at', '-n', String(maxCommits), '--', '.']);
    for (const chunk of out.split('\0')) {
      if (!chunk) continue;
      const [at, ...files] = chunk.split('\n');
      const t = Number(at) * 1000;
      if (!Number.isFinite(t)) continue;
      for (const f of files) if (f && !map.has(f)) bump(map, f, t);
    }
    // 工作区里有未提交修改的文件:用它的修改时间(克隆下来的干净文件 mtime 没有意义,所以只看这些)
    const prefix = git(baseDir, ['rev-parse', '--show-prefix']).trim();
    const status = git(baseDir, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
    for (const entry of status.split('\0')) {
      if (entry.length < 4) continue;
      let path = entry.slice(3);
      if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length);
      try {
        bump(map, path, statSync(join(baseDir, path)).mtimeMs);
      } catch { /* 已删除 */ }
    }
  } catch { /* 不是 git 仓库 */ }
  return map;
}

export function fileChangedFor(u: Universe, times: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of u.nodes.values()) {
    const f = n.attrs.file?.split('#')[0];
    const t = f ? times.get(f) : undefined;
    if (t !== undefined) out[n.id] = t;
  }
  return out;
}

/** git 那部分相对昂贵,按目录缓存几秒。 */
const cache = new Map<string, { at: number; times: Map<string, number> }>();
export function loadSignals(log: LogEntry[], u: Universe, baseDir: string, ttlMs = 3000): Signals {
  let hit = cache.get(baseDir);
  if (!hit || Date.now() - hit.at > ttlMs) {
    hit = { at: Date.now(), times: fileTimes(baseDir) };
    cache.set(baseDir, hit);
  }
  return { touched: touchedFromLog(log), fileChanged: fileChangedFor(u, hit.times) };
}

export interface Proposal { author: string; t: number; n: number }

/** 当前仍待确认的边 -> 是谁、何时提议的(从操作日志里回溯)。 */
export function proposalsFromLog(log: LogEntry[], u: Universe): Record<string, Proposal> {
  const out: Record<string, Proposal> = {};
  const key = (f: string, t: string, to: string) => `${f}|${t}|${to}`;
  const visit = (op: Op, e: LogEntry): void => {
    if (op.op === 'batch') { for (const sub of op.ops) visit(sub, e); return; }
    if (op.op === 'addEdge') { if (op.attrs?.status === 'proposed') out[key(op.from, op.type, op.to)] = { author: e.author, t: Date.parse(e.t), n: e.n }; else delete out[key(op.from, op.type, op.to)]; }
    if (op.op === 'removeEdge') delete out[key(op.from, op.type, op.to)];
    if (op.op === 'setEdge' && op.unset?.includes('status')) delete out[key(op.from, op.type, op.to)];
    if (op.op === 'setEdge' && op.set?.status === 'proposed') out[key(op.from, op.type, op.to)] = { author: e.author, t: Date.parse(e.t), n: e.n };
  };
  for (const e of log) visit(e.op, e);
  // 只保留宇宙里仍然是 proposed 的
  for (const k of Object.keys(out)) {
    const [f, t, to] = k.split('|');
    const edge = [...u.edges.values()].find((x) => x.from === f && x.type === t && x.to === to);
    if (!edge || edge.attrs.status !== 'proposed') delete out[k];
  }
  return out;
}
