// 端点:就地展开的容器,连线停在它的疆界上
function endPoint(n, other) {
  if (!expandedSet.has(n.id)) return n;
  const child = getSpace(n.id), E = child.E * scOf(n, child) + 4, dx = other.x - n.x, dy = other.y - n.y, d = Math.hypot(dx, dy) || 1;
  return { x: n.x + dx / d * E, y: n.y + dy / d * E, r: 0 };
}

function drawSpaceEdges(sp, tx, ty, s, aOf, map = null, hits = false) {
  const W = innerWidth, H = innerHeight, buckets = new Map(), few = sp.links.length < 400;
  for (const l of sp.links) {
    const a0 = map ? map(l.source) : l.source, b0 = map ? map(l.target) : l.target;
    const ea = expandedSet.has(a0.id), eb = expandedSet.has(b0.id);
    if ((ea || eb) && l.lifted) continue; // 展开后,细节由内部节点直接连出去
    const a = endPoint(a0, b0), b = endPoint(b0, a0);
    const ax = tx + a.x * s, ay = ty + a.y * s, bx = tx + b.x * s, by = ty + b.y * s;
    if (Math.max(ax, bx) < -40 || Math.min(ax, bx) > W + 40 || Math.max(ay, by) < -40 || Math.min(ay, by) > H + 40) continue;
    if (Math.hypot(bx - ax, by - ay) < 2) continue;
    const al = Math.min(aOf(a0), aOf(b0));
    const hot = edgeHot(a0.id, b0.id) || edgeIsSel(l);
    const faint = l.mode !== 'line';
    const w = (l.width || 1) * (l.lifted ? 0.8 + Math.min(Math.log2(l.count + 1), 3) * 0.5 : 1) * (hot ? 1.8 : 1);
    const op = al * (hot ? 0.95 : faint ? 0.16 : 0.42);
    const dash = l.proposed ? 'p' : l.lifted ? 'l' : '';
    const key = `${l.proposed ? 'p' : l.color}|${Math.round(op * 20)}|${Math.round(w * 4)}|${dash}`;
    let bk = buckets.get(key);
    if (!bk) { bk = { col: l.proposed ? [255, 210, 74] : hex2rgb(l.color), op, w, dash, segs: [], arrows: [] }; buckets.set(key, bk); }
    bk.segs.push(a, b);
    if (hits && l.mode !== 'hidden') frameEdges.push({ ax, ay, bx, by, l });   // 点选边用
    if ((few || hot) && l.arrow) bk.arrows.push([a, b0 === l.target && !eb ? b0 : b]);
    if ((l.lifted || l.count > 1) && (few || hot)) frameLabels.push({ text: '×' + l.count, sx: (ax + bx) / 2, sy: (ay + by) / 2 - 7, prio: 20, color: l.lifted ? '#b9c4ff' : '#9aa', small: true, alpha: al });
  }
  for (const bk of buckets.values()) {
    ctx.strokeStyle = rgba(bk.col, bk.op); ctx.lineWidth = bk.w / s;
    ctx.setLineDash(bk.dash === 'p' ? [5 / s, 4 / s] : bk.dash === 'l' ? [2 / s, 4 / s] : []);
    ctx.beginPath();
    for (let i = 0; i < bk.segs.length; i += 2) { ctx.moveTo(bk.segs[i].x, bk.segs[i].y); ctx.lineTo(bk.segs[i + 1].x, bk.segs[i + 1].y); }
    ctx.stroke(); ctx.setLineDash([]);
    for (const [a, b] of bk.arrows) drawArrow(a, b, bk.col, Math.min(1, bk.op * 1.5), s);
  }
}

/**
 * mode:'' 正常;'context' 当前空间外面的衬底(不参与交互、不保持热量);'preview' 正在放大的容器的内部。
 * opt.focusId:画衬底时指明"正被钻进去的那个"(就是当前所在的子空间),和在外面时画得一模一样。
 * opt.morph = { host, hs, e }:这个空间是 host 这个小星系"展开"出来的。星系的每颗粒子对应一个后代:
 *   e 从 0 到 1,粒子从旋臂上的位置一路移到对应节点的真实位置、长成那颗节点(孙辈的粒子汇入它所在的子星系)。
 *   e = 0 时就是原来的星系,e = 1 时就是真实的空间 —— 全程每个东西只出现一次,不会有粒子和节点叠在一起的重影。
 */
