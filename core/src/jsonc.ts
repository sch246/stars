// JSON 的表单编辑(浏览器与 Node 共用):解析成带源码位置的树,改动按路径只动那一段 —— 缩进、键序、注释都不变。
//   · 认 JSON,外加 JSONC 的两样:// 与 /* */ 注释、尾逗号(tsconfig.json、.vscode/settings.json 都这么写)
//   · 树和 LLF 的文档树同形(kind: map / list / str / null,key、entries / items、value、comments),表单直接复用;
//     type 记 JSON 自己的类型,写回时按它把表单里的字符串变成字面量(数字不加引号、开关写 true / false……)
//   · 紧挨在一项上方的注释属于这一项(和 LLF 的约定一样),删掉这一项时一起删;隔着空行的注释不属于任何一项
// 这个文件会被静态导出拼进同一个作用域:顶层名字都以 jsonc / Jsonc 开头。

export type JsoncType = 'object' | 'array' | 'string' | 'number' | 'bool' | 'null';
export interface JsoncNode {
  kind: 'map' | 'list' | 'str' | 'null';
  type: JsoncType;
  key?: string;
  /** 标量在表单里的样子:字符串的内容、数字的原文、true / false */
  value?: string;
  /** 给表单挑控件:bool / number / color */
  tag?: string;
  /** 字符串里有换行:表单用多行文本框 */
  block?: boolean;
  entries?: JsoncNode[];
  items?: JsoncNode[];
  comments?: string[];
  /** 值的范围 [start, end) */
  start: number;
  end: number;
  /** 这一项(连同键和属于它的注释)从哪儿开始 */
  lead: number;
  /** 后面的逗号;没有是 -1 */
  comma: number;
  /** 同一行上跟在后面的注释的结尾;没有是 -1 */
  trail: number;
}

export class JsoncError extends Error {
  line: number;
  constructor(message: string, text: string, at: number) {
    const line = text.slice(0, at).split('\n').length;
    super(`${message}(第 ${line} 行)`);
    this.name = 'JsoncError';
    this.line = line;
  }
}

interface JsoncComment { start: number; end: number; text: string; sameLine: boolean }

