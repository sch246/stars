// 一张命令表(cmdspec.ts):解析和 node:util 的 parseArgs 一致、按命令查选项;表里的内核命令内核都实现了、查看器里都有;帮助从表生成
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseArgs } from 'node:util';
import { CMD_LIST, CMD_OPTIONS, KERNEL_NAMES, cmdHelp, cmdParse } from '../src/cmdspec.ts';
import { execKernel, runKernel } from '../src/commands.ts';
import { StarsError } from '../src/model.ts';
import { viewerDir, viewerParts } from '../src/page.ts';
import { Store } from '../src/store.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');

test('命令表:切选项和 node:util 的 parseArgs 一样;这条命令不认的选项报出来', () => {
  const cases = [
    ['a', 'b', '-t', 'note', '--summary', 's', '-a', 'k=v', '-a', 'x=y', '--proposed'],
    ['x', '--label=名字', '--', '--not-an-option'],
    ['-tnote', 'id'],
  ];
  for (const args of cases) {
    const ours = cmdParse('add', args), node = parseArgs({ args, options: CMD_OPTIONS, allowPositionals: true });
    assert.deepEqual(ours, { positionals: node.positionals, values: { ...node.values } }, args.join(' '));
  }
  assert.deepEqual(cmdParse('nb', ['a', '--depth', '2', '--dir', 'out']).values, { depth: '2', dir: 'out' });
  assert.deepEqual(cmdParse('add', ['-0.5']).positionals, ['-0.5'], '负数当位置参数');
  assert.throws(() => cmdParse('add', ['x', '--depth', '2']), /add 不认识选项 --depth/);
  assert.throws(() => cmdParse('add', ['x', '--nope']), /add 不认识选项 --nope/);
  assert.throws(() => cmdParse('add', ['x', '-t']), /需要一个值/);
  assert.throws(() => cmdParse('add', ['x', '--proposed=1']), /不带值/);
  assert.deepEqual(cmdParse('ls', ['--json', '--draft']).values, { json: true, draft: true }, '全局选项哪条命令都认');
});

test('命令表:表里的内核命令内核都实现了;查看器里都有同名命令;帮助里每条都在', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-cmdspec-'));
  const store = new Store(join(dir, 'universe.stars')); store.create(genesis);
  for (const name of KERNEL_NAMES) {
    try { runKernel(name, [], {}, { store, author: 't', root: dir }); }
    catch (err) { assert.ok(err instanceof StarsError && !/不是内核命令/.test(err.message), `${name}: ${(err as Error).message}`); }
  }
  await assert.rejects(execKernel('nope', [], { store, author: 't', root: dir }), /不是内核命令/);
  const src = viewerParts().map((f) => readFileSync(`${viewerDir}/app/${f}`, 'utf8')).join('\n');
  // kdef('名字' / defCmd('名字',或者 for (const … of [ … ]) 后面跟着 kdef 的那几个
  const looped = [...src.matchAll(/for \(const [^\n]*? of (\[[^\n]*?\])\) \{?\n?\s*(?:const [^\n]*\n\s*)?kdef\(/g)].flatMap((m) => [...m[1]!.matchAll(/'([\w-]+)'/g)].map((x) => x[1]!));
  for (const name of KERNEL_NAMES) assert.ok(new RegExp(`(?:kdef|defCmd)\\('${name}'`).test(src) || looped.includes(name), `查看器里有 ${name}`);
  const help = cmdHelp();
  for (const c of CMD_LIST) assert.ok(help.includes(c.usage), `帮助里有 ${c.name}`);
  assert.match(cmdHelp('nb'), /选项:--depth {2}--dir {2}--type \/ -t/);
});

test('命令:execKernel 认 --draft(写进草稿);--author / --file 不认(由调用方定)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-cmdexec-'));
  const store = new Store(join(dir, 'universe.stars')); store.create(genesis);
  const r = await execKernel('add', ['d', '--draft'], { store, author: 'viewer', root: dir });
  assert.deepEqual(r.data, { draft: 1 });
  assert.ok(!store.load().nodes.has('d'));
  await execKernel('add', ['e', '--author', 'mallory'], { store, author: 'viewer', root: dir });
  assert.equal(store.readLog().at(-1)!.author, 'viewer');
  await execKernel('scan', ['.'], { store, author: 'viewer', root: dir, cwd: dir });
  assert.ok(store.load().nodes.has('repo'), 'scan 的相对路径按 cwd 解');
});
