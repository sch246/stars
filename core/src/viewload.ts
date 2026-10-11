// Node 里加载视图脚本(stars view、脚本里的 stars.cmd.view):import() 项目里的 .js 文件,地址带修改时间,改了不吃旧缓存。
// 还有 view-set --script 用的骨架文件。只在 Node 端用。

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Universe } from './model.ts';
import { listViews, type ViewSpec } from './viewspec.ts';
import { resolveView } from './viewlayers.ts';
import { viewModuleOf, type ViewModule } from './viewscript.ts';

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

/** view-set --script 指向的文件还不存在时,写一份骨架:能导出的都写好、注释掉 */
export function writeViewSkeleton(root: string, path: string, base = 'galaxy'): void {
  const abs = resolve(root, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `// 视图脚本:一个模板。视图用它:stars view-set <名字> --script ${path}(查看器里也可以把这个文件拖到视图列表上)
// 导出的函数各接管一步:拿到下面算出的值,返回新的;不返回 = 不改。用不到的删掉就行。
// n 是节点:n.id、n.label、n.type、n.attrs;别的名字都是「列」,和表达式里一样(n.size、n.ext、n.degree、n.fileChanged、n.stale ……);
//   n.parent、n.kids、n.edges(类型?, 'out' | 'in' | 'both')。
// v 是这次计算:v.params、v.now、v.expr('表达式')、v.query('名字')、v.fn.名字、v.node(id)、v.nodes、v.max(f)、v.scale(…)、v.warn(…),
//   以及表达式里的辅助函数:v.mix、v.hsl、v.hash、v.days、v.recent、v.clamp ……
// 可以 import 同一个文件夹里的辅助文件(import { x } from './工具.js'),改了它视图也会跟着重算。

/** 这一层的规则(和视图规格同一种写法);base = 垫在下面的视图 */
export const spec = { base: ${JSON.stringify(base)} };

/** 参数的默认值;视图里写的 params 盖掉它,函数里用 v.params 读 */
export const params = {};

// /** 哪些节点出现;base = 规则的结论 */
// export function select(n, v, base) { return base; }

// /** 半径(像素);r = 下面算出的 */
// export function size(n, v, r) { return n.type === 'dir' ? r * 1.2 : r; }

// /** 颜色 #rrggbb */
// export function color(n, v, c) { return n.stale ? '#ff5a5a' : c; }

// /** 形状:dot / star / nebula / ringed / pulsar */
// export function shape(n, v, s) { return s; }

// /** 显示的名字 */
// export function label(n, v, t) { return t; }

// /** 每种边类型一次:返回 { mode, color, width, arrow, distance, strength, spin } 里想改的几项 */
// export function edge(type, v, base) { return type === 'dependsOn' ? { color: '#7aa7ff' } : undefined; }
`, { flag: 'wx' });
}
