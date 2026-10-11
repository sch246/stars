// MCP(Model Context Protocol)出口:stars mcp 在标准输入输出上说 JSON-RPC,把内核命令一条一个暴露成工具,
// 给 Claude Code 这类 AI 客户端用。工具从命令表(cmdspec.ts)生成,执行走 execKernel —— 和 CLI、脚本、查看器同一份实现,
// 所以 AI 看到的用法、报错、输出和你在终端里敲的一样。写入的作者是 mcp:<客户端名>(--author 可改),操作日志里分得清。
//   --draft:写入一律进草稿,draft 工具只能看、不能应用 / 丢弃(你在查看器里看过再应用)
//   --read-only:只给读命令
// 不装 SDK(保持零依赖):stdio 传输就是一行一个 JSON-RPC 消息;日志只往 stderr 写,stdout 只给协议。
import { createInterface } from 'node:readline';
import { CMD_LIST, CMD_OPTIONS, type CmdOption, type CmdSpec } from './cmdspec.ts';
import { execKernel } from './commands.ts';
import { StarsError } from './model.ts';
import { DraftStore, type Store, readDraft, undoTarget } from './store.ts';

export interface McpOptions {
  store: Store;
  /** 项目根目录(扫描、体检查文件;命令里的相对路径也相对它) */
  root: string;
  /** 写入者;不给 = mcp:<客户端在 initialize 里报的名字> */
  author?: string;
  readOnly?: boolean;
  version?: string;
}

/** 这几版协议都认;客户端要的在里面就用它的,不在就用最新的 */
export const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

interface JsonSchema { type: string; description?: string; items?: JsonSchema; properties?: Record<string, JsonSchema> }
export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, JsonSchema>; additionalProperties: false };
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; openWorldHint: false };
}

const PER_CALL = new Set<string>(['file', 'author', 'json', 'help', 'draft']);   // 由服务定,或者下面单独加
const DESTRUCTIVE = new Set(['rm', 'unlink', 'ungroup', 'mv', 'undo', 'draft']);

/** 用法里这个选项后面写的是什么(-t 类型 → 类型;--depth N → N),给工具参数当说明 */
function optHint(usage: string, k: CmdOption): string {
  const d = CMD_OPTIONS[k], flags = [`--${k}`, ...('short' in d ? [`-${d.short}`] : [])], hints: string[] = [];
  for (const f of flags) {
    for (let i = usage.indexOf(f); i >= 0; i = usage.indexOf(f, i + 1)) {
      const before = usage[i - 1], after = usage[i + f.length];
      if ((before !== undefined && before !== ' ' && before !== '[') || (after !== undefined && after !== ' ' && after !== '=' && after !== ']')) continue;
      if (d.type === 'boolean' || after !== ' ') continue;
      const m = /^[^\][]*?(?=\]| \[| · | \| |$)/.exec(usage.slice(i + f.length + 1));
      if (m && m[0] && !hints.includes(m[0])) hints.push(m[0]);
    }
  }
  return hints.join(' / ');
}

