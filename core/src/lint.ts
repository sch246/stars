// 关系的体检:不是"能不能存",而是"关系有没有烂掉"。
// 规则刻意写成独立的小函数,以后加规则只需往 RULES 里加一项。

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Universe, SCHEMA_PREFIX, isSchemaId, schemaNode } from './model.ts';
import { seenPath, seenState } from './stale.ts';
import { compileView } from './view.ts';

export type Severity = 'error' | 'warn' | 'info';

export interface Issue {
  rule: string;
  severity: Severity;
  message: string;
  nodes: string[];
  edge?: { from: string; type: string; to: string };
}

export interface LintOptions {
  /** 节点 file 属性相对于哪个目录;不给则跳过文件检查 */
  baseDir?: string;
  fileExists?: (absPath: string) => boolean;
  /** 不逐个 stat 文件(只看 missing=true 的标记)。监听器在跑时用:它已经在维护这个标记 */
  skipFileStat?: boolean;
}

type Rule = (u: Universe, o: LintOptions) => Issue[];

const dangling: Rule = (u) =>
  [...u.edges.values()].flatMap((e) =>
    [e.from, e.to].filter((id) => !u.nodes.has(id)).map((id): Issue => ({
      rule: 'dangling-edge', severity: 'error', nodes: [],
      edge: { from: e.from, type: e.type, to: e.to },
      message: `边 ${e.from} -${e.type}-> ${e.to} 指向不存在的节点 ${id}`,
    })),
  );

const undeclaredEdgeType: Rule = (u) => {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const e of u.edges.values()) {
    if (seen.has(e.type)) continue;
    seen.add(e.type);
    if (schemaNode(u, e.type)?.attrs.kind !== 'edgeType') {
      out.push({
        rule: 'undeclared-edge-type', severity: 'warn', nodes: [],
        message: `边类型 "${e.type}" 未声明(需要节点 ${SCHEMA_PREFIX}${e.type} kind=edgeType)`,
      });
    }
  }
  return out;
};

const undeclaredNodeType: Rule = (u) => {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const n of u.nodes.values()) {
    const t = n.attrs.type;
    if (t === undefined || seen.has(t)) continue;
    seen.add(t);
    if (schemaNode(u, t)?.attrs.kind !== 'nodeType') {
      out.push({
        rule: 'undeclared-node-type', severity: 'warn', nodes: [n.id],
        message: `节点类型 "${t}" 未声明(需要节点 ${SCHEMA_PREFIX}${t} kind=nodeType),例如 ${n.id}`,
      });
    }
  }
  return out;
};

/** 声明了 acyclic=true 的边类型不能成环。 */
const cycle: Rule = (u) => {
  const out: Issue[] = [];
  for (const s of u.nodes.values()) {
    if (s.attrs.kind !== 'edgeType' || s.attrs.acyclic !== 'true') continue;
    const type = s.id.slice(SCHEMA_PREFIX.length);
    const next = new Map<string, string[]>();
    for (const e of u.edges.values()) {
      if (e.type === type) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
    }
    const state = new Map<string, 1 | 2>();
    const stack: string[] = [];
    const visit = (id: string): void => {
      state.set(id, 1);
      stack.push(id);
      for (const to of next.get(id) ?? []) {
        if (state.get(to) === 1) {
          const loop = [...stack.slice(stack.indexOf(to)), to];
          out.push({
            rule: 'cycle', severity: 'error', nodes: loop.slice(0, -1),
            edge: { from: id, type, to },
            message: `${type} 出现环: ${loop.join(' → ')}`,
          });
        } else if (!state.has(to)) visit(to);
      }
      stack.pop();
      state.set(id, 2);
    };
    for (const id of next.keys()) if (!state.has(id)) visit(id);
  }
  return out;
};

/** 声明了 single-parent=true 的边类型,每个节点最多一条入边。 */
const multipleParents: Rule = (u) => {
  const out: Issue[] = [];
  for (const s of u.nodes.values()) {
    if (s.attrs.kind !== 'edgeType' || s.attrs['single-parent'] !== 'true') continue;
    const type = s.id.slice(SCHEMA_PREFIX.length);
    const parents = new Map<string, string[]>();
    for (const e of u.edges.values()) {
      if (e.type === type) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
    }
    for (const [id, ps] of parents) {
      if (ps.length > 1) {
        out.push({
          rule: 'multiple-parents', severity: 'error', nodes: [id],
          message: `${id} 有 ${ps.length} 个 ${type} 上级: ${ps.join(', ')}`,
        });
      }
    }
  }
  return out;
};

