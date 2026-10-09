// 在查看器里看/改项目里的文件(不依赖 VS Code)。
//   · 路径一律限制在项目目录之内(../ 出不去),.git 里的东西与宇宙自己的存储只读
//   · 写入带"读到时的修改时间":磁盘上的文件在这之后被别人改过就拒绝(409),由查看器决定载入还是覆盖
//   · 原来是 CRLF 的文件保存时仍是 CRLF(浏览器的文本框会把换行统一成 \n)
//   · 点一下就打开,所以要轻:head=N 只读开头 N 字节(切在最后一个换行处),点进编辑框或滚到底再要全文
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { StarsError } from './model.ts';
import { isStorage } from './scan.ts';

export const MAX_TEXT = 2 << 20;
export const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
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

export function readProjectFile(baseDir: string, rel: string, opts: { self?: string; statOnly?: boolean; head?: number } = {}): FileInfo {
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
  }
  info.content = content;
  return info;
}

/** baseMtime = 打开时的修改时间;null = 不检查(用户选择了"用我的覆盖") */
export function writeProjectFile(baseDir: string, rel: string, content: string, baseMtime: number | null, opts: { self?: string } = {}): { size: number; mtime: number } {
  const abs = resolveInside(baseDir, rel);
  const r = relOf(baseDir, abs);
  if (readonlyPath(r, opts.self)) throw new StarsError(`这个文件只读(宇宙自己的存储或 .git): ${r}`);
  const st = statSync(abs);
  if (!st.isFile()) throw new StarsError(`不是文件: ${rel}`);
  if (baseMtime !== null && Math.abs(st.mtimeMs - baseMtime) > 1) throw new FileConflict(st.mtimeMs);
  if (!content.includes('\r\n') && readFileSync(abs, 'utf8').includes('\r\n')) content = content.replace(/\n/g, '\r\n');
  writeFileSync(abs, content);
  const after = statSync(abs);
  return { size: after.size, mtime: after.mtimeMs };
}
