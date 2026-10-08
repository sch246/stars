// 把一个目录(优先用 git ls-files)铺成 dir/file 节点 + contains 边,
// 作为宇宙的第一批居民。语义关系(依赖、解释……)留给 AI 或人去补。

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { type Universe, edgeKey } from './model.ts';
import { type Op } from './ops.ts';

export function listFiles(dir: string): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 });
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

/** 生成一个 batch:只添加宇宙里还没有的节点和边,所以可重复扫描。 */
export function planScan(u: Universe, files: string[], rootId: string, rootLabel: string): Op {
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
    addNode(f, posix.basename(f), { type: 'file', file: f });
    addContains(parent, f);
  }
  return { op: 'batch', ops };
}
