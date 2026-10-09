// 真实文件系统的两种 FsView(见 fssync.ts):
//   · snapshotFs  启动/兜底时的"全量对账":用 git ls-files 一次拿到整棵树(和 scan 的语义完全一致),不用逐目录起进程
//   · liveFs      事件触发的"局部对账":只 readdir 被标脏的目录,忽略规则交给 git check-ignore(.gitignore 语义分毫不差)
import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type FsEntry, type FsView } from './fssync.ts';
import { isStorage, listFiles } from './scan.ts';

const stat = (root: string, rel: string) => {
  try { const s = lstatSync(join(root, rel)); return { size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; }
};

export function snapshotFs(root: string, self?: string): FsView {
  const dirs = new Map<string, Map<string, boolean>>();
  const stats = new Map<string, { size: number; mtimeMs: number }>();
  const put = (dir: string, name: string, isDir: boolean) => {
    let m = dirs.get(dir);
    if (!m) { m = new Map(); dirs.set(dir, m); }
    m.set(name, isDir);
  };
  for (const f of listFiles(root, self)) {
    const st = stat(root, f);
    if (!st) continue; // git 索引里有、磁盘上已经没了
    stats.set(f, st);
    const parts = f.split('/');
    for (let i = 0; i < parts.length; i++) put(parts.slice(0, i).map((p) => p + '/').join(''), parts[i]!, i < parts.length - 1);
  }
  return {
    readdir: (rel) => { const m = dirs.get(rel); return m ? [...m].map(([name, dir]): FsEntry => ({ name, dir })) : null; },
    stat: (rel) => stats.get(rel) ?? null,
    ignored: () => new Set(),
  };
}

export function liveFs(root: string, self?: string): FsView {
  const cache = new Map<string, boolean>();
  const FALLBACK_IGNORE = /(^|\/)(node_modules|\.git)\/?$/;
  return {
    readdir(rel) {
      try {
        return readdirSync(join(root, rel), { withFileTypes: true }).map((d) => ({ name: d.name, dir: d.isDirectory() }));
      } catch { return null; }
    },
    stat: (rel) => stat(root, rel),
    ignored(rels) {
      const out = new Set<string>();
      const todo = rels.filter((r) => {
        if (isStorage(r, self)) { out.add(r); return false; }
        const c = cache.get(r); if (c === true) out.add(r); return c === undefined;
      });
      if (todo.length > 0) {
        const r = spawnSync('git', ['-C', root, 'check-ignore', '--stdin', '-z'], { input: todo.join('\0'), encoding: 'utf8', maxBuffer: 64 << 20 });
        if (r.status === 0 || r.status === 1) { // 0 = 有被忽略的,1 = 一个都没有
          const hit = new Set((r.stdout ?? '').split('\0').filter(Boolean));
          for (const t of todo) { const ig = hit.has(t) || hit.has(t.replace(/\/$/, '')); cache.set(t, ig); if (ig) out.add(t); }
        } else { // 不是 git 仓库:退化为只忽略 node_modules 与 .git
          for (const t of todo) { const ig = FALLBACK_IGNORE.test(t); cache.set(t, ig); if (ig) out.add(t); }
        }
      }
      if (cache.size > 200_000) cache.clear(); // 忽略规则可能变(改了 .gitignore),缓存别无限长
      return out;
    },
  };
}
