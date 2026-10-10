// ---------- 空间切换(有来源有目的 → 连续的过渡)----------
// 就地展开的子空间按容器体积等比缩放:疆域 E 一变大尺度就变小,把内容装回容器盘里 —— 边界不会被撑大。
// 代价是拖动成员时整组会往中间缩;抵消它的是"疆域张力"(见 tension):成员越远被拉回的力越大,
// 反作用力还把整组朝它推。两者收敛到"成员停在疆域边上、整组跟着走",不会失控地缩成一个点。
const scOf = (n, child) => (expandedSet.has(n.id) && P.fit !== '压入') ? 1 : (n.D * 0.92) / Math.max(child.E, 1);
/** 从当前空间走到目标容器:中间必须都是就地展开的(那样目标在画面里是看得见的) */
function pathWithin(fromId, targetId) {
  const chain = compiled.ancestors(targetId);
  let i = fromId === null ? 0 : chain.indexOf(fromId) + 1;
  if (fromId !== null && i === 0) return null;
  let sp = getSpace(fromId);
  const out = [];
  for (; i < chain.length; i++) {
    const n = sp.byId.get(chain[i]);
    if (!n) continue; // 被过滤掉的容器是透明的
    out.push(n);
    if (chain[i] === targetId) return out;
    if (!expandedSet.has(chain[i])) return null;
    sp = getSpace(chain[i]);
  }
  return null;
}
function setTransformNow(x, y, k) { d3.select(canvas).call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(k)); }

/** fly:显式进入(回车、按钮)—— 切换后再缩放动画到适应窗口,画面随 ρ 连续地从外面过渡到里面 */
function enterSpace(id, fly = false) {
  const path = pathWithin(curSpaceId, id);
  if (!path) return false;
  let ox = 0, oy = 0;
  for (const n of path) { ox += n.x; oy += n.y; } // 穿过就地展开的祖先,尺度都是 1
  const target = path[path.length - 1], child = getSpace(id), sc = scOf(target, child);
  const { x, y, k } = transform;
  fade = fadeOn() && path.length > 1 ? { kind: 'jump', fromId: curSpaceId, oldT: transform, t0: performance.now() } : null; // 穿过就地展开的几层:几何不连续,用淡入淡出
  curSpaceId = id; lastSwitchAt = performance.now(); stickyFocus = null; zoomFocusId = null; hovered = null;
  setTransformNow(x + k * ox, y + k * oy, k * sc);
  afterSwitch();
  if (fly) fitSpace(true);
  return true;
}
function exitSpace(fly = false) {
  if (curSpaceId === null) return false;
  const ps = holderOf(curSpaceId), n = ps.byId.get(curSpaceId), cur = getSpace(curSpaceId);
  if (!n) { jumpTo(ps.id); return true; }
  const sc = scOf(n, cur), { x, y, k } = transform, k2 = k / sc;
  fade = null;
  curSpaceId = ps.id; lastSwitchAt = performance.now(); stickyFocus = n.id; zoomFocusId = n.id; hovered = null; // 刚出来:它的内部继续按 ρ 淡出,不因指针不在它上面而突然消失
  setTransformNow(x - k2 * n.x, y - k2 * n.y, k2);
  afterSwitch();
  if (fly) fitSpace(true);
  return true;
}
/** 跨多级的跳转(面包屑、搜索结果):淡出旧空间,适应窗口地显示新空间 */
function jumpTo(id, focusId) {
  if (id === curSpaceId && !focusId) { fitSpace(true); return; }
  fade = fadeOn() ? { kind: 'jump', fromId: curSpaceId, oldT: transform, t0: performance.now() } : null;
  curSpaceId = id; lastSwitchAt = performance.now(); zoomFocusId = focusId ?? null; hovered = null;
  if (focusId) { const sp = getSpace(id), n = sp.byId.get(focusId); fitSpace(false); if (n) centerOn(n, sp); }
  else fitSpace(false);
  afterSwitch();
}
function afterSwitch() { renderStatus(); renderCrumbs(); savePlace(); }
// ---- 记住所在的位置:刷新后回到同一个空间、同样的展开(按项目目录 + 视图,存在浏览器里;选中不记,免得一刷新就打开文件)----
const placeKey = () => 'stars.place:' + (project ? project.dir : '_') + ':' + currentView;
function savePlace() {
  clearTimeout(placeTimer);
  placeTimer = setTimeout(() => {
    if (!compiled || replay || window.__STARS_STATIC__) return;
    const v = { space: curSpaceId, expanded: [...expandedSet], manual: [...manual] };
    try { if (v.space === null && !v.expanded.length && !v.manual.length) localStorage.removeItem(placeKey()); else localStorage.setItem(placeKey(), JSON.stringify(v)); } catch { /* 隐私模式 */ }
  }, 400);
}
function restorePlace() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(placeKey()) || 'null'); } catch { /* 隐私模式 / 坏数据 */ }
  if (!v || window.__STARS_STATIC__) return;
  curSpaceId = v.space && raw.has(v.space) ? v.space : null;   // 编译后还会再核对一次是不是容器
  expandedSet.clear(); for (const id of v.expanded || []) if (raw.has(id)) expandedSet.add(id);
  manual.clear(); for (const [id, on] of v.manual || []) if (raw.has(id)) manual.set(id, !!on);
}
function fitSpace(animate) {
  const sp = getSpace(curSpaceId);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const n of sp.nodes) { const r = n.fp; x0 = Math.min(x0, n.x - r); x1 = Math.max(x1, n.x + r); y0 = Math.min(y0, n.y - r); y1 = Math.max(y1, n.y + r); }
  if (!isFinite(x0)) { x0 = y0 = -50; x1 = y1 = 50; }
  const W = innerWidth, H = innerHeight;
  const k = Math.min(6, 0.84 * Math.min((W - 360) / Math.max(60, x1 - x0), (H - 80) / Math.max(60, y1 - y0)));
  const t = d3.zoomIdentity.translate(W / 2 - 20, H / 2 + 10).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  if (animate) d3.select(canvas).transition().duration(600).call(zoom.transform, t); else d3.select(canvas).call(zoom.transform, t);
}
function centerOn(n, sp) {
  const k = Math.max(transform.k, 10 / Math.max(n.r, 1));
  const t = d3.zoomIdentity.translate(innerWidth / 2 - 20, innerHeight / 2).scale(k).translate(-n.x, -n.y);
  d3.select(canvas).transition().duration(500).call(zoom.transform, t);
}
/** 让一个节点出现在画面里:必要时切换到它所在的空间 */
function reveal(id) {
  const holder = holderOf(id), holderId = holder.id;
  const path = pathWithin(curSpaceId, id);
  if (path) { let ox = 0, oy = 0; for (const n of path) { ox += n.x; oy += n.y; } centerOn({ x: ox, y: oy, r: path[path.length - 1].r }, null); return; }
  jumpTo(holderId, id);
}

