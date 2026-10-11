// LLF(Literal Line Format,字面行格式):解析、编码,以及保留原文的文档模型(配置表单写回用)。
//
// 移植自 sch246/llf-format 的参考实现 llf.py(SPEC v0.11,外加 EXTENSIONS.md 的 §1 帧流、§3 类型标签、§4 标签表达式)。
// 跟到 llf-format 9ed0e8c:文本块必须紧跟 `-` 行;头之后的行尾空白可以是任意 White_Space;引号键里的控制字符必须转义。
// 行为与错误码以 llf.py 为准;错误行号(1 起)也照它算:llfParseMulti / llfParseFrames 里每条消息从 1 重新计数。
//
// 这个文件也作为 ES 模块直接发给浏览器,并会被静态导出拼进同一个作用域:
// 不依赖 node:*,所有顶层名字(包括私有的)都以 llf / Llf 开头。
//
// 换行:默认(宽松)模式先把 CRLF 折成 LF。文档模型(llfParseDoc / llfSetString / llfDelete)里的偏移量
// 都指向折过之后的文本(doc.text),写回得到的新文本也只含 LF;要保留 CRLF 的调用方保存时自己还原。

/** 格式错误。code 是 SPEC 第 11 节的错误码(E01…E15);路径操作用错时是 'EPATH'。line 从 1 起,未知时为 null。 */
export class LlfError extends Error {
  code: string;
  line: number | null;
  constructor(code: string, message: string, line: number | null = null) {
    super(`${code}: ${message}${line === null ? '' : ` (line ${line})`}`);
    this.name = 'LlfError';
    this.code = code;
    this.line = line;
  }
}

/** 带类型标签的值(EXTENSIONS §3)。tag 是不透明的名字,格式不解释它;value 不因标签改变。 */
export class LlfTagged {
  tag: string;
  value: LlfValue;
  constructor(tag: string, value: LlfValue) {
    this.tag = tag;
    this.value = value;
  }
}

/** 字典是普通对象(键序即书写顺序;注意 JS 会把 "1" 这类整数键排到最前,要精确键序请看 LlfNode.entries)。 */
export type LlfValue = string | null | LlfValue[] | { [k: string]: LlfValue } | LlfTagged;

export interface LlfOptions {
  /** 严格模式:不做 CRLF→LF,CR 可以作为内容保留 */
  strict?: boolean;
  /** 启用类型标签扩展:`key !tag 头` / 列表项 `!tag 头` */
  tags?: boolean;
}

/** 保留原文位置的语法树节点。偏移量都是 doc.text 里的 UTF-16 下标。 */
export interface LlfNode {
  kind: 'str' | 'null' | 'map' | 'list';
  /** 作为字典条目时的键(已解引号) */
  key?: string;
  /** 类型标签(仅 opts.tags) */
  tag?: string;
  /** kind 为 'str' 时的值 */
  value?: string;
  entries?: LlfNode[];
  items?: LlfNode[];
  /** 结构行的缩进;隐式顶层字典为 -2 */
  indent: number;
  /** 结构行的行下标(0 起);隐式顶层字典为 -1 */
  line: number;
  /** 结构行行首的偏移;隐式顶层字典为消息体开头 */
  start: number;
  /** 属于本节点的最后一行(含子层、文本块)的 '\n' 之后。隐式顶层字典:最后一个条目的 end,没有条目时是结束符行的行首 */
  end: number;
  /** 头符号(`-` `_` `{}` `[]`)在结构行里的偏移,键和标签都在它之前;隐式顶层字典没有 */
  headStart?: number;
  /** 'str':行内值是 strip 后载荷的范围(空值时是 `-` 之后的空范围);文本块是整段 `|` 行的范围 */
  valueStart?: number;
  valueEnd?: number;
  /** 'str':是否写成文本块 */
  block?: boolean;
  /** 紧贴在结构行上方的连续注释行,去掉 `#` 和其后的一个空格 */
  comments?: string[];
}

export interface LlfDoc {
  /** 解析所用的文本(宽松模式下 CRLF 已折成 LF),节点偏移都指向它 */
  text: string;
  root: LlfNode;
  strict: boolean;
  tags: boolean;
}

const llfHeads: readonly string[] = ['-', '_', '{}', '[]'];
const llfTerminator = '--LLF-END';
const llfBegin = '--LLF-BEGIN';
const llfHex4 = /^[0-9a-fA-F]{4}$/;
const llfEscapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

// Unicode White_Space 属性为真的码点(按属性定义,不用语言自带的 trim,以免跨实现分歧)。全在 BMP 内,按 UTF-16 单元判断即可。
function llfIsWs(c: number): boolean {
  return (c >= 0x09 && c <= 0x0d) || c === 0x20 || c === 0x85 || c === 0xa0 || c === 0x1680
    || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;
}