function drawSpace(sp, tx, ty, s, alpha, depth, now, skipId, mode = '', opt = {}) {
  if (!mode) drawnSpaces.add(sp);
  if (alpha <= 0.01 || depth > 8) return;
  const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  const setT = () => { ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty); curK = s; };
  setT();
  const onScr = (n, rad) => { const x = tx + n.x * s, y = ty + n.y * s, m = rad * s + 30; return x > -m && x < W + m && y > -m && y < H + m; };
  const hitsOn = mode !== 'context' && !(mode === 'preview' && alpha < 0.5);
  const hit = (h) => { if (!hitsOn) return; if (mode) h.pv = true; frameHits.push(h); }; // pv:预览里的东西可以点选,但不能作为"放大进入"的目标
  const morph = opt.morph && opt.morph.e < 0.999 ? opt.morph : null, mE = morph ? morph.e : 1;
  // 焦点容器:放大时正被钻进去的那个(指针所在、盘最大;刚从它里面退出来时优先它)。
  // 它的内部随 ρ 展开(见 morph)、它自己的光晕随 ρ 淡出,外面的东西随 ρ 淡出
  let focus = null, aIn = 0, aOutF = 1;
  if (mode === 'context' && opt.focusId) focus = sp.byId.get(opt.focusId) || null;
  else if (depth === 0 && !mode && !morph) {
    // 进入/退出只由缩放决定:指针只在"正在缩放"时用来挑目标;鼠标悬浮本身不改变任何淡入淡出。
    const T = enterT();
    if (performance.now() - lastUserZoom < 220) {
      const [px, py] = pointerXY || [W / 2, H / 2];
      let pick = null;
      for (const n of sp.nodes) {
        if (!n.container || expandedSet.has(n.id) || n.id === skipId) continue;
        const R = n.D * s; if (R < 0.4 * T) continue;
        const d = Math.hypot(tx + n.x * s - px, ty + n.y * s - py);
        if (n.id === stickyFocus && d <= R * 1.6) { pick = n; break; }
        if (d <= R && (!pick || R > pick.D * s)) pick = n;
      }
      zoomFocusId = pick ? pick.id : null;
      if (!pick) stickyFocus = null;
    }
    focus = zoomFocusId ? (sp.byId.get(zoomFocusId) || null) : null;
    if (focus && focus.D * s < 0.4 * T) focus = null; // 没在"进入"的容器不画预览,避免残留
  }
  if (focus) { const r = focus.D * s / enterT(); aIn = innerAlpha(r); aOutF = outerAlpha(r); }
  // 展开中:匹配到粒子的节点从粒子的位置插值到真实位置(用代理对象画,不动模拟里的节点)
  let nodesV = sp.nodes, mapN = null;
  if (morph) {
    const { host, hs, e } = morph, f = hs / s, kids = host.kidRgb || [], len = kids.length;
    const idx = new Map(kids.map((k, i) => [k[2], i])), prox = new Map();
    nodesV = sp.nodes.map((n) => {
      const i = idx.get(n.id);
      if (i === undefined) return n;
      const [dx, dy, pr] = armPoint(host, i, len, now), p = Object.create(n);
      p.real = n; p.x = dx * f + (n.x - dx * f) * e; p.y = dy * f + (n.y - dy * f) * e; p.r = pr * f + (n.r - pr * f) * e;
      prox.set(n, p);
      return p;
    });
    mapN = (n) => prox.get(n) || n;
    const aq = Math.round(alpha * (1 - e) * 8) / 8; // 粒子:移向自己的节点(孙辈移向它所在的子星系),随 e 淡出
    if (aq > 0) {
      for (let i = 0; i < len; i++) {
        const [col, , id] = kids[i], [dx, dy, pr] = armPoint(host, i, len, now);
        let to = sp.byId.get(id);
        if (!to) for (let up = compiled.parentOf(id); up && !to; up = compiled.parentOf(up)) to = sp.byId.get(up);
        const fx = dx * f, fy = dy * f, gx = to ? to.x : fx, gy = to ? to.y : fy;
        pushParticle(col, aq, fx + (gx - fx) * e, fy + (gy - fy) * e, pr * f);
      }
      flushParticles();
    }
  }
  // 选中:全局变暗。豁免 = 选中的、它的邻居、以及它展开出来的整棵子树(在任意一层都成立)
  const hl = selected && P.highlight > 0 ? hlSet() : null;
  const selSub = !!(hl && sp.id != null && compiled.ancestors(sp.id).some((a) => selection.has(a)));
  const aOf = (n) => alpha * mE * (n === focus ? 1 - aIn : aOutF) * (filt && !qOK(n) ? 0.12 : (hl && !selSub && !hl.has(n.id)) ? 0.3 : 1);
  ctx.globalCompositeOperation = look === 'galaxy' ? 'lighter' : 'source-over';
  drawSpaceEdges(sp, tx, ty, s, morph ? (n) => aOf(n) * mE : aOf, mapN, hitsOn); // 展开中连线晚一点出现(∝ e²)
  const real = (n) => n.real || n;
  // 标签等展开过半才出现(挤在星系中心的半透明字只会添乱)
  const lblA = morph ? smooth((mE - 0.45) / 0.4) : 1, lab = (n) => aOf(n) / mE * lblA;

  const inPlace = [];
  for (const n of nodesV) { // 收起的容器:小星系(在下层)
    if (!n.container || n.id === skipId) continue;
    if (expandedSet.has(n.id)) { inPlace.push(n); continue; }
    if (!onScr(n, n.D * 1.7)) continue;
    const R = n.D * s, sx = tx + n.x * s, sy = ty + n.y * s;
    if (n.r * s < 1.2) { ctx.fillStyle = rgba(n.core, 0.8 * aOf(n)); ctx.fillRect(n.x - 1 / s, n.y - 1 / s, 2 / s, 2 / s); }
    else drawNode(n, now, aOf(n), n !== focus); // 焦点容器的旋臂由展开中的粒子代替
    if (real(n) === hovered) hoverRing(real(n));
    hit({ n: real(n), sp, depth, sx, sy, sr: Math.max(R * 0.75, 6), R, tx, ty, s });
    if (R >= 10 || mustLabel(n) || (filt && matchAnc.has(n.id))) {
      const cnt = filt && matchAnc.has(n.id) ? `  ·${matchAnc.get(n.id)} 处匹配` : '';
      if (lblA > 0.02) frameLabels.push({ text: n.label + cnt, sx, sy: sy + Math.max(R * 0.55, 6) + 3, prio: mustLabel(n) ? 1e9 : 1e5 + R, color: '#dfe3ff', alpha: lab(n), fade: alpha * lblA * (n === focus ? 1 - aIn : aOutF) });
    }
  }
  flushParticles();
  for (const n of nodesV) { // 叶子
    if (n.container || n.id === skipId || !onScr(n, n.r * 5)) continue;
    const sx = tx + n.x * s, sy = ty + n.y * s, sr = n.r * s;
    if (sr < 2.2 && n.id !== selected) { const q = Math.max(1.2 / s, n.r * 0.9); ctx.fillStyle = rgba(n.core, 0.9 * aOf(n)); ctx.fillRect(n.x - q / 2, n.y - q / 2, q, q); }
    else drawNode(n, now, aOf(n));
    if (real(n) === hovered) hoverRing(real(n));
    const age = now - (n.born || -1e9);
    if (age < 1800) { const p = age / 1800; ctx.strokeStyle = rgba(n.rgb, (1 - p) * 0.9 * alpha); ctx.lineWidth = 2 / s; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 4 + p * 50, 0, TAU); ctx.stroke(); }
    hit({ n: real(n), sp, depth, sx, sy, sr: Math.max(sr * 1.4, 5), R: sr, tx, ty, s });
    if (lblA > 0.02 && (sr >= 4 || mustLabel(n) || sp.nodes.length <= 16)) frameLabels.push({ text: n.label, sx, sy: sy + sr * 1.3 + 3, prio: mustLabel(n) ? 1e9 : sr, color: '#e8e8f6', alpha: lab(n), fade: alpha * lblA * aOutF });
  }
  flushParticles();
  for (const n of inPlace) { // 就地展开:疆界 + 子空间(物理独立;开启"紧凑展开"时按容器体积等比缩小)
    const child = getSpace(n.id), cs = scOf(n, child);
    const E = child.E * cs + 4, cx = tx + n.x * s, cy = ty + n.y * s, R = E * s, s2 = s * cs;
    if (!onScr(n, E + 30)) continue;
    ctx.globalCompositeOperation = 'source-over'; setT();
    if (boundsOn()) { // 文件夹的虚线边界 + 半透明底,可关;关掉后交互与文字仍在
      ctx.beginPath(); ctx.arc(n.x, n.y, E, 0, TAU);
      ctx.fillStyle = rgba(n.rgb, 0.05 * aOf(n)); ctx.fill();
      ctx.strokeStyle = rgba(n.rgb, (selShown(n.id) ? 0.65 : 0.32) * aOf(n)); ctx.lineWidth = 1.2 / s; ctx.setLineDash([6 / s, 5 / s]); ctx.stroke(); ctx.setLineDash([]);
    }
    frameLabels.push({ text: n.label, sx: cx, sy: cy - R - 16, prio: 6e5 + R, color: '#cfd6ff', alpha: aOf(n), fade: alpha * mE * aOutF });
    hit({ n: real(n), sp, depth, sx: cx, sy: cy, sr: R, R, tx, ty, s, domain: true });
    drawSpace(child, cx, cy, s2, alpha * mE * aOutF, depth + 1, now, null, mode);
    setT();
    drawInnerLinks(child, n, sp, s, alpha * mE * aOutF, cs);
  }
  if (focus && mode !== 'context' && fadeOn()) { // 正在钻进去的容器:它的小星系展开成内部的空间(同样的几何,画在盘里)
    const child = getSpace(focus.id);
    drawSpace(child, tx + focus.x * s, ty + focus.y * s, s * scOf(focus, child), alpha, depth + 1, now, null, 'preview', { morph: { host: focus, hs: s, e: aIn } });
    setT();
  }
}

