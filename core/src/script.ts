// 脚本:stars run <x.js|x.ts> [参数…] 在 Node 里跑一个 JS 脚本,脚本拿到的 stars 和页面、查看器里 run 的脚本是同一套:
//   stars.exec('link a dependsOn b')、stars.cmd.link('a', 'dependsOn', 'b', { proposed: true })、stars.graph()、stars.on('change', f)、
//   stars.print(…)、stars.store、stars.args、stars.exit()。
//   · 内核命令(add / link / ls / show …,见 commands.ts)直接读写宇宙文件,不需要开着查看器;
//     其余的(select / view / open …,只有查看器里才有)转给正在看这个宇宙的查看器页面执行(和 stars ui 一样)。
//   · 脚本可以 export default async function (stars, args) { … },也可以直接写顶层代码(全局有 stars 和 args)。
//   · Node 里的脚本就是你自己在终端里跑的程序,不分级:和直接敲 CLI 一样能写。要"只提议",写的时候带 --proposed。
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { proposalsFromLog } from './activity.ts';
import { cmdLine, cmdTokenize } from './cmdline.ts';
import { CLI_OPTIONS, KERNEL_COMMANDS, runKernel, type CliOpts, type KernelCtx } from './commands.ts';
import { configDir, pickServer } from './config.ts';
import { StarsError } from './model.ts';

export interface UiResult { ok?: boolean; out?: string; data?: unknown; error?: string }

/** 把一行命令发给看着这个宇宙的查看器页面,等第一个页面回报(stars ui 和脚本里的界面命令都走这里) */
export async function sendUi(line: string, opts: { file: string | null; port?: number; from: string }): Promise<{ delivered: number; result: UiResult | null; url: string }> {
  const srv = pickServer(opts.file, opts.port);
  const host = srv.host === '0.0.0.0' || srv.host === '::' ? '127.0.0.1' : srv.host.includes(':') ? `[${srv.host}]` : srv.host;
  const url = `http://${host}:${srv.port}`;
  const res = await fetch(`${url}/api/ui`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-stars-token': srv.token },
    body: JSON.stringify({ line, file: opts.file, from: opts.from }),
  });
  const r = await res.json() as { error?: string; delivered?: number; result?: UiResult | null };
  if (!res.ok) throw new StarsError(r.error ?? `服务返回 ${res.status}`);
  return { delivered: r.delivered ?? 0, result: r.result ?? null, url };
}

export interface ScriptCtx extends KernelCtx { file: string; port?: number; args: string[]; script: string }
export interface ExecResult { out: string; data?: unknown }

/** 脚本拿到的 stars 对象(Node 版) */
export function scriptApi(ctx: ScriptCtx) {
  const { store } = ctx;
  const ui = async (line: string): Promise<ExecResult> => {
    const { delivered, result, url } = await sendUi(String(line), { file: ctx.file, port: ctx.port, from: ctx.author });
    if (!delivered) throw new StarsError(`「${cmdTokenize(String(line))[0]}」要在查看器里执行,但没有打开着的查看器页面(在浏览器里打开 ${url})`);
    if (!result) throw new StarsError('查看器没有回报(超时)');
    if (result.ok === false) throw new StarsError(result.error ?? '执行失败');
    return { out: result.out ?? '', data: result.data };
  };
  const exec = async (line: string): Promise<ExecResult> => {
    const [name, ...rest] = cmdTokenize(String(line));
    if (!name) throw new StarsError('空命令');
    if (!KERNEL_COMMANDS.has(name)) return ui(String(line));
    let parsed;
    try { parsed = parseArgs({ args: rest, options: CLI_OPTIONS, allowPositionals: true }); }
    catch (err) { throw new StarsError(`${name}:${(err as Error).message}`); }
    const r = runKernel(name, parsed.positionals, parsed.values as CliOpts, ctx);
    return { out: r.out, data: r.data };
  };
  const cmd = new Proxy({}, {
    get: (_t, name) => (typeof name !== 'string' || name === 'then' ? undefined : (...a: unknown[]) => exec(cmdLine(name, a))),
  }) as Record<string, (...a: unknown[]) => Promise<ExecResult>>;

  // 订阅:Node 里只有 change(盯着操作日志,别处 —— 查看器、CLI、别的脚本 —— 写入也收得到)
  const subs = new Set<(v: unknown) => void>();
  let timer: NodeJS.Timeout | undefined, offset = 0;
  const poll = () => {
    const r = store.readLogSince(offset);
    offset = r.offset;
    const v = r.reset ? { n: store.logCount(), reset: true }
      : r.entries.length ? { n: r.entries[r.entries.length - 1]!.n, ops: r.entries.map((e) => ({ n: e.n, author: e.author, t: e.t, op: e.op })) } : null;
    if (v) for (const f of [...subs]) { try { f(v); } catch (err) { console.error(err); } }
  };
  const on = (event: string, f: (v: unknown) => void) => {
    if (event !== 'change') throw new StarsError(`Node 里的脚本只能订阅 change(${event} 只在查看器里有)`);
    if (!subs.size) { offset = store.readLogSince(0).offset; timer = setInterval(poll, 300); }
    subs.add(f);
    return () => { subs.delete(f); if (!subs.size) clearInterval(timer); };
  };

  // 按脚本存的小数据:~/.config/stars/script-store/<脚本路径的哈希>.json
  const storeFile = join(configDir(), 'script-store', createHash('sha1').update(ctx.script).digest('hex').slice(0, 16) + '.json');
  const readKv = (): Record<string, unknown> => { try { return JSON.parse(readFileSync(storeFile, 'utf8')) as Record<string, unknown>; } catch { return {}; } };
  const writeKv = (obj: Record<string, unknown>) => { mkdirSync(dirname(storeFile), { recursive: true }); writeFileSync(storeFile, JSON.stringify(obj, null, 2)); };

  return Object.freeze({
    args: ctx.args,
    exec,
    ui,
    cmd,
    graph: async () => {
      const u = store.load();
      return { nodes: [...u.nodes.values()], edges: [...u.edges.values()], proposals: proposalsFromLog(store.readLog(), u), n: store.logCount() };
    },
    info: async () => ({ runner: 'node', script: ctx.script, file: ctx.file, root: ctx.root, author: ctx.author, level: 'write' }),
    on,
    print: (...a: unknown[]) => console.log(...a),
    exit: (code = 0) => process.exit(code),
    store: Object.freeze({
      get: async (k: string) => { const o = readKv(); return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null; },
      set: async (k: string, v: unknown) => { const o = readKv(); o[k] = v === undefined ? null : v; writeKv(o); return true; },
      del: async (k: string) => { const o = readKv(); delete o[k]; writeKv(o); return true; },
      keys: async () => Object.keys(readKv()),
    }),
  });
}

/** stars run:载入脚本(globalThis 上有 stars 和 args);有默认导出的函数就调用它,返回值打印出来 */
export async function runNodeScript(path: string, ctx: Omit<ScriptCtx, 'script'>): Promise<void> {
  const abs = resolve(path);
  const stars = scriptApi({ ...ctx, script: abs });
  const g = globalThis as Record<string, unknown>;
  g.stars = stars; g.args = ctx.args;
  const m = await import(pathToFileURL(abs).href) as { default?: unknown };
  if (typeof m.default === 'function') {
    const r = await (m.default as (s: unknown, a: string[]) => unknown)(stars, ctx.args);
    if (r !== undefined) console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
  }
}
