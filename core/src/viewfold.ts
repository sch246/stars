// 视图的最后一步:外观已经算好(每个节点的大小、颜色、形状,每种边的画法),按展开状态折叠成场景,或者取一个容器的空间。
// 只做线性扫描,不重算外观 —— 展开 / 收起每次都要走这里,必须便宜。Node 和浏览器里都跑。

import type { ViewGraph } from './viewgraph.ts';
import { DEFAULT_MAX_NODES, SHAPES, type ExternalLink, type FoldOptions, type RelationMode, type Scene, type SceneEdge, type SceneNode, type SpaceScene, type ViewSpec } from './viewspec.ts';

/** 一种边的画法(按边类型编号) */
export interface EdgeLook {
  /** hidden = 不画,也不算度数 */
  mode: RelationMode;
  color: string;
  width: number;
  arrow: boolean;
  distance?: number;
  strength?: number;
  spin?: number;
}

/** 外观:每个节点长什么样(按节点下标),每种边怎么画(按边类型编号)。由视图规则算出来(view.ts)。 */
export interface Looks {
  /** 1 = 入选,有资格出现在画面里 */
  selected: Uint8Array;
  rad: Float32Array;
  color: string[];
  /** SHAPES 里的下标 */
  shape: Uint8Array;
  /** 驱动大小的原始数值(提示框里显示);NaN = 没有规则管它的大小 */
  value: Float64Array;
  edge: EdgeLook[];
}

export interface Folder {
  /** 按展开状态算出场景 */
  fold(f?: FoldOptions): Scene;
  /** 一个容器(null = 顶层)的空间:直接子节点、它们之间的关系、通向外面的关系。结果会缓存 */
  space(id: string | null): SpaceScene;
  /** 单个节点(收起的样子,带缩影) */
  node(i: number): SceneNode;
}

