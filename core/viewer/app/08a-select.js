// ---------- 多选、框选、右键菜单 ----------
// 点一下 = 只选它;Ctrl/⌘ + 点 = 加进 / 移出选中;Shift + 点 = 移出。
// 右键从背景拖 = 框选:不按 = 重选,Ctrl = 追加(并集),Shift = 减去(差集),Ctrl + Shift = 反选(异或)。拖的途中按 / 松修饰键,模式跟着变。
// 右键从节点拖 = 建关系(见「关系」一节);右键单击(不拖)= 右键菜单。文件夹的疆界(就地展开的虚线圆)算背景。
const isCtrl = (ev) => !!(ev.ctrlKey || ev.metaKey);
const BOX_MODES = { replace: '重选', add: '追加', remove: '减去', toggle: '反选' };
const BOX_COLORS = { replace: [150, 180, 255], add: [123, 224, 160], remove: [255, 122, 144], toggle: [255, 200, 90] };
const boxMode = (ev) => (isCtrl(ev) ? (ev.shiftKey ? 'toggle' : 'add') : ev.shiftKey ? 'remove' : 'replace');
let rdrag = null;    // 右键按着:{ sx, sy, x, y, hit, moved }
let boxSel = null;   // 框选中:{ x0, y0, x1, y1, mode, base, ids, result }
/** 画面上要不要给它画「选中」的环:框选途中按框选的结果预览 */
function selShown(id) { return (boxSel ? boxSel.result : selection).has(id); }
/** 这条边要不要高亮:单选 = 碰到选中的;多选 = 两头都在选中里 */
function edgeHot(a, b) { return selection.size > 1 ? selection.has(a) && selection.has(b) : !!selected && (a === selected || b === selected); }

/** 平铺模式只能选画面里有的(收起的容器里面的东西不在图上);空间模式别的空间里的也行 */
const selectable = (id) => raw.has(id) && (isSpaces() || sim.has(id) || id.startsWith('~'));
/** 换掉整个选中集合;primary = 主节点(不给:原来的还在就留着,否则取最后一个) */
function setSelection(ids, primary) {
  const next = new Set();
  for (const id of ids) if (selectable(id)) next.add(id);
  let p = primary === undefined ? selected : primary;
  if (p == null || !next.has(p)) p = next.size ? [...next][next.size - 1] : null;
  selection.clear(); for (const id of next) selection.add(id);
  selVer++; selEdge = null;
  select(p, false, true);
}
/** 去掉已经不在的(keep 给了就再按它筛),修正 selected */
function pruneSelection(keep) {
  let changed = false;
  for (const id of [...selection]) if (!raw.has(id) || (keep && !keep(id))) { selection.delete(id); changed = true; }
  if (selected && !selection.has(selected)) { selection.add(selected); changed = true; }
  if (!selected && selection.size) selected = [...selection][selection.size - 1];
  if (selEdge && !(raw.has(selEdge.from) && raw.has(selEdge.to))) selEdge = null;
  if (changed) selVer++;
}
function combine(base, ids, mode) {
  if (mode === 'replace') return new Set(ids);
  const out = new Set(base);
  for (const id of ids) {
    if (mode === 'add') out.add(id);
    else if (mode === 'remove') out.delete(id);
    else if (out.has(id)) out.delete(id); else out.add(id);
  }
  return out;
}
/** 回显用的 select 命令(太长就只写前几个) */
function selLine(ids, mode = 'replace') {
  const list = [...ids], flag = mode === 'replace' ? '' : ' --' + mode;
  if (!list.length) return mode === 'replace' ? 'select' : '';
  return 'select' + flag + ' ' + (list.length > 8 ? list.slice(0, 8).map(quoteArg).join(' ') + ` …(共 ${list.length} 个)` : list.map(quoteArg).join(' '));
}
/** 容器树里的全部后代(按视图的容器关系,递归;不含这些容器自己) */
function descendantsOf(ids) {
  const out = [], seen = new Set(ids), stack = [...ids];
  while (stack.length) for (const k of compiled.children(stack.pop())) if (!seen.has(k)) { seen.add(k); out.push(k); stack.push(k); }
  return out;
}

/** 画面上看得见、点得到的节点(屏幕坐标)。空间模式用这一帧的命中表;就地展开的容器(疆界)要整个圆都在框里才算 */
function screenNodes() {
  const out = [];
  if (isSpaces()) {
    const seen = new Set();
    for (const h of frameHits) if (!seen.has(h.n.id)) { seen.add(h.n.id); out.push({ id: h.n.id, sx: h.sx, sy: h.sy, r: h.domain ? h.R : 0 }); }
  } else {
    const k = transform.k;
    for (const n of sim.values()) if (n.x !== undefined && visible(n)) out.push({ id: n.id, sx: n.x * k + transform.x, sy: n.y * k + transform.y, r: 0 });
  }
  return out;
}
function boxIds(b) {
  const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
  return screenNodes().filter((p) => p.sx - p.r >= x0 && p.sx + p.r <= x1 && p.sy - p.r >= y0 && p.sy + p.r <= y1).map((p) => p.id);
}
function hitAt(px, py) {
  if (isSpaces()) return pickHit(px, py);
  const n = find(px, py);
  return n ? { n } : null;
}
const canvasXY = (ev) => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };

