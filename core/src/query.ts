// 查询:L0 只做最基本的三件事 —— 过滤节点、取邻域、找路径。
// 路径表达式(auth -dependsOn*->)留给 L1。

import { type Edge, type Node, type Universe, edgeKey, isSchemaId } from './model.ts';

export type Dir = 'out' | 'in' | 'both';

export interface NodeFilter {
  type?: string;
  where?: Record<string, string>;
  orphans?: boolean;
  includeSchema?: boolean;
  text?: string;
}

export function filterNodes(u: Universe, f: NodeFilter = {}): Node[] {
  const touched = new Set<string>();
  if (f.orphans) {
    for (const e of u.edges.values()) {
      touched.add(e.from);
      touched.add(e.to);
    }
  }
  const text = f.text?.toLowerCase();
  return [...u.nodes.values()].filter((n) => {
    if (!f.includeSchema && isSchemaId(n.id)) return false;
    if (f.type !== undefined && n.attrs.type !== f.type) return false;
    for (const [k, v] of Object.entries(f.where ?? {})) if (n.attrs[k] !== v) return false;
    if (f.orphans && (touched.has(n.id) || n.attrs.kind === 'root')) return false;
    if (text && !`${n.id} ${n.label} ${n.attrs.summary ?? ''}`.toLowerCase().includes(text)) return false;
    return true;
  });
}

export interface Step {
  edge: Edge;
  /** 走这一步到达的节点 */
  to: string;
  /** 是否沿边的正方向 */
  forward: boolean;
}

export function steps(u: Universe, id: string, dir: Dir = 'both', type?: string): Step[] {
  const out: Step[] = [];
  for (const e of u.edges.values()) {
    if (type !== undefined && e.type !== type) continue;
    if (e.from === id && dir !== 'in') out.push({ edge: e, to: e.to, forward: true });
    if (e.to === id && dir !== 'out') out.push({ edge: e, to: e.from, forward: false });
  }
  return out;
}

export interface Neighborhood {
  /** id -> 距离 */
  dist: Map<string, number>;
  edges: Edge[];
}

export function neighborhood(
  u: Universe, start: string, opts: { depth?: number; dir?: Dir; type?: string } = {},
): Neighborhood {
  const depth = opts.depth ?? 1;
  const dist = new Map<string, number>([[start, 0]]);
  const edges = new Map<string, Edge>();
  let frontier = [start];
  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const s of steps(u, id, opts.dir, opts.type)) {
        edges.set(edgeKey(s.edge.from, s.edge.type, s.edge.to), s.edge);
        if (!dist.has(s.to)) {
          dist.set(s.to, d);
          next.push(s.to);
        }
      }
    }
    frontier = next;
  }
  return { dist, edges: [...edges.values()] };
}

/** BFS 最短路径,返回经过的步骤;不可达返回 null。 */
export function shortestPath(
  u: Universe, from: string, to: string, opts: { dir?: Dir; type?: string } = {},
): Step[] | null {
  if (from === to) return [];
  const prev = new Map<string, { id: string; step: Step }>();
  const seen = new Set([from]);
  let frontier = [from];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const s of steps(u, id, opts.dir ?? 'both', opts.type)) {
        if (seen.has(s.to)) continue;
        seen.add(s.to);
        prev.set(s.to, { id, step: s });
        if (s.to === to) {
          const path: Step[] = [];
          for (let cur = to; cur !== from;) {
            const p = prev.get(cur)!;
            path.unshift(p.step);
            cur = p.id;
          }
          return path;
        }
        next.push(s.to);
      }
    }
    frontier = next;
  }
  return null;
}