/** 解析;不合法就抛 JsoncError */
export function jsoncParse(text: string): JsoncNode {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = (msg: string, at = i): never => { throw new JsoncError(msg, text, at); };
  /** 跳过空白与注释,返回经过的注释(sameLine:和 from 之前最后一个记号在同一行) */
  const gap = (): JsoncComment[] => {
    const out: JsoncComment[] = [];
    let newline = false;
    while (i < text.length) {
      const c = text[i]!;
      if (c === '\n') { newline = true; i++; }
      else if (c === ' ' || c === '\t' || c === '\r') i++;
      else if (c === '/' && text[i + 1] === '/') {
        const s = i, e = text.indexOf('\n', i);
        i = e < 0 ? text.length : e;
        out.push({ start: s, end: i, text: text.slice(s + 2, i).replace(/^ /, '').trimEnd(), sameLine: !newline });
      } else if (c === '/' && text[i + 1] === '*') {
        const s = i, e = text.indexOf('*/', i + 2);
        if (e < 0) fail('注释没有结束', s);
        i = e + 2;
        out.push({ start: s, end: i, text: text.slice(s + 2, e).replace(/^\s*\*?\s?|\s+$/g, '').replace(/\n\s*\* ?/g, '\n'), sameLine: !newline });
      } else break;
    }
    return out;
  };
  /** 一项前面的注释:紧挨着它(中间没有空行)的那一串属于它;同一行跟在上一项后面的不算 */
  const attach = (cs: JsoncComment[], at: number): { lead: number; comments: string[] } => {
    let lead = at;
    const mine: JsoncComment[] = [];
    for (let k = cs.length - 1; k >= 0; k--) {
      const c = cs[k]!;
      if (c.sameLine || /\n[ \t\r]*\n/.test(text.slice(c.end, lead))) break;
      mine.unshift(c); lead = c.start;
    }
    return { lead, comments: mine.flatMap((c) => c.text.split('\n')).filter((s) => s.trim()) };
  };
  const str = (): string => {
    const s = i;
    i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail('字符串没有结束', s);
      const c = text[i]!;
      if (c === '"') { i++; return out; }
      if (c === '\n') fail('字符串里不能直接换行', i);
      if (c === '\\') {
        const e = text[i + 1];
        const map: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e === 'u') {
          const h = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('\\u 后面要四位十六进制', i);
          out += String.fromCharCode(parseInt(h, 16)); i += 6;
        } else if (e !== undefined && e in map) { out += map[e]; i += 2; }
        else fail('不认识的转义', i);
      } else { out += c; i++; }
    }
  };
  const value = (key: string | undefined, lead: number, comments: string[]): JsoncNode => {
    const start = i, c = text[i];
    const base = { key, start, lead, comma: -1, trail: -1, ...(comments.length ? { comments } : {}) };
    if (c === '{' || c === '[') {
      const obj = c === '{', close = obj ? '}' : ']';
      i++;
      const kids: JsoncNode[] = [];
      for (;;) {
        const cs = gap();
        if (text[i] === close) { i++; break; }
        if (kids.length && kids[kids.length - 1]!.comma < 0) fail(`少了逗号或 ${close}`);
        if (i >= text.length) fail(`缺少 ${close}`, start);
        const { lead: l, comments: cm } = attach(cs, i);
        let k: string | undefined;
        if (obj) {
          if (text[i] !== '"') fail('键要用双引号括起来');
          k = str();
          gap();
          if (text[i] !== ':') fail('键后面要有冒号');
          i++;
          gap();
        }
        const kid = value(k, l, cm);
        const save = i, after = gap();
        if (text[i] === ',') {
          kid.comma = i; i++;
          const t = gap().find((x) => x.sameLine);   // 逗号后面同一行的注释属于这一项
          if (t) kid.trail = t.end;
          i = t ? t.end : kid.comma + 1;
        } else {
          const t = after.find((x) => x.sameLine);
          if (t) kid.trail = t.end;
          i = save;
        }
        kids.push(kid);
      }
      return obj ? { ...base, kind: 'map', type: 'object', entries: kids, end: i } : { ...base, kind: 'list', type: 'array', items: kids, end: i };
    }
    if (c === '"') { const v = str(); return { ...base, kind: 'str', type: 'string', value: v, end: i, ...(v.includes('\n') ? { block: true } : {}), ...(/^#[0-9a-fA-F]{6}$/.test(v) ? { tag: 'color' } : {}) }; }
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 400));
    if (!m) fail(i >= text.length ? '内容不完整' : `这里不该是「${text.slice(i, i + 12).split('\n')[0]}」`);
    i += m![0].length;
    const w = m![0];
    if (w === 'null') return { ...base, kind: 'null', type: 'null', end: i };
    if (w === 'true' || w === 'false') return { ...base, kind: 'str', type: 'bool', value: w, tag: 'bool', end: i };
    return { ...base, kind: 'str', type: 'number', value: w, tag: 'number', end: i };
  };
  const lead0 = gap();
  if (i >= text.length) fail('文件是空的');
  const { lead, comments } = attach(lead0, i);
  const root = value(undefined, lead, comments);
  gap();
  if (i < text.length) fail('值后面还有多余的内容');
  return root;
}

/** 按路径找;找不到返回 null(同名的键取最后一个,和 JSON.parse 一致) */
export function jsoncFind(root: JsoncNode, path: (string | number)[]): JsoncNode | null {
  let n: JsoncNode | undefined = root;
  for (const p of path) {
    if (!n) return null;
    if (n.kind === 'map') n = n.entries!.filter((e) => e.key === String(p)).pop();
    else if (n.kind === 'list' && typeof p === 'number') n = n.items![p];
    else return null;
  }
  return n ?? null;
}