function toolOf(c: CmdSpec, draftOnly: boolean): McpTool {
  const props: Record<string, JsonSchema> = {
    args: { type: 'array', items: { type: 'string' }, description: '位置参数,按用法里的顺序' },
  };
  for (const k of c.opts ?? []) {
    if (PER_CALL.has(k)) continue;
    const d = CMD_OPTIONS[k], hint = optHint(c.usage, k);
    props[k] = 'multiple' in d ? { type: 'array', items: { type: 'string' }, ...(hint ? { description: hint } : {}) }
      : { type: d.type, ...(hint ? { description: hint } : {}) };
  }
  if (c.effect === 'read') props.json = { type: 'boolean', description: '返回结构化的 JSON 而不是文本' };
  if (!draftOnly && c.name !== 'draft') props.draft = { type: 'boolean', description: c.effect === 'read' ? '看应用了草稿之后的样子' : '写进草稿:不落进宇宙,用户看过再整批应用' };
  return {
    name: c.name,
    title: c.title.replace(/[(:].*$/, ''),
    description: [c.title, `用法:${c.usage}`, ...(c.more ?? [])].join('\n'),
    inputSchema: { type: 'object', properties: props, additionalProperties: false },
    annotations: { readOnlyHint: c.effect === 'read', ...(c.effect === 'read' ? {} : { destructiveHint: DESTRUCTIVE.has(c.name) }), openWorldHint: false },
  };
}

/** 能用的工具:命令表里的内核命令(--read-only 时只有读的) */
export function mcpTools(opts: { readOnly?: boolean; draftOnly?: boolean } = {}): McpTool[] {
  return CMD_LIST.filter((c) => c.where === 'kernel' && (!opts.readOnly || c.effect === 'read')).map((c) => toolOf(c, !!opts.draftOnly));
}

/** 工具参数 → 命令行的词(再交给 execKernel 按命令表切,和 CLI 一样) */
export function mcpTokens(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  const args = input.args ?? [];
  if (!Array.isArray(args)) throw new StarsError('args 应该是字符串数组');
  for (const [k, v] of Object.entries(input)) {
    if (k === 'args' || v === undefined || v === null || v === false) continue;
    if (v === true) out.push(`--${k}`);
    else for (const x of Array.isArray(v) ? v : [v]) out.push(`--${k}=${String(x)}`);
  }
  return [...out, '--', ...args.map(String)];
}

type Id = string | number | null;
interface Msg { jsonrpc?: string; id?: Id; method?: string; params?: Record<string, unknown> }
type Reply = { jsonrpc: '2.0'; id: Id; result: unknown } | { jsonrpc: '2.0'; id: Id; error: { code: number; message: string } };

/** 协议本身(不管传输):收一条消息,回一条(通知不回 = null) */
export function createMcp(opts: McpOptions) {
  const draftOnly = opts.store instanceof DraftStore;
  const tools = mcpTools({ readOnly: opts.readOnly, draftOnly });
  const byName = new Map(tools.map((t) => [t.name, t]));
  let author = opts.author ?? 'mcp';
  const instructions = [
    '星罗(stars):项目的知识图谱。节点有 id(文件节点的 id 就是路径,如 src/app.ts;目录以 / 结尾)、标签、类型、摘要(summary),边有类型(contains、dependsOn、describes……)。',
    '先看:ls(-q 搜文字、-t 按类型)、show <id>、nb <id>、query 表达式(和视图规则同一套)、stale(说明过期了的)、lint。',
    '写入:add / set / link / rm …,每次写入一条操作日志(作者是你),能 undo(只撤销你自己最近的一次)。改很多处时带 draft: true 写进草稿,让用户看过再应用。',
    ...(draftOnly ? ['这个服务开了 --draft:你的写入一律进草稿,由用户应用;读命令看到的是应用了草稿之后的样子。'] : []),
    ...(opts.readOnly ? ['这个服务是只读的(--read-only)。'] : []),
  ].join('\n');

  async function call(name: string, input: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], ...(isError ? { isError } : {}) });
    try {
      const { json, ...rest } = input;
      if (draftOnly && name === 'draft' && ((rest.args as string[] | undefined)?.[0] ?? 'show') !== 'show') {
        throw new StarsError('这个 MCP 服务开了 --draft:草稿由用户应用 / 丢弃(查看器里,或 stars draft apply);这里只能 draft show');
      }
      if (name === 'undo') {   // 只撤销自己的:要撤的那一条(草稿模式下是草稿的最后一条)是别人写的就不做
        const t = draftOnly ? readDraft(opts.store.file).at(-1) : undoTarget(opts.store.readLog());
        if (t && t.author !== author) throw new StarsError(`${'n' in t ? `最近一次写入(#${t.n})` : '草稿的最后一条'}是 ${t.author} 写的,不是你;要撤销请让用户来`);
      }
      const r = await execKernel(name, mcpTokens(rest), { store: opts.store, author, root: opts.root, cwd: opts.root });
      if (json && r.data !== undefined) return text(JSON.stringify(r.data, null, 2));
      return text(r.out || '(完成)');
    } catch (err) {
      return text(err instanceof StarsError ? err.message : `出错了:${(err as Error).stack ?? err}`, true);
    }
  }

  async function handle(msg: Msg): Promise<Reply | null> {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return { jsonrpc: '2.0', id: msg && typeof msg === 'object' ? msg.id ?? null : null, error: { code: -32600, message: '不是 JSON-RPC 2.0 请求' } };
    }
    const id = msg.id ?? null, notify = msg.id === undefined;
    const ok = (result: unknown): Reply | null => (notify ? null : { jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string): Reply | null => (notify ? null : { jsonrpc: '2.0', id, error: { code, message } });
    const p = msg.params ?? {};
    switch (msg.method) {
      case 'initialize': {
        const want = String(p.protocolVersion ?? ''), client = (p.clientInfo as { name?: string } | undefined)?.name;
        if (!opts.author && client) author = `mcp:${client}`;
        return ok({
          protocolVersion: MCP_VERSIONS.includes(want) ? want : MCP_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'stars', title: '星罗', version: opts.version ?? '0' },
          instructions,
        });
      }
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools });
      case 'tools/call': {
        const name = String(p.name ?? '');
        if (!byName.has(name)) return fail(-32602, `没有这个工具:${name}${opts.readOnly && CMD_LIST.some((c) => c.name === name) ? '(这个服务是只读的)' : ''}`);
        const input = p.arguments ?? {};
        if (typeof input !== 'object' || Array.isArray(input)) return fail(-32602, 'arguments 应该是对象');
        return ok(await call(name, input as Record<string, unknown>));
      }
      default:
        if (msg.method.startsWith('notifications/')) return null;   // initialized、cancelled ……:不用回
        return fail(-32601, `不支持 ${msg.method}`);
    }
  }

  /** 一行文字(一条消息,或者一批) → 要写回去的一行;没有要回的 = null */
  async function line(text: string): Promise<string | null> {
    let msg: unknown;
    try { msg = JSON.parse(text); } catch { return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: '不是 JSON' } }); }
    if (Array.isArray(msg)) {
      const replies = (await Promise.all(msg.map((m) => handle(m as Msg)))).filter((r) => r !== null);
      return replies.length ? JSON.stringify(replies) : null;
    }
    const r = await handle(msg as Msg);
    return r ? JSON.stringify(r) : null;
  }

  return { handle, line, tools, get author() { return author; } };
}

/** 在标准输入输出上跑:一行一条,按顺序处理(写入不会交错);输入结束就退出 */
export async function serveMcp(opts: McpOptions, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const mcp = createMcp(opts);
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const raw of rl) {
    const text = raw.trim();
    if (!text) continue;
    const reply = await mcp.line(text);
    if (reply) output.write(reply + '\n');
  }
}
