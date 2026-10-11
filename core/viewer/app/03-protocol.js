// ---------- 数据接入 ----------
function connect() {
  if (window.__STARS_STATIC__) { // 静态导出:数据内嵌,没有服务器
    document.body.classList.add('static');
    ingest(window.__STARS_STATIC__);
    $('status').innerHTML += ' · <b>静态导出(只读)</b>';
    return;
  }
  if (stopListening) stopListening();
  stopListening = transport.listen({
    message: handle,
    error: () => { $('status').textContent = '连接断开,重连中…'; },
    // 个人设置 / 快捷键在别处改了(编辑器、别的标签页、stars ui):立即生效
    config: (m) => adoptCfg(m.name, m),
    // 看着的项目被关掉了(别的标签页、project --close):回到主项目
    closed: () => {
      if (!projectId) return;   // 自己关的、已经切回主项目了
      toast(`项目 ${esc(project ? project.name : '')} 已关闭,回到主项目`);
      api('/api/projects').then((r) => switchProject(r.open.find((x) => x.primary))).catch(() => { projectId = null; setHash(); connect(); });
    },
    // 遥控:stars ui <命令> → 在这里执行 → 把输出回报给服务端,由它交回 CLI
    ui: (m) => exec(m.line, 'remote', (r) => { api('/api/ui-result', { id: m.id, ...r }).catch(() => { /* CLI 已经不等了 */ }); }, m.from),
  });
}

// ---------- 增量协议:snapshot 一次,之后只收新增的日志条目(ops)与实时信号(signals) ----------
let lastN = 0, staleLive = false, recomputeTimer = null, lastCompile = 100;
// 等日志推回来:写命令在查看器里应用了这一条才算完成,这样脚本 / 页面写完马上读(graph、show)就能看到自己写的
const appliedWaiters = [];
const waitApplied = (n) => (lastN >= n ? Promise.resolve() : new Promise((ok) => { const w = { n, ok }; appliedWaiters.push(w); setTimeout(() => { const i = appliedWaiters.indexOf(w); if (i >= 0) appliedWaiters.splice(i, 1); ok(); }, 3000); }));
function wakeApplied() { for (let i = appliedWaiters.length - 1; i >= 0; i--) if (appliedWaiters[i].n <= lastN) appliedWaiters.splice(i, 1)[0].ok(); }
// ---------- 事件(名字见 core/src/events.ts):服务端推来的消息翻成同名的事件,查看器里的模块各自订阅(onEvent),
// 页面和查看器里跑的脚本也订阅同样的名字(页面桥转过去,见 15-bridge.js)----------
const eventSubs = new Map();
function onEvent(name, f) {
  if (!STARS_EVENTS[name]) throw new Error('不是事件名:' + name);
  if (!eventSubs.has(name)) eventSubs.set(name, new Set());
  eventSubs.get(name).add(f);
  return () => eventSubs.get(name).delete(f);
}
function emitEvent(name, value) {
  for (const f of eventSubs.get(name) || []) { try { f(value); } catch (e) { console.error(e); } }
}
function handle(m) {
  if (m.type === 'draft') { setDraft(m.entries || []); emitEvent('draft', { entries: m.entries || [] }); return; }
  if (m.type === 'run') { onRun(m); emitEvent('run', m); return; }
  if (m.type === 'change' || m.type === 'file' || m.type === 'issues') {
    if (replay) { staleLive = true; return; } // 回放中:实时更新先不动画面,退出回放时重新同步
    if (m.type === 'change') return applyOps(m.entries);
    if (m.type === 'file') return applySignals(m);
    data.issues = m.issues; onIssues();
    emitEvent('issues', { issues: m.issues });
    return;
  }
  ingest(m);
}
function resync() { connect(); }   // 日志出现缺口等不一致:重新连接,服务端会先发一份完整快照
function scheduleRecompute() {
  if (recomputeTimer) return;
  // 编译较贵:变化很密集时按上一次编译耗时自适应地合并,保证界面不被拖死
  recomputeTimer = setTimeout(() => { recomputeTimer = null; recompute(true); }, Math.max(120, lastCompile * 3));
}
function applyOps(entries) {
  const done = [];
  for (const e of entries) {
    if (e.n <= lastN) continue;                       // 重复(快照已包含)
    if (e.n !== lastN + 1) { resync(); return; }      // 缺口
    try { apply(liveU || uni, e.op); } catch { resync(); return; }
    if (opChangesStructure(e.op)) structStamp++;
    lastN = e.n; done.push(e);
    data.log.push(e); if (data.log.length > 60) data.log.shift();
    data.proposals = data.proposals || {};
    trackProposals(data.proposals, e);
  }
  if (draftOn) previewDraft();   // 预览草稿:在新的实时宇宙上重新叠一遍
  data.nodes = [...uni.nodes.values()]; data.edges = [...uni.edges.values()];
  raw.clear(); for (const n of data.nodes) raw.set(n.id, n);
  const lv = listViews(uni); specs = lv.specs; viewErrors = Object.values(lv.errors); viewNames = Object.keys(specs);
  if (!specs[currentView]) currentView = viewNames[0];
  scheduleRecompute();
  renderReview();
  renderStatus();
  if (done.length) emitEvent('change', { n: lastN, ops: done.map((e) => ({ n: e.n, author: e.author, t: e.t, op: e.op })) });
  wakeApplied();
}
function applySignals(m) {
  if (m.changed && Object.keys(m.changed).length) {   // 视图脚本(05a)、侧栏里的 HTML 页面(14)、页面桥都订阅 file
    const ids = Object.keys(m.changed);
    emitEvent('file', { ids, paths: ids.map((id) => (raw.get(id) && raw.get(id).attrs.file) || id) });
  }
  if (fp && ((m.changed && m.changed[fp.id] !== undefined) || (m.size && m.size[fp.id] !== undefined) || m.replace)) checkDisk();
  const sg = (data.signals = data.signals || {});
  if (m.replace) { sg.fileChanged = m.fileChanged; sg.touched = m.touched; if (m.size) sg.size = m.size; }
  else { sg.size = Object.assign(sg.size || {}, m.size); sg.fileChanged = Object.assign(sg.fileChanged || {}, m.changed); }
  scheduleRecompute();
}
/** 过期(stale)也当一个信号给视图用:表达式里写 stale(1 = 说明写于文件改动之前) */
let staleKey = '';
function staleSignal() { const o = {}; for (const i of data.issues) if (i.rule === 'stale') o[i.nodes[0]] = 1; return o; }
function onIssues() {
  rebuildIssues(); renderSide(); renderStatus();
  const now = Object.keys(staleSignal()).sort(), k = now.join('\n');
  if (k !== staleKey) {
    const before = new Set(staleKey ? staleKey.split('\n') : []), fresh = now.filter((id) => !before.has(id));
    staleKey = k; scheduleRecompute();
    if (fresh.length) emitEvent('stale', { ids: fresh });   // 新过期的说明(和脚本节点的 on=stale 同一个意思)
  }
}
function rebuildIssues() {
  issueByNode = new Map();
  for (const i of data.issues) for (const id of i.nodes) {
    const cur = issueByNode.get(id);
    if (!cur || i.severity === 'error' || (i.severity === 'warn' && cur !== 'error')) issueByNode.set(id, i.severity);
  }
}

function buildUniverse(snap) {
  const u = { nodes: new Map(), edges: new Map() };
  for (const n of snap.nodes) u.nodes.set(n.id, n);
  for (const e of snap.edges) u.edges.set(edgeKey(e.from, e.type, e.to), e);
  return u;
}
