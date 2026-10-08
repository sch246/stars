// 历史:宇宙文件在 git 里的提交图(DAG,不是一条线)。
// 为什么用 git:宇宙文件是"排序后一行一个事实"的文本,git 的三方合并天然能合并它,
// 分支、合并、协作都白送。操作日志(.log)只负责提交之内的细粒度,而且是线性的。仅 Node 端使用。

import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { parse } from './format.ts';
import { type Universe, edgeKey } from './model.ts';

export interface Commit {
  hash: string;
  /** 只含"改动过宇宙文件"的祖先(git 的历史简化会把无关提交折叠掉) */
  parents: string[];
  time: number; // 毫秒
  author: string;
  subject: string;
  refs: string[];
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotePath=false', '-C', dir, ...args], {
    encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** 所有分支上改动过该文件的提交,新的在前。不在 git 仓库里返回 []。 */
export function gitHistory(file: string, limit = 400): { commits: Commit[]; head: string | null; dirty: boolean } {
  const dir = dirname(file), name = basename(file);
  try {
    const out = git(dir, ['log', '--all', '--parents', '--full-history', '--topo-order', '-n', String(limit),
      '--format=%H%x1f%P%x1f%at%x1f%an%x1f%s%x1e', '--', name]);
    const refs = new Map<string, string[]>();
    for (const line of git(dir, ['for-each-ref', '--format=%(objectname) %(refname:short)', 'refs/heads', 'refs/tags']).split('\n')) {
      const [h, ...r] = line.trim().split(' ');
      if (h && r.length) refs.set(h, [...(refs.get(h) ?? []), r.join(' ')]);
    }
    const commits = out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((rec): Commit => {
      const [hash, parents, at, author, subject] = rec.split('\x1f');
      return {
        hash: hash!, parents: (parents ?? '').split(' ').filter(Boolean),
        time: Number(at) * 1000, author: author ?? '', subject: subject ?? '', refs: refs.get(hash!) ?? [],
      };
    });
    const head = git(dir, ['rev-parse', 'HEAD']).trim();
    const dirty = git(dir, ['status', '--porcelain', '--', name]).trim() !== '';
    return { commits, head, dirty };
  } catch {
    return { commits: [], head: null, dirty: false };
  }
}

/** 某次提交时的宇宙。 */
export function gitSnapshot(file: string, hash: string): Universe {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error('非法的提交 id');
  return parse(git(dirname(file), ['show', `${hash}:./${basename(file)}`]));
}

export interface UniverseDiff {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
}

/** 两个宇宙之间的差异(a 为 null 表示从空开始)。 */
export function diffUniverses(a: Universe | null, b: Universe): UniverseDiff {
  const d: UniverseDiff = { addedNodes: [], removedNodes: [], changedNodes: [], addedEdges: [], removedEdges: [] };
  for (const [id, n] of b.nodes) {
    const old = a?.nodes.get(id);
    if (!old) d.addedNodes.push(id);
    else if (old.label !== n.label || JSON.stringify(old.attrs) !== JSON.stringify(n.attrs)) d.changedNodes.push(id);
  }
  if (a) for (const id of a.nodes.keys()) if (!b.nodes.has(id)) d.removedNodes.push(id);
  for (const [k, e] of b.edges) if (!a?.edges.has(k)) d.addedEdges.push(edgeKey(e.from, e.type, e.to));
  if (a) for (const [k, e] of a.edges) if (!b.edges.has(k)) d.removedEdges.push(edgeKey(e.from, e.type, e.to));
  return d;
}