function llfLeadWs(s: string): number {
  let i = 0;
  while (i < s.length && llfIsWs(s.charCodeAt(i))) i++;
  return i;
}

function llfStrip(s: string): string {
  const i = llfLeadWs(s);
  let j = s.length;
  while (j > i && llfIsWs(s.charCodeAt(j - 1))) j--;
  return s.slice(i, j);
}

function llfHasWs(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (llfIsWs(s.charCodeAt(i))) return true;
  return false;
}

// 行内分词只认 U+0020
function llfFirstToken(s: string): string {
  const sp = s.indexOf(' ');
  return sp === -1 ? s : s.slice(0, sp);
}

// 头 token:行内第一个以 U+0020 分隔的 token,去掉它之后到行尾的空白(任意 White_Space,如 `{}⇥`、严格模式下的 `_␍`)。
// 分词仍只认 U+0020,所以 `a -⇥value` 的第一个 token 是 `-⇥value`,不是头(E07)
function llfHeadToken(s: string): string {
  const t = llfFirstToken(s);
  let j = t.length;
  while (j > 0 && llfIsWs(t.charCodeAt(j - 1))) j--;
  return t.slice(0, j);
}

function llfStartsWithHead(content: string): boolean {
  return llfHeads.includes(llfHeadToken(content));
}

// ---------- 切行 ----------

interface LlfRawLine { raw: string; start: number; end: number }
interface LlfLine extends LlfRawLine {
  /** 报错用的行号:在本条消息里从 1 起 */
  no: number;
  /** 在整段文本里的行下标(0 起) */
  idx: number;
  /** 在本条消息行数组里的下标 */
  k: number;
  indent: number;
  /** 去掉缩进后的内容 */
  content: string;
}

function llfNormalize(text: string, strict: boolean): string {
  if (text.startsWith('﻿')) throw new LlfError('E01', '带 BOM');
  return strict ? text : text.replaceAll('\r\n', '\n');
}

// 与 python 的 text.split("\n") 再去掉末尾空串一致,另外记下每行的偏移
function llfRawLines(text: string): LlfRawLine[] {
  const out: LlfRawLine[] = [];
  let pos = 0;
  for (;;) {
    const nl = text.indexOf('\n', pos);
    if (nl === -1) {
      out.push({ raw: text.slice(pos), start: pos, end: text.length });
      break;
    }
    out.push({ raw: text.slice(pos, nl), start: pos, end: nl + 1 });
    pos = nl + 1;
  }
  if (out.at(-1)?.raw === '') out.pop();
  return out;
}

// 先整体检查空白行(E01)与缩进里的 tab(E03),再开始解析:错误码的先后与 python 一致
function llfLinesFrom(raws: LlfRawLine[], from: number, to: number): LlfLine[] {
  const lines: LlfLine[] = [];
  for (let idx = from; idx < to; idx++) {
    const { raw, start, end } = raws[idx]!;
    const no = idx - from + 1;
    if (llfStrip(raw) === '') throw new LlfError('E01', '只含空白的行', no);
    let n = 0;
    while (n < raw.length && raw.charCodeAt(n) === 0x20) n++;
    if (raw[n] === '\t') throw new LlfError('E03', '缩进中含 tab', no);
    lines.push({ raw, start, end, no, idx, k: idx - from, indent: n, content: raw.slice(n) });
  }
  return lines;
}

// ---------- 解析 ----------

interface LlfHead { token: string; payload: string | null; lead: number }

function llfHead(rest: string, no: number): LlfHead {
  const token = llfHeadToken(rest);
  if (!llfHeads.includes(token)) throw new LlfError('E07', `未知的头符号:${JSON.stringify(rest.slice(0, 4))}`, no);
  const raw = rest.slice(token.length);
  if (token === '-') {
    const payload = llfStrip(raw);
    return { token, payload: payload === '' ? null : payload, lead: llfLeadWs(raw) };
  }
  if (llfStrip(raw) !== '') throw new LlfError('E08', `${token} 后不能有载荷`, no);
  return { token, payload: null, lead: 0 };
}

const llfKinds: Record<string, LlfNode['kind']> = { '-': 'str', _: 'null', '{}': 'map', '[]': 'list' };

// 逐行递归下降,结构与 llf.py 的 _Parser 一一对应;区别只是直接产出带位置的节点,值由 llfNodeValue 再取。
class LlfParser {
  lines: LlfLine[];
  i: number;
  tags: boolean;
  constructor(lines: LlfLine[], tags: boolean) {
    this.lines = lines;
    this.i = 0;
    this.tags = tags;
  }

  // 跳过注释行
  peek(): LlfLine | null {
    while (this.i < this.lines.length && this.lines[this.i]!.content.startsWith('#')) this.i++;
    return this.i < this.lines.length ? this.lines[this.i]! : null;
  }

