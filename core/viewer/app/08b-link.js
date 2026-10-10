// ---------- 关系:右键从节点拖到另一个节点 = 建关系;边可以点选、改类型、反转、删除 ----------
// 方向 = 拖的方向(菜单里 ⇄ 可以反过来)。从选中里的节点拖 = 整个选中都连过去(多对一);
// 从没选中的节点拖到选中里的节点 = 连到整个选中(一对多);两头都是多个时每一对都连(菜单里写明条数)。
// 松手弹出类型菜单:最近用过的在前,打字过滤,回车选中或新建这个类型。
let linkDrag = null;   // 拖着:{ from: id[], start, x, y, to: id[] | null }
let linkPick = null;   // 类型菜单开着:{ el, from, to, mode: 'link' | 'retype', edges?, q, idx, items }
const RECENT_REL_KEY = 'stars.recentRelations';
const recentRels = () => { try { return JSON.parse(localStorage.getItem(RECENT_REL_KEY) || '[]'); } catch { return []; } };
function rememberRel(t) { try { localStorage.setItem(RECENT_REL_KEY, JSON.stringify([t, ...recentRels().filter((x) => x !== t)].slice(0, 8))); } catch { /* 隐私模式 */ } }
const relColor = (t) => (uni && uni.nodes.get('~' + t)?.attrs.color) || hashColor('edge:' + t);
const labelOfIds = (ids) => (ids.length === 1 ? raw.get(ids[0])?.label || ids[0] : `${ids.length} 个`);

/** 拖到的节点是不是在选中里(而起点不在):那就连到整个选中 */
function linkTargets(L, h) {
  if (!h || !h.n || L.from.includes(h.n.id)) return null;
  const id = h.n.id;
  return selection.size > 1 && selection.has(id) && !selection.has(L.start) ? [...selection].filter((x) => !L.from.includes(x)) : [id];
}
function linkDragMove(d) {
  if (!linkDrag) {
    const start = d.hit.n.id;
    linkDrag = { start, from: selection.size > 1 && selection.has(start) ? [...selection] : [start] };
    canvas.style.cursor = 'crosshair';
    closeLinkPicker();
  }
  linkDrag.x = d.x; linkDrag.y = d.y;
  linkDrag.to = linkTargets(linkDrag, hitAt(d.x, d.y));
}
function linkDragEnd(d, ev) {
  const L = linkDrag; linkDrag = null; canvas.style.cursor = 'default';
  if (!L) return;
  const to = linkTargets(L, hitAt(d.x, d.y));
  if (!to || !to.length) return;
  if (window.__STARS_STATIC__ || replay) { toast('静态导出 / 回放里不能改宇宙', true); return; }
  openLinkPicker({ mode: 'link', from: L.from, to, x: ev.clientX, y: ev.clientY });
}
function linkDragCancel() { linkDrag = null; }