/** 缩放手势触发的空间切换:放大且指针落在一个已经占据小半屏幕的容器上 → 进入;当前空间缩到很小 → 退出 */
function maybeSwitch(se, dir) {
  if (!dir || fade || performance.now() - lastSwitchAt < 450) return;
  const T = enterT();
  if (dir > 0) {
    let px = innerWidth / 2, py = innerHeight / 2;
    try { [px, py] = d3.pointer(se, canvas); } catch { /* 触摸等 */ }
    let best = null;
    for (const h of frameHits) {
      if (h.pv || !h.n.container || h.R < T || Math.hypot(px - h.sx, py - h.sy) > h.R) continue;
      if (!best || h.depth > best.depth || (h.depth === best.depth && h.R < best.R)) best = h;
    }
    if (best) requestAnimationFrame(() => enterSpace(best.n.id));
  } else if (curSpaceId !== null && getSpace(curSpaceId).E * transform.k / 0.92 < EXIT_AT * T) requestAnimationFrame(() => exitSpace());
}

function pickHit(px, py) {
  let best = null, bestDomain = null;
  for (const h of frameHits) {
    const d = Math.hypot(px - h.sx, py - h.sy);
    if (h.domain) { if (d <= h.R && (!bestDomain || h.depth > bestDomain.depth)) bestDomain = h; }
    else if (d <= h.sr + 4 && (!best || h.sr < best.sr)) best = h;
  }
  return best || bestDomain;
}

// 面包屑居中在顶部:两侧面板折叠(或用户拖窄)后把可用宽度让出来,否则长路径被截断
function updateCrumbWidth() {
  const el = $('crumbs'); if (!el) return;
  const GAP = 20, PAD = 12;
  const vis = (id) => { const e = $(id); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width > 0 ? r : null; };
  const lt = vis('tools'), rt = vis('side');
  const L = lt ? lt.right + GAP : PAD;
  const R = rt ? rt.left - GAP : innerWidth - PAD;
  const c = innerWidth / 2;
  el.style.maxWidth = Math.max(140, Math.floor(Math.min(R - L, 2 * (c - L), 2 * (R - c)))) + 'px';
}
function renderCrumbs() {
  const el = $('crumbs');
  if (!isSpaces()) { el.hidden = true; return; }
  el.hidden = false;
  const chain = curSpaceId === null ? [] : compiled.ancestors(curSpaceId);
  el.innerHTML = `<span class="crumb" data-c="" data-cmd="jump">🌌 宇宙</span>` + chain.map((id) => `<span class="sep">›</span><span class="crumb" data-c="${esc(id)}" data-cmd="jump ${esc(quoteArg(id))}">${esc(raw.get(id)?.label || id)}</span>`).join('')
    + `<span class="hint">放大进入 · 缩小返回 · 双击就地展开</span>`;
  updateCrumbWidth();
}

