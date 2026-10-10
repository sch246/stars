// ---------- 整理:Shift 拖 = 移动 · Ctrl/⌘ 拖 = 复制 · Alt(或 Ctrl+Shift)拖 = 引用(也放进那里)----------
// 拖的是选中里的节点 = 整个选中一起(画面上跟着指针的是一组影子,保持原来的相对位置)。
// 放在哪:指着的容器(收起的星系、展开的疆界、概念节点);指着文件 = 它所在的文件夹;空地 = 当前空间;顶上的路径栏 = 那一层。
// 拖着停在收起的容器上 0.7 秒,它就地展开,可以接着往里放。放进它自己或它里面的东西会被拒绝。
// 文件 / 文件夹的移动、复制是真的在磁盘上做(服务端,见 core/src/arrange.ts、fsops.ts),一步撤回。
const DRAG_VERB = { move: '移动', copy: '复制', ref: '引用' };
const DRAG_CMD = { move: 'mv', copy: 'cp', ref: 'ln' };
const DRAG_CURSOR = { move: 'move', copy: 'copy', ref: 'alias' };
const dragMode = (ev) => (ev.altKey || (isCtrl(ev) && ev.shiftKey) ? 'ref' : isCtrl(ev) ? 'copy' : ev.shiftKey ? 'move' : 'pull');
const fsMount = () => arrangeMount(uni);
const isFsNode = (id) => arrangeIsFs(raw.get(id), fsMount());
const isFsDir = (id) => isFsNode(id) && (id === fsMount() || raw.get(id)?.attrs.type === 'dir');
const lblOf = (id) => (id == null ? (isSpaces() && curSpaceId !== null ? raw.get(curSpaceId)?.label || curSpaceId : '顶层') : raw.get(id)?.label || id);

/** 拖动的模式变了(按 / 松修饰键):普通拖 = 拉力;别的 = 整理(停止拉力,画影子) */
function setDragMode(d, mode) {
  if (mode === 'pull') {
    if (d.op) { clearCrumbDrop(d.op); d.op = null; canvas.style.cursor = 'default'; }
    if (!d.pulling) warmDrag(d);
    return;
  }
  if (window.__STARS_STATIC__ || replay) return;
  if (d.op) { d.op.mode = mode; return; }
  const id = d.n.id, items = selection.size > 1 && selection.has(id) ? [...selection] : [id];
  const pos = new Map(screenNodes().map((p) => [p.id, p]));
  const ghosts = items.map((x) => { const p = pos.get(x); if (!p) return null; const sn = isSpaces() ? compiled.node(x) : sim.get(x); return { id: x, sx: p.sx, sy: p.sy, rgb: hex2rgb(sn?.color || '#aab4d0'), label: raw.get(x)?.label || x }; }).filter(Boolean).slice(0, 80);
  d.op = { mode, items, ghosts, sx: d.px, sy: d.py, hoverId: null, hoverAt: 0, sprung: new Set(), crumbEl: null };
}
const dragKeys = (ev) => { if (drag && drag.moved && ['Shift', 'Control', 'Meta', 'Alt'].includes(ev.key)) { setDragMode(drag, dragMode(ev)); if (ev.key === 'Alt') ev.preventDefault(); } };
addEventListener('keydown', dragKeys, true);
addEventListener('keyup', dragKeys, true);

