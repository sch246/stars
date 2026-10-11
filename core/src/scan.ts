// 把一个目录(优先用 git ls-files)铺成 dir/file 节点 + contains 边,
// 作为宇宙的第一批居民。语义关系(依赖、解释……)留给 AI 或人去补;
// 打开 import 之后(挂载根上 imports=true),代码文件之间的 import 也写成 dependsOn 边(planImports)。

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, posix, relative, sep } from 'node:path';
import { type Universe, edgeKey } from './model.ts';
import { type Op } from './ops.ts';
import { importCandidates, importsOf, resolveImport } from './imports.ts';

/**
 * 宇宙自己的存储不是宇宙里的居民,扫描与同步都跳过:操作日志、原子写的临时文件、签名、草稿一律跳过;
 * 宇宙文件本身由调用方指明(self,相对路径)—— 别的 .stars 文件(比如 genesis.stars)照常收录。
 */
const STORE_AUX = /\.stars\.(log|tmp|sig|lock|draft|draft\.tmp|runs|runs\.tmp)$/;
export const isStorage = (rel: string, self?: string): boolean => STORE_AUX.test(rel) || rel === self || rel.startsWith('.stars-trash/');   // 回收站(删除的文件挪到这里,见 arrange.ts)
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

/** 扫描得来的依赖边上的标记:手画的同名边没有它,不会被扫描改动 */
export const IMPORT_VIA = 'import';
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/i;
/** 挂载根上开着 import 吗(imports=true) */
export const importsOn = (u: Universe, mountId: string): boolean => u.nodes.get(mountId)?.attrs.imports === 'true';

/**
 * 代码文件之间的 import → dependsOn 边(attrs.via = import)。只认相对路径;省略的扩展名按 TS / Node 的习惯补。
 * only = 只重新看这些文件(项目里的路径),不给 = 全部代码文件。已经有的 dependsOn(手画的)不动,也不重复加;
 * 文件里不再 import 的,扫描得来的那条边删掉。
 */
export function planImports(u: Universe, root: string, only?: Iterable<string>): Op[] {
  const byPath = new Map<string, string>();
  for (const n of u.nodes.values()) if (n.attrs.type === 'file' && n.attrs.file) byPath.set(n.attrs.file, n.id);
  const auto = new Map<string, Set<string>>(), any = new Set<string>();
  for (const e of u.edges.values()) {
    if (e.type !== 'dependsOn') continue;
    any.add(`${e.from}\u0000${e.to}`);
    if (e.attrs.via === IMPORT_VIA) { const s = auto.get(e.from); if (s) s.add(e.to); else auto.set(e.from, new Set([e.to])); }
  }
  const ops: Op[] = [];
  for (const path of only ? new Set(only) : byPath.keys()) {
    const from = byPath.get(path);
    if (!from || !CODE_FILE.test(path)) continue;
    let src: string;
    try { const abs = join(root, path); if (statSync(abs).size > 1 << 20) continue; src = readFileSync(abs, 'utf8'); } catch { continue; }
    const want = new Set<string>();
    for (const spec of importsOf(src)) {
      const base = resolveImport(path, spec);
      if (base === null) continue;
      for (const c of importCandidates(base)) { const id = byPath.get(c); if (id !== undefined) { if (id !== from) want.add(id); break; } }
    }
    for (const to of auto.get(from) ?? []) if (!want.has(to)) ops.push({ op: 'removeEdge', from, type: 'dependsOn', to });
    for (const to of want) if (!any.has(`${from}\u0000${to}`)) ops.push({ op: 'addEdge', from, type: 'dependsOn', to, attrs: { via: IMPORT_VIA } });
  }
  return ops;
}

/** 打开 / 关上 import 边:打开 = 挂载根记上 imports=true 并全部算一遍;关上 = 去掉标记和所有扫描得来的依赖边 */
export function planImportsToggle(u: Universe, root: string, mountId: string, on: boolean): Op {
  if (!u.nodes.has(mountId)) throw new Error(`挂载根节点 ${mountId} 不存在(先 stars scan)`);
  if (on) return { op: 'batch', ops: [...(importsOn(u, mountId) ? [] : [{ op: 'setNode', id: mountId, set: { imports: 'true' } } as Op]), ...planImports(u, root)] };
  const ops: Op[] = importsOn(u, mountId) ? [{ op: 'setNode', id: mountId, unset: ['imports'] }] : [];
  for (const e of u.edges.values()) if (e.type === 'dependsOn' && e.attrs.via === IMPORT_VIA) ops.push({ op: 'removeEdge', from: e.from, type: 'dependsOn', to: e.to });
  return { op: 'batch', ops };
}