// 拖着 / 菜单开着时:从每个起点画箭头到指针(或到目标)
overlayDrawers.push((now) => {
  const L = linkDrag || (linkPick && linkPick.mode === 'link' ? linkPick : null);
  if (!L) return;
  const pos = new Map(screenNodes().map((p) => [p.id, p]));
  const from = L.dir === -1 ? L.to : L.from, to = L.dir === -1 ? L.from : L.to;
  const targets = (to || []).map((id) => pos.get(id)).filter(Boolean);
  const ends = targets.length ? targets : linkDrag ? [{ sx: L.x, sy: L.y }] : [];
  const col = [150, 200, 255], pulse = 0.7 + 0.3 * Math.sin(now / 160);
  ctx.strokeStyle = rgba(col, 0.8 * pulse); ctx.fillStyle = rgba(col, 0.9); ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
  let drawn = 0;
  for (const id of from || []) {
    const a = pos.get(id); if (!a) continue;
    for (const b of ends) {
      if (++drawn > 400) break;
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      const ang = Math.atan2(b.sy - a.sy, b.sx - a.sx), bx = b.sx - Math.cos(ang) * 10, by = b.sy - Math.sin(ang) * 10;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - Math.cos(ang - 0.4) * 8, by - Math.sin(ang - 0.4) * 8); ctx.lineTo(bx - Math.cos(ang + 0.4) * 8, by - Math.sin(ang + 0.4) * 8); ctx.closePath(); ctx.fill();
    }
  }
  ctx.setLineDash([]);
  for (const b of targets) { ctx.strokeStyle = rgba(col, 0.95); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(b.sx, b.sy, 14, 0, TAU); ctx.stroke(); }
  if (linkDrag) {
    const text = `建关系:${labelOfIds(L.from)} → ${L.to ? labelOfIds(L.to) : '(松在另一个节点上)'}`;
    ctx.font = '11px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(8,10,24,0.85)'; ctx.fillRect(L.x + 12, L.y + 14, ctx.measureText(text).width + 10, 17);
    ctx.fillStyle = rgba(col, 1); ctx.fillText(text, L.x + 17, L.y + 17);
  }
});