  message(bodyStart: number, bodyEnd: number): LlfNode {
    const first = this.peek();
    const root: LlfNode = { kind: 'map', entries: [], indent: -2, line: -1, start: bodyStart, end: bodyEnd };
    if (first === null) return root;
    if (first.indent !== 0) throw new LlfError('E03', '顶层缩进必须为 0', first.no);
    if (first.content.startsWith('|')) throw new LlfError('E11', '文本行出现在不允许的位置', first.no);
    // 第一个 token 是头 → 顶层单独值(不接受标签);否则是隐式键值对。引号键以 " 开头,不会被误判
    if (!first.content.startsWith('"') && llfStartsWithHead(first.content)) {
      this.i++;
      const node = this.value(first, first.content, llfHead(first.content, first.no), undefined, undefined, 0);
      const leftover = this.peek();
      if (leftover !== null) throw new LlfError('E12', '顶层单独值之后又出现非注释行', leftover.no);
      return node;
    }
    this.map(root, 0);
    const leftover = this.peek();
    if (leftover !== null) throw new LlfError('E12', '顶层之后又出现非注释行', leftover.no);
    return root;
  }

  map(parent: LlfNode, indent: number): void {
    const seen = new Set<string>();
    const entries = parent.entries!;
    for (;;) {
      const nxt = this.peek();
      if (nxt === null) break;
      if (nxt.content.startsWith('|')) throw new LlfError('E11', '文本行出现在不允许的位置', nxt.no);
      if (nxt.indent < indent) break;
      if (nxt.indent > indent) throw new LlfError('E03', '缩进不是恰好多 2 格', nxt.no);
      this.i++;
      // 行的归类先于键名校验:第一个 token 是头就是项行
      if (llfStartsWithHead(nxt.content)) throw new LlfError('E15', '环境不匹配:字典环境里出现了项行', nxt.no);
      const [key, afterKey] = nxt.content.startsWith('"') ? this.quotedKey(nxt.content, nxt.no) : this.plainKey(nxt.content, nxt.no);
      const [tag, rest] = this.tag(afterKey, nxt.no);
      const head = llfHead(rest, nxt.no);
      // 解引号之后再判重:"a" 与 a 是同一个键
      if (seen.has(key)) throw new LlfError('E06', `同一层键名重复:${JSON.stringify(key)}`, nxt.no);
      seen.add(key);
      entries.push(this.value(nxt, rest, head, key, tag, indent));
    }
    if (entries.length) parent.end = entries[entries.length - 1]!.end;
  }

  list(parent: LlfNode, indent: number): void {
    const items = parent.items!;
    for (;;) {
      const nxt = this.peek();
      if (nxt === null) break;
      if (nxt.content.startsWith('|')) throw new LlfError('E11', '文本行出现在不允许的位置', nxt.no);
      if (nxt.indent < indent) break;
      if (nxt.indent > indent) throw new LlfError('E03', '缩进不是恰好多 2 格', nxt.no);
      this.i++;
      const [tag, rest] = this.tag(nxt.content, nxt.no);
      if (tag === undefined && !llfStartsWithHead(nxt.content)) {
        throw new LlfError('E15', '环境不匹配:列表环境里出现了不以头开头的行', nxt.no);
      }
      items.push(this.value(nxt, rest, llfHead(rest, nxt.no), undefined, tag, indent));
    }
    if (items.length) parent.end = items[items.length - 1]!.end;
  }

  plainKey(content: string, no: number): [string, string] {
    const sp = content.indexOf(' ');
    if (sp === -1) throw new LlfError('E04', '条目行只有键、没有头', no);
    const key = content.slice(0, sp);
    const rest = content.slice(sp + 1);
    if (key === '') throw new LlfError('E05', '键名为空', no);
    if (key.includes('"')) throw new LlfError('E05', '普通键名不能含双引号,需用引号键', no);
    if (llfHasWs(key)) throw new LlfError('E05', '普通键名不能含空白,需用引号键', no);
    if (rest === '') throw new LlfError('E04', '条目行只有键、没有头', no);
    if (rest[0] === ' ') throw new LlfError('E05', '键与头之间必须恰好一个空格', no);
    return [key, rest];
  }