const JSONC_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
/** 表单里的字符串 → 这个类型的 JSON 字面量 */
export function jsoncLiteral(type: JsoncType, value: string | null): string {
  if (value === null) return 'null';
  if (type === 'string') return JSON.stringify(value);
  if (type === 'number') {
    const v = value.trim();
    if (!JSONC_NUMBER.test(v)) throw new Error(`「${value}」不是数字`);
    return v;
  }
  if (type === 'bool') {
    if (/^(true|false)$/.test(value.trim())) return value.trim();
    throw new Error(`「${value}」不是 true / false`);
  }
  if (type === 'null') {   // 原来是 null:填的东西能当 JSON 字面量读就照写,否则当字符串;空着就还是 null
    const v = value.trim();
    if (!v || v === 'null') return 'null';
    if (JSONC_NUMBER.test(v) || v === 'true' || v === 'false') return v;
    try { if (typeof JSON.parse(v) === 'string') return v; } catch { /* 当字符串 */ }
    return JSON.stringify(value);
  }
  throw new Error('对象和列表不能直接填字符串');
}

const jsoncSplice = (text: string, edits: [number, number, string][]) => {
  let out = text;
  for (const [a, b, s] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, a) + s + out.slice(b);
  return out;
};
const jsoncLineStart = (text: string, at: number) => text.lastIndexOf('\n', at - 1) + 1;
const jsoncOwnLine = (text: string, at: number) => /^[ \t]*$/.test(text.slice(jsoncLineStart(text, at), at));
const jsoncIndentAt = (text: string, at: number) => /^[ \t]*/.exec(text.slice(jsoncLineStart(text, at)))![0];
const jsoncUnit = (text: string) => (/\n([ \t]+)\S/.exec(text) || [, '  '])[1]!;

/** 把路径上那个标量换成新值(按它原来的类型写);value = null 写成 null */
export function jsoncSet(text: string, path: (string | number)[], value: string | null): string {
  const n = jsoncFind(jsoncParse(text), path);
  if (!n) throw new Error(`没有这一项:${path.join('.')}`);
  return jsoncSplice(text, [[n.start, n.end, jsoncLiteral(n.type, value)]]);
}

// ---- 括号里的一串(JSON 的对象 / 列表,TOML 的数组 / 内联表共用):加在末尾、删掉一项,逗号和换行跟着已有的写法 ----
/** 括号里的一项:lead = 连同属于它的注释从哪儿开始,[start, end) = 这一项的原文,comma = 后面的逗号,trail = 同一行跟着的注释的结尾 */
export interface JsoncSpan { lead: number; start: number; end: number; comma: number; trail: number }
/** 括号:[start, end) 含两边的括号 */
export interface JsoncSeq { start: number; end: number; kids: JsoncSpan[] }

/**
 * 在末尾加一项(entry 是这一项的原文)。
 *   · 已有的项各占一行:新的一项也另起一行、同样的缩进;已有的项写在一行里:接在后面,逗号后面空几格跟着已有的
 *   · 空的:empty = 'multi' 另起一行(缩进多一级)、'pad' 写成 { 项 }、'inline' 写成 [项]
 */
export function jsoncSeqInsert(text: string, seq: JsoncSeq, entry: string, empty: 'multi' | 'pad' | 'inline', spaced = true): string {
  const { kids } = seq, close = seq.end - 1, last = kids[kids.length - 1];
  if (!last) {
    const multi = empty === 'multi' || text.slice(seq.start + 1, close).includes('\n');
    if (!multi) return jsoncSplice(text, [[seq.start + 1, close, empty === 'pad' ? ' ' + entry + ' ' : entry]]);
    const ind = jsoncIndentAt(text, seq.start);
    return jsoncSplice(text, [[seq.start + 1, close, '\n' + ind + jsoncUnit(text) + entry + '\n' + ind]]);
  }
  const pos = Math.max(last.end, last.comma + 1, last.trail);
  if (jsoncOwnLine(text, last.lead)) {
    const edits: [number, number, string][] = [[pos, pos, '\n' + jsoncIndentAt(text, last.lead) + entry + (last.comma >= 0 ? ',' : '')]];
    if (last.comma < 0) edits.push([last.end, last.end, ',']);
    return jsoncSplice(text, edits);
  }
  const before = kids[kids.length - 2], sep0 = before && before.comma >= 0 ? text.slice(before.comma + 1, last.lead) : null;
  const sep = sep0 !== null && /^[ \t]*$/.test(sep0) ? sep0 : spaced ? ' ' : '';
  return last.comma < 0 ? jsoncSplice(text, [[last.end, last.end, ',' + sep + entry]]) : jsoncSplice(text, [[last.comma + 1, last.comma + 1, sep + entry + ',']]);
}

