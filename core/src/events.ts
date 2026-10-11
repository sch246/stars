// 事件:同一套名字。服务端推给查看器的消息(type)、查看器里各个模块之间、页面和脚本订阅的(stars.on)、
// 脚本节点的触发(on=…,见 scriptnode.ts),说到同一件事都用这里的名字。浏览器和 Node 共用。
// where:server = 服务端推给订阅者的消息 · page = 页面、查看器里跑的脚本能 stars.on · node = Node 脚本能 stars.on ·
//        trigger = 脚本节点的 on= 里能写
export interface EventInfo { title: string; data: string; where: ReadonlyArray<'server' | 'page' | 'node' | 'trigger'> }

export const STARS_EVENTS: Readonly<Record<string, EventInfo>> = {
  snapshot: { title: '一份完整的状态(连上、重连、日志对不上的时候)', data: '{ nodes, edges, log, signals, issues, draft, project, … }', where: ['server'] },
  change: { title: '宇宙变了:新追加的操作(谁写的都算:查看器、CLI、脚本、实时同步)', data: '{ n, ops: [{ n, author, t, op }] };整份重新载入时 { n, reset: true }', where: ['server', 'page', 'node', 'trigger'] },
  file: { title: '磁盘上的文件变了(实时同步发现的;只改内容也算)', data: '{ ids, paths }(服务端推的还带 size / changed 这些实时信号)', where: ['server', 'page', 'trigger'] },
  issues: { title: '体检结果更新了', data: '{ issues: [{ severity, rule, message, nodes }] }', where: ['server', 'page'] },
  stale: { title: '有说明过期了(写说明之后文件又改了)', data: '{ ids }', where: ['page', 'trigger'] },
  draft: { title: '草稿变了', data: '{ entries }', where: ['server', 'page'] },
  run: { title: '脚本节点开始跑 / 跑完', data: '{ phase: start | end, script, trigger, runId, record? }', where: ['server', 'page'] },
  select: { title: '查看器里选中的节点变了', data: 'id | null', where: ['page'] },
  level: { title: '页面 / 脚本的连接级别变了', data: "'off' | 'read' | 'ui' | 'propose' | 'write'", where: ['page'] },
  start: { title: '服务(或 stars agent)启动的时候', data: '—', where: ['trigger'] },
  every: { title: '定时(every=10m)', data: '—', where: ['trigger'] },
};

/** 某处能用的事件名 */
export const eventsFor = (where: EventInfo['where'][number]): string[] => Object.keys(STARS_EVENTS).filter((k) => STARS_EVENTS[k]!.where.includes(where));
