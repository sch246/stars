// 文本的增量保存(浏览器与 Node 共用):保存时只传"改动的那一段 + 基线的哈希",不传整份文件。
//   · 基线 = 打开 / 上次保存 / 载入磁盘版本时的内容(换行折成 LF 之后)
//   · 服务端把磁盘上的内容同样折成 LF,哈希对得上才把这一段拼进去,对不上就是别处改过了(409)—— 按内容判断,不靠修改时间
//   · 一次保存只有一段:公共前缀和公共后缀之外的部分。改动集中时很小;改了相隔很远的两处,就是两处之间的整段,仍比整份小
// 这个文件也作为 ES 模块发给浏览器,并会被静态导出拼进同一个作用域:不依赖 node:*,顶层名字都以 text 开头。

/** 53 位的快速字符串哈希(cyrb53)加上长度;两端算出来一样。只用来确认"是不是同一版",不防恶意碰撞 */
export function textHash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16) + ':' + s.length;
}

/** 换行统一成 LF(CRLF 与单独的 CR 都算一个换行)—— 浏览器的文本框本来就会这样折 */
export const textNormEol = (s: string): string => s.replace(/\r\n?/g, '\n');

export interface TextPatch { start: number; end: number; insert: string }

const textHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const textLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** a → b 唯一改动的一段:把 a[start, end) 换成 insert 就得到 b。边界不会劈开一个代理对(emoji 等) */
export function textDiff(a: string, b: string): TextPatch {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  if (start > 0 && textHigh(a.charCodeAt(start - 1))) start--;   // 前缀停在代理对中间:退回到它前面
  let ea = a.length, eb = b.length;
  while (ea > start && eb > start && a.charCodeAt(ea - 1) === b.charCodeAt(eb - 1)) { ea--; eb--; }
  if (ea < a.length && textLow(a.charCodeAt(ea))) { ea++; eb++; }   // 后缀从代理对的后半开始:把它也算进改动
  return { start, end: ea, insert: b.slice(start, eb) };
}

export function textPatch(a: string, p: TextPatch): string {
  if (!Number.isInteger(p.start) || !Number.isInteger(p.end) || p.start < 0 || p.end < p.start || p.end > a.length || typeof p.insert !== 'string') {
    throw new RangeError('补丁的范围不对');
  }
  return a.slice(0, p.start) + p.insert + a.slice(p.end);
}
