let replay = null, liveSnap = null;   // 回放中:不应用实时更新,只记下最新的
function ingest(snap) {
  if (snap.project && !onProject(snap.project)) return;
  if (snap.error) { banner(snap.error); return; }
  liveSnap = snap;
  lastN = snap.n || 0; staleLive = false;
  draft = snap.draft || [];
  renderDraftBar();
  if (replay) return;
  applyData(snap);
  bridgeEmit('change', { n: lastN, reset: true });   // 整份重新载入(重连、切项目……)
  wakeApplied();
  if (!$('editor').hidden && !editorDirty) loadEditor(false);
}

/** live = false:回放里的历史快照(实时的宇宙 liveU 不动) */
function applyData(snap, live = true) {
  data = snap;
  uni = buildUniverse(snap);
  if (live) { liveU = uni; if (draftOn) { previewDraft(); data.nodes = [...uni.nodes.values()]; data.edges = [...uni.edges.values()]; } }
  raw.clear();
  for (const n of data.nodes) raw.set(n.id, n);
  const lv = listViews(uni);
  specs = lv.specs; viewErrors = Object.values(lv.errors); viewNames = Object.keys(specs);
  if (!specs[currentView]) currentView = viewNames[0];

  issueByNode = new Map();
  for (const i of snap.issues) for (const id of i.nodes) {
    const cur = issueByNode.get(id);
    if (!cur || i.severity === 'error' || (i.severity === 'warn' && cur !== 'error')) issueByNode.set(id, i.severity);
  }
  if (fresh && !replay) restorePlace();
  recompute();
  known = new Set(snap.nodes.map((n) => n.id));
  if (fresh) { fresh = false; userMoved = false; setTimeout(fit, 900); setTimeout(() => { if (!userMoved) fit(); }, 3600); }
}

/**
 * 视图 = f(宇宙, 规格, 展开状态)。
 * structural=true:宇宙/规格/信号变了,重新编译(算好所有节点的外观,较贵);
 * structural=false:只是展开/收起,复用编译结果,只做折叠(很便宜,10 万节点也在 ~20ms)。
 */
