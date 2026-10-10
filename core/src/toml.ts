// TOML 的表单编辑(浏览器与 Node 共用):解析成带源码位置的树,改动按路径只动那一段 —— 注释、空行、键序、引号风格都不变。
//   · 认 TOML 1.0 的全部写法:[表]、[[数组表]]、点号键、内联表、数组(可跨行、带注释、尾逗号)、四种字符串、日期时间
//     (内联表里换行、尾逗号是 1.1 才允许的,这里也认)
//   · 树和 LLF 的文档树同形(kind / key / entries / items / value / comments),表单直接复用;type 记 TOML 自己的类型
//   · 文件由一个个"定义单元"组成:一行键值、一段表(表头到下一个表头之前)、数组里的一项、内联表里的一个成员。
//     删一项 = 删掉定义它和它下面所有东西的单元;加一项 = 按这张表是怎么来的,在对的地方加一行(或加进括号里)
//   · 紧挨在一行上方的注释属于这一行(和 LLF 的约定一样),删的时候一起删;隔着空行的注释不属于任何一项
// 这个文件会被静态导出拼进同一个作用域:顶层名字都以 toml / Toml 开头。
import { jsoncSeqDelete, jsoncSeqInsert, type JsoncSeq, type JsoncSpan } from './jsonc.ts';

export type TomlType = 'table' | 'array' | 'string' | 'integer' | 'float' | 'bool' | 'datetime';
export type TomlPath = (string | number)[];
export interface TomlNode extends JsoncSpan {
  kind: 'map' | 'list' | 'str';
  type: TomlType;
  key?: string;
  /** 标量在表单里的样子:字符串的内容、数字 / 日期的原文、true / false */
  value?: string;
  /** 给表单挑控件:bool / number / color */
  tag?: string;
  block?: boolean;
  entries?: TomlNode[];
  items?: TomlNode[];
  comments?: string[];
  /** 这一项是怎么来的:root 整个文件;header [表];aot [[数组表]] 里的一张;aotList 数组表本身;
   *  implicit 只出现在别的表头的路径里;dotted 点号键带出来的表;inline 内联表;value 普通的值 */
  def: 'root' | 'header' | 'aot' | 'aotList' | 'implicit' | 'dotted' | 'inline' | 'value';
  /** 字符串的引号:" ' """ ''' */
  quote?: string;
  /** root / header / aot:新的键值插在哪儿(最后一个键值之后,没有就是表头那一行之后) */
  bodyAt?: number;
  /** 内联表的成员(点号键的成员可能一次定义好几层,所以不和 entries 一一对应) */
  members?: JsoncSpan[];
}
/** 定义单元:kv 一行键值;section 一段表;item 数组里的一项;member 内联表的一个成员。[a, b) 是删掉它要删的范围 */
export interface TomlUnit { kind: 'kv' | 'section' | 'item' | 'member'; path: TomlPath; a: number; b: number; owner?: TomlPath; seq?: JsoncSeq; idx?: number }
export interface TomlDoc { root: TomlNode; units: TomlUnit[] }

export class TomlError extends Error {
  line: number;
  constructor(message: string, text: string, at: number) {
    const line = text.slice(0, at).split('\n').length;
    super(`${message}(第 ${line} 行)`);
    this.name = 'TomlError';
    this.line = line;
  }
}