// 修饰键点星图:Ctrl/⌘ = 加进 / 移出,Shift = 移出;点背景不动选中。(由 handleTap 调用)
function modTap(hit, ev) {
  if (!hit || !hit.n) return;
  const id = hit.n.id, mode = isCtrl(ev) ? 'toggle' : 'remove';
  did(selLine([id], mode));
  const next = combine(selection, [id], mode);
  setSelection(next, next.has(id) ? id : undefined);
}

canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());   // 右键菜单自己画(松开时才弹),框选 / 连线不被系统菜单打断
canvas.addEventListener('mousedown', (ev) => {
  if (ev.button !== 2) return;
  closeMenu();
  rdrag = { sx: ev.offsetX, sy: ev.offsetY, x: ev.offsetX, y: ev.offsetY, hit: hitAt(ev.offsetX, ev.offsetY), moved: false };
});
addEventListener('mousemove', (ev) => {
  if (!rdrag) return;
  const [x, y] = canvasXY(ev);
  rdrag.x = x; rdrag.y = y;
  if (!rdrag.moved) { if (Math.hypot(x - rdrag.sx, y - rdrag.sy) < 4) return; rdrag.moved = true; }
  const h = rdrag.hit;
  if (h && !h.domain) { linkDragMove(rdrag, ev); return; }   // 从节点出发:建关系
  if (!boxSel) { boxSel = { x0: rdrag.sx, y0: rdrag.sy, base: new Set(selection), ids: [], result: new Set(selection) }; canvas.style.cursor = 'crosshair'; }
  boxSel.x1 = x; boxSel.y1 = y; boxSel.mode = boxMode(ev);
});
addEventListener('mouseup', (ev) => {
  if (ev.button !== 2 || !rdrag) return;
  const d = rdrag; rdrag = null;
  if (!d.moved) { openCanvasMenu(ev, d.hit); return; }
  if (boxSel) { finishBox(ev); return; }
  linkDragEnd(d, ev);
});
const modKey = (ev) => { if (boxSel && ['Control', 'Shift', 'Meta'].includes(ev.key)) boxSel.mode = boxMode(ev); };
addEventListener('keydown', modKey, true);
addEventListener('keyup', modKey, true);
addEventListener('blur', () => { rdrag = null; boxSel = null; linkDragCancel(); });

function finishBox(ev) {
  const b = boxSel; boxSel = null; canvas.style.cursor = 'default';
  b.mode = boxMode(ev);
  const ids = boxIds(b), result = combine(b.base, ids, b.mode);
  const line = selLine(ids, b.mode);
  if (line) did(line);
  setSelection(result);
}

// ---- 叠在画面上的东西(框选的框、连线的箭头、拖动的影子……):各节往这里挂,每帧最后画(屏幕坐标) ----
const overlayDrawers = [];
function drawOverlays(now) {
  const dpr = devicePixelRatio || 1;
  for (const f of overlayDrawers) {
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.setLineDash([]);
    try { f(now); } catch (e) { console.error(e); }
    ctx.restore();
  }
}
overlayDrawers.push(() => {
  if (!boxSel || boxSel.x1 === undefined) return;
  const b = boxSel;
  b.ids = boxIds(b); b.result = combine(b.base, b.ids, b.mode);   // 每帧按当前位置重算(节点还在动)
  const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0), col = BOX_COLORS[b.mode];
  ctx.fillStyle = rgba(col, 0.08); ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = rgba(col, 0.85); ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.setLineDash([]);
  ctx.font = '11px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  const text = `${BOX_MODES[b.mode]} · 框住 ${b.ids.length} · 结果 ${b.result.size}`;
  ctx.fillStyle = 'rgba(8,10,24,0.85)'; ctx.fillRect(b.x1 + 10, b.y1 + 12, ctx.measureText(text).width + 10, 17);
  ctx.fillStyle = rgba(col, 1); ctx.fillText(text, b.x1 + 15, b.y1 + 15);
});

