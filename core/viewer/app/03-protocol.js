// ---------- 数据接入 ----------
function connect() {
  if (window.__STARS_STATIC__) { // 静态导出:数据内嵌,没有服务器
    document.body.classList.add('static');
    ingest(window.__STARS_STATIC__);
    $('status').innerHTML += ' · <b>静态导出(只读)</b>';
    return;
  }
  if (es) es.close();
  es = new EventSource(withP('/events'));
  es.onmessage = (ev) => handle(JSON.parse(ev.data));
  es.onerror = () => { $('status').textContent = '连接断开,重连中…'; };
  // 个人设置 / 快捷键在别处改了(编辑器、别的标签页、stars ui):立即生效
  es.addEventListener('config', (ev) => { const m = JSON.parse(ev.data); adoptCfg(m.name, m); });
  // 看着的项目被关掉了(别的标签页、project --close):回到主项目
  es.addEventListener('closed', () => {
    if (!projectId) return;   // 自己关的、已经切回主项目了
    toast(`项目 ${esc(project ? project.name : '')} 已关闭,回到主项目`);
    api('/api/projects').then((r) => switchProject(r.open.find((x) => x.primary))).catch(() => { projectId = null; setHash(); connect(); });
  });
  // 遥控:stars ui <命令> → 在这里执行 → 把输出回报给服务端,由它交回 CLI
  es.addEventListener('ui', (ev) => {
    const m = JSON.parse(ev.data);
    exec(m.line, 'remote', (r) => { api('/api/ui-result', { id: m.id, ...r }).catch(() => { /* CLI 已经不等了 */ }); }, m.from);
  });
}

// ---------- 增量协议:snapshot 一次,之后只收新增的日志条目(ops)与实时信号(signals) ----------
let lastN = 0, staleLive = false, recomputeTimer = null, lastCompile = 100;
// 等日志推回来:写命令在查看器里应用了这一条才算完成,这样脚本 / 页面写完马上读(graph、show)就能看到自己写的
const appliedWaiters = [];
const waitApplied = (n) => (lastN >= n ? Promise.resolve() : new Promise((ok) => { const w = { n, ok }; appliedWaiters.push(w); setTimeout(() => { const i = appliedWaiters.indexOf(w); if (i >= 0) appliedWaiters.splice(i, 1); ok(); }, 3000); }));
function wakeApplied() { for (let i = appliedWaiters.length - 1; i >= 0; i--) if (appliedWaiters[i].n <= lastN) appliedWaiters.splice(i, 1)[0].ok(); }
function handle(m) {
  if (m.type === 'draft') { setDraft(m.entries || []); return; }
  if (m.type === 'run') { onRun(m); return; }
  if (m.type === 'ops' || m.type === 'signals' || m.type === 'issues') {
    if (replay) { staleLive = true; return; } // 回放中:实时更新先不动画面,退出回放时重新同步
    if (m.type === 'ops') return applyOps(m.entries);
    if (m.type === 'signals') return applySignals(m);
    data.issues = m.issues; onIssues();
    return;
  }
  ingest(m);
}
function resync() { if (es) es.close(); connect(); }   // 日志出现缺口等不一致:重新连接,服务端会先发一份完整快照
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
  if (done.length) bridgeEmit('change', { n: lastN, ops: done.map((e) => ({ n: e.n, author: e.author, t: e.t, op: e.op })) });
  wakeApplied();
}
function applySignals(m) {
  if (fp && fp.handler === 'html' && m.changed && Object.keys(m.changed).some((id) => id !== fp.id || !fp.opts.live)) htmlRefreshSoon();   // 页面引用的 css / js 改了
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
  const k = Object.keys(staleSignal()).sort().join('\n');
  if (k !== staleKey) { staleKey = k; scheduleRecompute(); }
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
