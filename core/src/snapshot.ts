// 查看器需要的一份"当前宇宙快照":节点、边、体检结果、最近日志、信号、待审阅提议。
// 实时查看器(SSE)和静态导出(单个 HTML)共用这一份。
import { loadSignals, proposalsFromLog } from './activity.ts';
import { lint } from './lint.ts';
import { type Store } from './store.ts';

export function buildSnapshot(store: Store, baseDir: string): Record<string, unknown> {
  const u = store.load();
  const log = store.readLog();
  return {
    t: Date.now(),
    nodes: [...u.nodes.values()],
    edges: [...u.edges.values()],
    issues: lint(u, { baseDir }),
    log: log.slice(-60),
    signals: loadSignals(log, u, baseDir),
    proposals: proposalsFromLog(log, u),
  };
}
