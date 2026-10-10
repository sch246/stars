// 视图的第一步:把宇宙压成按下标编号的数组 —— 节点、边、边类型、容器树。
// 外观(view.ts)、表达式(viewexpr.ts)、折叠与空间(viewfold.ts)都在它上面算;它只取决于宇宙和容器关系,和视图的其余规则无关。
// Node 和浏览器里都跑。

import { type Node, type Universe, isSymmetric } from './model.ts';

/** 压缩邻接表(CSR):start[i]..start[i+1] 是 i 的孩子在 list 里的区间。 */
export interface Csr { start: Int32Array; list: Int32Array }

export function buildCsr(N: number, from: ArrayLike<number>, to: ArrayLike<number>, pick: (e: number) => boolean, count: number): Csr {
  const start = new Int32Array(N + 1);
  for (let e = 0; e < count; e++) if (pick(e)) start[from[e]! + 1]!++;
  for (let i = 0; i < N; i++) start[i + 1]! += start[i]!;
  const fill = start.slice(0, N);
  const list = new Int32Array(start[N]!);
  for (let e = 0; e < count; e++) if (pick(e)) list[fill[from[e]!]!++] = to[e]!;
  return { start, list };
}

/** 沿邻接表向下汇总(迭代式后序遍历,不会栈溢出;遇到环就当那条边不存在)。 */
export function rollupArr(N: number, adj: Csr, op: 'sum' | 'max' | 'count', own: Float64Array | null): Float64Array {
  const out = new Float64Array(N), st = new Uint8Array(N), ptr = new Int32Array(N);
  const stack: number[] = [];
  for (let s = 0; s < N; s++) {
    if (st[s]) continue;
    st[s] = 1; ptr[s] = adj.start[s]!; stack.push(s);
    while (stack.length > 0) {
      const v = stack[stack.length - 1]!;
      if (ptr[v]! < adj.start[v + 1]!) {
        const c = adj.list[ptr[v]!++]!;
        if (st[c] === 0) { st[c] = 1; ptr[c] = adj.start[c]!; stack.push(c); }
        continue;
      }
      let acc = op === 'count' ? 0 : (own ? own[v]! : 0);
      for (let k = adj.start[v]!; k < adj.start[v + 1]!; k++) {
        const c = adj.list[k]!;
        if (st[c] !== 2) continue;
        if (op === 'sum') acc += out[c]!;
        else if (op === 'max') acc = Math.max(acc, out[c]!);
        else acc += 1 + out[c]!;
      }
      out[v] = acc; st[v] = 2; stack.pop();
    }
  }
  return out;
}

/** 图的索引。节点下标 0..N-1,边下标 0..E-1;下面的数组都按下标取。 */
export interface ViewGraph {
  readonly u: Universe;
  readonly N: number;
  readonly nodeList: Node[];
  readonly ids: string[];
  readonly idx: Map<string, number>;
  /** 边:起点、终点、类型编号、是否 proposed(两头都在的才算,共 E 条) */
  readonly E: number;
  readonly ef: Int32Array;
  readonly et: Int32Array;
  readonly ety: Int32Array;
  readonly eprop: Uint8Array;
  /** 边类型:按第一次出现编号;tSym = 不分方向(related 这类) */
  readonly typeNames: string[];
  readonly typeIdx: Map<string, number>;
  readonly tSym: boolean[];
  /** 容器关系(视图的 expand.relation,默认 contains)和它决定的容器树 */
  readonly relation: string;
  /** 父容器下标,-1 = 根(环在这里断开) */
  readonly parent: Int32Array;
  readonly depth: Int32Array;
  /** 按深度从浅到深排好的节点下标:"先父后子"的单遍扫描用 */
  readonly order: Int32Array;
  readonly treeKids: Csr;
  readonly childCount: Int32Array;
  /** 后代总数 */
  readonly desc: Int32Array;
  /** 1 = 这条容器边没进容器树(节点的第二个、第三个容器,或断环时断开的那条):画成淡线 */
  readonly second: Uint8Array;
  /** 某种边的邻接表(顺着边),算一次缓存 */
  adjOf(type: string): Csr;
  /** 从根到 v(含)的下标链 */
  chainOf(v: number): number[];
}