/** 就地展开的容器里,通向外面的关系:如果对方在这个空间里看得见,直接连过去(不同层级在一起时才能看到的连线) */
function drawInnerLinks(child, container, sp, s, alpha, cs = 1) {
  if (!child.external.length) return;
  ctx.globalCompositeOperation = look === 'galaxy' ? 'lighter' : 'source-over';
  for (const x of child.external) {
    const q = child.byId.get(x.node), target = sp.byId.get(x.other);
    if (!q || !target || target === container) continue;
    const a = { x: container.x + q.x * cs, y: container.y + q.y * cs }, b = endPoint(target, a);
    const col = hex2rgb(x.color), hot = edgeHot(q.id, target.id);
    ctx.strokeStyle = rgba(col, alpha * (hot ? 0.9 : 0.38)); ctx.lineWidth = (hot ? 1.6 : 1) / s;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (x.out) drawArrow(a, { ...b, r: target.r || 0 }, col, alpha * 0.7, s); else drawArrow(b, { ...a, r: q.r * cs }, col, alpha * 0.7, s);
  }
}

/** 当前空间通向外面的关系:从子节点伸向空间边界的短桩,方向指向外面那个对象在父空间里的方位 */
function drawStubs(sp, tx, ty, s, alpha) {
  if (curSpaceId === null || !sp.external.length) return;
  const ps = holderOf(curSpaceId), me = ps.byId.get(curSpaceId);
  if (!me) return;
  const R = sp.E * 1.05, dirCache = new Map();
  const dirTo = (other) => {
    if (dirCache.has(other)) return dirCache.get(other);
    let t = ps.byId.get(other);
    if (!t) for (const id of compiled.ancestors(other)) { t = ps.byId.get(id); if (t) break; }
    let dx, dy;
    if (t && t !== me) { dx = t.x - me.x; dy = t.y - me.y; } else { dx = me.x || 1; dy = me.y || 0; } // 在更外层:朝外
    const d = Math.hypot(dx, dy) || 1, v = [dx / d, dy / d];
    dirCache.set(other, v); return v;
  };
  ctx.setTransform((devicePixelRatio || 1) * s, 0, 0, (devicePixelRatio || 1) * s, (devicePixelRatio || 1) * tx, (devicePixelRatio || 1) * ty);
  ctx.globalCompositeOperation = 'source-over';
  for (const x of sp.external) {
    const n = sp.byId.get(x.node); if (!n) continue;
    const [ux, uy] = dirTo(x.other), ex = ux * R, ey = uy * R, col = hex2rgb(x.color);
    const hot = selected && n.id === selected;
    ctx.strokeStyle = rgba(col, alpha * (hot ? 0.85 : 0.4)); ctx.lineWidth = 1 / s; ctx.setLineDash([3 / s, 4 / s]);
    ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = rgba(col, alpha * 0.8); ctx.beginPath(); ctx.arc(ex, ey, 2.5 / s, 0, TAU); ctx.fill();
    frameLabels.push({ text: `${x.out ? '→' : '←'} ${raw.get(x.other)?.label || x.other}${x.count > 1 ? ' ×' + x.count : ''}`, sx: tx + ex * s + ux * 8, sy: ty + ey * s + uy * 8 - 6, prio: 40 + x.count, color: x.color, small: true, alpha, anchor: ux });
  }
}
