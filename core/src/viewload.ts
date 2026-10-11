// Node 里加载视图脚本(stars view、脚本里的 stars.cmd.view):import() 项目里的 .js 文件,地址带修改时间,改了不吃旧缓存。
// 还有 view-set --script 用的骨架文件、静态导出要带的脚本源码。只在 Node 端用。

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Universe } from './model.ts';
import { listViews, type ViewSpec } from './viewspec.ts';
import { resolveView } from './viewlayers.ts';
import { viewModuleOf, viewSkeleton, type ViewModule } from './viewscript.ts';
import { moduleGraph } from './imports.ts';
import { resolveInside } from './files.ts';

/** 加载一个视图脚本:失败(文件不在、语法错、顶层抛错)返回 Error,不抛出 */
export async function importViewModule(root: string, path: string): Promise<ViewModule | Error> {
  const abs = resolve(root, path);
  if (!existsSync(abs)) return new Error(`文件不存在: ${path}`);
  try {
    const ns = await import(`${pathToFileURL(abs).href}?v=${statSync(abs).mtimeMs}`) as Record<string, unknown>;
    return viewModuleOf(ns);
  } catch (err) { return err instanceof Error ? err : new Error(String(err)); }
}

/** 这份规格(连同 base 链、脚本自己的 spec 里再引用的)用到的视图脚本,全部加载好 */
export async function loadViewModules(u: Universe, spec: ViewSpec, root: string, name?: string): Promise<Map<string, ViewModule | Error>> {
  const mods = new Map<string, ViewModule | Error>();
  for (let round = 0; round < 16; round++) {
    const { missing } = resolveView(u, spec, mods, name);
    if (!missing.length) break;
    for (const p of missing) mods.set(p, await importViewModule(root, p));
  }
  return mods;
}

/** 视图名 → 加载好的脚本(没有这个视图 / 没用脚本 = 空) */
export async function viewModulesFor(u: Universe, name: string, root: string): Promise<Map<string, ViewModule | Error>> {
  const spec = listViews(u).specs[name];
  return spec ? loadViewModules(u, spec, root, name) : new Map();
}

/** view-set --script 指向的文件还不存在时,写一份骨架(见 viewSkeleton) */
export function writeViewSkeleton(root: string, path: string, base = 'galaxy'): void {
  const abs = resolve(root, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, viewSkeleton(path, base), { flag: 'wx' });
}

/** 静态导出要带上的视图脚本源码:所有视图用到的脚本,连同它们 import 的文件(路径 → 源码) */
export async function viewSources(u: Universe, root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const read = (p: string): string | null => { try { return readFileSync(resolveInside(root, p), 'utf8'); } catch { return null; } };
  for (const [name, spec] of Object.entries(listViews(u).specs)) {
    let mods: Map<string, ViewModule | Error>;
    try { mods = await loadViewModules(u, spec, root, name); } catch { continue; }   // base 写错:导出后照样报
    for (const [p, m] of mods) if (!(m instanceof Error)) for (const f of moduleGraph(p, read).files) out[f] ??= read(f)!;
  }
  return out;
}
