// 三方合并:宇宙是"一组事实",所以按事实合并,而不是按文本行。
// 两个分支各自往排序文件的同一处插入节点,git 的文本合并会冲突;按事实合并就不会。
// 只有"同一个事实的同一个字段被两边改成了不同的值"、"一边删了一边改了"才算真冲突。
// 作为 git 合并驱动使用:`stars merge %O %A %B`(见 CLI 的 install-merge)。

import { type Attrs, type Edge, type Node, type Universe, createUniverse, edgeKey } from './model.ts';

export interface MergeResult {
  universe: Universe;
  conflicts: string[];
}

/** 标量的三方合并:undefined 表示"不存在"。冲突时取 ours 并报告。 */
function scalar<T>(b: T | undefined, o: T | undefined, t: T | undefined, where: string, conflicts: string[]): T | undefined {
  if (o === t) return o;
  if (o === b) return t;
  if (t === b) return o;
  conflicts.push(`${where}: 两边改成了不同的值(ours=${JSON.stringify(o)} theirs=${JSON.stringify(t)}),取 ours`);
  return o;
}

function mergeAttrs(b: Attrs | undefined, o: Attrs, t: Attrs, where: string, conflicts: string[]): Attrs {
  const out: Attrs = {};
  for (const k of new Set([...Object.keys(b ?? {}), ...Object.keys(o), ...Object.keys(t)])) {
    const v = scalar(b?.[k], o[k], t[k], `${where}.${k}`, conflicts);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function same(a: { attrs: Attrs; label?: string }, b: { attrs: Attrs; label?: string }): boolean {
  return a.label === b.label && JSON.stringify(a.attrs) === JSON.stringify(b.attrs);
}

/** 某个事实(节点/边)在三个版本里的合并:返回合并后的版本,或 undefined(被删除)。 */
function mergeFact<T extends { attrs: Attrs; label?: string }>(
  b: T | undefined, o: T | undefined, t: T | undefined, where: string, conflicts: string[],
): T | undefined {
  if (!o && !t) return undefined;
  if (!b) { // 新增
    if (o && t) return { ...o, label: scalar(undefined, o.label, t.label, `${where}.label`, conflicts), attrs: mergeAttrs(undefined, o.attrs, t.attrs, where, conflicts) };
    return o ?? t;
  }
  if (!o || !t) { // 一边删除
    const kept = (o ?? t)!;
    if (same(kept, b)) return undefined; // 另一边没动 → 删除生效
    conflicts.push(`${where}: 一边删除了它,另一边修改了它,保留修改后的版本`);
    return kept;
  }
  return { ...o, label: scalar(b.label, o.label, t.label, `${where}.label`, conflicts), attrs: mergeAttrs(b.attrs, o.attrs, t.attrs, where, conflicts) };
}

export function mergeUniverses(base: Universe, ours: Universe, theirs: Universe): MergeResult {
  const conflicts: string[] = [];
  const u = createUniverse();

  for (const id of new Set([...base.nodes.keys(), ...ours.nodes.keys(), ...theirs.nodes.keys()])) {
    const m = mergeFact<Node>(base.nodes.get(id), ours.nodes.get(id), theirs.nodes.get(id), `节点 ${id}`, conflicts);
    if (m) u.nodes.set(id, { id, label: m.label ?? id, attrs: m.attrs });
  }
  for (const key of new Set([...base.edges.keys(), ...ours.edges.keys(), ...theirs.edges.keys()])) {
    const [bb, oo, tt] = [base.edges.get(key), ours.edges.get(key), theirs.edges.get(key)];
    const ref = oo ?? tt ?? bb!;
    const m = mergeFact<Edge>(bb, oo, tt, `边 ${ref.from} -${ref.type}-> ${ref.to}`, conflicts);
    if (m) u.edges.set(key, { from: ref.from, type: ref.type, to: ref.to, attrs: m.attrs });
  }
  // 一边删了节点、另一边却给它连了边:把节点救回来(任何一个版本里的都行),并报告
  for (const e of [...u.edges.values()]) {
    for (const id of [e.from, e.to]) {
      if (u.nodes.has(id)) continue;
      const n = ours.nodes.get(id) ?? theirs.nodes.get(id) ?? base.nodes.get(id);
      if (n) {
        u.nodes.set(id, n);
        conflicts.push(`节点 ${id}: 一边删除了它,另一边仍在引用它(${e.from} -${e.type}-> ${e.to}),已恢复`);
      } else u.edges.delete(edgeKey(e.from, e.type, e.to));
    }
  }
  return { universe: u, conflicts };
}
