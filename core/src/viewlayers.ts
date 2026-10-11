// 视图 = 一叠层,从下往上:base 指向的视图 → 视图脚本(它导出的 spec 和函数是同一层)→ 这份规格自己写的键。
// - 配置类的键合并成一份:select / expand / space / tags 按对象合并一层,relations 按边类型合并到每个字段,其余(look、layout、forces……)上面的盖掉下面的。
// - 逐节点的规则(size / color / style)按层算(view.ts):从上往下找第一条匹配这个节点的规则,哪层都不匹配就用默认(类型节点的、内置的);
//   再从那一层起往上,每层脚本的同名函数拿到下面算出的值,可以改掉。所以上面只写想改的,其余照旧。
// - 参数(params)从下往上合并:脚本里 export const params 是默认值,视图自己写的 params 盖掉它。
// 脚本模块由调用方先加载好(Node 用 import(),浏览器从服务端取),这里只按路径查。Node 和浏览器里都跑。

import { SCHEMA_PREFIX, type Universe } from './model.ts';
import { BUILTIN_VIEWS, type ViewSpec } from './viewspec.ts';
import type { ViewModule } from './viewscript.ts';

export interface ViewLayer {
  /** 内置视图名 / ~view/ 的名字 / 脚本路径;最上面那层是这份规格自己(名字是 opts.name,没给 = '') */
  name: string;
  spec: ViewSpec;
  /** 这一层是脚本:它的路径和加载好的模块 */
  script?: string;
  module?: ViewModule;
}
export interface ResolvedView {
  layers: ViewLayer[];
  /** 合并好的配置(size / color / style 不在里面) */
  spec: ViewSpec;
  params: Record<string, unknown>;
  /** 引用到的全部脚本(从下往上,含没加载的) */
  scripts: string[];
  /** 引用了但 modules 里没有的:调用方加载完再算一次 */
  missing: string[];
  /** 加载失败的脚本 */
  errors: string[];
}

const LAYER_KEYS = new Set(['size', 'color', 'style', 'base', 'script', 'params']);
const OBJ_KEYS = new Set(['select', 'expand', 'space', 'tags']);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** 脚本路径的统一写法(去掉开头的 ./ 和 /) */
export const scriptPath = (p: string): string => p.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');

/** 按名字找视图:~view/<名字> 优先;它已经在这条链上了(比如 ~view/galaxy 里写 base: "galaxy")就找内置的 */
function namedView(u: Universe, name: string, stack: string[]): { key: string; spec: ViewSpec } {
  const node = u.nodes.get(`${SCHEMA_PREFIX}view/${name}`);
  if (node && node.attrs.kind === 'view' && !stack.includes(`view:${name}`)) {
    try { return { key: `view:${name}`, spec: JSON.parse(node.attrs.spec ?? '{}') as ViewSpec }; }
    catch (err) { throw new Error(`视图 ${name} 的 spec 不是合法 JSON: ${(err as Error).message}`); }
  }
  if (BUILTIN_VIEWS[name] && !stack.includes(`builtin:${name}`)) return { key: `builtin:${name}`, spec: BUILTIN_VIEWS[name]! };
  if (node || BUILTIN_VIEWS[name]) throw new Error(`视图循环引用: ${[...stack, name].map((k) => k.replace(/^\w+:/, '')).join(' → ')}`);
  throw new Error(`base: 没有视图 "${name}"`);
}

/** 把规格展开成一叠层。base 写错 / 循环引用会抛出;脚本没加载不抛(记进 missing) */
export function resolveView(u: Universe, spec: ViewSpec, modules?: ReadonlyMap<string, ViewModule | Error>, name = '', mapLayer?: (s: ViewSpec) => ViewSpec): ResolvedView {
  const layers: ViewLayer[] = [], params: Record<string, unknown> = {}, scripts: string[] = [], missing: string[] = [], errors: string[] = [];
  const expand = (s: ViewSpec, layerName: string, stack: string[], script?: string, module?: ViewModule) => {
    if (s.base !== undefined) { const b = namedView(u, s.base, stack); expand(b.spec, s.base, [...stack, b.key]); }
    if (s.script !== undefined) {
      const p = scriptPath(s.script);
      if (stack.includes(`script:${p}`)) throw new Error(`视图循环引用: ${[...stack, `script:${p}`].map((k) => k.replace(/^\w+:/, '')).join(' → ')}`);
      if (!scripts.includes(p)) scripts.push(p);
      const m = modules?.get(p);
      if (m === undefined) missing.push(p);
      else if (m instanceof Error) errors.push(`视图脚本 ${p} 加载失败: ${m.message}`);
      else expand(isObj(m.spec) ? m.spec : {}, p, [...stack, `script:${p}`], p, m);
    }
    layers.push({ name: layerName, spec: mapLayer ? mapLayer(s) : s, ...(script ? { script, module } : {}) });
    if (module && isObj(module.params)) Object.assign(params, module.params);
    if (isObj(s.params)) Object.assign(params, s.params);
  };
  expand(spec, name, name && u.nodes.has(`${SCHEMA_PREFIX}view/${name}`) ? [`view:${name}`] : name && BUILTIN_VIEWS[name] ? [`builtin:${name}`] : []);

  const merged: Record<string, unknown> = {};
  for (const { spec: s } of layers) {
    for (const [k, v] of Object.entries(s)) {
      if (v === undefined || LAYER_KEYS.has(k)) continue;
      if (k === 'relations' && isObj(v)) {
        const r: Record<string, unknown> = { ...(merged.relations as object) };
        for (const [t, rule] of Object.entries(v)) r[t] = { ...(r[t] as object), ...(rule as object) };
        merged.relations = r;
      } else if (OBJ_KEYS.has(k) && isObj(v)) merged[k] = { ...(merged[k] as object), ...v };
      else merged[k] = v;
    }
  }
  return { layers, spec: merged as ViewSpec, params, scripts, missing, errors };
}
