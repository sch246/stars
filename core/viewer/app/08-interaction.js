// ---------- 交互 ----------
const find = (px, py) => {
  if (isSpaces()) { const h = pickHit(px, py); return h && !h.domain ? h.n : null; }
  const kk = transform.k;
  return simulation.find((px - transform.x) / kk, (py - transform.y) / kk, 16 / kk + 6);
};
const zoom = d3.zoom().scaleExtent([0.08, 10])
  // 只有落在**真正的节点(亮点)**上才把鼠标交给 d3.drag;文件夹的虚线疆界 = 背景,照常拖动平移
  .filter((ev) => {
    if (ev.button) return false;
    if (ev.type !== 'mousedown') return true;
    const h = isSpaces() ? pickHit(ev.offsetX, ev.offsetY) : find(ev.offsetX, ev.offsetY);
    return !(h && !h.domain);
  })
  .on('zoom', (ev) => {
    const prevK = transform.k;
    transform = ev.transform;
    if (ev.sourceEvent) {
      userMoved = true;
      const kChanged = Math.abs(transform.k - prevK) > 1e-4;
      if (kChanged) lastUserZoom = performance.now(); // 只有缩放算"进出意图",平移不算
      else if (ev.sourceEvent.type === 'mousemove' && followId) select(null); // 拖背景 = 脱离锁定
      if (isSpaces()) maybeSwitch(ev.sourceEvent, transform.k > prevK * 1.0001 ? 1 : transform.k < prevK * 0.9999 ? -1 : 0);
    }
  });
d3.select(canvas).call(zoom).on('dblclick.zoom', null);
// 按下和拖动都不改变温度与动力学:按下什么都不做;指针挪动超过 3px 才算拖动,拖动只是给被拖的节点加一个
// 指向指针的拉力(见 pullTo),不钉住它。(温度一变平衡点就变:斥力/引力随温度缩放而碰撞不随,
// 以前按住时整张图会收缩、松开又弹回去。)唯一的例外:热量关着时模拟是停的,力推不动任何东西,
// 这时拖动临时升到热量设定值,松手后冷却。
let drag = null;   // { sx, sy, px, py, h, n, sim, moved, warmed, g, gpw }
let pullDbg = null;   // 调试用:最近一次拖动力的计算
d3.select(canvas).call(d3.drag()
  .subject((ev) => {
    // 只有亮点(真正的节点,包括收起的小星系)是拖动把手;文件夹的虚线疆界(半透明底)不是 ——
    // 它和背景一样:点击仍旧选中那个文件夹,按下拖动 = 平移镜头。展开的文件夹靠拖它里面的成员来整组移动(见 pullTo)。
    if (isSpaces()) { const h = pickHit(ev.x, ev.y); return h && !h.domain ? { h, x: ev.x, y: ev.y } : null; }
    return find(ev.x, ev.y);
  })
  .on('start', (ev) => {
    const h = ev.subject.h;
    drag = { sx: ev.sourceEvent.offsetX, sy: ev.sourceEvent.offsetY, px: ev.sourceEvent.offsetX, py: ev.sourceEvent.offsetY, h, n: h ? h.n : ev.subject, sim: h ? h.sp.sim : simulation, moved: false, warmed: false };
  })
  .on('drag', (ev) => {
    if (!drag) return;
    const px = ev.sourceEvent.offsetX, py = ev.sourceEvent.offsetY;
    drag.px = px; drag.py = py;   // 只记指针在屏幕上的位置;世界目标每帧在 pullTo 里按当前相机重算
    if (!drag.moved) {
      if (Math.hypot(px - drag.sx, py - drag.sy) < 3) return;   // 手抖不算拖动
      drag.moved = true;
      lastTap = null;   // 真拖动过:清掉"原地双击"的记忆
      const lockT = followId;
      if (lockT && drag.n && drag.n.id !== lockT) select(null);   // 拖别的元素 = 脱离锁定;拖锁定本体不脱离 —— 它钉在中心、世界绕它转
      const running = drag.h ? heated.has(drag.h.sp) : heatOn(); // 拖动只影响这个节点所在的空间(物理独立)
      if (!running) { drag.warmed = true; if (drag.h) drag.h.sp.dragging = true; drag.sim.alpha(Math.max(drag.sim.alpha(), P.heatLevel)).alphaTarget(P.heatLevel).restart(); }
      // 拖的是就地展开空间里的成员:张力会把整组也带上(见 tension),所以父空间也得有温度
      if (drag.h && !drag.h.domain) {
        const g = drag.g = groupOf(drag.h.sp);
        if (g && !simActive(g.ps)) { drag.gpw = g.ps; g.ps.dragging = true; g.ps.sim.alpha(Math.max(g.ps.sim.alpha(), P.heatLevel)).alphaTarget(P.heatLevel).restart(); }
      }
    }
  })
  .on('end', () => {
    const d = drag; drag = null;
    if (!d) return;
    // 单击(没拖动)不在这里选中:交给 canvas 的 click 统一处理,好把"原地双击"算在第一次点击的目标上
    if (d.warmed) { if (d.h) d.h.sp.dragging = false; d.sim.alphaTarget(d.h ? (heated.has(d.h.sp) ? heatLevel() : 0) : heatLevel()); }
    if (d.gpw) { d.gpw.dragging = false; d.gpw.sim.alphaTarget(heated.has(d.gpw) ? heatLevel() : 0); }
  }));