  // 引号键就是一个 JSON 字符串:转义规则相同,控制字符(U+0000–U+001F,含 tab、CR)不能原样出现(E13)
  quotedKey(content: string, no: number): [string, string] {
    let out = '';
    let i = 1;
    while (i < content.length) {
      const c = content[i]!;
      if (c === '"') {
        const rest = content.slice(i + 1);
        if (rest === '') throw new LlfError('E04', '条目行只有键、没有头', no);
        if (rest[0] !== ' ' || rest[1] === ' ') throw new LlfError('E05', '键与头之间必须恰好一个空格', no);
        return [out, rest.slice(1)];
      }
      if (c === '\\') {
        i++;
        if (i >= content.length) throw new LlfError('E13', '引号键转义不完整', no);
        const e = content[i]!;
        if (Object.hasOwn(llfEscapes, e)) {
          out += llfEscapes[e];
          i++;
        } else if (e === 'u') {
          const [ch, next] = this.unicodeEscape(content, i + 1, no);
          out += ch;
          i = next;
        } else {
          throw new LlfError('E13', `非法转义 \\${e}`, no);
        }
      } else if (c.charCodeAt(0) < 0x20) {
        throw new LlfError('E13', `引号键里的控制字符必须转义(同 JSON):U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`, no);
      } else {
        out += c;
        i++;
      }
    }
    throw new LlfError('E14', '引号键没有闭合引号', no);
  }

  unicodeEscape(content: string, i: number, no: number): [string, number] {
    const hex = content.slice(i, i + 4);
    if (!llfHex4.test(hex)) throw new LlfError('E13', '\\u 后必须是 4 位十六进制', no);
    let cp = parseInt(hex, 16);
    i += 4;
    if (cp >= 0xd800 && cp <= 0xdbff) {
      if (content.slice(i, i + 2) !== '\\u') throw new LlfError('E13', '高位代理必须跟低位代理', no);
      const low = content.slice(i + 2, i + 6);
      if (!llfHex4.test(low)) throw new LlfError('E13', '\\u 后必须是 4 位十六进制', no);
      const lo = parseInt(low, 16);
      if (lo < 0xdc00 || lo > 0xdfff) throw new LlfError('E13', '低位代理不合法', no);
      cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
      i += 6;
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      throw new LlfError('E13', '孤立的低位代理', no);
    }
    return [String.fromCodePoint(cp), i];
  }

  // 扩展:拆出头之前的 `!标签 `。未启用或没有标签时原样返回
  tag(rest: string, no: number): [string | undefined, string] {
    if (!this.tags || !rest.startsWith('!')) return [undefined, rest];
    const sp = rest.indexOf(' ');
    const tag = sp === -1 ? rest.slice(1) : rest.slice(1, sp);
    if (!llfTagOk(tag)) throw new LlfError('E07', `类型标签不合法:${JSON.stringify(sp === -1 ? rest : rest.slice(0, sp))}`, no);
    if (sp === -1) throw new LlfError('E07', '类型标签之后缺少头', no);
    return [tag, rest.slice(sp + 1)];
  }

  // 建节点并读出它的值(含子层)。rest 从头符号开始,indent 是这一行所在层的缩进
  value(line: LlfLine, rest: string, head: LlfHead, key: string | undefined, tag: string | undefined, indent: number): LlfNode {
    const node = { kind: llfKinds[head.token] } as LlfNode;
    if (key !== undefined) node.key = key;
    if (tag !== undefined) node.tag = tag;
    const headStart = line.start + line.raw.length - rest.length;
    node.indent = indent;
    node.line = line.idx;
    node.start = line.start;
    node.end = line.end;
    node.headStart = headStart;
    const comments = this.commentsBefore(line);
    if (comments.length) node.comments = comments;

    if (head.token === '-') {
      node.block = false;
      if (head.payload !== null) {
        const nxt = this.peek();
        if (nxt !== null && (nxt.content.startsWith('|') || nxt.indent > indent)) {
          throw new LlfError('E10', '字符串既有同行载荷又有子层', nxt.no);
        }
        node.value = head.payload;
        node.valueStart = headStart + 1 + head.lead;
        node.valueEnd = node.valueStart + head.payload.length;
        return node;
      }
      node.value = '';
      node.valueStart = node.valueEnd = headStart + 1;
      // 文本块必须紧跟 `-` 行(SPEC §5):中间夹注释时不开始文本块,后面的 `|` 行报 E11
      if (this.i < this.lines.length && this.lines[this.i]!.content.startsWith('|')) {
        this.textBlock(node);
        return node;
      }
      const nxt = this.peek();
      if (nxt === null) return node;
      if (nxt.content.startsWith('|')) throw new LlfError('E11', '文本块必须紧跟 - 行,中间不能有注释', nxt.no);
      if (nxt.indent <= indent) return node;
      if (nxt.indent !== indent + 2) throw new LlfError('E03', '缩进不是恰好多 2 格', nxt.no);
      throw new LlfError('E10', '字符串的子层只能是文本行', nxt.no);
    }
    if (head.token === '_') {
      const nxt = this.peek();
      if (nxt !== null && (nxt.content.startsWith('|') || nxt.indent > indent)) throw new LlfError('E09', 'null 下不能有子层', nxt.no);
      return node;
    }
    const isMap = head.token === '{}';
    if (isMap) node.entries = [];
    else node.items = [];
    const nxt = this.peek();
    if (nxt === null) return node;
    if (nxt.content.startsWith('|')) throw new LlfError('E08', isMap ? '字典下不能有文本行' : '列表下不能有文本行', nxt.no);
    if (nxt.indent <= indent) return node;
    if (nxt.indent !== indent + 2) throw new LlfError('E03', '缩进不是恰好多 2 格', nxt.no);
    if (isMap) this.map(node, indent + 2);
    else this.list(node, indent + 2);
    return node;
  }