const missingFile: Rule = (u, o) => {
  const exists = o.fileExists ?? existsSync;
  const out: Issue[] = [];
  for (const n of u.nodes.values()) {
    const f = n.attrs.file;
    if (!f) continue;
    const path = f.split('#')[0]!;
    if (n.attrs.missing === 'true' || (o.baseDir && !o.skipFileStat && !exists(resolve(o.baseDir, path)))) {
      out.push({ rule: 'missing-file', severity: 'warn', nodes: [n.id], message: `${n.id} 指向的文件不存在: ${path}` });
    }
  }
  return out;
};

/** 说明写于文件改动之前:节点记的 seen(写说明时文件的版本)和文件现在的内容对不上(见 stale.ts) */
const stale: Rule = (u, o) => {
  if (!o.baseDir) return [];
  const out: Issue[] = [];
  for (const n of u.nodes.values()) {
    if (!n.attrs.seen || seenState(o.baseDir, n.attrs) !== 'stale') continue;
    out.push({ rule: 'stale', severity: 'warn', nodes: [n.id], message: `${n.id} 的说明写于文件改动之前: ${seenPath(n.attrs)}` });
  }
  return out;
};

const orphan: Rule = (u) => {
  const touched = new Set<string>();
  for (const e of u.edges.values()) {
    touched.add(e.from);
    touched.add(e.to);
  }
  return [...u.nodes.values()]
    .filter((n) => !isSchemaId(n.id) && n.attrs.kind !== 'root' && !touched.has(n.id))
    .map((n): Issue => ({ rule: 'orphan', severity: 'info', nodes: [n.id], message: `孤儿节点 ${n.id}(没有任何关系)` }));
};

const proposed: Rule = (u) => [
  ...[...u.nodes.values()]
    .filter((n) => n.attrs.status === 'proposed')
    .map((n): Issue => ({ rule: 'proposed', severity: 'info', nodes: [n.id], message: `待确认的节点: ${n.id}` })),
  ...[...u.edges.values()]
    .filter((e) => e.attrs.status === 'proposed')
    .map((e): Issue => ({
      rule: 'proposed', severity: 'info', nodes: [e.from, e.to],
      edge: { from: e.from, type: e.type, to: e.to },
      message: `待确认: ${e.from} -${e.type}-> ${e.to}`,
    })),
];

// 自定义规则 = 宇宙里的节点:~rule/<名字> kind=rule expr="<布尔表达式>" level=warn|error|info message="…"。
// 表达式和视图规则、保存的查询同一套(属性、degree、路径条件 from / to / out / into、fn.名字……),命中的节点各报一条。
export const RULE_PREFIX = `${SCHEMA_PREFIX}rule/`;
export interface CustomRule { name: string; id: string; expr: string; level: Severity; message: string }
export function listRules(u: Universe): CustomRule[] {
  const out: CustomRule[] = [];
  for (const n of u.nodes.values()) {
    if (!n.id.startsWith(RULE_PREFIX) || n.attrs.kind !== 'rule' || !n.attrs.expr) continue;
    const name = n.id.slice(RULE_PREFIX.length), lv = n.attrs.level;
    out.push({ name, id: n.id, expr: n.attrs.expr, level: lv === 'error' || lv === 'info' ? lv : 'warn', message: n.attrs.message ?? n.attrs.summary ?? (n.label || name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
const CUSTOM_CAP = 500;
const custom: Rule = (u) => {
  const rules = listRules(u);
  if (!rules.length) return [];
  const c = compileView(u, {});
  const out: Issue[] = [];
  for (const r of rules) {
    let ids: string[];
    try { ids = c.matches(r.expr); } catch (err) { out.push({ rule: 'rule-error', severity: 'error', nodes: [r.id], message: `规则 ${r.name} 写错了: ${(err as Error).message}` }); continue; }
    for (const id of ids.slice(0, CUSTOM_CAP)) out.push({ rule: `rule:${r.name}`, severity: r.level, nodes: [id], message: `${id}: ${r.message}` });
    if (ids.length > CUSTOM_CAP) out.push({ rule: `rule:${r.name}`, severity: r.level, nodes: [], message: `规则 ${r.name} 还有 ${ids.length - CUSTOM_CAP} 个节点没列出` });
  }
  return out;
};

export const RULES: Record<string, Rule> = {
  'dangling-edge': dangling,
  'undeclared-edge-type': undeclaredEdgeType,
  'undeclared-node-type': undeclaredNodeType,
  cycle,
  'multiple-parents': multipleParents,
  'missing-file': missingFile,
  stale,
  orphan,
  proposed,
  custom,
};

const ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

export function lint(u: Universe, options: LintOptions = {}): Issue[] {
  return Object.values(RULES)
    .flatMap((rule) => rule(u, options))
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