// ---- 右键菜单 ----
// 各节往 menuProviders 里挂:(右键点到的节点 id 或 null, 选中的 id[]) => 菜单项[];项 = { label, cmd | run, key?, disabled? } 或 '-'
const menuProviders = [];
let menuEl = null, menuAt = [0, 0];   // 菜单弹出的位置(client 坐标;「新建节点…」就建在这里)
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function showMenu(x, y, items) {
  closeMenu();
  menuAt = [x, y];
  if (!items.length) return;
  const el = menuEl = document.createElement('div');
  el.id = 'ctxmenu'; el.className = 'panel';
  el.innerHTML = items.map((it, i) => (it === '-' ? '<div class="sep"></div>'
    : `<div class="mi${it.disabled ? ' off' : ''}" data-mi="${i}"${it.title ? ` title="${esc(it.title)}"` : ''}>${esc(it.label)}${it.key ? `<span class="k">${esc(it.key)}</span>` : ''}</div>`)).join('');
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
  el.addEventListener('contextmenu', (ev) => ev.preventDefault());
  el.addEventListener('click', (ev) => {
    const m = ev.target.closest('[data-mi]'); if (!m) return;
    const it = items[+m.dataset.mi]; if (!it || it.disabled) return;
    closeMenu();
    if (it.cmd) exec(it.cmd, 'ui'); else if (it.run) it.run();
  });
}
addEventListener('mousedown', (ev) => { if (menuEl && !menuEl.contains(ev.target)) closeMenu(); }, true);
addEventListener('keydown', (ev) => { if (menuEl && ev.key === 'Escape') { closeMenu(); ev.stopPropagation(); ev.preventDefault(); } }, true);
addEventListener('wheel', () => closeMenu(), { passive: true });
function menuItems(id) {
  const ids = [...selection], out = [];
  for (const f of menuProviders) {
    let its = [];
    try { its = f(id, ids) || []; } catch (e) { console.error(e); }
    if (its.length) { if (out.length) out.push('-'); out.push(...its); }
  }
  return out;
}
function openCanvasMenu(ev, hit) {
  const id = hit && hit.n ? hit.n.id : null;
  if (id && !selection.has(id)) { did('select ' + quoteArg(id)); select(id, false); }   // 右键点没选中的:先只选它(和文件管理器一样);点选中里的:对整个选中
  showMenu(ev.clientX, ev.clientY, menuItems(id));
}
const firstKey = (line) => keysOf(line)[0] || '';
menuProviders.push((id, ids) => {
  if (!id) return [
    { label: '全选(画面里的)', cmd: 'select --all', key: firstKey('select --all') },
    ...(ids.length ? [{ label: `取消选择(${ids.length})`, cmd: 'select', key: 'Esc' }] : []),
    { label: '适应窗口', cmd: 'fit', key: firstKey('fit') },
  ];
  const n = raw.get(id), sn = isSpaces() ? compiled.node(id) : sim.get(id), multi = ids.length > 1, out = [];
  if (!multi && sn) {
    if (sn.container) {
      if (isSpaces()) out.push({ label: '进入', cmd: 'enter ' + quoteArg(id), key: firstKey('enter') });
      out.push({ label: (isSpaces() ? expandedSet.has(id) : sn.expanded) ? '收起' : '就地展开', cmd: 'expand ' + quoteArg(id), key: firstKey('expand') });
    } else if (fileOf(n)) out.push({ label: '打开', cmd: 'open ' + quoteArg(id), key: firstKey('enter') });
  }
  const boxes = ids.filter((x) => compiled.children(x).length);
  if (boxes.length) out.push({ label: '选中里面的全部', cmd: 'select --inside ' + boxes.map(quoteArg).join(' '), title: '沿容器关系递归' });
  const t = n && n.attrs.type;
  if (t) out.push({ label: `选中同类(${t})`, cmd: 'select --type ' + quoteArg(t), title: '画面里这一类的全部' });
  if (!window.__STARS_STATIC__ && !replay) out.push({ label: multi ? `删除 ${ids.length} 个` : '删除', cmd: 'delete', key: firstKey('delete') });
  return out;
});

// ---- 多选时的侧栏 ----
function multiPanel() {
  const ids = [...selection], types = new Map();
  for (const id of ids) { const t = typeOf(id); types.set(t, (types.get(t) || 0) + 1); }
  const live = !window.__STARS_STATIC__ && !replay;
  const rows = ids.slice(0, 300).map((id) => `<div class="row link" data-id="${esc(id)}"><span>${esc(raw.get(id)?.label || id)}</span><span class="tag">${esc(raw.get(id)?.attrs.type || '')}</span>`
    + `${id === selected ? '<span class="tag" title="主节点:双击、E、回车按它">主</span>' : ''}<span class="mini" data-selrm="${esc(id)}" title="移出选中(也可以 Ctrl / ⌘ + 点它)">×</span></div>`).join('');
  return `<h3>已选 ${ids.length} 个</h3>
    <div class="sub">${[...types].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${esc(t)} ×${c}`).join(' · ')}</div>
    <div class="btns" style="margin:6px 0">${live ? '<span class="btn" data-cmd="delete">删除</span>' : ''}<span class="btn" data-cmd="select">取消选择</span></div>
    <div class="sec"><div class="t">成员 ${ids.length > 300 ? '(只列前 300)' : ''}</div>${rows}</div>
    <div class="sc-hint">点一个 = 只选它 · Ctrl / ⌘ + 点星图 = 加进 / 移出 · 右键拖背景 = 框选(Ctrl 追加 · Shift 减去 · Ctrl+Shift 反选)· 右键点 = 菜单</div>`;
}
$('side-info').addEventListener('click', (ev) => {
  const x = ev.target.closest('[data-selrm]');
  if (!x) return;
  ev.stopPropagation();
  did(selLine([x.dataset.selrm], 'remove'));
  setSelection(combine(selection, [x.dataset.selrm], 'remove'));
});
