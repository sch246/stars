// 视图里的表达式:标识符 → 列(属性、信号、度数……)、路径条件(from / to / near / out / into / query)、函数节点(fn.名字)、
// 保存的查询的结果。全部按需计算、缓存;建在图的索引(viewgraph.ts)上。Node 和浏览器里都跑。

import { SCHEMA_PREFIX, isSchemaId } from './model.ts';
import { compileExpr, compileFn, type ExprEnv, type ExprGraph } from './expr.ts';
import { QUERY_PREFIX, listQueries, type QueryResult } from './query.ts';
import { buildCsr, rollupArr, type Csr, type ViewGraph } from './viewgraph.ts';
import type { CompileOptions } from './viewspec.ts';

export interface ViewExprs {
  readonly env: ExprEnv;
  /** 编译一条表达式(按源码缓存),返回 (节点下标) => 值 */
  exprFor(src: string): (i: number) => unknown;
  /** 属性的数值列:不是数字的当 0;同名信号(如监听器报告的实时 size)覆盖属性 */
  attrArr(attr: string): Float64Array;
  /** 信号的数值列(没有记录 = 0),可以沿某种关系向下汇总 */
  signalArr(name: string, rel?: { relation: string; op: 'max' | 'sum' | 'count' }): Float64Array;
  /** 对全部(非模式)节点算一条布尔表达式,返回匹配的 id;写错了会抛出 */
  matches(expr: string): string[];
  /** 保存的查询(~query/<名字>)的结果:算一次缓存;某条算不出来就带 error */
  queryResults(): QueryResult[];
}

