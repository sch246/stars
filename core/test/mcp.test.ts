// MCP 出口(mcp.ts):工具从命令表生成,执行和 CLI 同一份;作者是 mcp:<客户端名>;--draft / --read-only;真的起一个 stars mcp 走标准输入输出
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runKernel } from '../src/commands.ts';
import { createMcp, mcpTokens } from '../src/mcp.ts';
import { DraftStore, Store, readDraft } from '../src/store.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'stars-mcp-'));
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  return { dir, store };
}
type Res = { content: Array<{ text: string }>; isError?: boolean };
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-client', version: '1' } } };

test('MCP:握手、工具从命令表来、调用和 CLI 一样、作者是 mcp:<客户端>、出错带 isError', async () => {
  const { dir, store } = fresh();
  const mcp = createMcp({ store, root: dir, version: '9.9' });
  const hi = await mcp.handle(init) as { result: { protocolVersion: string; serverInfo: { name: string; version: string }; capabilities: object; instructions: string } };
  assert.equal(hi.result.protocolVersion, '2025-06-18', '客户端要的版本认得就用它');
  assert.deepEqual([hi.result.serverInfo.name, hi.result.serverInfo.version], ['stars', '9.9']);
  assert.match(hi.result.instructions, /ls/);
  assert.equal(((await mcp.handle({ ...init, params: { protocolVersion: '1999-01-01' } })) as { result: { protocolVersion: string } }).result.protocolVersion, '2025-11-25', '不认得就给最新的');
  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, '通知不回');
  assert.deepEqual(await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'ping' }), { jsonrpc: '2.0', id: 2, result: {} });

  const { result: { tools } } = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' }) as { result: { tools: Array<{ name: string; inputSchema: { properties: Record<string, { type: string; description?: string }> }; annotations: { readOnlyHint: boolean } }> } };
  const names = tools.map((t) => t.name);
  for (const n of ['add', 'set', 'rm', 'link', 'ls', 'show', 'query', 'stale', 'draft']) assert.ok(names.includes(n), `有 ${n}`);
  for (const n of ['serve', 'run', 'mcp', 'ui', 'init']) assert.ok(!names.includes(n), `没有只给自己用的 ${n}`);
  const add = tools.find((t) => t.name === 'add')!;
  assert.equal(add.inputSchema.properties.type!.description, '类型', '参数说明从用法里取');
  assert.equal(add.inputSchema.properties.attr!.type, 'array', '可重复的选项 = 数组');
  assert.equal(add.inputSchema.properties.draft!.type, 'boolean');
  assert.ok(!('author' in add.inputSchema.properties) && !('file' in add.inputSchema.properties), '作者、文件由服务定');
  assert.equal(tools.find((t) => t.name === 'show')!.annotations.readOnlyHint, true);
  assert.ok('json' in tools.find((t) => t.name === 'ls')!.inputSchema.properties);

  const call = async (name: string, args: Record<string, unknown>) => ((await mcp.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })) as { result: Res }).result;
  assert.match((await call('add', { args: ['x', '想法X'], type: 'note', summary: '说明', attr: ['k=v', 'w=1'] })).content[0]!.text, /\+ x/);
  const x = store.load().nodes.get('x')!;
  assert.deepEqual([x.label, x.attrs.type, x.attrs.summary, x.attrs.k, x.attrs.w], ['想法X', 'note', '说明', 'v', '1']);
  assert.equal(store.readLog().at(-1)!.author, 'mcp:test-client');
  assert.match((await call('show', { args: ['x'] })).content[0]!.text, /x \[note\]  想法X/);
  const ls = JSON.parse((await call('ls', { type: 'note', json: true })).content[0]!.text) as Array<{ id: string }>;
  assert.ok(ls.some((n) => n.id === 'x'), 'json: true 给结构化数据');
  const bad = await call('show', { args: ['nope'] });
  assert.ok(bad.isError && /节点不存在/.test(bad.content[0]!.text), '内核的报错原样给');
  assert.ok((await call('add', { args: ['y'], depth: '2' })).isError, '这条命令不认的选项报错');
  assert.equal(((await mcp.handle({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'serve', arguments: {} } })) as { error: { code: number } }).error.code, -32602);
  assert.equal(((await mcp.handle({ jsonrpc: '2.0', id: 11, method: 'resources/list' })) as { error: { code: number } }).error.code, -32601);
  assert.match((await mcp.line('{oops')) ?? '', /-32700/);
  assert.match((await mcp.line('null')) ?? '', /-32600/);
  assert.match((await mcp.line('{"jsonrpc":"2.0","id":5}')) ?? '', /"id":5.*-32600/);
  const batch = JSON.parse((await mcp.line(JSON.stringify([{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }])))!) as unknown[];
  assert.equal(batch.length, 1, '一批里的通知不回');

  // undo 只撤销自己的:最近一次是别人写的就不做
  runKernel('add', ['h', '人写的'], {}, { store, author: 'human', root: dir });
  const u1 = await call('undo', {});
  assert.ok(u1.isError && /human/.test(u1.content[0]!.text));
  assert.ok(store.load().nodes.has('h'));
  await call('add', { args: ['z'] });
  assert.ok(!(await call('undo', {})).isError);
  assert.ok(!store.load().nodes.has('z') && store.load().nodes.has('h'));
});