  // 文本块:紧接着的连续 `|` 行;遇到第一个非 `|` 行(含注释)就结束
  textBlock(node: LlfNode): void {
    const first = this.lines[this.i]!;
    let last = first;
    const out: string[] = [];
    while (this.i < this.lines.length && this.lines[this.i]!.content.startsWith('|')) {
      last = this.lines[this.i++]!;
      out.push(last.content.slice(1));
    }
    node.value = out.join('\n');
    node.block = true;
    node.valueStart = first.start;
    node.valueEnd = node.end = last.end;
  }

  // 紧挨在上面的注释;空注释行(只有 #)是分隔:它和它上面的注释不属于这个节点(比如文件开头的说明)
  commentsBefore(line: LlfLine): string[] {
    const out: string[] = [];
    for (let k = line.k - 1; k >= 0 && this.lines[k]!.content.startsWith('#'); k--) {
      const c = this.lines[k]!.content.slice(1);
      if (llfStrip(c) === '') break;
      out.push(c.startsWith(' ') ? c.slice(1) : c);
    }
    return out.reverse();
  }
}

// 键里可能有 __proto__:直接赋值会改原型而不是加键
function llfPut<T>(obj: { [k: string]: T }, key: string, value: T): void {
  if (key === '__proto__') Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
  else obj[key] = value;
}

function llfNodeValue(node: LlfNode): LlfValue {
  let v: LlfValue;
  if (node.kind === 'str') v = node.value!;
  else if (node.kind === 'null') v = null;
  else if (node.kind === 'list') v = node.items!.map(llfNodeValue);
  else {
    const obj: { [k: string]: LlfValue } = {};
    for (const e of node.entries!) llfPut(obj, e.key!, llfNodeValue(e));
    v = obj;
  }
  return node.tag === undefined ? v : new LlfTagged(node.tag, v);
}

/** 解析一条完整的 LLF 消息(结束符之后不得再有内容),同 llf.py 的 parse。 */
export function llfParse(text: string, opts: LlfOptions = {}): LlfValue {
  return llfNodeValue(llfParseDoc(text, opts).root);
}

/** 解析消息流:按 --LLF-END 切开连续消息,消息之间的空行忽略。同 parse_multi(参考实现的便利入口,不是格式要求)。 */
export function llfParseMulti(text: string, opts: LlfOptions = {}): LlfValue[] {
  const raws = llfRawLines(llfNormalize(text, !!opts.strict));
  const out: LlfValue[] = [];
  let start = 0;
  while (start < raws.length) {
    if (llfStrip(raws[start]!.raw) === '') {
      start++;
      continue;
    }
    let end = start;
    while (end < raws.length && llfStrip(raws[end]!.raw) !== llfTerminator) end++;
    if (end === raws.length) throw new LlfError('E02', '缺少结束符(截断)');
    const parser = new LlfParser(llfLinesFrom(raws, start, end), !!opts.tags);
    out.push(llfNodeValue(parser.message(raws[start]!.start, raws[end]!.start)));
    start = end + 1;
  }
  return out;
}

/** 解析 --LLF-BEGIN … --LLF-END 帧流(EXTENSIONS §1):帧外的内容与空行忽略,帧内按单条消息解析。同 parse_frames。 */
export function llfParseFrames(text: string, opts: LlfOptions = {}): LlfValue[] {
  const raws = llfRawLines(llfNormalize(text, !!opts.strict));
  const out: LlfValue[] = [];
  let start = -1;
  for (let idx = 0; idx < raws.length; idx++) {
    const marker = llfStrip(raws[idx]!.raw);
    if (marker === llfBegin) {
      if (start !== -1) throw new LlfError('E02', '帧流里上一个 frame 缺少结束符(截断)');
      start = idx + 1;
    } else if (marker === llfTerminator && start !== -1) {
      const parser = new LlfParser(llfLinesFrom(raws, start, idx), !!opts.tags);
      out.push(llfNodeValue(parser.message(raws[start]!.start, raws[idx]!.start)));
      start = -1;
    }
  }
  if (start !== -1) throw new LlfError('E02', '帧流缺少结束符(截断)');
  return out;
}