// ---- 类型菜单 ----
function closeLinkPicker() { if (linkPick) { linkPick.el.remove(); linkPick = null; } }
/** o = { mode: 'link', from, to, x, y } 建新边;{ mode: 'retype', edges: [{from,type,to}], x, y } 改已有边的类型 */
function openLinkPicker(o) {
  closeLinkPicker(); closeMenu();
  const el = document.createElement('div');
  el.id = 'linkpick'; el.className = 'panel';
  linkPick = { ...o, el, q: '', idx: 0, dir: 1, items: [] };
  document.body.appendChild(el);
  renderLinkPicker();
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(6, Math.min(o.x + 8, innerWidth - r.width - 8)) + 'px';
  el.style.top = Math.max(6, Math.min(o.y + 8, innerHeight - r.height - 8)) + 'px';
  el.querySelector('input').focus();
}
function linkPairs(P) {
  const from = P.dir === -1 ? P.to : P.from, to = P.dir === -1 ? P.from : P.to, out = [];
  for (const a of from) for (const b of to) if (a !== b) out.push([a, b]);
  return out;
}
function pickerItems(P) {
  const { edges } = styleTypes(uni), count = new Map(edges.map((t) => [t.name, t.count])), q = P.q.trim();
  const names = [...new Set([...recentRels().filter((t) => count.has(t) || !q), ...edges.map((t) => t.name)])];
  const rel = compiled ? compiled.relation : 'contains';
  if (!names.includes(rel)) names.push(rel);
  const list = names.filter((t) => !q || t.toLowerCase().includes(q.toLowerCase())).map((t) => ({ type: t, count: count.get(t) || 0, recent: recentRels().includes(t) }));
  if (q && !names.includes(q)) list.unshift({ type: q, isNew: true, count: 0 });
  return list.slice(0, 40);
}
function renderLinkPicker() {
  const P = linkPick; if (!P) return;
  P.items = pickerItems(P);
  P.idx = Math.max(0, Math.min(P.idx, P.items.length - 1));
  let head, note = '';
  if (P.mode === 'link') {
    const pairs = linkPairs(P), from = P.dir === -1 ? P.to : P.from, to = P.dir === -1 ? P.from : P.to;
    head = `<b>${esc(labelOfIds(from))}</b> → <b>${esc(labelOfIds(to))}</b> <span class="lp-flip" data-lp="flip" title="方向反过来(Tab)">⇄ 反向</span>`;
    note = `${pairs.length} 条${from.length > 1 && to.length > 1 ? `(多对多:${from.length} × ${to.length},每一对都连)` : ''}`;
  } else {
    const e = P.edges;
    head = e.length === 1 ? `改类型:<b>${esc(raw.get(e[0].from)?.label || e[0].from)}</b> -${esc(e[0].type)}→ <b>${esc(raw.get(e[0].to)?.label || e[0].to)}</b>` : `改 ${e.length} 条边的类型`;
  }
  const rows = P.items.map((it, i) => `<div class="lp-i${i === P.idx ? ' on' : ''}" data-lpi="${i}"><i style="background:${esc(relColor(it.type))}"></i>`
    + `<span>${it.isNew ? `新建「${esc(it.type)}」` : esc(it.type)}</span>${it.recent ? '<span class="tag">最近</span>' : ''}${it.count ? `<span class="tag">${it.count}</span>` : ''}</div>`).join('');
  const inp = P.el.querySelector('input');
  if (!inp) {
    P.el.innerHTML = `<div class="lp-h"></div><input placeholder="关系类型:打字过滤,回车选中 / 新建" spellcheck="false"><div class="lp-n"></div><div class="lp-l"></div>`;
    const input = P.el.querySelector('input');
    input.addEventListener('input', () => { P.q = input.value; P.idx = 0; renderLinkPicker(); });
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.isComposing) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { P.idx += ev.key === 'ArrowDown' ? 1 : -1; renderLinkPicker(); ev.preventDefault(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); const it = P.items[P.idx]; if (it) pickRelation(it.type); }
      else if (ev.key === 'Escape') { ev.preventDefault(); closeLinkPicker(); }
      else if (ev.key === 'Tab' && P.mode === 'link') { ev.preventDefault(); P.dir = -P.dir; renderLinkPicker(); }
    });
    P.el.addEventListener('mousedown', (ev) => ev.stopPropagation());
    P.el.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-lp="flip"]')) { P.dir = -P.dir; renderLinkPicker(); P.el.querySelector('input').focus(); return; }
      const i = ev.target.closest('[data-lpi]'); if (i) pickRelation(P.items[+i.dataset.lpi].type);
    });
  }
  P.el.querySelector('.lp-h').innerHTML = head;
  P.el.querySelector('.lp-n').innerHTML = note;
  P.el.querySelector('.lp-l').innerHTML = rows || '<span class="tag">没有这样的类型</span>';
  const on = P.el.querySelector('.lp-i.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
addEventListener('mousedown', (ev) => { if (linkPick && !linkPick.el.contains(ev.target)) closeLinkPicker(); }, true);

function pickRelation(type) {
  const P = linkPick; if (!P) return;
  try { assertRelType(type); } catch (e) { toast(esc(e.message), true); return; }
  closeLinkPicker();
  rememberRel(type);
  if (P.mode === 'retype') { relinkEdges(P.edges, { type }); return; }
  const pairs = linkPairs(P);
  const fresh = pairs.filter(([a, b]) => !uni.edges.has(edgeKey(a, type, b)));
  if (!fresh.length) { toast(`这${pairs.length > 1 ? '些' : '条'}关系已经有了`); return; }
  const lines = fresh.map(([a, b]) => `link ${quoteArg(a)} ${quoteArg(type)} ${quoteArg(b)}`);
  for (const l of lines.slice(0, 3)) did(l);
  if (lines.length > 3) did(`# …共 ${lines.length} 条(一次提交)`);
  const ops = fresh.map(([a, b]) => ({ op: 'addEdge', from: a, type, to: b, attrs: {} }));
  if (!uni.nodes.has('~' + type)) ops.unshift(styleOp(uni, type, {}, [], 'edgeType'));   // 新的类型:顺手登记(~类型 kind=edgeType),体检不报「未声明」
  const skipped = pairs.length - fresh.length;
  commitOp(ops.length === 1 ? ops[0] : { op: 'batch', ops }, `+ ${fresh.length} 条 ${type}${skipped ? `(${skipped} 条已有)` : ''}`, null)
    .then((r) => { if (fresh.length > 1 || skipped) toast(esc(r.out)); })
    .catch((e) => toast(esc(e.message), true));
}
function assertRelType(t) {
  if (!t || /\s/.test(t) || t.startsWith('~')) throw new Error(`关系类型不能有空白、不能以 ~ 开头(得到「${t}」)`);
}

// ---- 改已有的边:类型、方向 ----
/** 一批边换类型 / 反向(一次提交,一步撤回);属性跟着走 */
function relinkEdges(edges, { type, reverse }) {
  const ops = [], lines = [];
  for (const e of edges) {
    const cur = uni.edges.get(edgeKey(e.from, e.type, e.to)); if (!cur) continue;
    const nt = type || e.type, nf = reverse ? e.to : e.from, nto = reverse ? e.from : e.to;
    if (nt === e.type && nf === e.from && nto === e.to) continue;
    if (uni.edges.has(edgeKey(nf, nt, nto))) { toast(`已经有 ${esc(nf)} -${esc(nt)}→ ${esc(nto)} 了`, true); return; }
    ops.push({ op: 'removeEdge', from: e.from, type: e.type, to: e.to }, { op: 'addEdge', from: nf, type: nt, to: nto, attrs: { ...cur.attrs } });
    lines.push(`relink ${quoteArg(e.from)} ${quoteArg(e.type)} ${quoteArg(e.to)}${type && type !== e.type ? ' --type ' + quoteArg(type) : ''}${reverse ? ' --reverse' : ''}`);
  }
  if (!ops.length) return;
  for (const l of lines.slice(0, 3)) did(l);
  const one = edges.length === 1 && ops.length === 2;
  return commitOp({ op: 'batch', ops }, one ? `~ ${ops[1].from} -${ops[1].type}-> ${ops[1].to}` : `~ ${ops.length / 2} 条边`, null)
    .then(() => { if (one && selEdge) { selEdge = { from: ops[1].from, type: ops[1].type, to: ops[1].to }; renderSide(); } })
    .catch((e) => toast(esc(e.message), true));
}

// ---- 选中边 ----
const edgeIsSel = (l) => !!selEdge && l.from === selEdge.from && l.to === selEdge.to && l.type === selEdge.type;
let frameEdges = [];   // 这一帧画出来的边(屏幕坐标),点选用;空间模式在 drawSpaceEdges 里收集
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
/** 点到的边(离指针 5px 以内最近的那条) */
function edgeAt(px, py) {
  let best = null, bd = 5;
  if (isSpaces()) { for (const f of frameEdges) { const d = segDist(px, py, f.ax, f.ay, f.bx, f.by); if (d < bd) { bd = d; best = f.l; } } return best; }
  const k = transform.k, X = transform.x, Y = transform.y;
  for (const l of links) {
    const a = l.source, b = l.target;
    if (a.x === undefined || b.x === undefined || l.mode === 'region' || l.mode === 'orbit') continue;
    const d = segDist(px, py, a.x * k + X, a.y * k + Y, b.x * k + X, b.y * k + Y);
    if (d < bd) { bd = d; best = l; }
  }
  return best;
}
function selectEdge(l) {
  const real = !l.lifted && uni.edges.has(edgeKey(l.from, l.type, l.to));
  select(null);
  selEdge = { from: l.from, type: l.type, to: l.to, lifted: !real, count: l.count || 1 };
  did(`edge ${quoteArg(l.from)} ${quoteArg(l.type)} ${quoteArg(l.to)}`);
  renderSide();
}
/** 一条汇总边底下的真实边:类型相同,两头分别在(或就是)汇总边的两个端点下面 */
function underlyingEdges(se) {
  const under = (id, top) => id === top || (compiled && compiled.ancestors(id).includes(top));
  const out = [];
  for (const e of data.edges) {
    if (e.type !== se.type) continue;
    if (under(e.from, se.from) && under(e.to, se.to)) out.push(e);
    else if (isSymmetricType(se.type) && under(e.from, se.to) && under(e.to, se.from)) out.push(e);
    if (out.length >= 500) break;
  }
  return out;
}
const isSymmetricType = (t) => uni && uni.nodes.get('~' + t)?.attrs.symmetric === 'true';
function edgePanel(se) {
  const live = !window.__STARS_STATIC__ && !replay, lbl = (id) => esc(raw.get(id)?.label || id);
  const e = uni.edges.get(edgeKey(se.from, se.type, se.to));
  const col = relColor(se.type), q = (s) => esc(quoteArg(s));
  if (e && !se.lifted) {
    const attrs = Object.entries(e.attrs).map(([k, v]) => `<div class="row"><span class="tag">${esc(k)}</span><span>${esc(v)}</span></div>`).join('');
    return `<h3><span style="color:${esc(col)}">${esc(se.type)}</span></h3>
      <div class="sub">关系 · <span class="link ty-link" data-cmd="type-edit ${q(se.type)} edge" title="改这一类关系的样子">样子 ✎</span></div>
      <div class="sec"><div class="row link" data-id="${esc(se.from)}"><span class="tag">从</span><span>${lbl(se.from)}</span></div>
        <div class="row link" data-id="${esc(se.to)}"><span class="tag">到</span><span>${lbl(se.to)}</span></div></div>
      ${e.attrs.status === 'proposed' ? `<div class="sec"><div class="row"><span class="sev-warn">待确认</span><span class="mini ok" data-act="accept" data-from="${esc(e.from)}" data-type="${esc(e.type)}" data-to="${esc(e.to)}">✓</span><span class="mini no" data-act="reject" data-from="${esc(e.from)}" data-type="${esc(e.type)}" data-to="${esc(e.to)}">✗</span></div></div>` : ''}
      ${attrs ? `<div class="sec">${attrs}</div>` : ''}
      ${live ? `<div class="btns" style="margin-top:6px"><span class="btn" data-eact="retype">改类型…</span><span class="btn" data-eact="reverse" title="从和到对调">⇄ 反转</span><span class="btn" data-eact="rm">删除</span></div>` : ''}
      <div class="sc-hint">右键从一个节点拖到另一个 = 建关系 · Del 删除选中的边</div>`;
  }
  const list = underlyingEdges(se);
  const rows = list.slice(0, 200).map((x) => `<div class="row"><span class="link" data-id="${esc(x.from)}">${lbl(x.from)}</span><span class="tag">→</span><span class="link" data-id="${esc(x.to)}">${lbl(x.to)}</span>`
    + `<span class="mini" data-eone="${esc(JSON.stringify([x.from, x.type, x.to]))}" title="选中这条">选</span>${live ? `<span class="mini" data-erev="${esc(JSON.stringify([x.from, x.type, x.to]))}" title="反转">⇄</span><span class="mini no" data-erm="${esc(JSON.stringify([x.from, x.type, x.to]))}" title="删除">✗</span>` : ''}</div>`).join('');
  return `<h3><span style="color:${esc(col)}">${esc(se.type)}</span> <span class="tag">×${list.length}</span></h3>
    <div class="sub">汇总的关系:${lbl(se.from)} 里面 → ${lbl(se.to)} 里面</div>
    ${live && list.length ? `<div class="btns" style="margin:6px 0"><span class="btn" data-eact="retype-all">全部改类型…</span>${!e ? `<span class="btn" data-eact="promote" title="在两个容器之间建一条真实的边">提升为真实的边</span>` : ''}</div>` : ''}
    <div class="sec"><div class="t">底下的边 ${list.length > 200 ? '(只列前 200)' : ''}</div>${rows || '<span class="tag">没有</span>'}</div>`;
}
$('side-info').addEventListener('click', (ev) => {
  const t = ev.target;
  const one = t.closest('[data-eone]'), rv = t.closest('[data-erev]'), rm = t.closest('[data-erm]'), act = t.closest('[data-eact]'), rt = t.closest('[data-eretype]');
  if (!one && !rv && !rm && !act && !rt) return;
  ev.stopPropagation();
  const parse = (el, k) => { const [from, type, to] = JSON.parse(el.dataset[k]); return { from, type, to }; };
  if (one) { const e = parse(one, 'eone'); selectEdge(e); return; }
  if (rt) { const r = rt.getBoundingClientRect(); openLinkPicker({ mode: 'retype', edges: [parse(rt, 'eretype')], x: r.left - 240, y: r.bottom }); return; }
  if (rv) { relinkEdges([parse(rv, 'erev')], { reverse: true }); return; }
  if (rm) { const e = parse(rm, 'erm'); exec(`unlink ${quoteArg(e.from)} ${quoteArg(e.type)} ${quoteArg(e.to)}`, 'ui'); return; }
  const se = selEdge; if (!se) return;
  const r = act.getBoundingClientRect();
  switch (act.dataset.eact) {
    case 'retype': openLinkPicker({ mode: 'retype', edges: [se], x: r.left - 220, y: r.bottom }); break;
    case 'retype-all': openLinkPicker({ mode: 'retype', edges: underlyingEdges(se).map((x) => ({ from: x.from, type: x.type, to: x.to })), x: r.left - 220, y: r.bottom }); break;
    case 'reverse': relinkEdges([se], { reverse: true }); break;
    case 'rm': exec(`unlink ${quoteArg(se.from)} ${quoteArg(se.type)} ${quoteArg(se.to)}`, 'ui'); break;
    case 'promote': exec(`link ${quoteArg(se.from)} ${quoteArg(se.type)} ${quoteArg(se.to)}`, 'ui'); break;
  }
});
// 「连到…」(右键菜单):不用拖 —— 接下来点哪个节点就连到哪个(Esc / 点背景取消)。触控板上右键拖不方便时用它
let linkArm = null;   // { from: id[] }
function armLink(from) { linkArm = { from }; canvas.style.cursor = 'crosshair'; toast(`点要连到的节点(${esc(labelOfIds(from))} → ?)· Esc 取消`, false, 4000); }
/** canvas 的点击先问这里:连线待命时,这次点击用来选目标 */
function armedClick(hit, ev) {
  if (!linkArm) return false;
  const from = linkArm.from; linkArm = null; canvas.style.cursor = 'default';
  const to = hit && hit.n && !from.includes(hit.n.id) ? (selection.size > 1 && selection.has(hit.n.id) && !from.some((x) => selection.has(x)) ? [...selection] : [hit.n.id]) : null;
  if (to) openLinkPicker({ mode: 'link', from, to, x: ev.clientX, y: ev.clientY });
  return true;
}
addEventListener('keydown', (ev) => { if (linkArm && ev.key === 'Escape') { linkArm = null; canvas.style.cursor = 'default'; ev.stopPropagation(); ev.preventDefault(); } }, true);
overlayDrawers.push((now) => {
  if (!linkArm || !pointerXY) return;
  const pos = new Map(screenNodes().map((p) => [p.id, p])), [x, y] = pointerXY;
  ctx.strokeStyle = rgba([150, 200, 255], 0.55 + 0.25 * Math.sin(now / 160)); ctx.lineWidth = 1.5; ctx.setLineDash([3, 5]);
  for (const id of linkArm.from.slice(0, 200)) { const a = pos.get(id); if (a) { ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(x, y); ctx.stroke(); } }
});
menuProviders.push((id, ids) => {
  if (!id || window.__STARS_STATIC__ || replay) return [];
  return [{ label: ids.length > 1 ? `把这 ${ids.length} 个连到…` : '连到…', title: '接下来点哪个节点就连到哪个;右键从它拖到另一个节点也行', run: () => armLink(ids.length ? ids : [id]) }];
});
