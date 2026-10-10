// 查看器需要的一份"当前宇宙快照":节点、边、体检结果、最近日志、信号、待审阅提议、草稿。
// 实时查看器(SSE)和静态导出(单个 HTML)共用这一份。
import { loadSignals, proposalsFromLog, type LiveSignals } from './activity.ts';
import { lint } from './lint.ts';
import { readDraft, type Store } from './store.ts';

export function buildSnapshot(store: Store, baseDir: string, live?: LiveSignals, opts: { skipFileStat?: boolean } = {}): Record<string, unknown> {
  const u = store.peek();
  const log = store.readLog();
  return {
    type: 'snapshot',
    watching: !!opts.skipFileStat,
    t: Date.now(),
    n: log.length,
    nodes: [...u.nodes.values()],
    edges: [...u.edges.values()],
    issues: lint(u, { baseDir, skipFileStat: opts.skipFileStat }),
    log: log.slice(-60),
    signals: loadSignals(log, u, baseDir, 3000, live),
    proposals: proposalsFromLog(log, u),
    draft: readDraft(store.file),
  };
}
