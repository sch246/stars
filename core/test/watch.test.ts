import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from '../src/format.ts';
import { apply } from '../src/ops.ts';
import { Store } from '../src/store.ts';
import { FsWatcher } from '../src/watch.ts';
import { planScan, listFiles, statMeta } from '../src/scan.ts';

const genesis = readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('等待超时'); await sleep(20); }
}
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'stars-watch-'));
  const sh = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  sh('init', '-q'); writeFileSync(join(dir, '.gitignore'), 'node_modules/\nuniverse.stars*\n');
  mkdirSync(join(dir, 'src')); writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'README.md'), '# hi\n');
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  const u = store.load();
  apply(u, planScan(u, listFiles(dir), 'repo', 'proj', statMeta(dir)));
  store.save(u);
  return { dir, store };
}

test('监听:创建/改名/删除/修改 → 宇宙实时对账;node_modules 被忽略;修改只更新实时信号', async () => {
  const { dir, store } = project();
  const syncs: Array<{ full: boolean; ops: number }> = [];
  const live: Record<string, number> = {};
  const w = new FsWatcher({
    root: dir, mountId: 'repo', store, debounceMs: 30, pollSec: 0,
    onSync: (r) => { Object.assign(live, r.live.size); if (r.op) syncs.push({ full: r.full, ops: r.op.op === 'batch' ? r.op.ops.length : 1 }); },
  });
  w.start();
  try {
    const has = (id: string) => new Store(store.file).load().nodes.has(id);
    // 新建文件 + 新建整个目录树
    writeFileSync(join(dir, 'src/b.ts'), 'export const b = 2;\n');
    mkdirSync(join(dir, 'lib/deep'), { recursive: true });
    writeFileSync(join(dir, 'lib/deep/c.ts'), 'x\n');
    mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/pkg/index.js'), 'ignored\n');
    await until(() => has('src/b.ts') && has('lib/deep/c.ts'));
    assert.ok(!has('node_modules/'), 'node_modules 被 .gitignore 忽略');
    // 改名:关系要跟着走
    store.commit({ op: 'addNode', id: 'note', label: 'n' }, { author: 'human' });
    store.commit({ op: 'addEdge', from: 'note', type: 'describes', to: 'src/b.ts' }, { author: 'human' });
    renameSync(join(dir, 'src/b.ts'), join(dir, 'src/b2.ts'));
    await until(() => has('src/b2.ts') && !has('src/b.ts'));
    assert.ok(new Store(store.file).load().edges.has('note\u0000describes\u0000src/b2.ts'), '改名后关系还在');
    // 修改内容:不写宇宙,只有实时信号
    const logBefore = store.logCount();
    writeFileSync(join(dir, 'src/a.ts'), 'export const a = 1; // 变大了很多很多很多\n'.repeat(50));
    await until(() => live['src/a.ts'] !== undefined);
    assert.equal(store.logCount(), logBefore, '内容变化没有产生对宇宙的写入');
    // 删除:没有语义关系的直接移除
    rmSync(join(dir, 'README.md'));
    await until(() => !has('README.md'));
    assert.ok(syncs.every((s) => !s.full), '全程只做了局部对账');
  } finally { w.stop(); }
});

test('监听:事件风暴(上千个文件一次落地)合并成很少几次提交', async () => {
  const { dir, store } = project();
  const w = new FsWatcher({ root: dir, mountId: 'repo', store, debounceMs: 50, pollSec: 0 });
  w.start();
  try {
    const before = store.logCount();
    for (let d = 0; d < 20; d++) {
      mkdirSync(join(dir, `gen/d${d}`), { recursive: true });
      for (let f = 0; f < 60; f++) writeFileSync(join(dir, `gen/d${d}/f${f}.txt`), `${d}-${f}`);
    }
    const has = (id: string) => new Store(store.file).load().nodes.has(id);
    await until(() => has('gen/d19/f59.txt'), 15000);
    const commits = store.logCount() - before;
    assert.ok(commits <= 12, `1200 个文件应当只触发很少几次提交,实际 ${commits} 次`);
    assert.equal(w.stats.fullSyncs, 1, '只有启动时那一次全量对账');
  } finally { w.stop(); }
});

test('监听:启动时的全量对账能追上"没开着的时候"发生的变化', async () => {
  const { dir, store } = project();
  writeFileSync(join(dir, 'while-away.ts'), 'x');
  rmSync(join(dir, 'src/a.ts'));
  const w = new FsWatcher({ root: dir, mountId: 'repo', store, pollSec: 0 });
  const first = w.start();
  try {
    assert.equal(first.full, true);
    const u = new Store(store.file).load();
    assert.ok(u.nodes.has('while-away.ts') && !u.nodes.has('src/a.ts'));
  } finally { w.stop(); }
});
