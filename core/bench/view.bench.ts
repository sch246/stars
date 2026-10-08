// 视图性能基准:node bench/view.bench.ts [文件数]  (默认 100000)
import { readFileSync } from 'node:fs';
import { parse } from '../src/format.ts';
import { apply } from '../src/ops.ts';
import { planScan } from '../src/scan.ts';
import { BUILTIN_VIEWS, compileView, evaluateView } from '../src/view.ts';

const N = Number(process.argv[2] ?? 100_000);
const time = <T>(label: string, fn: () => T): T => {
  const t = performance.now();
  const r = fn();
  console.log(`${label.padEnd(44)} ${(performance.now() - t).toFixed(1).padStart(9)} ms`);
  return r;
};

const u = parse(readFileSync(new URL('../genesis.stars', import.meta.url), 'utf8'));
const files: string[] = [];
const top = Math.max(10, Math.round(Math.sqrt(N / 25) / 1.4));
for (let a = 0; a < top; a++) for (let b = 0; b < Math.ceil(N / 25 / top); b++) for (let c = 0; c < 25 && files.length < N; c++) files.push(`pkg${a}/mod${b}/f${c}.ts`);
const sizes = new Map(files.map((f, i) => [f, { size: 100 + ((i * 7919) % 50_000) }]));
time(`构建宇宙 ${files.length} 个文件`, () => apply(u, planScan(u, files, 'repo', 'bench', (p) => sizes.get(p)!)));
const ids = [...u.nodes.keys()].filter((k) => k.endsWith('.ts'));
time('随机 dependsOn 边 ×' + ids.length, () => {
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i]!, b = ids[(i * 48271 + 11) % ids.length]!;
    if (a !== b) { try { apply(u, { op: 'addEdge', from: a, type: 'dependsOn', to: b }); } catch { /* 重复 */ } }
  }
});
const fileChanged = Object.fromEntries(ids.map((id, i) => [id, Date.now() - (i % 4000) * 3_600_000]));
console.log(`节点 ${u.nodes.size} · 边 ${u.edges.size}\n`);

const galaxy = BUILTIN_VIEWS.galaxy!, recent = BUILTIN_VIEWS.recent!;
for (let i = 0; i < 2; i++) {
  console.log(i === 0 ? '--- 冷启动 ---' : '--- 预热后 ---');
  const c = time('galaxy 编译(宇宙/规格/信号变了才做一次)', () => compileView(u, galaxy));
  time('  fold 收起(默认)', () => c.fold());
  time('  fold 展开一个目录(交互热路径)', () => c.fold({ expanded: ['pkg0/'] }));
  time('  fold 展开到第 3 层', () => c.fold({ depth: 3 }));
  const r = time('recent 编译(含信号与汇总)', () => compileView(u, recent, { signals: { fileChanged } }));
  time('  fold 收起', () => r.fold());
  time('evaluateView 一步到位(galaxy)', () => evaluateView(u, galaxy));
}