export function indexGraph(u: Universe, relation: string): ViewGraph {
  const nodeList = [...u.nodes.values()];
  const N = nodeList.length;
  const ids = nodeList.map((n) => n.id);
  const idx = new Map<string, number>();
  for (let i = 0; i < N; i++) idx.set(ids[i]!, i);

  const typeNames: string[] = [];
  const typeIdx = new Map<string, number>();
  const typeId = (t: string): number => {
    let i = typeIdx.get(t);
    if (i === undefined) { i = typeNames.length; typeNames.push(t); typeIdx.set(t, i); }
    return i;
  };

  // ---- 边:压成数组;顺手确定容器树(同一节点取第一条 relation 入边作父节点) ----
  const E0 = u.edges.size;
  const ef = new Int32Array(E0), et = new Int32Array(E0), ety = new Int32Array(E0);
  const eprop = new Uint8Array(E0);
  const parent = new Int32Array(N).fill(-1);
  let E = 0;
  // 一个节点在几个容器里时(contains 没有 single-parent):和文件路径对得上的那条(目录包含文件)进容器树,
  // 不然取第一条 —— 不取决于边在文件里的先后,模块包含文件时文件夹层级也不会被打乱
  const fsPair = (from: Node, to: Node): boolean => {
    const tf = to.attrs.file;
    if (from.attrs.type !== 'dir' || !tf) return false;
    const ff = from.attrs.file;
    return ff ? ff.endsWith('/') && tf.startsWith(ff) && tf !== ff : !tf.replace(/\/$/, '').includes('/');
  };
  const fsParent = new Uint8Array(N);
  for (const e of u.edges.values()) {
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a === undefined || b === undefined) continue;
    if (e.type === relation && a !== b && (parent[b] === -1 || !fsParent[b])) {
      const fs = fsPair(nodeList[a]!, nodeList[b]!);
      if (parent[b] === -1 || fs) { parent[b] = a; fsParent[b] = fs ? 1 : 0; }
    }
    ef[E] = a; et[E] = b; ety[E] = typeId(e.type);
    eprop[E] = e.attrs.status === 'proposed' ? 1 : 0;
    E++;
  }
  const tSym = typeNames.map((t) => isSymmetric(u, t));

  // ---- 断环 + 深度 ----
  const state = new Uint8Array(N), path: number[] = [];
  for (let s = 0; s < N; s++) {
    if (state[s]) continue;
    path.length = 0;
    let cur = s;
    while (cur >= 0 && state[cur] === 0) { state[cur] = 1; path.push(cur); cur = parent[cur]!; }
    if (cur >= 0 && state[cur] === 1) parent[cur] = -1; // 走回了本条链上的节点:环,在这里断开,它自己当根
    for (const v of path) state[v] = 2;
  }
  const depth = new Int32Array(N).fill(-1), climb: number[] = [];
  for (let s = 0; s < N; s++) {
    if (depth[s]! >= 0) continue;
    climb.length = 0;
    let cur = s;
    while (cur >= 0 && depth[cur]! < 0) { climb.push(cur); cur = parent[cur]!; }
    let d = cur >= 0 ? depth[cur]! : -1;
    for (let k = climb.length - 1; k >= 0; k--) depth[climb[k]!] = ++d;
  }
  // 按深度排序(计数排序),这样"先父后子"的单遍扫描就能算出可见性和代表节点
  let maxD = 0;
  for (let i = 0; i < N; i++) if (depth[i]! > maxD) maxD = depth[i]!;
  const bucket = new Int32Array(maxD + 2);
  for (let i = 0; i < N; i++) bucket[depth[i]! + 1]!++;
  for (let d = 0; d <= maxD; d++) bucket[d + 1]! += bucket[d]!;
  const order = new Int32Array(N);
  { const fill = bucket.slice(0, maxD + 1); for (let i = 0; i < N; i++) order[fill[depth[i]!]!++] = i; }
  // 容器树的孩子表(CSR)
  const treeKids = ((): Csr => {
    const start = new Int32Array(N + 1);
    for (let i = 0; i < N; i++) if (parent[i]! >= 0) start[parent[i]! + 1]!++;
    for (let i = 0; i < N; i++) start[i + 1]! += start[i]!;
    const fill = start.slice(0, N), list = new Int32Array(start[N]!);
    for (let i = 0; i < N; i++) if (parent[i]! >= 0) list[fill[parent[i]!]!++] = i;
    return { start, list };
  })();
  const childCount = new Int32Array(N);
  for (let i = 0; i < N; i++) childCount[i] = treeKids.start[i + 1]! - treeKids.start[i]!;
  // 第二个、第三个容器:一个节点可以在几个容器里(contains 没有 single-parent),容器树只用第一条;
  // 其余的(和断环时断开的那条)画成淡线 —— 不是疆界,但看得见"它也属于那里"
  const second = new Uint8Array(E);
  { const rt = typeIdx.get(relation); if (rt !== undefined) for (let e = 0; e < E; e++) if (ety[e] === rt && parent[et[e]!] !== ef[e]) second[e] = 1; }
  const desc = new Int32Array(N);
  for (let k = N - 1; k >= 0; k--) { const v = order[k]!, p = parent[v]!; if (p >= 0) desc[p]! += desc[v]! + 1; }

  const adjCache = new Map<number, Csr>();
  const adjOf = (type: string): Csr => {
    const t = typeIdx.get(type);
    if (t === undefined) return { start: new Int32Array(N + 1), list: new Int32Array(0) };
    let a = adjCache.get(t);
    if (!a) { a = buildCsr(N, ef, et, (e) => ety[e] === t, E); adjCache.set(t, a); }
    return a;
  };
  const chainOf = (v: number): number[] => { const c: number[] = []; for (let x = v; x >= 0; x = parent[x]!) c.push(x); return c.reverse(); };

  return { u, N, nodeList, ids, idx, E, ef, et, ety, eprop, typeNames, typeIdx, tSym, relation, parent, depth, order, treeKids, childCount, desc, second, adjOf, chainOf };
}
