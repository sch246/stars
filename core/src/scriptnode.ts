// 脚本节点的定义与触发的写法(L4)。纯函数,Node 和浏览器共用(查看器的侧栏用它说明触发、指出写错的地方);
// 运行记录在 runlog.ts,跑脚本和触发循环在 agent.ts。
//   ~script/<名字> kind=script code="…" | file=tools/x.js  on="change, file:src/**, stale, start"  every=10m
//     draft=true(写进草稿)· enabled=false(停用触发)· timeout=2m · debounce=1.5s · record=always
// 静态导出把浏览器模块拼进同一个作用域:顶层名字不能和别的模块重复。
import { type Universe } from './model.ts';

export const SCRIPT_PREFIX = '~script/';
export const RUN_PREFIX = '~run/';
export const AGENT_AUTHOR = 'agent';

export type Trigger =
  | { kind: 'change' }
  | { kind: 'file'; glob: string; re: RegExp | null }
  | { kind: 'stale' }
  | { kind: 'start' };

export interface ScriptDef {
  name: string;
  id: string;
  label: string;
  code?: string;
  file?: string;
  on: Trigger[];
  /** every 的毫秒数 */
  every?: number;
  draft: boolean;
  enabled: boolean;
  timeoutMs: number;
  debounceMs: number;
  record: 'always' | 'changes';
  summary?: string;
  /** 节点上写错了的地方(触发写错了的那一项不生效) */
  problems: string[];
}

/** 这次为什么跑(交给脚本:stars.trigger) */
export interface TriggerInfo {
  kind: 'manual' | 'change' | 'file' | 'stale' | 'every' | 'start';
  by?: string;
  paths?: string[];
  ids?: string[];
  ops?: Array<{ n: number; author: string; op: string }>;
}

export interface RunRecord {
  id: string;
  script: string;
  trigger: TriggerInfo['kind'];
  /** 开始的时间(ISO) */
  t: string;
  ms: number;
  status: 'ok' | 'error' | 'timeout';
  /** 输出(最后 4000 字) */
  out: string;
  /** 写进宇宙的操作数(作者是这个脚本的日志条目) */
  ops: number;
  /** 写进草稿的条数 */
  draft: number;
}

// ---------- 解析 ----------
/** "30s" "10m" "2h" "1d" "500ms";只写数字 = 秒 */
export function parseDuration(s: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[(m[2] ?? 's') as 'ms']!;
}

/** 文件通配:** 跨目录,* 和 ? 不跨;以 / 结尾 = 这个目录下的所有东西 */
export function globToRegExp(glob: string): RegExp {
  const g = glob.endsWith('/') ? glob + '**' : glob;
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') { re = re.slice(0, -2) + '(?:.*/)?'; i++; } }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function parseTriggers(on: string | undefined): { triggers: Trigger[]; errors: string[] } {
  const triggers: Trigger[] = [], errors: string[] = [];
  for (const raw of (on ?? '').split(/[,;]/)) {
    const t = raw.trim();
    if (!t) continue;
    if (t === 'change' || t === 'stale' || t === 'start') triggers.push({ kind: t });
    else if (t === 'file') triggers.push({ kind: 'file', glob: '', re: null });
    else if (t.startsWith('file:')) { const glob = t.slice(5).trim(); triggers.push({ kind: 'file', glob, re: glob ? globToRegExp(glob) : null }); }
    else errors.push(`不认识的触发 "${t}"(可用:change、file、file:<通配>、stale、start)`);
  }
  return { triggers, errors };
}

function defOf(id: string, label: string, a: Record<string, string>): ScriptDef {
  const name = id.slice(SCRIPT_PREFIX.length);
  const { triggers, errors } = parseTriggers(a.on);
  const problems = [...errors];
  let every: number | undefined;
  if (a.every !== undefined) {
    const ms = parseDuration(a.every);
    if (ms === null) problems.push(`every 应写成 30s / 10m / 2h / 1d(得到 ${a.every})`);
    else if (ms < 5000) problems.push(`every 至少 5s(得到 ${a.every})`);
    else every = ms;
  }
  const timeoutMs = a.timeout !== undefined ? parseDuration(a.timeout) : 120_000;
  if (timeoutMs === null) problems.push(`timeout 应写成 30s / 2m(得到 ${a.timeout})`);
  const debounceMs = a.debounce !== undefined ? parseDuration(a.debounce) : 1500;
  if (debounceMs === null) problems.push(`debounce 应写成 1s / 500ms(得到 ${a.debounce})`);
  if (!a.code && !a.file) problems.push('没有代码:写 code="…" 或 file=<脚本文件>');
  return {
    name, id, label: label || name,
    ...(a.code ? { code: a.code } : {}), ...(a.file ? { file: a.file } : {}),
    on: triggers, ...(every !== undefined ? { every } : {}),
    draft: a.draft === 'true', enabled: a.enabled !== 'false',
    timeoutMs: timeoutMs ?? 120_000, debounceMs: debounceMs ?? 1500,
    record: a.record === 'always' ? 'always' : 'changes',
    ...(a.summary ? { summary: a.summary } : {}),
    problems,
  };
}

/** 脚本节点的属性写得对不对(script-set 写之前检查) */
export function checkScriptAttrs(attrs: Record<string, string>): string[] {
  return defOf(`${SCRIPT_PREFIX}x`, '', attrs).problems;
}

export function listScripts(u: Universe): ScriptDef[] {
  const out: ScriptDef[] = [];
  for (const n of u.nodes.values()) if (n.id.startsWith(SCRIPT_PREFIX) && n.attrs.kind === 'script') out.push(defOf(n.id, n.label, n.attrs));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function scriptDef(u: Universe, name: string): ScriptDef | null {
  const n = u.nodes.get(SCRIPT_PREFIX + name);
  return n && n.attrs.kind === 'script' ? defOf(n.id, n.label, n.attrs) : null;
}

/** 一句话说清触发:"change · file:src/** · 每 10m"(没有 = "只能手动") */
export function describeTriggers(d: ScriptDef): string {
  const parts = d.on.map((t) => (t.kind === 'file' ? (t.glob ? `file:${t.glob}` : 'file') : t.kind));
  if (d.every) parts.push(`每 ${fmtDuration(d.every)}`);
  return (parts.length ? parts.join(' · ') : '只能手动') + (d.enabled ? '' : '(已停用)') + (d.draft ? ' · 写进草稿' : '');
}
export function fmtDuration(ms: number): string {
  for (const [u, k] of [['d', 86_400_000], ['h', 3_600_000], ['m', 60_000], ['s', 1000]] as const) if (ms >= k && ms % k === 0) return `${ms / k}${u}`;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
