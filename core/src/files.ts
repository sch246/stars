// 在查看器里看/改项目里的文件(不依赖 VS Code)。
//   · 路径一律限制在项目目录之内(../ 出不去),.git 里的东西与宇宙自己的存储只读
//   · 写入带"读到时的修改时间":磁盘上的文件在这之后被别人改过就拒绝(409),由查看器决定载入还是覆盖
//   · 原来是 CRLF 的文件保存时仍是 CRLF(浏览器的文本框会把换行统一成 \n);还原之后和磁盘上一样就不写(不碰修改时间)
//   · 保存可以只传改动的一段(patchProjectFile):按内容的哈希确认基线,比修改时间可靠
//   · 点一下就打开,所以要轻:head=N 只读开头 N 字节(切在最后一个换行处),点进编辑框或滚到底再要全文
//   · 重新载入也是增量的:服务端记着最近给出去 / 存下来的几版(按内容哈希),查看器带着手上那版的哈希来要(since),
//     就只回"改动的那一段";记不得那一版(重启过、被挤掉了)就回整份
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { StarsError } from './model.ts';
import { isStorage } from './scan.ts';
import { textDiff, textHash, textNormEol, textPatch, type TextPatch } from './textsync.ts';

export const MAX_TEXT = 2 << 20;
export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
};

/** /preview 提供项目文件时的类型(HTML 预览引用的 css / js / 图片 / 字体……) */
export const PREVIEW_TYPES: Record<string, string> = {
  ...IMAGE_TYPES,
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
};

export interface FileInfo {
  path: string;
  abs: string;
  kind: 'text' | 'image' | 'binary' | 'large';
  size: number;
  mtime: number;
  readonly: boolean;
  /** 能在查看器里改(不只读、且不超过 MAX_TEXT) */
  editable: boolean;
  /** 只给了开头一段(head) */
  partial?: boolean;
  content?: string;
  /** 全文(换行折成 LF)的哈希 */
  hash?: string;
  /** 带 since 来要、服务端还记得那一版时:不给 content,只给从那一版到现在的改动 */
  patch?: TextPatch;
}

// ---- 基线:每个文件记最近几版全文(LF),按哈希取;总量有上限,最久没用的先丢 ----
const BASE_PER_FILE = 4, BASE_MAX_BYTES = 32 << 20;
const baselines = new Map<string, Map<string, string>>();   // 绝对路径 → 哈希 → 文本;两层都按"最近用过"排在后面
let baselineBytes = 0;
function rememberText(abs: string, text: string, hash: string): void {
  let m = baselines.get(abs);
  if (m) baselines.delete(abs); else m = new Map();
  baselines.set(abs, m);
  if (m.has(hash)) { m.delete(hash); m.set(hash, text); return; }
  m.set(hash, text); baselineBytes += text.length;
  for (const [h, t] of m) { if (m.size <= BASE_PER_FILE) break; m.delete(h); baselineBytes -= t.length; }
  for (const [p, vs] of baselines) {
    if (baselineBytes <= BASE_MAX_BYTES || p === abs) break;
    for (const t of vs.values()) baselineBytes -= t.length;
    baselines.delete(p);
  }
}
function recallText(abs: string, hash: string): string | null {
  return baselines.get(abs)?.get(hash) ?? null;
}

/** 写入时磁盘上的版本已经不是读到的那个了 */
export class FileConflict extends StarsError {
  readonly mtime: number;
  constructor(mtime: number) {
    super('文件在你打开之后被别处改过了');
    this.mtime = mtime;
  }
}

/** 项目里的相对路径 → 绝对路径;跑出项目目录就报错 */
export function resolveInside(baseDir: string, rel: string): string {
  const root = resolve(baseDir), abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) throw new StarsError(`路径不在项目里: ${rel}`);
  return abs;
}

const readonlyPath = (rel: string, self?: string) => isStorage(rel, self) || /(^|\/)\.git(\/|$)/.test(rel);
const relOf = (baseDir: string, abs: string) => relative(resolve(baseDir), abs).split(sep).join('/');