/** degree:会显示的边的条数(取决于视图的关系规则,所以由外面算好传进来) */
export function viewExprs(g: ViewGraph, degree: Int32Array, opts: CompileOptions, now: number): ViewExprs {
  const { u, N, nodeList, ids, idx, E, ef, et, ety, typeIdx, tSym, depth, childCount, desc } = g;

  // ---- 数值数组(惰性):属性、信号、汇总 ----
  /** 信号里"有记录"的节点才有值,其余是 NaN(用来覆盖同名属性,如监听器报告的实时 size) */
  const sparseSignal = (name: string): Float64Array | null => {
    const src = opts.signals?.[name];
    if (!src) return null;
    const a = new Float64Array(N).fill(NaN);
    if (src instanceof Map) for (let i = 0; i < N; i++) { const v = src.get(ids[i]!); if (v !== undefined) a[i] = v; }
    else for (let i = 0; i < N; i++) { const v = src[ids[i]!]; if (v !== undefined) a[i] = v; }
    return a;
  };
  const attrCache = new Map<string, Float64Array>();
  const attrArr = (attr: string): Float64Array => {
    let a = attrCache.get(attr);
    if (!a) {
      a = new Float64Array(N);
      for (let i = 0; i < N; i++) { const x = Number(nodeList[i]!.attrs[attr]); a[i] = Number.isFinite(x) ? x : 0; }
      const over = sparseSignal(attr); // 同名信号(如实时 size)覆盖属性
      if (over) for (let i = 0; i < N; i++) if (over[i]! === over[i]!) a[i] = over[i]!;
      attrCache.set(attr, a);
    }
    return a;
  };
  const sigCache = new Map<string, Float64Array>();
  const signalArr = (name: string, rel?: { relation: string; op: 'max' | 'sum' | 'count' }): Float64Array => {
    const key = `${name}|${rel?.relation ?? ''}|${rel?.op ?? ''}`;
    let a = sigCache.get(key);
    if (!a) {
      const src = opts.signals?.[name];
      const base = new Float64Array(N);
      if (src instanceof Map) for (let i = 0; i < N; i++) base[i] = src.get(ids[i]!) ?? 0;
      else if (src) for (let i = 0; i < N; i++) base[i] = src[ids[i]!] ?? 0;
      a = rel ? rollupArr(N, g.adjOf(rel.relation), rel.op, base) : base;
      sigCache.set(key, a);
    }
    return a;
  };

  // ---- 列:标识符 → 类型化数组 / 字符串数组 ----
  const colCache = new Map<string, ArrayLike<number | string>>();
  const exprSignal = (name: string): Float64Array | null => (opts.signals?.[name] ? signalArr(name) : null);
  const exprColumn = (name: string): ArrayLike<number | string> => {
    let col = colCache.get(name);
    if (col) return col;
    switch (name) {
      case 'id': col = ids; break;
      case 'label': col = nodeList.map((n) => n.label); break;
      case 'degree': col = degree; break;
      case 'depth': col = depth; break;
      case 'children': col = childCount; break;
      case 'descendants': col = desc; break;
      default: {
        const sig = exprSignal(name);
        const hasAttr = nodeList.some((n) => n.attrs[name] !== undefined);
        col = sig && !hasAttr ? sig : undefined;
        if (!col) { // 属性列:全是数字就做成数值列,否则是字符串列(缺失 → 0 / '')
          let numeric = true, any = false;
          for (let i = 0; i < N; i++) { const v = nodeList[i]!.attrs[name]; if (v === undefined || v === '') continue; any = true; if (!Number.isFinite(Number(v))) { numeric = false; break; } }
          if (any && numeric) { col = attrArr(name); }
          else col = nodeList.map((n) => n.attrs[name] ?? '');
        }
      }
    }
    colCache.set(name, col);
    return col;
  };

  // ---- 路径条件(表达式里的 from / to / near / out / into / query):全部按参数缓存,惰性计算 ----
  const dirAdj = new Map<string, Csr>();
  /** 按方向的邻接表:out 顺着边,in 逆着边,both 都算;对称的边类型两头都算 */
  const adjDir = (type: string | undefined, dir: 'out' | 'in' | 'both'): Csr => {
    const key = `${type ?? ''}|${dir}`;
    let a = dirAdj.get(key);
    if (a) return a;
    const t = type === undefined ? -1 : typeIdx.get(type) ?? -2;
    const A = new Int32Array(2 * E), B = new Int32Array(2 * E);
    let m = 0;
    if (t !== -2) for (let e = 0; e < E; e++) {
      if (t >= 0 && ety[e] !== t) continue;
      const both = dir === 'both' || tSym[ety[e]!];
      if (dir === 'out' || both) { A[m] = ef[e]!; B[m] = et[e]!; m++; }
      if (dir === 'in' || both) { A[m] = et[e]!; B[m] = ef[e]!; m++; }
    }
    a = buildCsr(N, A, B, () => true, m);
    dirAdj.set(key, a);
    return a;
  };
  const reachCache = new Map<string, Uint8Array>();
  const countCache = new Map<string, Int32Array>();
  const queryCache = new Map<string, Uint8Array>();
  const queryStack: string[] = [];
  const graph: ExprGraph = {
    cur: { i: 0 },
    reach(root, type, dir, maxDepth) {
      const key = `${root}\u0000${type ?? ''}\u0000${dir}\u0000${maxDepth}`;
      let r = reachCache.get(key);
      if (r) return r;
      r = new Uint8Array(N);
      const s = idx.get(root);
      if (s !== undefined) {
        const adj = adjDir(type, dir), seen = new Uint8Array(N);
        seen[s] = 1;
        let frontier = [s];
        for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
          const next: number[] = [];
          for (const v of frontier) {
            for (let k = adj.start[v]!; k < adj.start[v + 1]!; k++) { const w = adj.list[k]!; if (!seen[w]) { seen[w] = 1; r[w] = 1; next.push(w); } }
          }
          frontier = next;
        }
      }
      reachCache.set(key, r);
      return r;
    },
    count(type, other, dir) {
      const key = `${type ?? ''}\u0000${other ?? ''}\u0000${dir}`;
      let c = countCache.get(key);
      if (c) return c;
      c = new Int32Array(N);
      const t = type === undefined ? -1 : typeIdx.get(type) ?? -2, o = other === undefined ? -1 : idx.get(other) ?? -2;
      if (t !== -2 && o !== -2) for (let e = 0; e < E; e++) {
        if (t >= 0 && ety[e] !== t) continue;
        const a = dir === 'out' ? ef[e]! : et[e]!, b = dir === 'out' ? et[e]! : ef[e]!;
        if (o < 0 || b === o) c[a]!++;
        if (tSym[ety[e]!] && (o < 0 || a === o)) c[b]!++; // 对称边:两头都算出边也都算入边
      }
      countCache.set(key, c);
      return c;
    },
    query(name) {
      let r = queryCache.get(name);
      if (r) return r;
      const qn = u.nodes.get(QUERY_PREFIX + name);
      if (!qn || qn.attrs.expr === undefined) throw new Error(`没有保存的查询 "${name}"`);
      if (queryStack.includes(name)) throw new Error(`查询循环引用: ${[...queryStack, name].join(' → ')}`);
      queryStack.push(name);
      const outer = graph.cur.i; // 里面会把 cur 走一遍,算完要还原,外面那条表达式还在算第 outer 个节点
      try {
        const f = exprFor(qn.attrs.expr);
        r = new Uint8Array(N);
        for (let i = 0; i < N; i++) if (!isSchemaId(ids[i]!) && f(i)) r[i] = 1;
      } finally { queryStack.pop(); graph.cur.i = outer; }
      queryCache.set(name, r);
      return r;
    },
  };

  // ---- 函数节点:~fn/<名字>,kind=function,code 是一个函数表达式 ----
  const userFns: Record<string, (...args: never[]) => unknown> = {};
  const env: ExprEnv = { column: exprColumn, fns: userFns, now, graph };
  for (const n of nodeList) {
    if (!n.id.startsWith(`${SCHEMA_PREFIX}fn/`) || n.attrs.kind !== 'function' || !n.attrs.code) continue;
    userFns[n.id.slice(SCHEMA_PREFIX.length + 3)] = compileFn(n.attrs.code, env);
  }
  const exprCache = new Map<string, (i: number) => unknown>();
  const exprFor = (src: string): ((i: number) => unknown) => {
    let f = exprCache.get(src);
    if (!f) { f = compileExpr(src, env); exprCache.set(src, f); }
    return f;
  };

  const matches = (expr: string): string[] => {
    const f = compileExpr(expr, env), out: string[] = [];
    for (let i = 0; i < N; i++) if (!isSchemaId(ids[i]!) && f(i)) out.push(ids[i]!);
    return out;
  };
  let queryList: QueryResult[] | null = null;
  const queryResults = (): QueryResult[] => (queryList ??= listQueries(u).map((q): QueryResult => {
    try {
      const r = graph.query(q.name), members: string[] = [];
      for (let i = 0; i < N; i++) if (r[i]) members.push(ids[i]!);
      return { ...q, members };
    } catch (err) { return { ...q, members: [], error: (err as Error).message }; }
  }));

  return { env, exprFor, attrArr, signalArr, matches, queryResults };
}