canvas.addEventListener('mousemove', (ev) => { pointerXY = [ev.offsetX, ev.offsetY]; hovered = find(ev.offsetX, ev.offsetY) || null; canvas.style.cursor = hovered ? 'pointer' : 'default'; });
// 点击统一入口(选中 + 原地双击)。canvas 的 click 只在"没有真正拖动"时触发,所以拖动不会被误当成点击。
let lastTap = null;                        // 第一次点击:{ id, x, y, t }
const TAP_MS = 500, TAP_PX = 10;           // 原地双击:同一屏幕位置,500ms 以内(和系统双击阈值一致)
function performDouble(id) {   // 双击 = 执行这类节点的双击命令(设置 → 快捷键 → 双击,keys.llf 的 dblclick)
  if (id == null) return;
  const line = dblLine(id);
  if (line) exec(line, 'mouse');
}
function handleTap(px, py, hit) {
  const now = performance.now();
  if (lastTap && now - lastTap.t < TAP_MS && Math.hypot(px - lastTap.x, py - lastTap.y) < TAP_PX) {
    // 第二次点击仍落在第一次的位置附近 → 算在第一次的目标上,第二次点到的"当地东西"忽略(镜头已经移动也不影响)
    const id = lastTap.id; lastTap = null;
    performDouble(id);
    return;
  }
  lastTap = { id: hit && hit.n ? hit.n.id : null, x: px, y: py, t: now };
  const id = hit ? hit.n.id : null;
  if (id !== selected) did(id ? 'select ' + quoteArg(id) : 'select', 'mouse');   // 回显:点一下 = select 命令
  select(id, false);
}
// "原地双击"在捕获阶段处理:第二次按下先只记成候选,抬起时还没怎么移动才算双击。
// 这样即使第一次点击后镜头移动、甚至详情面板(看文件时会展开到 600px)盖住了那个位置,双击仍算在第一次的目标上;
// 而"点一下再按住拖"不会被误判成双击——一旦移动超过 3px 候选就作废,拖动照常。
let swallowClick = false, dblCand = null;
addEventListener('mousedown', (ev) => {
  swallowClick = false; dblCand = null;
  if (!lastTap || ev.button) return;
  if (performance.now() - lastTap.t < TAP_MS && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < TAP_PX) dblCand = { id: lastTap.id, x: ev.clientX, y: ev.clientY };
}, true);
addEventListener('mousemove', (ev) => { if (dblCand && Math.hypot(ev.clientX - dblCand.x, ev.clientY - dblCand.y) > 3) dblCand = null; }, true);
addEventListener('mouseup', () => {
  if (!dblCand) return;
  const id = dblCand.id; dblCand = null; lastTap = null; swallowClick = true;
  performDouble(id);   // 第二次是原地点击(没有拖动)→ 算在第一次点击的目标上
}, true);
addEventListener('click', (ev) => {
  if (!swallowClick) return;
  swallowClick = false; ev.preventDefault(); ev.stopPropagation();
}, true);
canvas.addEventListener('click', (ev) => {
  let hit = null;
  if (isSpaces()) hit = pickHit(ev.offsetX, ev.offsetY);
  else { const n = find(ev.offsetX, ev.offsetY); hit = n ? { n } : null; }
  handleTap(ev.clientX, ev.clientY, hit);
});
$('q').addEventListener('input', (ev) => { query = ev.target.value.trim(); ev.target.classList.toggle('expr', query.startsWith('=')); if (!query) qEditing = null; computeMatches(); });
$('qbar').addEventListener('click', (ev) => { if (ev.target.closest('[data-qsave]')) saveQueryFromBox(); });
addEventListener('keydown', (ev) => onKey(ev));   // 键 → 命令:见下面的「命令」一节(KEYMAP)
