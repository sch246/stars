// 宇宙 = 节点 + 带类型的有向边。其余一切(类型、规则、视图)都建立在这上面。
// 边由 (from, type, to) 三元组唯一确定,不需要 id。

export type Attrs = Record<string, string>;

export interface Node {
  id: string;
  label: string;
  attrs: Attrs;
}

export interface Edge {
  from: string;
  type: string;
  to: string;
  attrs: Attrs;
}

export interface Universe {
  nodes: Map<string, Node>;
  edges: Map<string, Edge>;
}

/** 约定:id 以 ~ 开头的节点是"模式节点",用来定义类型(见 DESIGN.md)。 */
export const SCHEMA_PREFIX = '~';

export function createUniverse(): Universe {
  return { nodes: new Map(), edges: new Map() };
}

export function edgeKey(from: string, type: string, to: string): string {
  return `${from}\u0000${type}\u0000${to}`;
}

export class StarsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StarsError';
  }
}

const ID_RE = /^[^\s"#][^\s"]*$/u;
const TYPE_RE = /^[\p{L}\p{N}_]([\p{L}\p{N}_.:/-]*[\p{L}\p{N}_])?$/u;

export function assertValidId(id: string): void {
  if (!ID_RE.test(id)) {
    throw new StarsError(`非法 id "${id}":不能为空、含空白或引号,也不能以 # 开头`);
  }
}

export function assertValidType(type: string): void {
  if (!TYPE_RE.test(type)) {
    throw new StarsError(`非法边类型 "${type}":只能含字母数字 _ . : / -,且不能以 - 结尾`);
  }
}

export function isSchemaId(id: string): boolean {
  return id.startsWith(SCHEMA_PREFIX);
}

export function schemaNode(u: Universe, name: string): Node | undefined {
  return u.nodes.get(SCHEMA_PREFIX + name);
}

export function isSymmetric(u: Universe, type: string): boolean {
  return schemaNode(u, type)?.attrs.symmetric === 'true';
}

/** 对称边规范化为 from <= to,保证 (a,b) 与 (b,a) 是同一条边。 */
export function canonicalEnds(u: Universe, from: string, type: string, to: string): [string, string] {
  return isSymmetric(u, type) && from > to ? [to, from] : [from, to];
}

export function getEdge(u: Universe, from: string, type: string, to: string): Edge | undefined {
  const [a, b] = canonicalEnds(u, from, type, to);
  return u.edges.get(edgeKey(a, type, b));
}
