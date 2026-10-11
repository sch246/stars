// 只看宇宙就能答的读命令(show / ls / nb / path / types):CLI 对磁盘上那份算,查看器对手上那份算(回放、预览草稿时就是画面上的),
// 输出和 data 的样子两边一样(stars ui --json、页面、Node 脚本拿到的是同一种)。浏览器和 Node 共用。
import { StarsError, type Attrs, type Universe } from './model.ts';
import { filterNodes, neighborhood, shortestPath, type Dir } from './query.ts';
import { styleTypes, type StyleTypeInfo } from './styles.ts';

export interface ReadOut { out: string; data: unknown }

/** 一行:id [类型]  标签(提议的标出来) */
export function nodeLine(u: Universe, id: string): string {
  const n = u.nodes.get(id);
  if (!n) return `${id}  (不存在)`;
  return `${n.id}${n.attrs.type ? ` [${n.attrs.type}]` : ''}  ${n.label}${n.attrs.status === 'proposed' ? '  (proposed)' : ''}`;
}
const must = (u: Universe, id: string | undefined) => { if (!id || !u.nodes.has(id)) throw new StarsError(`节点不存在: ${id ?? ''}`); return id; };

export function readShow(u: Universe, id: string | undefined): ReadOut {
  const n = u.nodes.get(must(u, id))!;
  const out = [...u.edges.values()].filter((e) => e.from === n.id), inn = [...u.edges.values()].filter((e) => e.to === n.id);
  const lines = [nodeLine(u, n.id)];
  for (const [k, v] of Object.entries(n.attrs)) if (k !== 'type') lines.push(`  ${k}: ${v}`);
  for (const e of out) lines.push(`  → -${e.type}-> ${e.to}${e.attrs.status ? ` (${e.attrs.status})` : ''}`);
  for (const e of inn) lines.push(`  ← ${e.from} -${e.type}->${e.attrs.status ? ` (${e.attrs.status})` : ''}`);
  return { out: lines.join('\n'), data: { node: n, out, in: inn } };
}

export function readNb(u: Universe, id: string | undefined, o: { depth?: string; dir?: string; type?: string }): ReadOut {
  const nb = neighborhood(u, must(u, id), { depth: Number(o.depth ?? 1), dir: (o.dir as Dir) ?? 'both', type: o.type });
  return {
    out: [...nb.dist].sort((a, b) => a[1] - b[1]).map(([nid, d]) => `${'  '.repeat(d)}${nodeLine(u, nid)}`).join('\n'),
    data: { nodes: Object.fromEntries(nb.dist), edges: nb.edges },
  };
}

export function readPath(u: Universe, a: string | undefined, b: string | undefined, o: { type?: string }): ReadOut {
  const p = shortestPath(u, must(u, a), must(u, b), { type: o.type });
  return { out: p === null ? '不可达' : [a, ...p.map((s) => `${s.forward ? `-${s.edge.type}->` : `<-${s.edge.type}-`} ${s.to}`)].join(' '), data: p };
}

/** limit:最多列几行(查看器里 300;CLI 不限) */
export function readLs(u: Universe, o: { type?: string; where?: Attrs; orphans?: boolean; text?: string; edges?: boolean }, limit = Infinity): ReadOut {
  const nodes = filterNodes(u, { type: o.type, where: o.where, orphans: o.orphans, text: o.text });
  let out = nodes.slice(0, limit).map((n) => nodeLine(u, n.id)).join('\n') || '(空)';
  if (nodes.length > limit) out += `\n… 共 ${nodes.length} 个,只列前 ${limit}`;
  if (o.edges) out += [...u.edges.values()].map((e) => `\n${e.from} -${e.type}-> ${e.to}`).join('');
  return { out, data: nodes };
}

export function readTypes(u: Universe, hint = ''): ReadOut {
  const t = styleTypes(u);
  const fmt = (x: StyleTypeInfo) => `  ${x.name.padEnd(14)} ${String(x.count).padStart(6)}  ${Object.entries(x.style).map(([k, v]) => `${k}=${v}`).join(' ') || '(默认样式)'}`
    + `${x.label !== x.name ? `  ${x.label}` : ''}${x.declared ? '' : '   (还没有类型节点)'}`;
  return { out: ['节点类型', ...t.nodes.map(fmt), '边类型', ...t.edges.map(fmt), ...(hint ? [hint] : [])].join('\n'), data: t };
}
