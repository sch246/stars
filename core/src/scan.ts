// 把一个目录(优先用 git ls-files)铺成 dir/file 节点 + contains 边,
// 作为宇宙的第一批居民。语义关系(依赖、解释……)留给 AI 或人去补。

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { extname, join, posix, relative, sep } from 'node:path';
import { type Universe, edgeKey } from './model.ts';
import { type Op } from './ops.ts';

/**
 * 宇宙自己的存储不是宇宙里的居民,扫描与同步都跳过:操作日志、原子写的临时文件、签名、草稿一律跳过;
 * 宇宙文件本身由调用方指明(self,相对路径)—— 别的 .stars 文件(比如 genesis.stars)照常收录。
 */
const STORE_AUX = /\.stars\.(log|tmp|sig|lock|draft|draft\.tmp)$/;
export const isStorage = (rel: string, self?: string): boolean => STORE_AUX.test(rel) || rel === self;
/** 宇宙文件相对于被扫描目录的路径(统一用 /) */
export const selfRel = (dir: string, file: string): string => relative(dir, file).split(sep).join('/');

export function listFiles(dir: string, self?: string): string[] {
  return listAll(dir).filter((f) => !isStorage(f, self));
}

function listAll(dir: string): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean);
  } catch {
    const files: string[] = [];
    const walk = (rel: string): void => {
      for (const ent of readdirSync(join(dir, rel), { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        const p = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk('');
    return files;
  }
}

export type FileMeta = (path: string) => { size: number } | null;

export function statMeta(dir: string): FileMeta {
  return (path) => {
    try {
      return { size: statSync(join(dir, path)).size };
    } catch {
      return null;
    }
  };
}

/** 生成一个 batch:只添加宇宙里还没有的节点和边;已有文件节点的 size 变了会被刷新。所以可重复扫描。 */
export function planScan(u: Universe, files: string[], rootId: string, rootLabel: string, meta?: FileMeta): Op {
  const ops: Op[] = [];
  const nodes = new Set(u.nodes.keys());
  const edges = new Set(u.edges.keys());
  const addNode = (id: string, label: string, attrs: Record<string, string>) => {
    if (nodes.has(id)) return;
    nodes.add(id);
    ops.push({ op: 'addNode', id, label, attrs });
  };
  const addContains = (from: string, to: string) => {
    const key = edgeKey(from, 'contains', to);
    if (edges.has(key)) return;
    edges.add(key);
    ops.push({ op: 'addEdge', from, type: 'contains', to });
  };

  addNode(rootId, rootLabel, { type: 'dir' });
  for (const f of [...files].sort()) {
    const parts = f.split('/');
    let parent = rootId;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/') + '/';
      addNode(dirPath, parts[i]!, { type: 'dir', file: dirPath });
      addContains(parent, dirPath);
      parent = dirPath;
    }
    const attrs: Record<string, string> = { type: 'file', file: f };
    const ext = extname(f).slice(1).toLowerCase();
    if (ext) attrs.ext = ext;
    const size = meta?.(f)?.size;
    if (size !== undefined) attrs.size = String(size);
    if (nodes.has(f)) {
      const old = u.nodes.get(f);
      const set: Record<string, string> = {};
      for (const k of ['size', 'ext']) if (attrs[k] !== undefined && old?.attrs[k] !== attrs[k]) set[k] = attrs[k]!;
      if (old && Object.keys(set).length > 0) ops.push({ op: 'setNode', id: f, set });
    } else addNode(f, posix.basename(f), attrs);
    addContains(parent, f);
  }
  return { op: 'batch', ops };
}
