// 监听性能基准:node bench/watch.bench.ts [文件数]  (默认 30000)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/ops.ts';
import { listFiles, planScan, statMeta } from '../src/scan.ts';
import { Store } from '../src/store.ts';
import { FsWatcher } from '../src/watch.ts';

const N = Number(process.argv[2] ?? 30_000);
const dir = mkdtempSync(join(tmpdir(), 'stars-wbench-'));
const t = (label: string, fn: () => void) => { const t0 = performance.now(); fn(); console.log(`${label.padEnd(40)} ${(performance.now() - t0).toFixed(0).padStart(7)} ms`); };
execFileSync('git', ['-C', dir, 'init', '-q']);
writeFileSync(join(dir, '.gitignore'), 'universe.stars*\n');
t(`生成 ${N} 个文件`, () => {
  const per = 25, dirs = Math.ceil(N / per);
  for (let d = 0; d < dirs; d++) { const p = join(dir, `pkg${d % 40}/mod${Math.floor(d / 40)}`); mkdirSync(p, { recursive: true }); for (let f = 0; f < per && d * per + f < N; f++) writeFileSync(join(p, `f${f}.ts`), `export const x = ${f};\n`); }
});
const store = new Store(join(dir, 'universe.stars'));
store.create(readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8'));
t('scan 建立宇宙', () => { const u = store.load(); apply(u, planScan(u, listFiles(dir), 'repo', 'bench', statMeta(dir))); store.save(u); });
console.log(`宇宙文件 ${(statSync(store.file).size / 1048576).toFixed(1)} MB\n`);

const syncs: number[] = [];
const w = new FsWatcher({ root: dir, mountId: 'repo', store, debounceMs: 30, pollSec: 0, onSync: (r) => syncs.push(r.ms) });
t('启动(全量对账 + 建立监听)', () => w.start());
console.log(`  目录监听数 ${(readFileSync('/proc/self/status', 'utf8').match(/VmRSS:\s+(\d+)/)?.[1] ?? '?')} kB RSS`);
const wait = (cond: () => boolean, ms = 20000) => new Promise<number>((ok, fail) => { const t0 = performance.now(); const i = setInterval(() => { if (cond()) { clearInterval(i); ok(performance.now() - t0); } else if (performance.now() - t0 > ms) { clearInterval(i); fail(new Error('超时')); } }, 5); });
const has = (id: string) => store.peek().nodes.has(id);

for (const [label, act, id] of [
  ['新建 1 个文件', () => writeFileSync(join(dir, 'pkg0/mod0/new.ts'), 'x'), 'pkg0/mod0/new.ts'],
  ['新建 1 个文件(第二次,热)', () => writeFileSync(join(dir, 'pkg1/mod0/new2.ts'), 'x'), 'pkg1/mod0/new2.ts'],
] as const) {
  const t0 = performance.now(); act();
  await wait(() => has(id));
  console.log(`${label.padEnd(40)} ${(performance.now() - t0).toFixed(0).padStart(7)} ms(落盘到宇宙文件)`);
}
{
  const t0 = performance.now();
  for (let d = 0; d < 20; d++) { mkdirSync(join(dir, `storm/d${d}`), { recursive: true }); for (let f = 0; f < 100; f++) writeFileSync(join(dir, `storm/d${d}/f${f}.txt`), 'x'); }
  await wait(() => has('storm/d19/f99.txt'));
  console.log(`${'风暴:2000 个文件落地'.padEnd(36)} ${(performance.now() - t0).toFixed(0).padStart(7)} ms`);
}
console.log(`\n每次对账耗时(ms): ${syncs.map((x) => x.toFixed(0)).join(' ')}`);
w.stop(); rmSync(dir, { recursive: true, force: true });