function drawSpacesFrame(now) {
  frameHits = []; frameLabels = []; frameEdges = [];
  drawnSpaces.clear();
  if (!compiled) return;
  const k = transform.k;
  const x = transform.x, y = transform.y;
  const p = fade ? Math.min(1, (now - fade.t0) / 420) : 1, ease = p * p * (3 - 2 * p);
  if (fade && p < 1) { // 过渡:旧空间按"来源—目的"的几何关系画出来,渐隐
    try {
      if (fade.kind === 'enter') { const kP = k / fade.sc; drawSpace(getSpace(fade.fromId), x - kP * fade.ox, y - kP * fade.oy, kP, 1 - ease, 0, now, fade.skip); }
      else if (fade.kind === 'exit') { const n = fade.node; drawSpace(getSpace(fade.fromId), x + k * n.x, y + k * n.y, k * fade.sc, 1 - ease, 0, now, null); }
      else drawSpace(getSpace(fade.fromId), fade.oldT.x, fade.oldT.y, fade.oldT.k, 1 - ease, 0, now, null);
    } catch { fade = null; }
    frameHits = []; frameLabels = []; frameEdges = []; // 旧空间不参与交互
  }
  const cur = getSpace(curSpaceId);
  let morphC = null;
  if (!fade && curSpaceId !== null) { // 外面:父空间按"来源—目的"的几何画在下面,画法和在外面时一样(焦点就是当前空间)
    const ps = holderOf(curSpaceId), c = ps.byId.get(curSpaceId);
    if (c && !expandedSet.has(c.id)) {
      const r = cur.E * k / 0.92 / enterT(), sc = scOf(c, cur), kP = k / sc, e = innerAlpha(r);
      if (outerAlpha(r) > 0.01 || e < 0.999) { drawSpace(ps, x - kP * c.x, y - kP * c.y, kP, 1, 0, now, null, 'context', { focusId: c.id }); frameLabels = frameLabels.filter((L) => (L.fade ?? 1) >= 0.25); }
      if (e < 0.999 && fadeOn()) morphC = { host: c, hs: kP, e };
    }
  }
  drawSpace(cur, x, y, k, fade ? Math.max(0.05, ease) : 1, 0, now, null, '', { morph: morphC });
  drawStubs(cur, x, y, k, fade ? ease : morphC ? morphC.e : 1);
  if (fade && p >= 1) fade = null;
  heatSpaces();

  // 屏幕空间:选中 / 问题 / 回放差异的环,标签
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.setLineDash([]);
  for (const h of frameHits) {
    const rr = h.domain ? h.R + 3 : h.sr + 3, sev = issueByNode.get(h.n.id);
    if (sev === 'error' || sev === 'warn') { ctx.strokeStyle = sev === 'error' ? 'rgba(255,90,90,.9)' : 'rgba(255,179,71,.9)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(h.sx, h.sy, rr, 0, TAU); ctx.stroke(); }
    if (raw.get(h.n.id)?.attrs.status === 'proposed') { ctx.strokeStyle = 'rgba(255,210,74,.9)'; ctx.lineWidth = 1.3; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(h.sx, h.sy, rr + 1.5, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }   // 待确认的节点:黄色虚线环(同提议的边)
    { const ring = diffRing(h.n.id); if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(h.sx, h.sy, rr + 5, 0, TAU); ctx.stroke(); } }
    if (!h.domain && selShown(h.n.id)) { ctx.strokeStyle = h.n.id === selected ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(h.sx, h.sy, rr + 3, 0, TAU); ctx.stroke(); }
  }
  drawFrameLabels();
}

function drawFrameLabels() {
  frameLabels.sort((a, b) => b.prio - a.prio);
  const placed = [];
  ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
  let n = 0;
  for (const L of frameLabels) {
    if (n > 260) break;
    const fs = L.small ? 10 : 11.5;
    ctx.font = `${fs}px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
    const w = ctx.measureText(L.text).width;
    const x0 = L.anchor > 0.3 ? L.sx : L.anchor < -0.3 ? L.sx - w : L.sx - w / 2;
    const box = [x0 - 2, L.sy - 1, x0 + w + 2, L.sy + fs + 2];
    if (L.prio < 1e9 && placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) continue;
    placed.push(box); n++;
    const la = Math.max(0.3 * (L.fade ?? 1), Math.min(1, L.alpha ?? 1));
    if (la < 0.06) continue;
    ctx.globalAlpha = la;
    if (!L.small) { ctx.strokeStyle = 'rgba(2,2,10,0.85)'; ctx.lineWidth = 3; ctx.strokeText(L.text, x0, L.sy); }
    ctx.fillStyle = L.color || '#e8e8f6'; ctx.fillText(L.text, x0, L.sy);
  }
  ctx.globalAlpha = 1;
}

function fit() {
  if (isSpaces()) { fitSpace(true); return; }
  const vis = simulation.nodes().filter((n) => n.x !== undefined);
  if (!vis.length) return;
  const xs = vis.map((n) => n.x), ys = vis.map((n) => n.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const bar = $('tagbar').hidden ? 0 : $('tagbar').getBoundingClientRect().height + 16; // 底部的 tag 栏会挡住一块
  const H = innerHeight - bar;
  const k = Math.min(2.2, 0.82 * Math.min((innerWidth - 340) / Math.max(80, x1 - x0), H / Math.max(80, y1 - y0)));
  const t = d3.zoomIdentity.translate(innerWidth / 2 - 20, H / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  d3.select(canvas).transition().duration(700).call(zoom.transform, t);
}