/** 平铺视图:指针落在哪个展开容器的疆界(凸包)里(最小的那个) */
function regionAt(px, py) {
  const wx = (px - transform.x) / transform.k, wy = (py - transform.y) / transform.k;
  let best = null;
  for (const r of regions) if (r.hull && d3.polygonContains(r.hull, [wx, wy]) && (!best || r.members.length < best.members.length)) best = r;
  return best ? best.id : null;
}
/** 指针下面的放置目标:{ id } 容器(null = 顶层)· { off } 在面板上 · { self } 还在自己身上 */
function opTarget(d) {
  const o = d.op, el = document.elementFromPoint(d.cx, d.cy);
  const crumb = el && el.closest && el.closest('.crumb');
  if (crumb) return { id: crumb.dataset.c || null, crumb };
  if (el && el !== canvas) return { off: true };
  const h = hitAt(d.px, d.py);
  if (h && h.n) {
    const id = h.n.id;
    if (o.items.includes(id)) return h.domain ? { id } : { self: true };
    if (!h.domain && raw.get(id)?.attrs.type === 'file') return { id: compiled.parentOf(id) ?? null, near: id };   // 指着文件 = 放进它所在的文件夹
    return { id, hover: h.domain ? null : id };
  }
  if (!isSpaces()) return { id: regionAt(d.px, d.py) };
  return { id: curSpaceId };
}
/** 能不能放:{ ok } · { bad: 原因 } · { same } 已经在那里 · { none } 不放 */
function opCheck(o, t) {
  if (t.off || t.self) return { none: true };
  const target = t.id, verb = DRAG_VERB[o.mode];
  if (target != null && o.items.includes(target)) return { bad: '不能放到它自己身上' };
  if (target != null) { const anc = compiled.ancestors(target), it = o.items.find((x) => anc.includes(x)); if (it) return { bad: `不能把「${lblOf(it)}」放进它自己里面` }; }
  if (o.mode === 'ref' && target == null) return { bad: '引用要放进一个容器里' };
  if (o.mode === 'ref' && raw.get('~' + compiled.relation)?.attrs['single-parent'] === 'true') return { bad: `这个宇宙规定了 ${compiled.relation} 只能有一个上级(~${compiled.relation} single-parent=true)` };
  const fsItem = o.mode !== 'ref' && o.items.find((x) => isFsNode(x));
  if (fsItem && (target == null || !isFsDir(target))) return { bad: `「${lblOf(fsItem)}」是${isFsDir(fsItem) ? '文件夹' : '文件'},只能${verb}到文件夹里${o.mode === 'move' ? '(Alt 拖 = 引用:也出现在那里)' : ''}` };
  if (o.mode === 'move' && o.items.every((x) => (compiled.parentOf(x) ?? null) === target)) return { same: true };
  if (o.mode === 'ref' && o.items.every((x) => uni.edges.has(edgeKey(target, compiled.relation, x)))) return { same: true };
  return { ok: true };
}
function clearCrumbDrop(o) { if (o && o.crumbEl) { o.crumbEl.classList.remove('drop', 'nodrop'); o.crumbEl = null; } }
/** 拖着停在收起的容器上:0.7 秒后就地展开 */
function springLoad(o, t, now) {
  const id = t.hover;
  const shut = id && (isSpaces() ? compiled.node(id)?.container && !expandedSet.has(id) : sim.get(id)?.container && !sim.get(id).expanded);
  if (!shut || o.sprung.has(id)) { o.hoverId = null; return 0; }
  if (o.hoverId !== id) { o.hoverId = id; o.hoverAt = now; return 0; }
  const p = (now - o.hoverAt) / 700;
  if (p >= 1) { o.sprung.add(id); o.hoverId = null; if (isSpaces()) toggleExpandSpace(id); else toggleExpand(id); return 0; }
  return p;
}
overlayDrawers.push((now) => {
  const d = drag;
  if (!d || !d.op) return;
  const o = d.op, t = opTarget(d), chk = opCheck(o, t), spring = springLoad(o, t, now);
  const dx = d.px - o.sx, dy = d.py - o.sy;
  // 影子:选中的这一组,保持相对位置跟着指针
  ctx.font = '11px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const g of o.ghosts) {
    const x = g.sx + dx, y = g.sy + dy;
    ctx.fillStyle = rgba(g.rgb, 0.5); ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);
    if (o.ghosts.length <= 12) { ctx.fillStyle = 'rgba(232,232,246,0.75)'; ctx.fillText(g.label, x, y + 10); }
  }
  // 目标:绿圈能放、红圈不能;停在收起的容器上时画一圈进度(就地展开)
  clearCrumbDrop(o);
  if (t.crumb) { t.crumb.classList.add(chk.bad ? 'nodrop' : 'drop'); o.crumbEl = t.crumb; }
  const pos = t.id != null ? screenNodes().find((p) => p.id === t.id) : null;
  if (pos && !chk.none) {
    const col = chk.bad ? [255, 110, 130] : chk.same ? [170, 170, 190] : [123, 224, 160], r = Math.max(16, pos.r + 4);
    ctx.strokeStyle = rgba(col, 0.95); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pos.sx, pos.sy, r, 0, TAU); ctx.stroke();
    if (spring > 0) { ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(pos.sx, pos.sy, r + 5, -Math.PI / 2, -Math.PI / 2 + TAU * spring); ctx.stroke(); }
  }
  // 说明
  const n = o.items.length, verb = DRAG_VERB[o.mode];
  const text = chk.none ? `${verb} ${n} 个:${t.self ? '拖到要放的地方' : '这里不能放'}` : chk.bad ? `✗ ${chk.bad}` : chk.same ? `已经在「${lblOf(t.id)}」里了` : `${verb} ${n} 个 → ${lblOf(t.id)}${spring > 0 ? '(停住:展开)' : ''}`;
  ctx.textAlign = 'left';
  const w = ctx.measureText(text).width + 12, bx = Math.min(d.px + 16, innerWidth - w - 6), by = d.py + 18;
  ctx.fillStyle = 'rgba(8,10,24,0.88)'; ctx.fillRect(bx, by, w, 18);
  ctx.fillStyle = chk.bad ? '#ff8aa0' : chk.ok ? '#9ef0c0' : '#c8c8dc'; ctx.fillText(text, bx + 6, by + 3);
  canvas.style.cursor = chk.ok ? DRAG_CURSOR[o.mode] : chk.bad ? 'no-drop' : 'grabbing';
});
function finishOp(d) {
  const o = d.op; clearCrumbDrop(o); canvas.style.cursor = 'default';
  const t = opTarget(d), chk = opCheck(o, t);
  if (chk.bad) { toast(esc(chk.bad), true); return; }
  if (!chk.ok) return;
  arrangeNow(o.mode, o.items, t.id, { echo: true });
}