/** 去掉所有类型标签。 */
export function llfUntag(v: LlfValue): LlfValue {
  if (v instanceof LlfTagged) return llfUntag(v.value);
  if (Array.isArray(v)) return v.map(llfUntag);
  if (v !== null && typeof v === 'object') {
    const obj: { [k: string]: LlfValue } = {};
    for (const k of Object.keys(v)) llfPut(obj, k, llfUntag(v[k]!));
    return obj;
  }
  return v;
}

/** 转成纯 JSON 值:标签展开成 {"$tag": 名字, "$value": 值},同 to_json_value。 */
export function llfToJson(v: LlfValue): unknown {
  if (v instanceof LlfTagged) return { $tag: v.tag, $value: llfToJson(v.value) };
  if (Array.isArray(v)) return v.map(llfToJson);
  if (v !== null && typeof v === 'object') {
    const obj: { [k: string]: unknown } = {};
    for (const k of Object.keys(v)) llfPut(obj, k, llfToJson(v[k]!));
    return obj;
  }
  return v;
}

// ---------- 编码 ----------

function llfPlainKeyOk(key: string): boolean {
  return key !== '' && !llfHasWs(key) && !key.includes('"') && !llfHeads.includes(key) && !key.startsWith('#') && !key.startsWith('|');
}

function llfTagOk(tag: string): boolean {
  return tag !== '' && !llfHasWs(tag) && !tag.includes('"');
}

function llfEncodeKey(key: string): string {
  return llfPlainKeyOk(key) ? key : JSON.stringify(key);
}

// SPEC §5 的选形:含 LF 或首尾有 White_Space → 文本块(可只有一行);其余 → 行内 `-`
function llfInlineOk(s: string): boolean {
  return s !== '' && !s.includes('\n') && llfStrip(s) === s;
}

/** 字符串的头 + 文本行(不含缩进) */
function llfStringLines(s: string): string[] {
  if (s === '') return ['-'];
  if (!llfInlineOk(s)) return ['-', ...s.split('\n').map((l) => '|' + l)];
  return ['- ' + s];
}