const TOML_DEC = /^[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?/;
const TOML_INT = /^(?:[+-]?(?:0|[1-9](?:_?\d)*)|0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*)$/;
const TOML_FLOAT = /^(?:[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?|[+-]?(?:inf|nan))$/;
const TOML_DATE = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?/;
const TOML_TIME = /^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?/;
const tomlBare = (k: string) => /^[A-Za-z0-9_-]+$/.test(k);
/** 键:能裸写就裸写,否则加双引号 */
export const tomlKey = (k: string): string => (tomlBare(k) ? k : tomlBasic(k));
const tomlBasic = (s: string) => JSON.stringify(s).replace(/\x7f/g, '\\u007F');
const tomlLineStart = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;
const tomlLineEnd = (text: string, at: number) => { const e = text.indexOf('\n', at); return e < 0 ? text.length : e + 1; };
const tomlHeaderKeys = (path: TomlPath) => path.filter((p) => typeof p === 'string').map((k) => tomlKey(k as string)).join('.');
const tomlStarts = (p: TomlPath, prefix: TomlPath) => prefix.length <= p.length && prefix.every((x, i) => x === p[i]);

interface TomlComment { start: number; end: number; text: string; sameLine: boolean }

export function tomlParseDoc(text: string): TomlDoc {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = (msg: string, at = i): never => { throw new TomlError(msg, text, at); };
  const units: TomlUnit[] = [];
  const blank = (key: string | undefined, def: TomlNode['def'], at: number): TomlNode => ({ kind: 'map', type: 'table', key, entries: [], def, start: at, end: at, lead: at, comma: -1, trail: -1 });
  const root = blank(undefined, 'root', 0);
  const child = (t: TomlNode, k: string) => t.entries!.find((e) => e.key === k);
  const ws = () => { while (text[i] === ' ' || text[i] === '\t') i++; };
  const eol = () => { if (text[i] === '\r' && text[i + 1] === '\n') i++; if (i < text.length && text[i] !== '\n') fail(`这里不该是「${text.slice(i, i + 12).split('\n')[0]}」`); if (i < text.length) i++; };

  // ---- 键 ----
  const simpleKey = (): string => {
    if (text[i] === '"') return basic();
    if (text[i] === "'") return literal();
    const m = /^[A-Za-z0-9_-]+/.exec(text.slice(i, i + 256));
    if (!m) fail('这里应该是键');
    i += m![0].length;
    return m![0];
  };
  const dottedKey = (): string[] => {
    const ks = [simpleKey()];
    for (;;) { const s = i; ws(); if (text[i] !== '.') { i = s; return ks; } i++; ws(); ks.push(simpleKey()); }
  };

  // ---- 字符串 ----
  const escape = (): string => {
    const e = text[i + 1];
    const map: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };
    if (e !== undefined && e in map) { i += 2; return map[e]!; }
    const len = e === 'u' ? 4 : e === 'U' ? 8 : e === 'x' ? 2 : 0;
    const h = text.slice(i + 2, i + 2 + len);
    if (!len || !new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(h)) fail('不认识的转义');
    i += 2 + len;
    return String.fromCodePoint(parseInt(h, 16));
  };
  const basic = (): string => {
    const s = i; i++;
    let out = '';
    for (;;) {
      const c = text[i];
      if (c === undefined || c === '\n') fail('字符串没有结束', s);
      if (c === '"') { i++; return out; }
      if (c === '\\') out += escape(); else { out += c; i++; }
    }
  };
  const literal = (): string => {
    const s = i, e = text.indexOf("'", i + 1), nl = text.indexOf('\n', i + 1);
    if (e < 0 || (nl >= 0 && nl < e)) fail('字符串没有结束', s);
    i = e + 1;
    return text.slice(s + 1, e);
  };
  const multi = (q: string): string => {
    const s = i; i += 3;
    if (text[i] === '\n') i++; else if (text[i] === '\r' && text[i + 1] === '\n') i += 2;   // 紧跟开头的换行不算内容
    let out = '';
    for (;;) {
      if (i >= text.length) fail('多行字符串没有结束', s);
      if (text.startsWith(q + q + q, i)) {
        let n = 3;
        while (n < 5 && text[i + n] === q) n++;   // 结尾前最多可以再有两个引号,算内容
        out += q.repeat(n - 3); i += n;
        return out;
      }
      const c = text[i]!;
      if (q === '"' && c === '\\') {
        if (/^\\[ \t]*\r?\n/.test(text.slice(i, tomlLineEnd(text, i)))) {
          i++; while (/[ \t\r\n]/.test(text[i] ?? '')) i++;   // 行尾的反斜杠:连同后面的空白和换行一起去掉
        } else out += escape();
      } else { out += c; i++; }
    }
  };

  // ---- 值 ----
  const gap = (): TomlComment[] => {
    const out: TomlComment[] = [];
    let nl = false;
    while (i < text.length) {
      const c = text[i]!;
      if (c === '\n') { nl = true; i++; }
      else if (c === ' ' || c === '\t' || c === '\r') i++;
      else if (c === '#') { const s = i, e = tomlLineEnd(text, i); i = text[e - 1] === '\n' ? e - 1 : e; out.push({ start: s, end: i, text: text.slice(s + 1, i).replace(/^ /, '').trimEnd(), sameLine: !nl }); }
      else break;
    }
    return out;
  };
  const attach = (cs: TomlComment[], at: number): { lead: number; comments: string[] } => {
    let lead = at;
    const mine: string[] = [];
    for (let k = cs.length - 1; k >= 0; k--) {
      const c = cs[k]!;
      if (c.sameLine || /\n[ \t\r]*\n/.test(text.slice(c.end, lead))) break;
      mine.unshift(c.text); lead = c.start;
    }
    return { lead, comments: mine };
  };
  /** 括号里的一串:[ 值, … ] 或 { 键 = 值, … }。每一项交给 one,返回它的范围 */
  const seq = (close: string, one: (lead: number, comments: string[]) => JsoncSpan): JsoncSpan[] => {
    const kids: JsoncSpan[] = [];
    for (;;) {
      const cs = gap();
      if (text[i] === close) { i++; return kids; }
      if (i >= text.length) fail(`缺少 ${close}`);
      if (kids.length && kids[kids.length - 1]!.comma < 0) fail(`少了逗号或 ${close}`);
      const { lead, comments } = attach(cs, i);
      const kid = one(lead, comments);
      const save = i, after = gap();
      if (text[i] === ',') {
        kid.comma = i; i++;
        const t = gap().find((x) => x.sameLine);
        if (t) kid.trail = t.end;
        i = t ? t.end : kid.comma + 1;
      } else {
        const t = after.find((x) => x.sameLine);
        if (t) kid.trail = t.end;
        i = save;
      }
      kids.push(kid);
    }
  };
  const value = (key: string | undefined, lead: number, comments: string[], path: TomlPath): TomlNode => {
    const start = i, c = text[i];
    const base = { key, start, lead, comma: -1, trail: -1, def: 'value' as const, ...(comments.length ? { comments } : {}) };
    const str = (v: string, quote: string): TomlNode => ({ ...base, kind: 'str', type: 'string', value: v, quote, end: i, ...(v.includes('\n') ? { block: true } : {}), ...(/^#[0-9a-fA-F]{6}$/.test(v) ? { tag: 'color' } : {}) });
    if (text.startsWith('"""', i)) { const v = multi('"'); return str(v, '"""'); }
    if (text.startsWith("'''", i)) { const v = multi("'"); return str(v, "'''"); }
    if (c === '"') { const v = basic(); return str(v, '"'); }
    if (c === "'") { const v = literal(); return str(v, "'"); }
    if (c === '[') {
      i++;
      const node: TomlNode = { ...base, kind: 'list', type: 'array', items: [], end: i };
      const kids = seq(']', (l, cm) => { const v = value(undefined, l, cm, [...path, node.items!.length]); node.items!.push(v); return v; });
      node.end = i;
      const s: JsoncSeq = { start, end: i, kids };
      kids.forEach((k, idx) => units.push({ kind: 'item', path: [...path, idx], a: k.lead, b: k.end, seq: s, idx }));
      return node;
    }
    if (c === '{') {
      i++;
      const node: TomlNode = { ...base, kind: 'map', type: 'table', def: 'inline', entries: [], end: i };
      const mem: { span: JsoncSpan; path: TomlPath }[] = [];
      const kids = seq('}', (l) => {
        const ks = dottedKey(); ws();
        if (text[i] !== '=') fail('键后面要有 =');
        i++; ws();
        let t = node;
        for (const k of ks.slice(0, -1)) {
          let n = child(t, k);
          if (!n) { n = { ...blank(k, 'inline', l) }; t.entries!.push(n); }
          else if (n.kind !== 'map' || n.members) fail(`「${k}」不是表`);
          t = n;
        }
        const last = ks[ks.length - 1]!;
        if (child(t, last)) fail(`重复的键「${last}」`);
        const v = value(last, l, [], [...path, ...ks]);
        t.entries!.push(v);
        const span = { lead: l, start: l, end: v.end, comma: -1, trail: -1 };
        mem.push({ span, path: [...path, ...ks] });
        return span;
      });
      node.end = i; node.members = kids;
      const s: JsoncSeq = { start, end: i, kids };
      mem.forEach((m, idx) => units.push({ kind: 'member', path: m.path, a: m.span.lead, b: m.span.end, seq: s, idx }));
      return node;
    }
    const rest = text.slice(i, i + 128);
    let m: RegExpExecArray | null, type: TomlType;
    if ((m = TOML_DATE.exec(rest)) || (m = TOML_TIME.exec(rest))) type = 'datetime';
    else if ((m = /^(?:true|false)/.exec(rest))) type = 'bool';
    else if ((m = /^(?:[+-]?(?:inf|nan)|0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*)/.exec(rest)) || (m = TOML_DEC.exec(rest))) type = TOML_INT.test(m[0]) ? 'integer' : 'float';
    else return fail(i >= text.length ? '缺少值' : `这里不该是「${rest.split('\n')[0]!.slice(0, 12)}」`);
    i += m[0].length;
    if (i < text.length && !/[\s,\]}#]/.test(text[i]!)) fail(`这里不该是「${text.slice(start, i + 1)}」`);
    const v = m[0];
    const tag = type === 'bool' ? 'bool' : (type === 'integer' || type === 'float') && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v) ? 'number' : undefined;
    return { ...base, kind: 'str', type, value: v, end: i, ...(tag ? { tag } : {}) };
  };

  // ---- 一行一行 ----
  let cur = root, curPath: TomlPath = [], pending: TomlComment[] = [];
  let section: TomlUnit | null = null;
  while (i < text.length) {
    ws();
    const c = text[i];
    if (c === '\n' || (c === '\r' && text[i + 1] === '\n')) { pending = []; eol(); continue; }
    if (c === undefined) break;
    if (c === '#') { const s = i, e = tomlLineEnd(text, i); i = e; pending.push({ start: tomlLineStart(text, s), end: e, text: text.slice(s + 1, e).replace(/\r?\n$/, '').replace(/^ /, '').trimEnd(), sameLine: false }); continue; }
    const lead = pending.length ? pending[0]!.start : tomlLineStart(text, i), comments = pending.map((x) => x.text);
    pending = [];
    if (c === '[') {
      const aot = text[i + 1] === '[';
      i += aot ? 2 : 1; ws();
      const ks = dottedKey(); ws();
      if (!text.startsWith(aot ? ']]' : ']', i)) fail(aot ? '表头要用 ]] 结束' : '表头要用 ] 结束');
      i += aot ? 2 : 1; ws();
      if (text[i] === '#') i = tomlLineEnd(text, i) - (text[tomlLineEnd(text, i) - 1] === '\n' ? 1 : 0);
      eol();
      if (section) section.b = tomlLineStart(text, lead);
      let t = root;
      const p: TomlPath = [];
      for (const k of ks.slice(0, -1)) {
        let n = child(t, k);
        if (!n) { n = blank(k, 'implicit', lead); t.entries!.push(n); }
        p.push(k);
        if (n.def === 'aotList') { p.push(n.items!.length - 1); n = n.items![n.items!.length - 1]!; }
        else if (n.kind !== 'map' || n.def === 'inline') fail(`「${k}」不是表`);
        t = n;
      }
      const last = ks[ks.length - 1]!;
      let n = child(t, last);
      if (aot) {
        if (!n) { n = { ...blank(last, 'aotList', lead), kind: 'list', type: 'array', entries: undefined, items: [] }; t.entries!.push(n); }
        else if (n.def !== 'aotList') fail(`「${last}」已经定义过,不是数组表`);
        const el = blank(undefined, 'aot', lead);
        if (comments.length) el.comments = comments;
        n.items!.push(el);
        p.push(last, n.items!.length - 1);
        cur = el;
      } else {
        if (n && n.def !== 'implicit') fail(`表「${ks.join('.')}」重复定义了`);
        if (!n) { n = blank(last, 'header', lead); t.entries!.push(n); }
        n.def = 'header'; n.lead = n.start = n.end = lead;
        if (comments.length) n.comments = comments;
        p.push(last);
        cur = n;
      }
      cur.bodyAt = i;
      curPath = p;
      section = { kind: 'section', path: p, a: tomlLineStart(text, lead), b: text.length };
      units.push(section);
      continue;
    }
    // 键 = 值
    const ks = dottedKey(); ws();
    if (text[i] !== '=') fail('键后面要有 =');
    i++; ws();
    let t = cur;
    const p = [...curPath];
    for (const k of ks.slice(0, -1)) {
      let n = child(t, k);
      if (!n) { n = blank(k, 'dotted', lead); t.entries!.push(n); }
      else if (n.def !== 'dotted' && n.def !== 'implicit') fail(`「${k}」不是能接着写的表`);
      p.push(k);
      t = n;
    }
    const last = ks[ks.length - 1]!;
    if (child(t, last)) fail(`重复的键「${last}」`);
    p.push(last);
    const v = value(last, lead, comments, p);
    t.entries!.push(v);
    ws();
    if (text[i] === '#') { const e = tomlLineEnd(text, i); i = text[e - 1] === '\n' ? e - 1 : e; v.trail = i; }
    eol();
    units.push({ kind: 'kv', path: p, a: tomlLineStart(text, lead), b: i, owner: curPath });
    cur.bodyAt = i;
  }
  return { root, units };
}

export const tomlParse = (text: string): TomlNode => tomlParseDoc(text).root;

export function tomlFind(root: TomlNode, path: TomlPath): TomlNode | null {
  let n: TomlNode | undefined = root;
  for (const p of path) {
    if (!n) return null;
    if (n.kind === 'map') n = n.entries!.find((e) => e.key === String(p));
    else if (n.kind === 'list' && typeof p === 'number') n = n.items![p];
    else return null;
  }
  return n ?? null;
}

/** 表单里的字符串 → 这个类型的 TOML 字面量;字符串尽量保持原来的引号 */
export function tomlLiteral(type: TomlType, value: string, quote = '"'): string {
  if (type === 'string') {
    // eslint-disable-next-line no-control-regex
    const ctl = /[\x00-\x08\x0b-\x1f\x7f]/.test(value);
    if (quote === "'" && !/['\n\r]/.test(value) && !ctl) return `'${value}'`;
    if (quote === "'''" && !value.includes("'''") && !ctl && !value.endsWith("''")) return "'''" + (value.includes('\n') ? '\n' : '') + value + "'''";
    if (quote === '"""' || ((quote === "'''") && value.includes('\n'))) {
      const body = value.replace(/\\/g, '\\\\').replace(/"""/g, '""\\"').replace(/"$/, '\\"').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
      return '"""' + (value.includes('\n') ? '\n' : '') + body + '"""';
    }
    return tomlBasic(value);
  }
  const v = value.trim();
  if (type === 'integer' || type === 'float') { if (TOML_INT.test(v) || TOML_FLOAT.test(v)) return v; throw new Error(`「${value}」不是数字`); }
  if (type === 'bool') { if (v === 'true' || v === 'false') return v; throw new Error(`「${value}」不是 true / false`); }
  if (type === 'datetime') { const m = TOML_DATE.exec(v) || TOML_TIME.exec(v); if (m && m[0] === v) return v; throw new Error(`「${value}」不是日期 / 时间`); }
  throw new Error('表和数组不能直接填字符串');
}

const tomlSplice = (text: string, at: number, del: number, ins: string) => text.slice(0, at) + ins + text.slice(at + del);
/** 在 pos(一行的开头,或文件末尾)插入一整行 */
const tomlInsertLine = (text: string, pos: number, line: string) => tomlSplice(text, pos, 0, (pos > 0 && text[pos - 1] !== '\n' ? '\n' : '') + line + '\n');

/** 把路径上那个标量换成新值(按它原来的类型和引号写) */
export function tomlSet(text: string, path: TomlPath, value: string | null): string {
  const n = tomlFind(tomlParse(text), path);
  if (!n) throw new Error(`没有这一项:${path.join('.')}`);
  if (value === null) throw new Error('TOML 没有空值');
  return tomlSplice(text, n.start, n.end - n.start, tomlLiteral(n.type, value, n.quote));
}

/** 往路径上的表 / 数组加一项。literal 是 TOML 原文(比如 "" 0 false {} []);往数组表里加就是新加一段 [[…]](literal 不用) */
export function tomlInsert(text: string, path: TomlPath, key: string | undefined, literal: string): string {
  const { root, units } = tomlParseDoc(text), c = tomlFind(root, path);
  if (!c || (c.kind !== 'map' && c.kind !== 'list')) throw new Error('只能往表或数组里加');
  const under = units.filter((u) => tomlStarts(u.path, path) && u.path.length > path.length);
  if (c.kind === 'list') {
    if (c.def === 'aotList') {
      const end = Math.max(...under.map((u) => u.b));
      const atEof = end >= text.length;
      return tomlSplice(text, end, 0, (atEof ? (text.endsWith('\n') ? '' : '\n') + (/\n\s*\n$/.test(text) || !text ? '' : '\n') : '') + `[[${tomlHeaderKeys(path)}]]\n` + (atEof ? '' : '\n'));
    }
    return jsoncSeqInsert(text, { start: c.start, end: c.end, kids: c.items! }, literal, 'inline');
  }
  if (typeof key !== 'string' || !key) throw new Error('要有键名');
  if (c.entries!.some((e) => e.key === key)) throw new Error(`已经有「${key}」了`);
  const entry = tomlKey(key) + ' = ' + literal;
  if (c.def === 'inline') {
    if (!c.members) throw new Error('这张表是点号键在内联表里带出来的,到原文里改');
    return jsoncSeqInsert(text, { start: c.start, end: c.end, kids: c.members }, entry, 'pad');
  }
  if (c.def === 'root' || c.def === 'header' || c.def === 'aot') {
    const own = units.some((u) => u.kind === 'kv' && u.owner && u.owner.length === path.length && tomlStarts(u.owner, path));
    if (c.def === 'root' && !own) {   // 文件里还没有顶层的键值:放在第一个表头之前,空一行
      const first = units.find((u) => u.kind === 'section');
      return first ? tomlSplice(text, first.a, 0, entry + '\n\n') : tomlInsertLine(text, text.length, entry);
    }
    return tomlInsertLine(text, c.bodyAt ?? text.length, entry);
  }
  if (c.def === 'dotted') {   // 点号键带出来的表:接在它最后一行键值后面,同样用点号写
    const kvs = under.filter((u) => u.kind === 'kv');
    const u = kvs.reduce((x, y) => (y.b > x.b ? y : x));
    const rel = path.slice(u.owner!.length).map((k) => tomlKey(String(k)));
    return tomlInsertLine(text, u.b, [...rel, tomlKey(key)].join('.') + ' = ' + literal);
  }
  // implicit:只出现在别的表头里 —— 在它下面第一段之前补上它自己的表头
  const first = under.reduce((x, y) => (y.a < x.a ? y : x));
  return tomlSplice(text, first.a, 0, `[${tomlHeaderKeys(path)}]\n${entry}\n\n`);
}

/** 删掉路径上那一项:定义它和它下面所有东西的行 / 段 / 括号里的项都删掉(连同属于它们的注释) */
export function tomlDelete(text: string, path: TomlPath): string {
  if (!path.length) throw new Error('不能删整个文件');
  const { root, units } = tomlParseDoc(text);
  if (!tomlFind(root, path)) throw new Error(`没有这一项:${path.join('.')}`);
  const ms = units.filter((u) => tomlStarts(u.path, path));
  const top = ms.filter((u) => !ms.some((o) => o !== u && o.a <= u.a && u.b <= o.b && o.b - o.a > u.b - u.a));
  if (!top.length) throw new Error('找不到定义它的地方');
  // 都在同一对括号里(数组的一项,或内联表里定义它的几个成员):从后往前一个个删,逗号跟着调整。
  // 删后面的不会挪动前面的项,所以每删一个重新解析一次,按括号的位置和序号找回同一个
  const inl = top.filter((u) => u.seq);
  if (inl.length) {
    const at = inl[0]!.seq!.start;
    for (const idx of inl.map((u) => u.idx!).sort((x, y) => y - x)) {
      const u = tomlParseDoc(text).units.find((x) => x.seq && x.seq.start === at && x.idx === idx)!;
      text = jsoncSeqDelete(text, u.seq!, idx);
    }
    return text;
  }
  // 整行 / 整段:互不重叠,从后往前删
  for (const u of top.sort((x, y) => y.a - x.a)) {
    let a = u.a;
    if (u.b >= text.length) { const m = /\n([ \t]*\r?\n)+$/.exec(text.slice(0, a)); if (m) a -= m[0].length - 1; }   // 删到文件末尾:前面多出来的空行也收掉
    text = text.slice(0, a) + text.slice(u.b);
  }
  return text;
}
