import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { Store, lockPath, withLock } from '../src/store.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');
const storeUrl = new URL('../src/store.ts', import.meta.url).href;
const run = promisify(execFile);

test('写锁:几个进程同时提交,一条都不丢,日志序号连续', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-lock-'));
  const file = join(dir, 'universe.stars');
  new Store(file).create(genesis);
  const worker = join(dir, 'w.mjs');
  writeFileSync(worker, `import { Store } from ${JSON.stringify(storeUrl)};
const [file, tag, n, defer] = process.argv.slice(2);
const s = new Store(file);
for (let i = 0; i < +n; i++) s.commit({ op: 'addNode', id: tag + '-' + i, label: tag }, { author: tag }, undefined, { defer: defer === '1' });
`);
  const N = 4, M = 25;
  await Promise.all(Array.from({ length: N }, (_, k) => run(process.execPath, [worker, file, 'p' + k, String(M), k % 2 ? '1' : '0'])));
  const s = new Store(file);
  const u = s.load();
  for (let k = 0; k < N; k++) for (let i = 0; i < M; i++) assert.ok(u.nodes.has(`p${k}-${i}`), `p${k}-${i} 丢了`);
  const ns = s.readLog().map((e) => e.n);
  assert.deepEqual(ns, Array.from({ length: N * M }, (_, i) => i + 1), '日志序号连续、不重复');
  assert.ok(!existsSync(lockPath(file)), '锁放掉了');
});

test('写锁:持锁的进程死了(锁文件留下)→ 认出是死锁,接着写;别的机器上的新锁要等;同一进程里可以重入', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stars-lock-'));
  const file = join(dir, 'universe.stars');
  const s = new Store(file);
  s.create(genesis);
  const deadPid = 2 ** 22 + 12345;
  writeFileSync(lockPath(file), JSON.stringify({ pid: deadPid, host: 'elsewhere', t: Date.now() }));   // 别的机器、刚写的:判断不了死活,只能等
  assert.throws(() => withLock(file, () => 1, { timeoutMs: 150 }), /锁着/);
  writeFileSync(lockPath(file), JSON.stringify({ pid: deadPid, host: hostname(), t: Date.now() }));     // 本机、进程不在了:立刻接手
  s.commit({ op: 'addNode', id: 'after', label: 'a' }, { author: 't' });
  assert.ok(s.load().nodes.has('after'));
  assert.equal(withLock(file, () => withLock(file, () => 'inner')), 'inner', '重入');
  assert.ok(!existsSync(lockPath(file)));
  writeFileSync(lockPath(file), JSON.stringify({ pid: deadPid, host: 'elsewhere', t: Date.now() - 10 * 60_000 }));   // 很久以前的锁也算死锁
  s.commit({ op: 'addNode', id: 'after2', label: 'b' }, { author: 't' });
  assert.ok(s.load().nodes.has('after2'));
});
