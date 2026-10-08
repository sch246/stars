// 文本格式(.stars):一行一个事实,人和 AI 都能直接读写,git diff 友好。
//
//   stars 1
//   node auth "认证模块" type=module file=src/auth.ts
//   auth -dependsOn-> session status=proposed
//   a -related- b
//
// 节点和边都按 id 排序输出,所以同一个宇宙总是序列化成同一段文本。
// 注意:注释(# 开头的行)读入时丢弃,不会被保留。

import {
  type Attrs, type Edge, type Universe, StarsError, assertValidId, assertValidType,
  canonicalEnds, createUniverse, edgeKey, isSymmetric,
} from './model.ts';

export const FORMAT_VERSION = 1;

const ARROW_OUT = /^-(.+)->$/u;
const ARROW_SYM = /^-(.+)-$/u;
const ATTR_ORDER = ['kind', 'type', 'file', 'status', 'summary'];

function tokenize(line: string, lineNo: number): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && /\s/.test(line[i]!)) i++;
    if (i >= n) break;
    let buf = '';
    while (i < n && !/\s/.test(line[i]!)) {
      if (line[i] === '"') {
        let j = i + 1;
        while (j < n && line[j] !== '"') j += line[j] === '\\' ? 2 : 1;
        if (j >= n) throw new StarsError(`第 ${lineNo} 行:引号未闭合`);
        try {
          buf += JSON.parse(line.slice(i, j + 1)) as string;
        } catch {
          throw new StarsError(`第 ${lineNo} 行:非法的字符串转义`);
        }
        i = j + 1;
      } else {
        buf += line[i];
        i++;
      }
    }
    tokens.push(buf);
  }
  return tokens;
}

function parseAttrs(tokens: string[], lineNo: number): Attrs {
  const attrs: Attrs = {};
  for (const t of tokens) {
    const eq = t.indexOf('=');
    if (eq <= 0) throw new StarsError(`第 ${lineNo} 行:属性应写成 key=value,得到 "${t}"`);
    attrs[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return attrs;
}

export function parse(text: string): Universe {
  const u = createUniverse();
  const lines = text.split(/\r?\n/);
  let sawHeader = false;
  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const line = lines[idx]!;
    if (/^\s*$/.test(line) || line.startsWith('#')) continue;
    const tokens = tokenize(line, lineNo);
    if (!sawHeader) {
      if (tokens[0] !== 'stars') throw new StarsError(`第 ${lineNo} 行:文件应以 "stars ${FORMAT_VERSION}" 开头`);
      if (Number(tokens[1]) !== FORMAT_VERSION) throw new StarsError(`不支持的格式版本 "${tokens[1]}"`);
      sawHeader = true;
      continue;
    }
    const arrow = tokens[1];
    const isEdge = arrow !== undefined && (ARROW_OUT.test(arrow) || ARROW_SYM.test(arrow));
    if (isEdge) {
      const m = ARROW_OUT.exec(arrow!) ?? ARROW_SYM.exec(arrow!)!;
      const from = tokens[0]!;
      const to = tokens[2];
      if (to === undefined) throw new StarsError(`第 ${lineNo} 行:边缺少终点`);
      const type = m[1]!;
      assertValidType(type);
      const key = edgeKey(from, type, to);
      if (u.edges.has(key)) throw new StarsError(`第 ${lineNo} 行:重复的边 ${from} -${type}-> ${to}`);
      u.edges.set(key, { from, type, to, attrs: parseAttrs(tokens.slice(3), lineNo) });
    } else if (tokens[0] === 'node') {
      const id = tokens[1];
      if (id === undefined) throw new StarsError(`第 ${lineNo} 行:node 缺少 id`);
      assertValidId(id);
      if (u.nodes.has(id)) throw new StarsError(`第 ${lineNo} 行:重复的节点 ${id}`);
      const label = tokens[2];
      if (label === undefined) throw new StarsError(`第 ${lineNo} 行:node 缺少标签(写成 node id "标签")`);
      u.nodes.set(id, { id, label, attrs: parseAttrs(tokens.slice(3), lineNo) });
    } else {
      throw new StarsError(`第 ${lineNo} 行:无法识别 "${line.trim()}"`);
    }
  }
  if (!sawHeader && text.trim() !== '') throw new StarsError(`缺少文件头 "stars ${FORMAT_VERSION}"`);
  // 对称边的方向规范化(手写文件里 b -related- a 与 a -related- b 是同一条)
  const canon = new Map<string, Edge>();
  for (const e of u.edges.values()) {
    const [from, to] = canonicalEnds(u, e.from, e.type, e.to);
    const key = edgeKey(from, e.type, to);
    if (canon.has(key)) throw new StarsError(`重复的对称边 ${from} -${e.type}- ${to}`);
    canon.set(key, { ...e, from, to });
  }
  u.edges = canon;
  return u;
}

function emitValue(v: string): string {
  return v !== '' && /^[^\s"]+$/u.test(v) ? v : JSON.stringify(v);
}

function emitAttrs(attrs: Attrs): string {
  const ks = Object.keys(attrs);
  if (ks.length === 0) return '';
  if (ks.length === 1) return ` ${ks[0]}=${emitValue(attrs[ks[0]!]!)}`;
  const keys = ks.sort((a, b) => {
    const ia = ATTR_ORDER.indexOf(a);
    const ib = ATTR_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return keys.map((k) => ` ${k}=${emitValue(attrs[k]!)}`).join('');
}

/** 文件头里的 rev=N:这个文件已经包含了操作日志的前 N 条。没有 rev(旧文件)返回 undefined。 */
export function readRev(text: string): number | undefined {
  const m = /^stars \d+ rev=(\d+)/m.exec(text.slice(0, 200));
  return m ? Number(m[1]) : undefined;
}

export function serialize(u: Universe, rev?: number): string {
  const out: string[] = [`stars ${FORMAT_VERSION}${rev !== undefined ? ` rev=${rev}` : ''}`, ''];
  // 默认的字符串排序是按 UTF-16 码元,比带比较函数的排序快得多,而且和"按 id 字典序"完全一致
  for (const id of [...u.nodes.keys()].sort()) {
    const n = u.nodes.get(id)!;
    out.push(`node ${n.id} ${JSON.stringify(n.label)}${emitAttrs(n.attrs)}`);
  }
  out.push('');
  // 边的键是 from\0type\0to,\0 比任何字符都小,所以按整串排序就等于按 (from, type, to) 逐段比较
  for (const key of [...u.edges.keys()].sort()) {
    const e = u.edges.get(key)!;
    const arrow = isSymmetric(u, e.type) ? `-${e.type}-` : `-${e.type}->`;
    out.push(`${e.from} ${arrow} ${e.to}${emitAttrs(e.attrs)}`);
  }
  out.push('');
  return out.join('\n');
}
