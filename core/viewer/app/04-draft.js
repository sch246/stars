// ---------- 草稿:批量改动的预览(见 core/src/draft.ts)----------
// 草稿在 <宇宙文件>.draft 里(stars --draft …、stars run --draft …写进去);预览时 uni 是"应用之后"的那份,
// 实时更新照样落在 liveU 上,每次重新叠一遍草稿。记号:新增绿、修改橙、删除红(删掉的节点留在原位,看得见)。
let draft = [], draftOn = false, draftMark = null, liveU = null;
/** 回放 / 草稿预览时节点身上的记号颜色 */
function diffRing(id) {
  const m = replay || draftMark;
  if (!m) return null;
  if (m.added.has(id)) return 'rgba(123,224,160,.95)';
  if (m.changed.has(id)) return 'rgba(255,179,71,.95)';
  if (m.removed instanceof Set && m.removed.has(id)) return 'rgba(255,90,110,.95)';
  return null;
}
/** 预览:uni = liveU 叠上草稿(调用方负责刷新 data / raw / 画面) */
function previewDraft() {
  if (!liveU) return;
  if (!draftOn || !draft.length) { draftOn = false; draftMark = null; uni = liveU; return; }
  draftMark = draftPreview(liveU, draft);
  uni = draftMark.u;
}
/** uni 换了(进出预览、草稿变了):把 data / raw / 视图列表和画面跟上 */
function refreshFromUni() {
  data.nodes = [...uni.nodes.values()]; data.edges = [...uni.edges.values()];
  raw.clear(); for (const n of data.nodes) raw.set(n.id, n);
  const lv = listViews(uni); specs = lv.specs; viewErrors = Object.values(lv.errors); viewNames = Object.keys(specs);
  if (!specs[currentView]) currentView = viewNames[0];
  if (selected && !raw.has(selected)) selected = null;
  pruneSelection();
  recompute(true);
  renderDraftBar(); renderSide();
}
function setDraft(entries) {
  draft = entries;
  if (liveSnap) liveSnap.draft = entries;
  if (draftOn && !replay) { previewDraft(); refreshFromUni(); }
  else renderDraftBar();
  if (!draftOn && !selected) renderSide();
}
function enterDraft() {
  if (!draft.length) return false;
  if (replay) exitReplay();
  draftOn = true; previewDraft(); refreshFromUni();
  return true;
}
function exitDraft() {
  if (!draftOn) return false;
  draftOn = false; draftMark = null; uni = liveU || uni;
  refreshFromUni();
  return true;
}
function renderDraftBar() {
  const el = $('draftbar');
  if (!el) return;
  if (!draft.length || replay) { el.hidden = true; return; }
  el.hidden = false;
  const live = !window.__STARS_STATIC__, authors = [...new Set(draft.map((e) => e.author))].join('、');
  const m = draftMark;
  el.innerHTML = draftOn && m
    ? `<b>草稿预览</b><span>${draft.length} 条 · ${esc(authors)}</span>`
      + `<span style="color:#7be0a0">+${m.added.size}</span><span style="color:#ffb347">~${m.changed.size}</span><span style="color:#ff7a90">−${m.removed.size}</span>`
      + `<span class="tag">边 +${m.addedEdges} −${m.removedEdges}</span>`
      + (m.failed.length ? `<span class="sev-error">${m.failed.length} 条现在做不了</span>` : '')
      + (live ? `<span class="btn pri" data-cmd="draft apply" title="整批作为一次提交落进宇宙;之后 undo 一步撤回">应用</span><span class="btn" data-cmd="draft drop">丢弃</span>` : '')
      + `<span class="btn" data-cmd="draft exit">退出预览 (Esc)</span>`
    : `<b>草稿</b><span>${draft.length} 条改动还没落进宇宙 · ${esc(authors)}</span><span class="btn pri" data-cmd="draft preview">预览</span>`
      + (live ? `<span class="btn" data-cmd="draft apply">应用</span><span class="btn" data-cmd="draft drop">丢弃</span>` : '');
}
/** 草稿改了这个节点的哪些属性:旧 → 新 */
function draftChanges(id) {
  const a = liveU && liveU.nodes.get(id), b = uni.nodes.get(id);
  if (!a || !b) return '';
  const rows = [];
  if (a.label !== b.label) rows.push(['标签', a.label, b.label]);
  for (const k of new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)])) if (a.attrs[k] !== b.attrs[k]) rows.push([k, a.attrs[k], b.attrs[k]]);
  return rows.map(([k, x, y]) => `<div class="row"><span class="tag">${esc(k)}</span><span style="color:#ff9fae;text-decoration:line-through">${esc(x ?? '(无)')}</span><span>→</span><span style="color:#9fe6b8">${esc(y ?? '(删去)')}</span></div>`).join('');
}
/** 预览时什么都没选中:侧栏列出草稿里的每一条 */
function draftPanel() {
  const m = draftMark, bad = new Map(m.failed.map((f) => [f.i, f.error])), live = !window.__STARS_STATIC__;
  const rows = draft.map((e, i) => {
    const id = draftNodeOf(e.op);
    return `<div class="row ${id && raw.has(id) ? 'link' : ''}" ${id && raw.has(id) ? `data-id="${esc(id)}"` : ''}><span class="tag">${i + 1}</span><span ${bad.has(i) ? 'class="sev-error"' : ''}>${esc(draftSummary(e.op))}</span>`
      + (bad.has(i) ? `<span class="sev-error" title="${esc(bad.get(i))}">做不了</span>` : '')
      + (live ? `<span class="mini no" data-draftdrop="${i + 1}" title="从草稿里去掉这一条">✗</span>` : '') + '</div>'
      + (bad.has(i) ? `<div class="row sev-error" style="opacity:.8;padding-left:22px">${esc(bad.get(i))}</div>` : '');
  }).join('');
  return `<h3>草稿 · ${draft.length} 条改动</h3>
    <div class="sub">${esc([...new Set(draft.map((e) => e.author))].join('、'))} · 应用之后 +${m.added.size} 节点 ~${m.changed.size} −${m.removed.size} · 边 +${m.addedEdges} −${m.removedEdges}</div>
    <div class="sec"><div class="t">图上的记号</div><div class="row"><span style="color:#7be0a0">○ 新增</span><span style="color:#ffb347">○ 修改</span><span style="color:#ff7a90">○ 删除(还留在原位)</span></div></div>
    <div class="sec"><div class="t">改动</div>${rows}</div>
    ${live ? `<div class="btns"><span class="btn pri" data-cmd="draft apply">整批应用(一次提交,undo 一步撤回)</span><span class="btn" data-cmd="draft drop">全部丢弃</span></div>` : ''}`;
}
