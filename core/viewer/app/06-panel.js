// ---------- 面板 ----------
function renderViews() {
  $('views').innerHTML = viewNames.map((v, i) => `<span class="vbtn ${v === currentView ? 'on' : ''}" data-v="${esc(v)}" data-cmd="view ${esc(quoteArg(v))}" title="按 ${i + 1}">${esc(v)}</span>`).join('');
}
function setView(v) {
  if (!v || v === currentView) return;
  currentView = v; setHash(); fresh = true; selected = null; hiddenTypes.clear(); manual.clear(); auto.clear();
  curSpaceId = null; expandedSet.clear(); fade = null; spaces.clear(); activeTags.clear(); zoomFocusId = null;
  restorePlace();   // 每个视图记着自己的位置
  for (const n of sim.values()) n.born = 0;
  recompute();
  fresh = false; userMoved = false; setTimeout(fit, 900); setTimeout(() => { if (!userMoved) fit(); }, 3600);
}

function renderTagbar() {
  const el = $('tagbar');
  const counts = new Map(), colorOf = new Map();
  if (!isSpaces()) for (const n of scene.nodes) for (const t of n.tags || []) { counts.set(t, (counts.get(t) || 0) + 1); if (!colorOf.has(t)) colorOf.set(t, n.color); }
  if (!counts.size) { el.hidden = true; return; }
  el.hidden = false;
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 60);
  const labelCount = new Map();
  for (const [t] of top) { const l = raw.get(t)?.label || t; labelCount.set(l, (labelCount.get(l) || 0) + 1); }
  const nameOf = (t) => { const l = raw.get(t)?.label || t; return labelCount.get(l) > 1 ? t.replace(/\/$/, '') : l; }; // 同名时显示路径
  tagColor = colorOf;
  el.innerHTML = `<span class="tag" style="font-size:11px">tag</span>` + top.map(([t, c]) => {
    const col = colorOf.get(t) || '#888';
    return `<span class="tagc ${activeTags.has(t) ? 'on' : ''}" data-tag="${esc(t)}" data-cmd="tag ${esc(quoteArg(t))}" title="${esc(t)}"><i style="background:${col}"></i>${esc(nameOf(t))}<span class="c">${c}</span></span>`;
  }).join('') + (activeTags.size ? `<span class="tagc" data-tag="" data-cmd="tag">清除</span>` : '');
}
function toggleTag(t) {
  if (!t) activeTags.clear(); else if (activeTags.has(t)) activeTags.delete(t); else activeTags.add(t);
  renderTagbar(); renderSide();
}

function renderChips() {
  const counts = new Map(), sample = new Map();
  if (isSpaces()) {
    for (const n of data.nodes) { if (n.id.startsWith('~')) continue; const t = typeOf(n.id); counts.set(t, (counts.get(t) || 0) + 1); if (!sample.has(t)) sample.set(t, compiled.node(n.id) || { color: '#888' }); }
  } else for (const n of sim.values()) { const t = typeOf(n.id); counts.set(t, (counts.get(t) || 0) + 1); sample.set(t, n); }
  $('types-badge').hidden = !hiddenTypes.size; $('types-badge').textContent = hiddenTypes.size ? '−' + hiddenTypes.size : '';
  $('chips').innerHTML = [...counts].sort((a, b) => b[1] - a[1]).map(([t, c]) =>
    `<span class="chip ${hiddenTypes.has(t) ? '' : 'on'}" data-t="${esc(t)}" data-cmd="type ${esc(quoteArg(t))} toggle"><i style="background:${sample.get(t).color}"></i>${esc(t)} ${c}</span>`).join('');
}
function setTypeShown(t, on) {
  if (on) hiddenTypes.delete(t); else hiddenTypes.add(t);
  if (isSpaces()) recompute(true); else { rebuildGraph(); renderChips(); }
}

const fmtBytes = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B');
const summ = (e) => {
  if (e.undoOf) return `撤销 #${e.undoOf}`;
  const o = e.op;
  switch (o.op) {
    case 'addNode': return `+ 节点 ${o.id}`; case 'removeNode': return `- 节点 ${o.id}`; case 'setNode': return `~ 节点 ${o.id}`;
    case 'addEdge': return `+ ${o.from} ${o.type} ${o.to}`; case 'removeEdge': return `- ${o.from} ${o.type} ${o.to}`;
    case 'setEdge': return `~ ${o.from} ${o.type} ${o.to}`; case 'batch': return `批量 ×${o.ops.length}`;
  }
  return o.op;
};