// 普通对象(包括别的 realm 和 Object.create(null));Map、Date、类实例都不算
function llfIsPlainObject(v: unknown): v is { [k: string]: LlfValue } {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

function llfEmit(key: string | null, value: LlfValue, indent: number, lines: string[]): void {
  let prefix = ' '.repeat(indent) + (key === null ? '' : llfEncodeKey(key) + ' ');
  if (value instanceof LlfTagged) {
    if (typeof value.tag !== 'string' || !llfTagOk(value.tag)) throw new TypeError(`类型标签不合法:${JSON.stringify(value.tag)}`);
    if (value.value instanceof LlfTagged) throw new TypeError('一个值只能有一个类型标签');
    prefix += '!' + value.tag + ' ';
    value = value.value;
  }
  if (value === null) {
    lines.push(prefix + '_');
  } else if (typeof value === 'string') {
    const parts = llfStringLines(value);
    lines.push(prefix + parts[0]);
    for (let i = 1; i < parts.length; i++) lines.push(' '.repeat(indent + 2) + parts[i]);
  } else if (Array.isArray(value)) {
    lines.push(prefix + '[]');
    for (const item of value) llfEmit(null, item, indent + 2, lines);
  } else if (llfIsPlainObject(value)) {
    lines.push(prefix + '{}');
    for (const k of Object.keys(value)) llfEmit(k, value[k]!, indent + 2, lines);
  } else {
    throw new TypeError(`不支持的值的类型:${typeof value}`);
  }
}

/**
 * 编码成一条 LLF 消息(以 '--LLF-END\n' 结尾),同 dumps。
 * 字典 → 顶层隐式键值对,其它值 → 顶层单独值。值里可以有 LlfTagged,但顶层值本身不能带标签。
 * 只接受 string / null / 数组 / 普通对象 / LlfTagged,数字、布尔、undefined 等抛 TypeError(与 python 版一致,不做隐式转换)。
 */
export function llfStringify(value: LlfValue): string {
  if (value instanceof LlfTagged) throw new TypeError('顶层值不能带类型标签');
  const lines: string[] = [];
  if (llfIsPlainObject(value)) {
    for (const k of Object.keys(value)) llfEmit(k, value[k]!, 0, lines);
  } else {
    llfEmit(null, value, 0, lines);
  }
  return lines.map((l) => l + '\n').join('') + llfTerminator + '\n';
}

// ---------- 保留原文的文档模型 ----------

/**
 * 解析成带位置的语法树。校验与错误码同 llfParse(包括结束符之后不得有内容);顶层单独值时 root 就是那个值的节点。
 * 宽松模式下 doc.text 是 CRLF 折成 LF 之后的文本,所有偏移都指向它。
 */
export function llfParseDoc(text: string, opts: LlfOptions = {}): LlfDoc {
  const strict = !!opts.strict;
  const tags = !!opts.tags;
  const norm = llfNormalize(text, strict);
  const raws = llfRawLines(norm);
  const end = raws.findIndex((r) => llfStrip(r.raw) === llfTerminator);
  if (end === -1) throw new LlfError('E02', '缺少结束符(截断)');
  if (end + 1 < raws.length) throw new LlfError('E12', '结束符之后还有内容');
  const root = new LlfParser(llfLinesFrom(raws, 0, end), tags).message(0, raws[end]!.start);
  return { text: norm, root, strict, tags };
}

export function llfDocValue(doc: LlfDoc): LlfValue {
  return llfNodeValue(doc.root);
}

/** 按路径找节点:字符串段走字典的键,数字段走列表下标。找不到或类型不符返回 null。 */
export function llfFind(doc: LlfDoc, path: (string | number)[]): LlfNode | null {
  let node: LlfNode | undefined = doc.root;
  for (const seg of path) {
    if (typeof seg === 'string' && node.kind === 'map') node = node.entries!.find((e) => e.key === seg);
    else if (typeof seg === 'number' && node.kind === 'list') node = node.items![seg];
    else return null;
    if (node === undefined) return null;
  }
  return node;
}

function llfPathError(seg: unknown, node: LlfNode): LlfError {
  const where = node.indent < 0 ? '顶层' : node.key !== undefined ? `键 ${JSON.stringify(node.key)}` : `第 ${node.line + 1} 行`;
  return new LlfError('EPATH', `路径段 ${JSON.stringify(seg)} 不适用于${where}(${node.kind}):字符串段只用于字典,整数段只用于列表`);
}

// 取子节点:不存在返回 null;路径段与节点类型不符(字符串段遇到非字典、数字段遇到非列表、非整数下标)抛 EPATH
function llfChild(node: LlfNode, seg: string | number): LlfNode | null {
  if (typeof seg === 'string' && node.kind === 'map') return node.entries!.find((e) => e.key === seg) ?? null;
  if (typeof seg === 'number' && node.kind === 'list' && Number.isInteger(seg)) return node.items![seg] ?? null;
  throw llfPathError(seg, node);
}

function llfLeadingSpaces(t: string, pos: number): string {
  let j = pos;
  while (t.charCodeAt(j) === 0x20) j++;
  return t.slice(pos, j);
}

// 新建的条目 / 项(路径里缺的中间层:后一段是字符串建 `{}`,是 0 建 `[]`)
function llfNewLines(segs: (string | number)[], value: string | null, indent: number): string {
  const out: string[] = [];
  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k];
    const prefix = ' '.repeat(indent) + (typeof seg === 'string' ? llfEncodeKey(seg) + ' ' : '');
    if (k === segs.length - 1) {
      const parts = value === null ? ['_'] : llfStringLines(value);
      out.push(prefix + parts[0]);
      for (let i = 1; i < parts.length; i++) out.push(' '.repeat(indent + 2) + parts[i]);
    } else {
      const next = segs[k + 1];
      if (typeof next === 'string') out.push(prefix + '{}');
      else if (next === 0) out.push(prefix + '[]');
      else throw new LlfError('EPATH', `新建的列表只能写下标 0,得到 ${JSON.stringify(next)}`);
      indent += 2;
    }
  }
  return out.map((l) => l + '\n').join('');
}

function llfReplace(t: string, node: LlfNode, value: string | null): string {
  if (node.headStart === undefined) throw new LlfError('EPATH', '隐式的顶层字典不能整体替换');
  // 行内改行内:只换 strip 后的那一段,行里其它字节(键、标签、多余空白)一个不动
  if (value !== null && node.kind === 'str' && !node.block && node.value !== '' && llfInlineOk(value)) {
    return t.slice(0, node.valueStart) + value + t.slice(node.valueEnd);
  }
  // 其余情况:从头符号到节点末尾整段重写;原来是文本块就沿用它第一行 `|` 的缩进
  const blockIndent = node.block ? llfLeadingSpaces(t, node.valueStart!) : ' '.repeat(node.indent + 2);
  const parts = value === null ? ['_'] : llfStringLines(value);
  let out = parts[0] + '\n';
  for (let i = 1; i < parts.length; i++) out += blockIndent + parts[i] + '\n';
  return t.slice(0, node.headStart) + out + t.slice(node.end);
}

/**
 * 返回把 path 处的值改成字符串(value 为 null 时写 `_`)之后的新文本;文本里其它字节保持不变。
 * - 行内 / 文本块按 SPEC §5 的规则选,原有的键和标签保留。目标原来是字典或列表时,整棵子树被替换。
 * - path 不存在但父字典存在:在父字典末尾(它最后一个子孙行之后)追加新条目;缺的中间层建成 `key {}`。
 *   父节点是列表时,下标恰好等于长度表示追加一项。
 * - 路径段落在字符串 / null 上、或类型不符(字符串段对列表、数字段对字典)、或下标越界:抛 LlfError('EPATH')。
 * 宽松模式下输入的 CRLF 会折成 LF,返回的文本只含 LF。
 */