/** 删掉第 idx 项(连同属于它的注释;各占一行时连那一行一起删);删空了、里面只剩空白就收成 {} / [] */
export function jsoncSeqDelete(text: string, seq: JsoncSeq, idx: number): string {
  const { kids } = seq, el = kids[idx], prev = kids[idx - 1];
  if (!el) throw new Error('没有这一项');
  const edits: [number, number, string][] = [];
  const own = jsoncOwnLine(text, el.lead);
  let a = own ? jsoncLineStart(text, el.lead) : el.lead;
  let b = Math.max(el.comma >= 0 ? el.comma + 1 : el.end, el.trail);
  b += (own ? /^[ \t]*\r?\n?/ : /^[ \t]*/).exec(text.slice(b))![0].length;
  if (idx === kids.length - 1 && el.comma < 0 && prev) {   // 删的是最后一项:上一项的逗号成了多余的
    if (own) { if (prev.comma >= 0) edits.push([prev.comma, prev.comma + 1, '']); }
    else { a = prev.comma >= 0 ? prev.comma : prev.end; b = el.end; }
  }
  edits.push([a, b, '']);
  let out = jsoncSplice(text, edits);
  if (kids.length === 1) {
    const close = seq.end - 1 - (text.length - out.length);
    if (/^\s*$/.test(out.slice(seq.start + 1, close))) out = out.slice(0, seq.start + 1) + out.slice(close);
  }
  return out;
}

const jsoncSeqOf = (c: JsoncNode): JsoncSeq => ({ start: c.start, end: c.end, kids: c.kind === 'map' ? c.entries! : c.items! });

/** 往路径上的对象 / 列表末尾加一项;literal 是 JSON 原文(比如 "" 0 false {} [])。缩进、逗号风格跟着已有的项 */
export function jsoncInsert(text: string, path: (string | number)[], key: string | undefined, literal: string): string {
  const root = jsoncParse(text), c = jsoncFind(root, path);
  if (!c || (c.kind !== 'map' && c.kind !== 'list')) throw new Error('只能往对象或列表里加');
  const kids = c.kind === 'map' ? c.entries! : c.items!;
  if (c.kind === 'map') {
    if (typeof key !== 'string' || !key) throw new Error('要有键名');
    if (kids.some((e) => e.key === key)) throw new Error(`已经有「${key}」了`);
  }
  const last = kids[kids.length - 1];
  const colon = last && last.key !== undefined ? (/:([ \t]*)$/.exec(text.slice(last.lead, last.start)) || [, ' '])[1]! : ' ';   // 冒号后面空几格,跟着上一项
  const entry = c.kind === 'map' ? JSON.stringify(key) + ':' + colon + literal : literal;
  const parent = path.length ? jsoncFind(root, path.slice(0, -1)) : null;
  // 空对象跟着外层:外层分了行就另起一行;空列表写成一行
  const multi = c.kind === 'map' && (!parent || text.slice(parent.start, parent.end).includes('\n'));
  return jsoncSeqInsert(text, jsoncSeqOf(c), entry, multi ? 'multi' : 'inline', colon !== '');
}

/** 删掉路径上那一项(连同属于它的注释、它那一行);删空了的对象 / 列表收成 {} / [] */
export function jsoncDelete(text: string, path: (string | number)[]): string {
  if (!path.length) throw new Error('不能删整个文件');
  const root = jsoncParse(text), c = jsoncFind(root, path.slice(0, -1)), el = jsoncFind(root, path);
  if (!c || (c.kind !== 'map' && c.kind !== 'list') || !el) throw new Error(`没有这一项:${path.join('.')}`);
  return jsoncSeqDelete(text, jsoncSeqOf(c), (c.kind === 'map' ? c.entries! : c.items!).indexOf(el));
}
