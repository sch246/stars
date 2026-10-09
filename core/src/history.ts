// 历史:宇宙文件在 git 里的提交图(DAG,不是一条线)。
// 为什么用 git:宇宙文件是"排序后一行一个事实"的文本,git 的三方合并天然能合并它,
// 分支、合并、协作都白送。操作日志(.log)只负责提交之内的细粒度,而且是线性的。仅 Node 端使用。

import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';
import { parse } from './format.ts';
import { type Universe, edgeKey } from './model.ts';
import { apply } from './ops.ts';
import { isStorage, planScan, selfRel } from './scan.ts';

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

/**
 * 改动过该文件的提交,新的在前(最多 limit 个;more = 更早的还有)。不在 git 仓库里返回空。
 * 范围:本地分支、远程分支、标签与 HEAD(不含 stash 之类)。--date-order:父在子之后、其余按时间(时间线的横轴才是时间);
 * --full-history --simplify-merges:
 * 保留真实的分叉与合并,但去掉"没动过这个文件"的合并,图才不会被无关的合并线淹没。
 * head = HEAD 上最近一次改动它的提交(工作区就是从它往后改的)。
 */
export type HistoryScope = 'file' | 'repo';

/**
 * scope = 'file':宇宙文件自己的历史(默认)。
 * scope = 'repo':宇宙所在文件夹的 git 历史 —— 宇宙文件是新建的、还没提交过,但仓库本身的历史可能很长;
 *   每个提交时的宇宙由那时的文件树现场长出来(见 gitTreeUniverse)。
 */
export function gitHistory(file: string, limit = 400, scope: HistoryScope = 'file', baseDir?: string): { commits: Commit[]; head: string | null; dirty: boolean; more: boolean; scope: HistoryScope } {
  const dir = scope === 'repo' ? (baseDir ?? dirname(file)) : dirname(file);
  // 目录的历史:宇宙自己的存储文件不算(否则每次提交宇宙都会让"工作区"显示有改动)
  const paths = scope === 'repo' ? ['.', ':(exclude,glob)**/*.stars', ':(exclude,glob)**/*.stars.*'] : [basename(file)];
  const name = paths[0]!;
  try {
    const out = git(dir, ['log', '--branches', '--remotes', '--tags', 'HEAD', '--parents', '--full-history', '--simplify-merges', '--date-order',
      '-n', String(limit + 1), '--format=%H%x1f%P%x1f%at%x1f%an%x1f%s%x1e', '--', ...paths]);
    const commits = out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((rec): Commit => {
      const [hash, parents, at, author, subject] = rec.split('\x1f');
      return { hash: hash!, parents: (parents ?? '').split(' ').filter(Boolean), time: Number(at) * 1000, author: author ?? '', subject: subject ?? '', refs: [] };
    });
    const more = commits.length > limit;
    if (more) commits.length = limit;
    // 分支/标签名:指向的提交没动过宇宙文件时(比如最后一次提交只改了文档),挂到它最近一个动过的祖先上。
    // 按最近活跃排序,最多额外解析 50 个,分支很多的仓库也不会慢
    const byHash = new Map(commits.map((c) => [c.hash, c]));
    let resolved = 0;
    for (const line of git(dir, ['for-each-ref', '--sort=-committerdate', '--format=%(objectname) %(refname:short)', 'refs/heads', 'refs/remotes', 'refs/tags']).split('\n')) {
      const [h, ...r] = line.trim().split(' ');
      const ref = r.join(' ');
      if (!h || !ref || ref.endsWith('/HEAD')) continue;
      let c = byHash.get(h);
      if (!c && resolved < 50 && scope === 'file') { resolved++; c = byHash.get(git(dir, ['rev-list', '-1', h, '--', name]).trim()); }
      if (c && !c.refs.includes(ref)) c.refs.push(ref);
    }
    const head = git(dir, ['log', '-1', '--format=%H', 'HEAD', '--', ...paths]).trim() || null;
    const dirty = git(dir, ['status', '--porcelain', '--', ...paths]).trim() !== '';
    return { commits, head, dirty, more, scope };
  } catch {
    return { commits: [], head: null, dirty: false, more: false, scope };
  }
}

/** 某次提交时的宇宙。 */
export function gitSnapshot(file: string, hash: string): Universe {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error('非法的提交 id');
  return parse(git(dirname(file), ['show', `${hash}:./${basename(file)}`]));
}

/** 第一父提交;根提交返回 null */
export function gitFirstParent(dir: string, hash: string): string | null {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error('非法的提交 id');
  try { return git(dir, ['rev-parse', '--verify', '-q', `${hash}^`]).trim() || null; } catch { return null; }
}

/** 这次提交的真实第一父提交时的宇宙(差异 = 这次提交改了什么);根提交或那时还没有这个文件就是 null */
export function gitParentSnapshot(file: string, hash: string): Universe | null {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error('非法的提交 id');
  try {
    const parent = git(dirname(file), ['rev-parse', '--verify', '-q', `${hash}^`]).trim();
    return parent ? gitSnapshot(file, parent) : null;
  } catch { return null; }
}

/**
 * 目录历史里某个提交时的宇宙:文件节点按那时的文件树重新长出来(git ls-tree,和 scan 同样的规则),
 * 其余的东西(模式、视图、概念、语义关系)取现在的 —— 两端都还在的关系就挂上去。
 */
export function gitTreeUniverse(baseDir: string, hash: string, current: Universe, storeFile: string, mountId = 'repo'): Universe | null {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error('非法的提交 id');
  let out: string;
  try { out = git(baseDir, ['ls-tree', '-r', '-l', '-z', hash]); } catch { return null; }
  const self = selfRel(baseDir, storeFile);
  const files: string[] = [], sizes = new Map<string, number>();
  for (const rec of out.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [, type, , size] = rec.slice(0, tab).split(/\s+/);
    const path = rec.slice(tab + 1);
    if (type !== 'blob' || isStorage(path, self)) continue;
    files.push(path); sizes.set(path, Number(size) || 0);
  }
  const isFs = (n: { attrs: Record<string, string> }) => typeof n.attrs.file === 'string' && (n.attrs.type === 'file' || n.attrs.type === 'dir');
  const u: Universe = { nodes: new Map(), edges: new Map() };
  for (const [id, n] of current.nodes) if (!isFs(n)) u.nodes.set(id, n);
  apply(u, planScan(u, files, mountId, current.nodes.get(mountId)?.label ?? mountId, (p) => (sizes.has(p) ? { size: sizes.get(p)! } : null)));
  for (const [k, e] of current.edges) {
    if (u.edges.has(k) || !u.nodes.has(e.from) || !u.nodes.has(e.to)) continue;
    const a = current.nodes.get(e.from), b = current.nodes.get(e.to);
    if (e.type === 'contains' && a && b && isFs(a) && isFs(b)) continue; // 文件树由那时的 ls-tree 决定
    u.edges.set(k, e);
  }
  return u;
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