test('MCP:--read-only 只有读命令;--draft 写入一律进草稿、草稿不能自己应用', async () => {
  const { dir, store } = fresh();
  const ro = createMcp({ store, root: dir, readOnly: true });
  const { result: { tools } } = await ro.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as { result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> } };
  assert.ok(tools.length > 5 && tools.every((t) => t.annotations.readOnlyHint));
  const no = await ro.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'add', arguments: { args: ['x'] } } }) as { error: { message: string } };
  assert.match(no.error.message, /只读/);

  const dm = createMcp({ store: new DraftStore(store.file), root: dir, author: 'claude' });
  const call = async (name: string, args: Record<string, unknown>) => ((await dm.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } })) as { result: Res }).result;
  const { result: { tools: dt } } = await dm.handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' }) as { result: { tools: Array<{ name: string; inputSchema: { properties: object } }> } };
  assert.ok(!('draft' in dt.find((t) => t.name === 'add')!.inputSchema.properties), '草稿模式下不用再给 draft');
  await call('add', { args: ['d1', '草稿里的'] });
  assert.ok(!store.load().nodes.has('d1'), '没落进宇宙');
  assert.deepEqual(readDraft(store.file).map((e) => e.author), ['claude'], '--author 定的作者');
  assert.match((await call('show', { args: ['d1'] })).content[0]!.text, /草稿里的/, '读命令看到应用了草稿之后的样子');
  assert.match((await call('draft', {})).content[0]!.text, /草稿:1 条/);
  const apply = await call('draft', { args: ['apply'] });
  assert.ok(apply.isError && /--draft/.test(apply.content[0]!.text), '应用草稿留给用户');
  assert.ok(!store.load().nodes.has('d1'));
  runKernel('add', ['d2'], {}, { store: new DraftStore(store.file), author: 'human', root: dir });
  const u = await call('undo', {});
  assert.ok(u.isError && /草稿的最后一条是 human/.test(u.content[0]!.text), '草稿里别人写的也不撤');
  assert.equal(readDraft(store.file).length, 2);
});

test('MCP:stars mcp 走标准输入输出,stdout 上只有协议', async () => {
  const { dir, store } = fresh();
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const p = spawn(process.execPath, [cli, 'mcp', '-f', store.file], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: p.stdout! })[Symbol.asyncIterator]();
  const next = async () => JSON.parse(((await lines.next()).value as string)) as { id: number; result: { tools?: unknown[]; content?: Array<{ text: string }> } };
  try {
    p.stdin!.write(JSON.stringify(init) + '\n');
    assert.equal((await next()).id, 1);
    p.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    p.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    assert.ok(((await next()).result.tools ?? []).length > 20);
    p.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add', arguments: { args: ['m1', '从 MCP 来'], type: 'note' } } }) + '\n');
    const r = await next();
    assert.equal(r.id, 3);
    assert.match(r.result.content![0]!.text, /\+ m1/);
    assert.equal(store.readLog().at(-1)!.author, 'mcp:test-client');
  } finally {
    p.stdin!.end();
    await new Promise((ok) => p.once('exit', ok));
  }
});

test('MCP:工具参数 → 命令行的词(位置参数放在 -- 之后,横杠开头的也当位置参数)', () => {
  assert.deepEqual(mcpTokens({ args: ['a', '-0.5', '--x'], type: 'note', attr: ['k=v', 'w=1'], proposed: true, draft: false }),
    ['--type=note', '--attr=k=v', '--attr=w=1', '--proposed', '--', 'a', '-0.5', '--x']);
});