/** 整理一批节点;from 不给 = 每个从它在这个视图里所在的容器移出 */
async function arrangeNow(mode, ids, target, { echo = false, from, author = 'viewer' } = {}) {
  if (window.__STARS_STATIC__ || replay) throw new Error('静态导出 / 回放里不能改宇宙');
  const fromMap = mode === 'move' ? Object.fromEntries(ids.map((id) => [id, from !== undefined ? from : (compiled.parentOf(id) ?? null)])) : undefined;
  if (echo) did(`${DRAG_CMD[mode]} ${ids.length > 8 ? ids.slice(0, 8).map(quoteArg).join(' ') + ` …(共 ${ids.length} 个)` : ids.map(quoteArg).join(' ')} ${target == null ? '--top' : quoteArg(target)}`);
  try {
    const r = await api('/api/arrange', { mode, ids, target, fromMap, rel: compiled ? compiled.relation : 'contains', author });
    if (!r.n) { toast(r.skipped.length ? `已经在「${esc(lblOf(target))}」里了` : '没有要改的'); return r; }
    await waitApplied(r.n);
    setSelection(r.result);
    const disk = r.fs.length ? `(磁盘上${r.fs.map((a) => `${a.act === 'move' ? '搬' : '复制'} ${esc(a.from)} → ${esc(a.to)}`).slice(0, 2).join(';')}${r.fs.length > 2 ? '…' : ''})` : '';
    toast(`${esc(r.summary)}${disk} · <span data-cmd="undo" style="cursor:pointer;text-decoration:underline">撤销</span>`, false, 4500);
    return r;
  } catch (e) { if (echo) toast(esc(e.message), true); throw e; }
}

// 「移动到… / 复制到… / 引用到…」(右键菜单):不用拖 —— 接下来点哪个容器就放进哪个(点空地 = 当前空间;Esc 取消)
let arrangeArm = null;   // { mode, ids }
function armArrange(mode, ids) { linkArm = null; arrangeArm = { mode, ids }; canvas.style.cursor = DRAG_CURSOR[mode]; toast(`点要${DRAG_VERB[mode]}到的容器(${ids.length} 个)· Esc 取消`, false, 4000); }
function arrangeArmClick(hit, ev) {
  if (!arrangeArm) return false;
  const a = arrangeArm; arrangeArm = null; canvas.style.cursor = 'default';
  let target;
  if (hit && hit.n) target = !hit.domain && raw.get(hit.n.id)?.attrs.type === 'file' ? compiled.parentOf(hit.n.id) ?? null : hit.n.id;
  else target = isSpaces() ? curSpaceId : regionAt(...canvasXY(ev));
  const chk = opCheck({ mode: a.mode, items: a.ids }, { id: target });
  if (chk.bad) { toast(esc(chk.bad), true); return true; }
  if (chk.same) { toast(`已经在「${esc(lblOf(target))}」里了`); return true; }
  arrangeNow(a.mode, a.ids, target, { echo: true }).catch(() => {});
  return true;
}
addEventListener('keydown', (ev) => { if (arrangeArm && ev.key === 'Escape') { arrangeArm = null; canvas.style.cursor = 'default'; ev.stopPropagation(); ev.preventDefault(); } }, true);
menuProviders.push((id, ids) => {
  if (!id || window.__STARS_STATIC__ || replay) return [];
  const list = ids.length ? ids : [id], n = list.length > 1 ? ` ${list.length} 个` : '';
  return [
    { label: `移动${n}到…`, key: 'Shift 拖', run: () => armArrange('move', list) },
    { label: `复制${n}到…`, key: 'Ctrl 拖', run: () => armArrange('copy', list) },
    { label: `引用${n}到…`, key: 'Alt 拖', title: '也放进那个容器(一个节点可以在几个容器里),什么都不搬', run: () => armArrange('ref', list) },
  ];
});