export function llfSetString(text: string, path: (string | number)[], value: string | null, opts: LlfOptions = {}): string {
  if (value !== null && typeof value !== 'string') throw new TypeError('llfSetString 只接受字符串或 null');
  const doc = llfParseDoc(text, opts);
  const t = doc.text;
  let node = doc.root;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]!;
    const child = llfChild(node, seg);
    if (child === null) {
      if (typeof seg === 'number' && seg !== node.items!.length) {
        throw new LlfError('EPATH', `列表下标越界:${seg}(长度 ${node.items!.length})`);
      }
      return t.slice(0, node.end) + llfNewLines(path.slice(i), value, node.indent + 2) + t.slice(node.end);
    }
    node = child;
  }
  return llfReplace(t, node, value);
}

/**
 * 返回删掉 path 处条目 / 列表项之后的新文本:连同它的子层、文本块,以及紧贴在它上方的注释行。
 * path 不存在时原样返回(宽松模式下 CRLF 已折成 LF);路径类型不符抛 EPATH;不能删根。
 */
export function llfDelete(text: string, path: (string | number)[], opts: LlfOptions = {}): string {
  if (path.length === 0) throw new LlfError('EPATH', '不能删除根');
  const doc = llfParseDoc(text, opts);
  const t = doc.text;
  let node = doc.root;
  for (const seg of path) {
    const child = llfChild(node, seg);
    if (child === null) return t;
    node = child;
  }
  // 往上吞掉紧贴的注释行(消息体里没有空行,文本块也不会以 # 开头,所以按行首 # 判断就够);
  // 遇到空注释行(只有 #)就停:那是分隔,它和上面的注释属于别处(比如文件开头的说明)
  let from = node.start;
  while (from > 0) {
    const prev = t.lastIndexOf('\n', from - 2) + 1;
    if (prev >= from) break;
    const j = prev + llfLeadingSpaces(t, prev).length;
    if (t[j] !== '#' || llfStrip(t.slice(j + 1, from)) === '') break;
    from = prev;
  }
  return t.slice(0, from) + t.slice(node.end);
}

// ---------- 标签表达式(EXTENSIONS §4,注册表层的可选约定)----------
// 把标签名读成 { name, types, args }:`list<color>(1,8)` → { name: 'list', types: [{ name: 'color', … }], args: ['1', '8'] }。
// 值参数是原样的字符串,不做任何词法解释;名字是什么意思由注册表决定。
// 这不是格式的一部分:表达式写错抛普通的 Error(不是 LlfError),调用方捕获后按"不认识的标签"处理(退回文本框)。

export interface LlfTagExpr { name: string; types: LlfTagExpr[]; args: string[] }

const llfTagPunct = '<>(),';

export function llfParseTagExpr(name: string): LlfTagExpr {
  if (typeof name !== 'string' || !llfTagOk(name)) throw new Error(`不是合法的标签名:${JSON.stringify(name)}`);
  const [expr, i] = llfTagExprAt(name, 0);
  if (i !== name.length) throw new Error(`标签表达式在第 ${i} 个字符之后还有内容:${JSON.stringify(name)}`);
  return expr;
}

function llfTagAtomEnd(s: string, i: number): number {
  while (i < s.length && !llfTagPunct.includes(s[i]!)) i++;
  return i;
}

function llfTagExprAt(s: string, i: number): [LlfTagExpr, number] {
  let j = llfTagAtomEnd(s, i);
  if (j === i) throw new Error(`标签表达式缺少名字:${JSON.stringify(s)}`);
  const node: LlfTagExpr = { name: s.slice(i, j), types: [], args: [] };
  i = j;
  if (s[i] === '<') {
    for (;;) {
      const [sub, k] = llfTagExprAt(s, i + 1);
      node.types.push(sub);
      i = k;
      if (s[i] === ',') continue;
      if (s[i] === '>') { i++; break; }
      throw new Error(`类型参数缺少 >:${JSON.stringify(s)}`);
    }
  }
  if (s[i] === '(') {
    i++;
    if (s[i] === ')') return [node, i + 1];
    for (;;) {
      j = llfTagAtomEnd(s, i);
      if (j === i) throw new Error(`值参数为空:${JSON.stringify(s)}`);
      node.args.push(s.slice(i, j));
      i = j;
      if (s[i] === ',') { i++; continue; }
      if (s[i] === ')') return [node, i + 1];
      throw new Error(`值参数缺少 ):${JSON.stringify(s)}`);
    }
  }
  return [node, i];
}