function renderSide() {
  const el = $('side-info');
  const n = selected && raw.get(selected);
  syncFile(n || null);
  const sn = selected && (isSpaces() ? compiled.node(selected) : sim.get(selected));
  if (!n && draftOn && draftMark) { el.innerHTML = draftPanel(); return; }
  if (!n && qActive && compiled) {
    const r = compiled.queryResults().find((x) => x.name === qActive);
    if (r) { el.innerHTML = queryPanel(r); return; }
  }
  if (!n) {
    const feed = data.log.slice().reverse().slice(0, 14).map((e) =>
      `<div class="row"><span class="tag">#${e.n}</span><span class="author">${esc(e.author)}</span><span>${esc(summ(e))}</span></div>`).join('');
    const groups = new Map();
    for (const i of data.issues.filter((i) => i.severity !== 'info')) {
      const g = groups.get(i.rule) || { sev: i.severity, items: [] };
      g.items.push(i); groups.set(i.rule, g);
    }
    const issues = [...groups].map(([rule, g]) => g.items.length <= 3
      ? g.items.map((i) => `<div class="row sev-${g.sev}">${esc(i.message)}</div>`).join('')
      : `<div class="row sev-${g.sev}"><b>${g.items.length} × ${esc(rule)}</b></div><div class="row sev-${g.sev}" style="opacity:.7">例如 ${esc(g.items[0].message)}</div>`).join('');
    el.innerHTML = `<h3>日志</h3>`
      + (issues ? `<div class="sec"><div class="t">需要关注</div>${issues}</div>` : '')
      + `<div class="sec"><div class="t">最近变更</div>${feed || '<span class="tag">暂无</span>'}</div>`;
    return;
  }
  const out = data.edges.filter((e) => e.from === n.id), inn = data.edges.filter((e) => e.to === n.id);
  const attrs = Object.entries(n.attrs).filter(([k]) => !['type', 'summary', 'seen'].includes(k))
    .map(([k, v]) => `<div class="row"><span class="tag">${esc(k)}</span><span>${esc(k === 'size' ? fmtBytes(+v) : v)}</span></div>`).join('');
  const edgeRow = (e, other, arrow) => `<div class="row link" data-id="${esc(other)}"><span class="tag">${arrow}</span>`
    + `<span style="color:${edgeColors.get(`${e.from}|${e.type}|${e.to}`) || '#8a8aa8'}">${esc(e.type)}</span><span>${esc(raw.get(other)?.label || other)}</span>`
    + (e.attrs.status === 'proposed' ? `<span class="sev-warn">待确认</span><span class="mini ok" data-act="accept" data-from="${esc(e.from)}" data-type="${esc(e.type)}" data-to="${esc(e.to)}">✓</span><span class="mini no" data-act="reject" data-from="${esc(e.from)}" data-type="${esc(e.type)}" data-to="${esc(e.to)}">✗</span>` : (e.attrs.status ? `<span class="sev-warn">${esc(e.attrs.status)}</span>` : '')) + '</div>';
  const myIssues = data.issues.filter((i) => i.nodes.includes(n.id) && i.rule !== 'proposed' && i.rule !== 'stale');   // 待确认的上面已经有 ✓ ✗ 了(体检结果要等 1.5 秒才推,不用它);过期有自己的一栏
  el.innerHTML = `<h3 style="color:${sn ? sn.color : '#fff'}">${esc(n.label)}</h3>
    <div class="sub">${esc(n.id)}${n.attrs.type ? ' · ' + esc(n.attrs.type) : ''}${sn && sn.value !== undefined ? ' · 视图值 ' + esc(sn.value) : ''}</div>
    ${n.attrs.status === 'proposed' ? (() => { const who = (data.proposals || {})[nodeProposalKey(n.id)]; return `<div class="sec"><div class="row"><span class="sev-warn">待确认的节点</span><span>${who ? esc(who.author) + ' · ' + ago(who.t) : '来源未知'}</span><span class="mini ok" data-act="accept" data-id="${esc(n.id)}" title="接受">✓</span><span class="mini no" data-act="reject" data-id="${esc(n.id)}" title="拒绝(删除这个节点和它的边)">✗</span></div></div>`; })() : ''}
    ${draftMark ? (draftMark.added.has(n.id) ? '<div class="sec"><span style="color:#7be0a0">草稿里新增的节点(还没落进宇宙)</span></div>' : draftMark.removed.has(n.id) ? '<div class="sec"><span style="color:#ff7a90">草稿会删掉这个节点(连同它的边)</span></div>' : draftMark.changed.has(n.id) ? `<div class="sec"><span style="color:#ffb347">草稿会改它</span>${draftChanges(n.id)}</div>` : '') : ''}
    ${n.attrs.summary ? `<p>${esc(n.attrs.summary)}</p>` : ''}
    ${seenSection(n)}
    ${sn && sn.container ? (isSpaces()
      ? `<div class="sec"><div class="row"><span class="tag">空间</span><span>${sn.children} 个直接子项 · ${sn.descendants} 个后代${expandedSet.has(sn.id) ? ' · 已就地展开' : ''}${curSpaceId === sn.id ? ' · 你在这里' : ''}</span></div>`
        + `<div class="btns" style="margin-top:6px"><span class="btn pri" data-act="enter" data-id="${esc(sn.id)}">进入 ⏎</span><span class="btn" data-act="inplace" data-id="${esc(sn.id)}">${expandedSet.has(sn.id) ? '收起' : '就地展开'}(双击 / E)</span></div></div>`
      : `<div class="sec"><div class="row"><span class="tag">容器</span><span>${sn.expanded ? '已展开' : '已收起'} · ${sn.children} 个直接子节点 · ${sn.descendants} 个后代</span></div><div class="row"><span class="tag">操作</span><span>双击 或 <kbd>E</kbd> ${sn.expanded ? '收起' : '展开'}</span></div></div>`) : ''}
    ${sn && sn.tags && sn.tags.length ? `<div class="sec"><div class="t">tag</div><div style="display:flex;flex-wrap:wrap;gap:5px">${sn.tags.map((t) => `<span class="tagc ${activeTags.has(t) ? 'on' : ''}" data-sidetag="${esc(t)}"><i style="background:${tagColor.get(t) || '#888'}"></i>${esc(t.replace(/\/$/, ''))}</span>`).join('')}</div></div>` : ''}
    ${attrs ? `<div class="sec">${attrs}</div>` : ''}
    ${!replay && data.signals ? `<div class="sec"><div class="t">最近编辑</div><div class="row"><span class="tag">图里</span><span>${ago((data.signals.touched || {})[n.id])}</span></div>${(data.signals.fileChanged || {})[n.id] ? `<div class="row"><span class="tag">文件</span><span>${ago(data.signals.fileChanged[n.id])}</span></div>` : ''}</div>` : ''}
    ${out.length || !fileOf(n) ? `<div class="sec"><div class="t">出边 ${out.length}</div>${out.map((e) => edgeRow(e, e.to, '→')).join('') || '<span class="tag">无</span>'}</div>` : ''}
    ${inn.length || !fileOf(n) ? `<div class="sec"><div class="t">入边 ${inn.length}</div>${inn.map((e) => edgeRow(e, e.from, '←')).join('') || '<span class="tag">无</span>'}</div>` : ''}
    ${sn && sn.container && (isSpaces() || !sn.expanded) ? liftedSection(n.id) : ''}
    ${queryChips(n.id)}
    ${myIssues.length ? `<div class="sec"><div class="t">问题</div>${myIssues.map((i) => `<div class="row sev-${i.severity}">${esc(i.message)}</div>`).join('')}</div>` : ''}`;
}
/** 点亮的保存的查询:条件、成员;能改条件(放进过滤框)、删除 */
function queryPanel(r) {
  const live = !window.__STARS_STATIC__, rows = r.members.slice(0, 200).map((id) => `<div class="row link" data-id="${esc(id)}"><span>${esc(raw.get(id)?.label || id)}</span><span class="tag">${esc(raw.get(id)?.attrs.type || '')}</span></div>`).join('');
  return `<h3 style="color:${esc(r.color || '#9db4ff')}">◇ ${esc(r.label)}</h3>
    <div class="sub">保存的查询 · ${esc(r.id)} · ${r.error ? '算不出来' : r.members.length + ' 个'}</div>
    ${r.summary ? `<p>${esc(r.summary)}</p>` : ''}
    <div class="sec"><div class="t">条件</div><code class="qexpr">${esc(r.expr)}</code>${r.error ? `<div class="row sev-error">${esc(r.error)}</div>` : ''}
      <div class="btns" style="margin-top:6px">${live ? `<span class="btn" data-qact="edit" title="把条件放进过滤框里改,边改边看;改好了点「存为查询」">改条件</span><span class="btn" data-qact="rm">删除</span>` : ''}<span class="btn" data-cmd="region">熄灭</span></div></div>
    <div class="sec"><div class="t">成员 ${r.members.length}${r.members.length > 200 ? '(只列前 200)' : ''}</div>${rows || '<span class="tag">现在没有</span>'}</div>`;
}
/** 节点在哪些保存的查询里 */
function queryChips(id) {
  if (!compiled) return '';
  const res = compiled.queryResults().filter((r) => r.members.includes(id));
  return res.length ? `<div class="sec"><div class="t">在这些查询里</div><div style="display:flex;flex-wrap:wrap;gap:5px">${res.map((r) => `<span class="tagc ${qActive === r.name ? 'on' : ''}" data-cmd="region ${esc(quoteArg(r.name))}"><i style="background:${esc(r.color || '#9db4ff')}"></i>${esc(r.label)}</span>`).join('')}</div></div>` : '';
}
/** 说明对应的文件版本(见 core/src/stale.ts):过期了能看改动、确认仍然有效;有说明却没记版本的可以记下 */
function seenSection(n) {
  if (!fileOf(n) || replay) return '';
  const live = !window.__STARS_STATIC__, id = esc(n.id);
  if (data.issues.some((i) => i.rule === 'stale' && i.nodes[0] === n.id)) {
    return `<div class="sec" id="seen-sec"><div class="row"><span class="sev-warn">写说明之后文件改过了</span>`
      + (live ? `<span class="mini" data-act="seen-diff" data-id="${id}" title="写说明时的那一版 → 现在">${seenOpen && seenOpen.id === n.id ? '收起改动' : '看改动'}</span><span class="mini ok" data-act="stamp" data-id="${id}" title="说明不用改:记下文件现在的版本">仍然有效</span>` : '')
      + `</div>${seenOpen && seenOpen.id === n.id ? `<div class="seen-diff">${seenOpen.html}</div>` : ''}</div>`;
  }
  if (n.attrs.seen) return `<div class="sec"><div class="row"><span class="tag">说明</span><span style="color:var(--muted)">对着文件的当前版本写的</span></div></div>`;
  if (n.attrs.summary && live) return `<div class="sec"><div class="row"><span class="tag">说明</span><span style="color:var(--muted)">没记是对着哪一版文件写的</span><span class="mini" data-act="stamp" data-id="${id}" title="记下文件现在的版本,之后文件改了会提醒">记下</span></div></div>`;
  return '';
}
function renderDiff(text) {
  return text.split('\n').map((l) => `<div class="${l.startsWith('@@') ? 'dh' : l[0] === '+' ? 'da' : l[0] === '-' ? 'dd' : ''}">${esc(l) || ' '}</div>`).join('');
}
/** 展开着的改动:面板会因为信号、体检等重画,所以记在这里,重画时照样画出来 */
let seenOpen = null;
async function showSeenDiff(id) {
  if (seenOpen && seenOpen.id === id) { seenOpen = null; renderSide(); return; }
  const mine = seenOpen = { id, html: '<span class="tag">读取中…</span>' };
  renderSide();
  let html;
  try {
    const d = await api('/api/seen-diff?id=' + encodeURIComponent(id));
    html = !d.old ? '<span class="tag">写说明时的那一版不在 git 里(不是 git 仓库,或已被清理),看不到改了什么</span>'
      : d.diff ? renderDiff(d.diff.replace(/\n$/, '')) : '<span class="tag">只有换行风格不同</span>';
  } catch (e) { html = `<span class="sev-error">${esc(e.message)}</span>`; }
  if (seenOpen !== mine) return;   // 期间收起了或换了节点
  mine.html = html; renderSide();
}
async function stampNodes(ids, author = 'viewer') {
  const r = await api('/api/stamp', { ids, author });
  if (r.stamped.length && r.n) await waitApplied(r.n);
  // 体检结果要等一会儿才推回来:先在本地把这几条过期去掉,面板马上就对
  const done = new Set(r.stamped);
  if (seenOpen && done.has(seenOpen.id)) seenOpen = null;
  if (data.issues.some((i) => i.rule === 'stale' && done.has(i.nodes[0]))) { data.issues = data.issues.filter((i) => !(i.rule === 'stale' && done.has(i.nodes[0]))); onIssues(); }
  return r;
}
$('side').addEventListener('click', (ev) => {
  const tg = ev.target.closest('[data-sidetag]'); if (tg) { toggleTag(tg.dataset.sidetag); return; }
  const dd = ev.target.closest('[data-draftdrop]');
  if (dd) { ev.stopPropagation(); exec(`draft drop ${dd.dataset.draftdrop}`, 'ui'); return; }
  const qa = ev.target.closest('[data-qact]');
  if (qa && qActive) {
    const r = compiled && compiled.queryResults().find((x) => x.name === qActive);
    if (!r) return;
    if (qa.dataset.qact === 'edit') { qEditing = r.name; qActive = null; $('q').value = '= ' + r.expr; $('q').dispatchEvent(new Event('input')); $('q').focus(); renderSide(); }
    if (qa.dataset.qact === 'rm' && confirm(`删除查询「${r.label}」?(只删这个查询,不动它的成员;之后可以 undo)`)) exec(`rm ${quoteArg(r.id)}`, 'ui', (x) => { if (x.ok) setRegion(null); });
    return;
  }
  const el = ev.target.closest('.row.link'); if (el) select(el.dataset.id, true);
});

