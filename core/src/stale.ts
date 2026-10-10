// 过期检测:节点的说明是对着某一版文件写的。
//   seen=<哈希>  写说明(或确认"仍然有效")时,节点指向的文件的内容哈希(前 12 位)
//   文件现在的哈希对不上 → 说明可能过期了(lint 的 stale)
// 哈希就是 git 的 blob id(文本先统一成 LF,换行风格不同不算改动),所以记版本时顺手把那一版存进 git 的对象库
// (git hash-object -w,和 git add 存内容是同一回事,只是不动暂存区),以后能直接 git diff 出"写说明之后改了什么"。
// 不在 git 仓库里也能检测过期,只是看不到改动。只看文件,不看目录(目录里随便改一处就算过期,太吵)。仅 Node 端使用。

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Attrs, type Universe } from './model.ts';
import { type Op } from './ops.ts';

export const SEEN_LEN = 12;

/** 文本(前 8000 字节里没有 NUL,和 git 判断二进制的办法一样)把 CRLF 统一成 LF;二进制原样 */
export function seenBody(buf: Buffer): Buffer {
  if (buf.subarray(0, 8000).includes(0) || !buf.includes(13)) return buf;
  return Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

/** git 的 blob id:sha1("blob <长度>\0" + 内容) */
export function blobId(body: Buffer): string {
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}

/** 按 (大小, 修改时间, inode) 缓存,没改过的文件不重新读 */
const cache = new Map<string, { size: number; mtimeMs: number; ino: number; id: string }>();

/** 文件现在的完整哈希;不存在、是目录、读不了 → null */
export function fileHash(baseDir: string, rel: string): string | null {
  const abs = resolve(baseDir, rel);
  try {
    const st = statSync(abs);
    if (!st.isFile()) return null;
    const hit = cache.get(abs);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs && hit.ino === st.ino) return hit.id;
    const id = blobId(seenBody(readFileSync(abs)));
    if (cache.size > 50_000) cache.delete(cache.keys().next().value!);
    cache.set(abs, { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino, id });
    return id;
  } catch {
    return null;
  }
}

/** 节点的 file 属性去掉 #锚点;目录(以 / 结尾)不算 */
export function seenPath(attrs: Attrs): string | null {
  const f = attrs.file?.split('#')[0];
  return f && !f.endsWith('/') ? f : null;
}

export const seenMatches = (seen: string, full: string): boolean => seen.length >= 7 && full.startsWith(seen.toLowerCase());

export type SeenState = 'fresh' | 'stale' | 'untracked' | 'none';
/** fresh = 记了版本且对得上;stale = 对不上;untracked = 有说明、指向文件,但没记版本;none = 不适用(没指向文件、文件不在……) */
export function seenState(baseDir: string, attrs: Attrs): SeenState {
  const path = seenPath(attrs);
  if (!path || attrs.missing === 'true') return 'none';
  const cur = fileHash(baseDir, path);
  if (cur === null) return 'none';
  if (!attrs.seen) return attrs.summary ? 'untracked' : 'none';
  return seenMatches(attrs.seen, cur) ? 'fresh' : 'stale';
}

function git(baseDir: string, args: string[], input?: Buffer): Buffer {
  return execFileSync('git', ['-C', baseDir, ...args], { input, maxBuffer: 256 << 20, stdio: ['pipe', 'pipe', 'ignore'] });
}

/** 记下文件现在的版本:返回 seen(前 12 位);在 git 仓库里顺手把这一版存进对象库。文件读不了 → null */
export function stampFile(baseDir: string, rel: string): string | null {
  const abs = resolve(baseDir, rel);
  let body: Buffer;
  try { if (!statSync(abs).isFile()) return null; body = seenBody(readFileSync(abs)); } catch { return null; }
  try { git(baseDir, ['hash-object', '-w', '--stdin'], body); } catch { /* 不是 git 仓库:只能检测,看不到改动 */ }
  return blobId(body).slice(0, SEEN_LEN);
}

/**
 * 写入时自动记版本:一条操作里给节点写了 summary(新建或修改),节点又指向一个文件,而操作自己没碰 seen ——
 * 那就是"对着现在这一版写的说明",补上 seen。返回补过的操作(没有要补的就是原来那个)。
 */
export function stampOnSummary(u: Universe, op: Op, baseDir: string): Op {
  const fileOf = (id: string, attrs?: Attrs): string | null => seenPath({ ...u.nodes.get(id)?.attrs, ...attrs });
  switch (op.op) {
    case 'addNode': {
      if (op.attrs?.summary === undefined || op.attrs.seen !== undefined) return op;
      const path = fileOf(op.id, op.attrs), seen = path && stampFile(baseDir, path);
      return seen ? { ...op, attrs: { ...op.attrs, seen } } : op;
    }
    case 'setNode': {
      if (op.set?.summary === undefined || op.set.seen !== undefined || op.unset?.includes('seen')) return op;
      const path = fileOf(op.id, op.set), seen = path && stampFile(baseDir, path);
      return seen ? { ...op, set: { ...op.set, seen } } : op;
    }
    case 'batch': {
      const ops = op.ops.map((o) => stampOnSummary(u, o, baseDir));
      return ops.some((o, i) => o !== op.ops[i]) ? { op: 'batch', ops } : op;
    }
    default: return op;
  }
}

/** 记版本的操作:给这些节点写上文件现在的 seen。指向的不是文件(或文件不在)的节点放进 skipped */
export function planStamp(u: Universe, ids: string[], baseDir: string): { op: Op | null; stamped: string[]; skipped: string[] } {
  const ops: Op[] = [], stamped: string[] = [], skipped: string[] = [];
  for (const id of ids) {
    const n = u.nodes.get(id), path = n && seenPath(n.attrs), seen = path && n.attrs.missing !== 'true' ? stampFile(baseDir, path) : null;
    if (!n || !seen) { skipped.push(id); continue; }
    stamped.push(id);
    if (n.attrs.seen !== seen) ops.push({ op: 'setNode', id, set: { seen } });
  }
  return { op: ops.length === 0 ? null : ops.length === 1 ? ops[0]! : { op: 'batch', ops }, stamped, skipped };
}

/** 写说明之后文件改了什么:统一 diff(只有 @@ 段)。旧版本不在 git 对象库里(不是 git 仓库、被 gc 掉了)→ old=false */
export function seenDiff(baseDir: string, attrs: Attrs): { path: string; old: boolean; diff: string } | null {
  const path = seenPath(attrs);
  if (!path || !attrs.seen) return null;
  const abs = resolve(baseDir, path);
  let body: Buffer;
  try { body = seenBody(readFileSync(abs)); } catch { return null; }
  try {
    const oldId = git(baseDir, ['rev-parse', '--verify', '--quiet', `${attrs.seen}^{blob}`]).toString().trim();
    const newId = git(baseDir, ['hash-object', '-w', '--stdin'], body).toString().trim();
    const out = git(baseDir, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '-U3', oldId, newId]).toString();
    const at = out.indexOf('\n@@');
    return { path, old: true, diff: at < 0 ? (/^Binary files/m.test(out) ? '(二进制文件,不显示改动)' : '') : out.slice(at + 1) };
  } catch {
    return { path, old: false, diff: '' };
  }
}
