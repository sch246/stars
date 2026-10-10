// ---------- 视图规则编辑器:改 JSON,即时预览,保存后写进宇宙 ----------
const ta = $('ed-text'), msg = $('ed-msg');
const isCustom = (name) => !!(uni && uni.nodes.has('~view/' + name));
function loadEditor(clearMsg = true) {
  if (!specs[currentView]) return;
  ta.value = JSON.stringify(specs[currentView], null, 2);
  $('ed-name').textContent = currentView + (isCustom(currentView) ? '' : '(内置)');
  draftSpec = null; editorDirty = false; if (clearMsg) msg.innerHTML = '';
}
function layoutPanels() { const b = $('tools').getBoundingClientRect().bottom + 10; for (const id of ['editor', 'review', 'projects', 'physics']) { $(id).style.top = b + 'px'; $(id).style.maxHeight = `calc(100vh - ${b + 30}px)`; } }
addEventListener('resize', () => { layoutPanels(); updateCrumbWidth(); });
// 面板的开关都是命令(panel <名字>),键位见「命令」一节的 KEYMAP
function togglePanel(id, on) {
  const el = $(id); if (!el) return;
  el.hidden = on === undefined ? !el.hidden : !on;
  updateCrumbWidth();
}
function toggleEditor(on) {
  if (on && typeof toggleReview === 'function' && !$('review').hidden) { $('review').hidden = true; $('btn-review').classList.remove('on'); }
  if (on) { $('projects').hidden = true; togglePhysics(false); }
  layoutPanels();
  $('editor').hidden = !on; $('btn-edit').classList.toggle('on', on);
  if (on) loadEditor(); else if (draftSpec) { draftSpec = null; editorDirty = false; recompute(); }
}
ta.addEventListener('input', debounce(() => {
  let spec;
  try { spec = JSON.parse(ta.value); } catch (e) { msg.innerHTML = `<span class="bad">JSON 有误:${esc(e.message)}</span>`; return; }
  const problems = validateSpec(spec, uni);
  if (problems.length) { msg.innerHTML = problems.map((p) => `<span class="bad">${esc(p)}</span>`).join(''); return; }
  draftSpec = spec; editorDirty = true;
  msg.innerHTML = '<span class="ok">✓ 规格有效,已预览(尚未保存)</span>';
  recompute();
}, 250));
async function saveView(name) {
  if (!/^[\w-]+$/.test(name)) { msg.innerHTML = '<span class="bad">视图名只能含字母、数字、_ 和 -</span>'; return; }
  const spec = draftSpec || specs[currentView];
  const id = '~view/' + name, compact = JSON.stringify(spec);
  const op = uni.nodes.has(id) ? { op: 'setNode', id, set: { spec: compact } } : { op: 'addNode', id, label: name, attrs: { kind: 'view', spec: compact } };
  try {
    const r = await api('/api/op', { op, author: 'viewer' });
    currentView = name; draftSpec = null; editorDirty = false; setHash();
    msg.innerHTML = `<span class="ok">✓ 已写入宇宙(操作 #${r.n}),可用 stars view ${esc(name)} 查看</span>`;
  } catch (e) { msg.innerHTML = `<span class="bad">保存失败:${esc(e.message)}</span>`; }
}
$('ed-save').addEventListener('click', () => saveView(currentView));
$('ed-saveas').addEventListener('click', () => { const n = $('ed-as').value.trim(); if (n) saveView(n); });
$('ed-revert').addEventListener('click', () => { loadEditor(); recompute(); });
$('ed-del').addEventListener('click', async () => {
  if (!isCustom(currentView)) { msg.innerHTML = '<span class="bad">内置视图不能删除(可以保存一个同名自定义视图来覆盖它)</span>'; return; }
  try { await api('/api/op', { op: { op: 'removeNode', id: '~view/' + currentView }, author: 'viewer' }); msg.innerHTML = '<span class="ok">已删除</span>'; } catch (e) { msg.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
});

  // ---------- 审阅:接受/拒绝 AI(或别人、或页面)提议的节点和边;把汇总出来的边提升为真边 ----------
const edgeKeyOf = (e) => `${e.from}|${e.type}|${e.to}`;
/** 待确认的:先节点后边(节点在 id 上区分:边没有 id) */
const proposed = () => [...data.nodes.filter((n) => n.attrs.status === 'proposed'), ...data.edges.filter((e) => e.attrs.status === 'proposed')];
const propKeyOf = (x) => (x.id !== undefined ? nodeProposalKey(x.id) : edgeKeyOf(x));
/** 一批接受 / 拒绝:拒绝时先删边再删节点(删节点会连带它的边,反过来做就会删两次) */
const batchOps = (list, fn) => ({ op: 'batch', ops: [...list.filter((x) => x.id === undefined), ...list.filter((x) => x.id !== undefined)].map(fn) });
const rvMsg = (t, bad) => { $('rv-msg').style.color = bad ? 'var(--warn)' : 'var(--muted)'; $('rv-msg').textContent = t; };
async function write(op, okText, author = 'viewer') {
  try { const r = await api('/api/op', { op, author }); rvMsg(`${okText}(操作 #${r.n},可撤销)`); }
  catch (e) { rvMsg('写入失败:' + e.message, true); }
}
const acceptOp = (e) => (e.id !== undefined ? { op: 'setNode', id: e.id, unset: ['status'] } : { op: 'setEdge', from: e.from, type: e.type, to: e.to, unset: ['status'] });
const rejectOp = (e) => (e.id !== undefined ? { op: 'removeNode', id: e.id } : { op: 'removeEdge', from: e.from, type: e.type, to: e.to });
function renderReview() {
  const list = proposed(), props = data.proposals || {};
  $('rv-badge').hidden = list.length === 0; $('rv-badge').textContent = list.length;
  $('btn-review').style.opacity = list.length || !$('review').hidden ? 1 : 0.55; // 没有待确认的提议时淡一点
  if ($('review').hidden) return;
  $('rv-sub').textContent = list.length ? `${list.length} 条等待确认` : '没有待确认的了';
  $('rv-list').innerHTML = list.map((e, i) => {
    const who = props[propKeyOf(e)];
    const what = e.id !== undefined
      ? `<span style="color:#ffd24a">＋</span> <span style="color:#dfe3ff">${esc(e.label)}</span> <span class="tag">${esc(e.id)}${e.attrs.type ? ' · ' + esc(e.attrs.type) : ''}</span>`
      : `<span style="color:#dfe3ff">${esc(raw.get(e.from)?.label || e.from)}</span> <span style="color:${edgeColors.get(edgeKeyOf(e)) || '#ffd24a'}">—${esc(e.type)}→</span> <span style="color:#dfe3ff">${esc(raw.get(e.to)?.label || e.to)}</span>`;
    return `<div class="rv-row"><div class="t" data-i="${i}">${what}`
      + `<div class="who">${who ? esc(who.author) + ' · ' + ago(who.t) : '来源未知'}</div></div>`
      + `<div class="acts"><span class="mini ok" data-ok="${i}" title="接受">✓</span><span class="mini no" data-no="${i}" title="${e.id !== undefined ? '拒绝(删除这个节点和它的边)' : '拒绝(删除这条边)'}">✗</span></div></div>`;
  }).join('') || '<div class="tag" style="padding:8px">🎉 都处理完了</div>';
  $('rv-all').style.opacity = $('rv-none').style.opacity = list.length ? 1 : 0.4;
}
function toggleReview(on) {
  if (on) { toggleEditor(false); $('projects').hidden = true; togglePhysics(false); }
  $('review').hidden = !on; $('btn-review').classList.toggle('on', on);
  if (on) { layoutPanels(); renderReview(); }
}
$('rv-list').addEventListener('click', (ev) => {
  const list = proposed(); const t = ev.target.closest('[data-i],[data-ok],[data-no]'); if (!t) return;
  if (t.dataset.ok !== undefined) write(acceptOp(list[+t.dataset.ok]), '已接受');
  else if (t.dataset.no !== undefined) write(rejectOp(list[+t.dataset.no]), '已拒绝并删除');
  else { const e = list[+t.dataset.i]; select(e.id ?? e.from, true); }
});
// 面板里单条边的操作(节点详情里的 proposed 边;收起容器里的汇总边)
$('side').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  ev.stopPropagation();
  const e = b.dataset.from === undefined && b.dataset.id !== undefined ? { id: b.dataset.id } : { from: b.dataset.from, type: b.dataset.type, to: b.dataset.to };
  if (b.dataset.act === 'enter' || b.dataset.act === 'inplace') { if (b.dataset.act === 'enter') { if (!enterSpace(b.dataset.id, true)) jumpTo(b.dataset.id); } else toggleExpandSpace(b.dataset.id); return; }
  if (b.dataset.act === 'accept') write(acceptOp(e), '已接受');
  else if (b.dataset.act === 'reject') write(rejectOp(e), '已拒绝');
  else if (b.dataset.act === 'enter') { if (!enterSpace(b.dataset.id)) jumpTo(b.dataset.id); }
  else if (b.dataset.act === 'inplace') toggleExpandSpace(b.dataset.id);
  else if (b.dataset.act === 'promote') write({ op: 'addEdge', ...e, attrs: { note: `由 ${b.dataset.count} 条内部关系汇总提升` } }, '已提升为真边');
  else if (b.dataset.act === 'seen-diff') showSeenDiff(b.dataset.id);
  else if (b.dataset.act === 'stamp') stampNodes([b.dataset.id]).then((r) => toast(r.stamped.length ? '已记下文件现在的版本' : '没记上:节点没指向文件,或文件不在', !r.stamped.length)).catch((err) => toast('没记上:' + esc(err.message), true));
}, true);