function liftedSection(id) {
  if (isSpaces()) { // 这个空间里的东西与外面的关系(汇总到"从这里看出去"的对象上)
    const ext = compiled.space(id).external, agg = new Map();
    for (const x of ext) { const k = `${x.out}|${x.type}|${x.other}`; const a = agg.get(k) || { ...x, count: 0 }; a.count += x.count; agg.set(k, a); }
    const rows = [...agg.values()].sort((a, b) => b.count - a.count).slice(0, 30).map((x) => {
      const from = x.out ? id : x.other, to = x.out ? x.other : id;
      return `<div class="row link" data-id="${esc(x.other)}"><span class="tag">${x.out ? '→' : '←'}</span><span style="color:${x.color}">${esc(x.type)}</span><span>${esc(raw.get(x.other)?.label || x.other)}</span><span class="tag">×${x.count}</span><span class="mini ok" data-act="promote" data-from="${esc(from)}" data-type="${esc(x.type)}" data-to="${esc(to)}" data-count="${x.count}" title="把这条汇总关系提升为两者之间真实存在的边">提升</span></div>`;
    });
    return rows.length ? `<div class="sec"><div class="t">里面的东西与外面的关系(汇总)</div>${rows.join('')}</div>` : '';
  }
  const rel = scene.expand.relation;
  const rows = scene.edges.filter((e) => e.type !== rel && (e.from === id || e.to === id)).map((e) => {
    const other = e.from === id ? e.to : e.from;
    return `<div class="row link" data-id="${esc(other)}"><span class="tag">${e.from === id ? '→' : '←'}</span><span style="color:${e.color}">${esc(e.type)}</span><span>${esc(raw.get(other)?.label || other)}</span><span class="tag">×${e.count}${e.lifted ? ' · 汇总' : ''}</span>${e.lifted ? `<span class="mini ok" data-act="promote" data-from="${esc(e.from)}" data-type="${esc(e.type)}" data-to="${esc(e.to)}" data-count="${e.count}" title="把这条汇总关系提升为容器之间真实存在的边">提升</span>` : ''}</div>`;
  });
  return rows.length ? `<div class="sec"><div class="t">收起后的对外关系(含内部汇总)</div>${rows.join('')}</div>` : '';
}

function select(id, center) {
  if (id !== selected) bridgeEmit('select', id || null);
  selected = id;
  if (isSpaces()) {
    // 跟随时不自己抢镜头:只保证它在画面里,居中交给(带延迟的)跟随,免得两段动画打架
    if (id && center) { if (P.follow > 0) ensureVisible(id); else reveal(id); }
    scheduleFollow(id);
    renderSide(); return;
  }
  const n = id && sim.get(id);
  if (n && !visible(n)) { hiddenTypes.delete(typeOf(id)); rebuildGraph(); renderChips(); }
  if (n && center && n.x !== undefined && !(P.follow > 0)) {
    const t = d3.zoomIdentity.translate(innerWidth / 2 - 100, innerHeight / 2).scale(Math.max(transform.k, 1)).translate(-n.x, -n.y);
    d3.select(canvas).transition().duration(500).call(zoom.transform, t);
  }
  scheduleFollow(id);
  renderSide();
}