/** since:查看器手上那一版的哈希。服务端还记得那一版就只回改动(patch),否则回整份 */
export function readProjectFile(baseDir: string, rel: string, opts: { self?: string; statOnly?: boolean; head?: number; since?: string } = {}): FileInfo {
  const abs = resolveInside(baseDir, rel);
  const st = statSync(abs);
  if (!st.isFile()) throw new StarsError(`不是文件: ${rel}`);
  const r = relOf(baseDir, abs);
  const readonly = readonlyPath(r, opts.self);
  const info: FileInfo = { path: r, abs, kind: 'text', size: st.size, mtime: st.mtimeMs, readonly, editable: !readonly && st.size <= MAX_TEXT };
  const ext = extname(abs).toLowerCase();
  if (IMAGE_TYPES[ext]) { info.kind = 'image'; info.editable = false; return info; }
  if (opts.statOnly) return info;
  const head = opts.head && opts.head > 0 ? opts.head : 0;
  if (!head && st.size > MAX_TEXT) { info.kind = 'large'; return info; }
  const want = head ? Math.min(st.size, head) : st.size;
  const buf = Buffer.alloc(want);
  const fd = openSync(abs, 'r');
  try { readSync(fd, buf, 0, want, 0); } finally { closeSync(fd); }
  if (buf.subarray(0, 8000).includes(0)) { info.kind = 'binary'; info.editable = false; return info; }
  let content = buf.toString('utf8');
  if (want < st.size) { // 只给开头:切在最后一个换行处,不留半行、也不留被切坏的多字节字符
    info.partial = true;
    const cut = content.lastIndexOf('\n');
    content = cut > 0 ? content.slice(0, cut + 1) : content.replace(/\uFFFD+$/, '');
    info.content = content;
    return info;
  }
  const text = textNormEol(content), hash = textHash(text);
  const old = opts.since ? (opts.since === hash ? text : recallText(abs, opts.since)) : null;
  rememberText(abs, text, hash);
  info.hash = hash;
  if (old !== null) info.patch = textDiff(old, text);
  else info.content = content;
  return info;
}

/** baseMtime = 打开时的修改时间;null = 不检查(用户选择了"用我的覆盖") */
/** 写入;内容和磁盘上一字不差时什么也不做(不改修改时间,也不算冲突),返回 unchanged: true */
export function writeProjectFile(baseDir: string, rel: string, content: string, baseMtime: number | null, opts: { self?: string } = {}): { size: number; mtime: number; unchanged?: boolean } {
  const abs = resolveInside(baseDir, rel);
  const r = relOf(baseDir, abs);
  if (readonlyPath(r, opts.self)) throw new StarsError(`这个文件只读(宇宙自己的存储或 .git): ${r}`);
  const st = statSync(abs);
  if (!st.isFile()) throw new StarsError(`不是文件: ${rel}`);
  const disk = readFileSync(abs, 'utf8');
  if (!content.includes('\r\n') && disk.includes('\r\n')) content = content.replace(/\n/g, '\r\n');
  if (content === disk) return { size: st.size, mtime: st.mtimeMs, unchanged: true };
  if (baseMtime !== null && Math.abs(st.mtimeMs - baseMtime) > 1) throw new FileConflict(st.mtimeMs);
  writeFileSync(abs, content);
  const after = statSync(abs);
  const text = textNormEol(content);
  rememberText(abs, text, textHash(text));
  return { size: after.size, mtime: after.mtimeMs };
}

/** 增量保存:磁盘上的内容(换行折成 LF)哈希等于 baseHash 才把补丁拼进去,否则是别处改过了(409)。
 *  原来是 CRLF 的文件拼完仍写成 CRLF;拼完和磁盘上一样就不写。返回新内容的哈希,查看器拿它当新基线的凭证 */
export function patchProjectFile(baseDir: string, rel: string, patch: TextPatch, baseHash: string, opts: { self?: string } = {}): { size: number; mtime: number; hash: string; unchanged?: boolean } {
  const abs = resolveInside(baseDir, rel);
  const r = relOf(baseDir, abs);
  if (readonlyPath(r, opts.self)) throw new StarsError(`这个文件只读(宇宙自己的存储或 .git): ${r}`);
  const st = statSync(abs);
  if (!st.isFile()) throw new StarsError(`不是文件: ${rel}`);
  const disk = readFileSync(abs, 'utf8'), base = textNormEol(disk);
  if (textHash(base) !== baseHash) throw new FileConflict(st.mtimeMs);
  const next = textPatch(base, patch);
  const out = disk.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next;
  if (out === disk) return { size: st.size, mtime: st.mtimeMs, hash: textHash(next), unchanged: true };
  writeFileSync(abs, out);
  const after = statSync(abs), hash = textHash(next);
  rememberText(abs, next, hash);
  return { size: after.size, mtime: after.mtimeMs, hash };
}