let compiled = null;
const perf = { compileMs: 0, foldMs: 0, frameMs: 0, regionsMs: 0, edgesMs: 0, nodesMs: 0, labelsMs: 0 };
// 体积半径:目录和文件用同一套体积公式(同 scale、同 range);目录仍按 contains 汇总子孙字节数。「归一化」决定池子:
//   合一 = 合并成一条规则(rollup 会连节点自己的 size 一起加,所以文件的汇总就是它自己),同样字节数必得同样半径;
//   分开 = 各条规则在各自命中的节点里归一化,各自用满区间。
function withVolume(spec) {
  if (!(P.volRadius > 0) || !spec || !Array.isArray(spec.size)) return spec;
  const scale = P.volMap === 'log' || P.volMap === 'linear' ? P.volMap : 'sqrt';
  const lo = Number(P.volMin), hi = Number(P.volMax);
  const range = hi > lo ? [lo, hi] : [2, 16];
  const sized = spec.size.filter((r) => r && r.attr === 'size');
  const whens = sized.map((r) => r.when);
  // 只在原规则能约成"哪些 type"时才合并;认不出来就退回分开,免得把 degree 兜底也吃掉
  if (P.volPool === '合一' && sized.length && whens.every((w) => w && typeof w === 'object' && typeof w.type === 'string')) {
    const types = [...new Set(whens.map((w) => w.type))];
    const rollup = (sized.find((r) => r.rollup) || {}).rollup ?? { relation: (spec.expand && spec.expand.relation) || 'contains', op: 'sum' };
    const rest = spec.size.filter((r) => !(r && r.attr === 'size'));
    return { ...spec, size: [{ when: types.map((t) => 'type == ' + JSON.stringify(t)).join(' || '), attr: 'size', rollup, scale, range }, ...rest] };
  }
  return { ...spec, size: spec.size.map((r) => (r && r.attr === 'size') ? { ...r, scale, range } : r) };
}
function recompute(structural = true) {
  if (!uni) return;
  banner(viewErrors.length ? viewErrors.join(';') : null);
  const opened = [], shut = [];
  const ids = new Set([...auto.keys(), ...manual.keys()]);
  for (const id of ids) { const v = manual.has(id) ? manual.get(id) : auto.get(id); (v ? opened : shut).push(id); }
  const t0 = performance.now();
  if (structural || !compiled) {
    const base = draftSpec ?? specs[currentView];
    const spec0 = base.layout === 'spaces' && hiddenTypes.size // 空间模式下,类型过滤交给内核(被隐藏的容器是"透明"的)
      ? { ...base, select: { ...(base.select || {}), hideTypes: [...((base.select && base.select.hideTypes) || []), ...hiddenTypes] } } : base;
    const spec = withVolume(spec0);
    try { compiled = compileView(uni, spec, { signals: { ...(data.signals || {}), stale: staleSignal() }, now: Date.now() }); }
    catch (err) { banner('视图无法编译: ' + err.message); return; }
  }
  const t1 = performance.now();
  if (compiled.layout === 'spaces') {
    if (structural) lastCompile = t1 - t0;
    perf.compileMs = lastCompile;
    spaceVer++;                                   // 空间按需重建,保留已有位置
    if (curSpaceId !== null && !compiled.node(curSpaceId)) curSpaceId = null;
    pruneSelection();   // 空间模式:别的空间里选中的照样留着(可以跨空间多选),只去掉已经不在的
    for (const id of [...expandedSet]) if (!compiled.node(id)) expandedSet.delete(id);
    scene = { look: compiled.look, nodes: [], edges: [], expand: { relation: 'contains' } };
    look = compiled.look;
    links = []; drawNodes = []; regions = []; sim.clear();
    simulation.nodes([]); simulation.force('link').links([]); simulation.stop();
    zoom.scaleExtent([0.02, 80]);
    computeMatches();
    renderViews(); renderChips(); renderSide(); renderLegend(); renderReview();
    layoutPanels(); renderStatus(); renderCrumbs(); $('tagbar').hidden = true;
    return;
  }
  zoom.scaleExtent([0.08, 10]);
  simulation.restart();
  $('crumbs').hidden = true;
  scene = compiled.fold({ expanded: opened, collapsed: shut });
  if (structural) computeMatches();   // 保存的查询、表达式过滤的结果跟着宇宙变
  if (structural) lastCompile = t1 - t0;
  perf.compileMs = structural ? t1 - t0 : perf.compileMs; perf.foldMs = performance.now() - t1;
  look = scene.look;
  edgeColors = new Map(scene.edges.map((e) => [`${e.from}|${e.type}|${e.to}`, e.color]));

  const seen = new Set();
  for (const sn of scene.nodes) {
    seen.add(sn.id);
    let n = sim.get(sn.id);
    if (!n) { n = { id: sn.id, x: undefined, y: undefined, born: (fresh || known.has(sn.id) || !known.size) ? 0 : performance.now(), phase: Math.random() * TAU }; sim.set(sn.id, n); }
    for (const k of ['parent', 'container', 'expanded', 'descendants', 'children', 'kids', 'value']) n[k] = undefined;
    Object.assign(n, sn);
    n.rgb = hex2rgb(sn.color);
    n.core = mix(n.rgb, [255, 255, 255], 0.65);
    n.dot = mix(n.rgb, [255, 255, 255], 0.25);
    n.kidRgb = sn.kids ? sn.kids.map(([c, r, id]) => [hex2rgb(c), r, id]) : null;
    n.tilt = (n.phase - 3) * 0.3;
  }
  for (const id of [...sim.keys()]) if (!seen.has(id)) sim.delete(id);
  layoutTags([...sim.values()]);
  // 新出现的节点:出生在父容器/邻居旁边(展开时像从容器里涌出);有 tag 锚点的直接出生在锚点上
  for (const n of sim.values()) {
    if (n.x !== undefined) continue;
    if (n.tx !== undefined) { n.x = n.tx; n.y = n.ty; n.vx = 0; n.vy = 0; continue; }
    const p = n.parent && sim.get(n.parent);
    const e = scene.edges.find((e) => (e.from === n.id && sim.get(e.to)?.x !== undefined) || (e.to === n.id && sim.get(e.from)?.x !== undefined));
    const nb = p && p.x !== undefined ? p : e ? sim.get(e.from === n.id ? e.to : e.from) : null;
    const a = Math.random() * TAU, d = (nb ? nb.r * 1.2 : 10) + 12 + Math.random() * 20;
    n.x = (nb ? nb.x : 0) + Math.cos(a) * d; n.y = (nb ? nb.y : 0) + Math.sin(a) * d;
    if (nb) { n.vx = 0; n.vy = 0; }
  }
  if (selected && !sim.has(selected) && !(selected.startsWith('~') && raw.has(selected))) selected = null;   // 模式节点(脚本、类型……)不在图上,选中了就一直选着
  pruneSelection((id) => sim.has(id) || (id.startsWith('~') && raw.has(id)));

  rebuildGraph();
  renderViews(); renderChips(); renderSide(); renderLegend(); renderReview(); renderTagbar();
  layoutPanels();
  renderStatus();
}