/** spec 只用到 look、expand(depth / maxNodes / auto)、tags */
export function viewFolder(g: ViewGraph, looks: Looks, spec: ViewSpec): Folder {
  const { N, nodeList, ids, idx, E, ef, et, ety, eprop, typeNames, typeIdx, tSym, relation, parent, depth, order, treeKids, desc, second, chainOf } = g;
  const { selected, rad, color, shape, value, edge: tEdge } = looks;
  const nT = typeNames.length;
  const tShown = tEdge.map((l) => l.mode !== 'hidden');
  const expandAuto = spec.expand?.auto;
  const look = spec.look ?? 'galaxy';
  const tagDepth = spec.tags ? (spec.tags.depth ?? 2) + 1 : 0; // 根(挂载点)本身不算 tag

  /** 收起的容器:取最多 48 个后代作为缩影(广度优先,够数就停) */
  const kidsOf = (i: number): Array<[string, number, string]> => {
    const kids: Array<[string, number, string]> = [], queue = [i];
    for (let q = 0; q < queue.length && kids.length < 48; q++) {
      const v = queue[q]!;
      for (let k = treeKids.start[v]!; k < treeKids.start[v + 1]! && kids.length < 48; k++) {
        const c = treeKids.list[k]!;
        queue.push(c);
        if (selected[c]) kids.push([color[c]!, rad[c]!, ids[c]!]);
      }
    }
    return kids;
  };
  const baseNode = (i: number): SceneNode => {
    const sn: SceneNode = { id: ids[i]!, label: nodeList[i]!.label, r: Math.round(rad[i]! * 100) / 100, color: color[i]!, shape: SHAPES[shape[i]!]! };
    const v = value[i]!;
    if (v === v) sn.value = v;
    return sn;
  };

  function fold(f: FoldOptions = {}): Scene {
    // 1. 哪些容器展开
    const maxDepth = f.depth ?? spec.expand?.depth ?? Infinity;
    const budget = f.maxNodes ?? spec.expand?.maxNodes ?? (maxDepth === Infinity ? DEFAULT_MAX_NODES : Infinity);
    const forced = new Int8Array(N); // 用户手动:1 展开,-1 收起
    for (const id of f.expanded ?? []) { const i = idx.get(id); if (i !== undefined) forced[i] = 1; }
    for (const id of f.collapsed ?? []) { const i = idx.get(id); if (i !== undefined) forced[i] = -1; }
    const open = new Uint8Array(N);
    if (budget === Infinity) {
      for (let i = 0; i < N; i++) open[i] = forced[i] ? (forced[i]! > 0 ? 1 : 0) : depth[i]! < maxDepth ? 1 : 0;
    } else {
      // 一层一层往下:这一层可见的容器里,先展开孩子少的,直到再展开就超出预算。
      // 不在画面里的容器(没被选中,比如 tags 视图隐藏的目录)是"透明"的:收起它只会把内容藏起来,所以总是展开。
      const vis = new Uint8Array(N), kidCount = (v: number) => treeKids.start[v + 1]! - treeKids.start[v]!;
      let count = 0;
      for (let k = 0; k < N;) {
        const d = depth[order[k]!]!, cands: number[] = [];
        let room = budget;
        for (; k < N && depth[order[k]!] === d; k++) {
          const v = order[k]!, p = parent[v]!;
          if (p >= 0 && !(vis[p] && open[p])) continue;
          vis[v] = 1;
          if (selected[v]) count++;
          if (kidCount(v) === 0) continue;
          if (forced[v]) open[v] = forced[v]! > 0 ? 1 : 0;
          else if (d >= maxDepth) open[v] = 0;
          else if (!selected[v]) open[v] = 1;
          else { cands.push(v); continue; }
          if (open[v]) room -= kidCount(v);
        }
        room -= count;
        cands.sort((a, b) => kidCount(a) - kidCount(b));
        for (const v of cands) { if (kidCount(v) > room) break; open[v] = 1; room -= kidCount(v); }
      }
    }

    // 2. 可见性与代表节点:按深度从小到大扫一遍
    const treeVis = new Uint8Array(N), rep = new Int32Array(N);
    for (let k = 0; k < N; k++) {
      const v = order[k]!, p = parent[v]!;
      if (p < 0) { treeVis[v] = 1; rep[v] = v; }
      else if (treeVis[p] && open[p]) { treeVis[v] = 1; rep[v] = v; }
      else rep[v] = rep[p]!;
    }
    const visible = new Uint8Array(N);
    for (let i = 0; i < N; i++) visible[i] = treeVis[i]! & selected[i]!;

    // 3. 边:折叠掉的内部关系提升到容器上,按 (起点,类型,终点) 汇总
    interface Agg { from: number; to: number; type: number; count: number; real: boolean; proposed: boolean; sec: number }
    const aggs = new Map<number, Agg>();
    for (let e = 0; e < E; e++) {
      const t = ety[e]!;
      if (!tShown[t]) continue;
      let a = rep[ef[e]!]!, b = rep[et[e]!]!;
      if (a === b || !visible[a] || !visible[b]) continue;
      const lifted = a !== ef[e] || b !== et[e];
      if (lifted && tSym[t] && ids[a]! > ids[b]!) { const x = a; a = b; b = x; }
      const key = ((a * N + b) * nT + t) * 2 + second[e]!;
      let agg = aggs.get(key);
      if (!agg) { agg = { from: a, to: b, type: t, count: 0, real: false, proposed: true, sec: second[e]! }; aggs.set(key, agg); }
      agg.count++;
      if (!lifted) agg.real = true;
      if (!eprop[e]) agg.proposed = false;
    }

    // 4. 场景
    const nodes: SceneNode[] = [];
    for (let i = 0; i < N; i++) {
      if (!visible[i]) continue;
      const sn = baseNode(i);
      const p = parent[i]!;
      if (p >= 0 && visible[p]) sn.parent = ids[p]!;
      if (tagDepth > 0) {
        const tags: string[] = [];
        for (let a = parent[i]!; a >= 0; a = parent[a]!) if (depth[a]! < tagDepth && depth[a]! > 0) tags.push(ids[a]!);
        if (tags.length) sn.tags = tags.reverse();
      }
      const cc = treeKids.start[i + 1]! - treeKids.start[i]!;
      if (cc > 0) {
        sn.container = true; sn.children = cc; sn.descendants = desc[i]!; sn.expanded = open[i] === 1;
        if (!sn.expanded) sn.kids = kidsOf(i);
      }
      nodes.push(sn);
    }
    const edges: SceneEdge[] = [];
    for (const agg of aggs.values()) edges.push(mkEdge(agg.from, agg.to, agg.type, agg.count, agg.real, agg.proposed, agg.sec));
    const expand: Scene['expand'] = { relation };
    if (expandAuto) expand.auto = expandAuto;
    return { look, nodes, edges, expand };
  }

  // ---------- 空间:每个容器一个独立的小世界 ----------
  const relTypeIdx = typeIdx.get(relation);
  const mkNode = (i: number): SceneNode => {
    const sn = baseNode(i);
    const cc = treeKids.start[i + 1]! - treeKids.start[i]!;
    if (cc > 0) {
      sn.container = true; sn.children = cc; sn.descendants = desc[i]!; sn.expanded = false;
      sn.kids = kidsOf(i);
    }
    return sn;
  };
  /** sec:第二个容器的 contains(见 ViewGraph.second):疆界 / 轨道画不出"也属于",改成淡线,不带距离、公转 */
  function mkEdge(from: number, to: number, t: number, count: number, real: boolean, proposed: boolean, sec = 0): SceneEdge {
    const te = tEdge[t]!;
    const weak = sec === 1 && (te.mode === 'region' || te.mode === 'orbit');
    const edge: SceneEdge = {
      from: ids[from]!, to: ids[to]!, type: typeNames[t]!, mode: weak ? 'faint' : te.mode as SceneEdge['mode'],
      color: te.color, width: te.width, arrow: weak ? true : te.arrow, proposed, count, lifted: !real,
    };
    if (weak) return edge;
    if (te.distance !== undefined) edge.distance = te.distance;
    if (te.strength !== undefined) edge.strength = te.strength;
    if (te.spin !== undefined) edge.spin = te.spin;
    return edge;
  }
  const spaceCache = new Map<number, SpaceScene>();

  function space(id: string | null): SpaceScene {
    const ci = id === null ? -1 : (idx.get(id) ?? -2);
    if (ci === -2) return { id, nodes: [], edges: [], external: [] };
    const hit = spaceCache.get(ci);
    if (hit) return hit;

    // 直接子节点:没被选择过滤掉的孩子;被过滤掉的容器"透明",它的孩子提升上来
    const children: number[] = [];
    const queue: number[] = [];
    if (ci < 0) { for (let i = 0; i < N; i++) if (parent[i]! < 0) queue.push(i); }
    else for (let k = treeKids.start[ci]!; k < treeKids.start[ci + 1]!; k++) queue.push(treeKids.list[k]!);
    for (let h = 0; h < queue.length; h++) {
      const v = queue[h]!;
      if (selected[v]) children.push(v);
      else for (let k = treeKids.start[v]!; k < treeKids.start[v + 1]!; k++) queue.push(treeKids.list[k]!);
    }
    // rep:每个节点属于哪个直接子节点(在这个空间之外的 = -1)
    const rep = new Int32Array(N).fill(-1);
    const stack: number[] = [];
    for (const c of children) {
      stack.push(c);
      while (stack.length > 0) { const v = stack.pop()!; rep[v] = c; for (let k = treeKids.start[v]!; k < treeKids.start[v + 1]!; k++) stack.push(treeKids.list[k]!); }
    }
    const here = ci < 0 ? new Set<number>() : new Set<number>(chainOf(ci));

    interface Agg { from: number; to: number; type: number; count: number; real: boolean; proposed: boolean; sec: number }
    const internal = new Map<number, Agg>();
    const external = new Map<string, ExternalLink & { _k: string }>();
    for (let e = 0; e < E; e++) {
      const t = ety[e]!;
      if (!tShown[t]) continue;
      const ra = rep[ef[e]!]!, rb = rep[et[e]!]!;
      if (ra < 0 && rb < 0) continue;
      if (ra >= 0 && rb >= 0) {
        if (ra === rb) continue;
        let a = ra, b = rb;
        const lifted = a !== ef[e] || b !== et[e];
        if (lifted && tSym[t] && ids[a]! > ids[b]!) { const x = a; a = b; b = x; }
        const key = ((a * N + b) * nT + t) * 2 + second[e]!;
        let agg = internal.get(key);
        if (!agg) { agg = { from: a, to: b, type: t, count: 0, real: false, proposed: true, sec: second[e]! }; internal.set(key, agg); }
        agg.count++;
        if (!lifted) agg.real = true;
        if (!eprop[e]) agg.proposed = false;
        continue;
      }
      if (t === relTypeIdx && !second[e]) continue; // 容器树上的"包含"是空间本身,不当作外部链接;第二个容器的照样伸出去
      const out = ra >= 0, inside = out ? ra : rb, otherIdx = out ? et[e]! : ef[e]!;
      let other = otherIdx;
      for (const v of chainOf(otherIdx)) if (!here.has(v)) { other = v; break; } // 两条祖先链分叉处
      const key = `${inside}|${t}|${out ? 1 : 0}|${other}`;
      const x = external.get(key);
      if (x) x.count++;
      else external.set(key, { _k: key, node: ids[inside]!, other: ids[other]!, type: typeNames[t]!, out, count: 1, color: tEdge[t]!.color });
    }
    const out: SpaceScene = {
      id,
      nodes: children.map(mkNode),
      edges: [...internal.values()].map((agg) => mkEdge(agg.from, agg.to, agg.type, agg.count, agg.real, agg.proposed, agg.sec)),
      external: [...external.values()].map(({ _k, ...rest }) => rest),
    };
    spaceCache.set(ci, out);
    return out;
  }

  return { fold, space, node: mkNode };
}
