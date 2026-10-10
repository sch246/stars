import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cmdLine, cmdQuote, cmdTokenize } from '../src/cmdline.ts';

process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'stars-cfg-')); // 脚本的 store 别写进真实的家目录
const cliPath = new URL('../src/cli.ts', import.meta.url).pathname;
const stars = (cwd: string, ...args: string[]) => new Promise<{ code: number; out: string; err: string }>((ok) => {
  execFile(process.execPath, [cliPath, ...args], { cwd, env: process.env }, (e, out, err) => ok({ code: e ? (e as { code?: number }).code ?? 1 : 0, out, err }));
});

test('命令行:切词与加引号能互相还原;结构化调用拼成和 CLI 一样的一行', () => {
  for (const s of ['a', 'a b', '"', '\\', "it's", '', '中 文', 'x"y\\z', '-0.5']) assert.deepEqual(cmdTokenize(cmdQuote(s)), [s], JSON.stringify(s));
  assert.deepEqual(cmdTokenize(`link a "b c" 'd \\ e' --x`), ['link', 'a', 'b c', 'd \\ e', '--x']);
  assert.equal(cmdLine('link', ['a', 'dependsOn', 'b c', { proposed: true }]), 'link a dependsOn "b c" --proposed');
  assert.equal(cmdLine('add', ['n', '名字', { type: 'note', attr: { owner: 'bot', 'x y': '1' }, unset: ['a', 'b'], proposed: false, label: null }]),
    'add n 名字 --type note --attr owner=bot --attr "x y=1" --unset a --unset b');
  assert.equal(cmdLine('collapseAll', []), 'collapse-all', '驼峰的命令名');
  assert.equal(cmdLine('view', ['tags', { maxNodes: 50, depth: 2 }]), 'view tags --max-nodes 50 --depth 2', '驼峰的选项名、数字');
  assert.equal(cmdLine('select', [undefined]), 'select', '位置参数里的 undefined 跳过');
  assert.throws(() => cmdLine('rm -rf; x', []), /不是命令名/);
});

test('stars run:脚本拿到 stars(内核命令直接读写宇宙、结构化调用、快照、按脚本存的数据);脚本名之后的参数原样交给脚本', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-run-'));
  assert.equal((await stars(dir, 'init')).code, 0);
  writeFileSync(join(dir, 'job.mjs'), `
export default async function (stars, args) {
  await stars.cmd.add('idea', '想法', { type: 'note', proposed: true });
  const link = await stars.cmd.link('idea', 'dependsOn', 'universe', { attr: { why: 'x y' } });
  const shown = await stars.exec('show idea');
  const g = await stars.graph();
  await stars.store.set('n', ((await stars.store.get('n')) || 0) + 1);
  let err = null;
  try { await stars.exec('show nope'); } catch (e) { err = e.message; }
  return { args, globalArgs: globalThis.args, link: link.data, attrs: shown.data.node.attrs, out: shown.data.out.map((e) => e.attrs),
    proposals: Object.keys(g.proposals), runs: await stars.store.get('n'), err, info: (await stars.info()).author };
}
`);
  const r = await stars(dir, 'run', 'job.mjs', 'one', '--two', '3');
  assert.equal(r.code, 0, r.err);
  const v = JSON.parse(r.out);
  assert.deepEqual(v.args, ['one', '--two', '3'], '--two 没被当成 stars 的选项');
  assert.deepEqual(v.globalArgs, v.args);
  assert.deepEqual(v.attrs, { type: 'note', status: 'proposed' });
  assert.deepEqual(v.out, [{ why: 'x y' }]);
  assert.deepEqual(v.proposals, ['#idea']);
  assert.equal(v.runs, 1);
  assert.match(v.err, /节点不存在/);
  assert.equal(v.info, 'script:job.mjs');
  assert.ok(Number.isInteger(v.link.n));
  const log = readFileSync(join(dir, 'universe.stars.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { author: string });
  assert.deepEqual(log.slice(-2).map((e) => e.author), ['script:job.mjs', 'script:job.mjs'], '写入的作者默认是 script:<路径>');
  // 顶层写法 + 出错:退出码不是 0,错误打印出来
  writeFileSync(join(dir, 'top.mjs'), `stars.print('top', args.join(','));\nawait stars.cmd.rm('nope');\n`);
  const t = await stars(dir, '--author', 'me', 'run', 'top.mjs', 'a', 'b');
  assert.equal(t.out.trim(), 'top a,b');
  assert.notEqual(t.code, 0);
  assert.match(t.err, /nope/);
  // 不是内核命令、又没有开着的查看器
  writeFileSync(join(dir, 'ui.mjs'), `await stars.exec('select idea');\n`);
  const u = await stars(dir, 'run', 'ui.mjs');
  assert.notEqual(u.code, 0);
  assert.match(u.err, /没有正在运行的星罗服务|没有打开着的查看器/);
});