const selTail = () => (selection.size > 1 ? ` · <span data-cmd="select" style="cursor:pointer" title="点一下取消选择">已选 <b>${selection.size}</b></span>` : '');
function renderStatus() {
  const nn = data.nodes.filter((n) => !n.id.startsWith('~')).length;
  const ne = data.issues.filter((i) => i.severity === 'error').length, nw = data.issues.filter((i) => i.severity === 'warn').length;
  // 只在有问题时才显示错误/警告数(点一下看详情 = lint 命令)
  const tail = (ne || nw ? ` · <span data-cmd="lint" style="cursor:pointer" title="看详情(lint)">${ne ? `<span class="sev-error">${ne} 错误</span>` : ''}${ne && nw ? ' ' : ''}${nw ? `<span class="sev-warn">${nw} 警告</span>` : ''}</span>` : '')
    + (data.watching ? ' · <b style="color:#7be0a0" title="文件夹的变化实时同步进宇宙">● 同步</b>' : '');
  if (isSpaces()) {
    const sp = getSpace(curSpaceId);
    $('status').innerHTML = `<b>${esc(curSpaceId === null ? '宇宙' : (raw.get(curSpaceId)?.label || curSpaceId))}</b> · ${sp.nodes.length} 项 · 共 ${nn} 节点`
      + (expandedSet.size ? ` · ${expandedSet.size} 个展开` : '') + selTail() + tail;
    return;
  }
  const folded = scene.nodes.filter((n) => n.container && !n.expanded).length;
  $('status').innerHTML = `<b>${scene.nodes.length}</b>/${nn} 节点 · <b>${scene.edges.length}</b> 边` + (folded ? ` · ${folded} 个收起` : '') + selTail() + tail;
}

const typeOf = (id) => (raw.get(id)?.attrs.type) || '(无类型)';
const visible = (n) => !hiddenTypes.has(typeOf(n.id));

function rebuildGraph() {
  const vis = [...sim.values()].filter(visible);
  const ids = new Set(vis.map((n) => n.id));
  const deg = new Map();
  links = scene.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ ...e, source: e.from, target: e.to }));
  // 域:每个展开的容器 + 它所有可见的后代
  const kidsOf = new Map();
  for (const n of vis) if (n.parent && ids.has(n.parent)) kidsOf.set(n.parent, [...(kidsOf.get(n.parent) || []), n]);
  const byId = new Map(vis.map((n) => [n.id, n]));
  regions = [];
  for (const n of vis) {
    if (!n.container || !n.expanded || !kidsOf.has(n.id)) continue;
    const members = [], stack = [...kidsOf.get(n.id)];
    while (stack.length) { const m = stack.pop(); members.push(m); stack.push(...(kidsOf.get(m.id) || [])); }
    const ancestors = new Set();
    for (let p = n.parent; p && byId.has(p); p = byId.get(p).parent) ancestors.add(p);
    regions.push({ id: n.id, node: n, members: [n, ...members], ancestors, cx: n.x, cy: n.y, rad: 40 });
  }
  regions.sort((a, b) => b.members.length - a.members.length);
  drawNodes = [...vis.filter((n) => n.shape === 'nebula'), ...vis.filter((n) => n.shape !== 'nebula')];
  simulation.nodes(vis);
  simulation.force('link').links(links);
  simulation.alpha(0.5).restart();
}

function banner(msg) {
  const b = $('banner');
  b.style.display = msg ? 'block' : 'none';
  b.textContent = msg ? '⚠ ' + msg : '';
}
