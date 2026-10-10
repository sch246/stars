// ======================= 嵌套空间 =======================
// 每个容器是一个独立的小世界:只有它的直接子节点,只受内部关系约束,和外界没有力的交互。
//  · 放大越过阈值 = 切换到子空间(像 cd 进目录),外面不再画;缩小 = 回到父空间。有来源有目的,所以有连续的过渡动画。
//  · 双击 / E = 显式的就地展开:把子空间以同样的尺度画在原地(内部物理仍独立),父空间给它让出位置。
const isSpaces = () => !!compiled && compiled.layout === 'spaces';
// 缩放时的交叉淡入淡出:只由 ρ(容器在屏幕上的盘半径;在子空间里时用子空间的范围折算)决定,
// 所以切换前后是同一幅画面 —— 切换本身只改变"当前空间"是谁。进入 ρ ≥ T、退出 ρ < 0.95T:
// 只留 5% 防抖(画面是连续的,来回切换也看不出来),放大一点进去、缩小一点就出来。
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const enterT = () => (P.enterAt > 0 ? P.enterAt : compiled.enterAt) * Math.min(innerWidth, innerHeight);
const fadeOn = () => P.fade > 0;                                                             // 关掉:内外直接切换,没有任何交叉淡入淡出
const innerAlpha = (r) => (fadeOn() ? smooth((r - 0.4) / 0.6) : (r >= 1 ? 1 : 0));           // r = ρ / T
const outerAlpha = (r) => (fadeOn() ? (1 - 0.85 * smooth((r - 0.6) / 1.6)) * (1 - smooth(r - 3)) : 1);
const EXIT_AT = 0.95;
let pointerXY = null, stickyFocus = null, zoomFocusId = null;
const spaces = new Map();          // 容器 id('' = 顶层)→ 空间
let spaceVer = 0;
let curSpaceId = null;             // 当前所在的空间,null = 顶层
const expandedSet = new Set();     // 就地展开的容器
let fade = null;                   // 空间切换的过渡
let frameHits = [], frameLabels = [];
let lastSwitchAt = 0;
let matchSet = new Set(), matchAnc = new Map();
const BODY = 4.2;                  // 收起的容器在父空间里的"盘"半径 = r × BODY
const PAD = 16;                    // 就地展开的疆域外留的空隙(兄弟节点和它们的标签不贴着疆界)
const keyOf = (id) => id ?? '';

function decorate(n, old) {
  n.rgb = hex2rgb(n.color); n.core = mix(n.rgb, [255, 255, 255], 0.65);
  n.kidRgb = n.kids ? n.kids.map(([c, r, id]) => [hex2rgb(c), r, id]) : null;
  n.phase = old ? old.phase : Math.random() * TAU; n.tilt = (n.phase - 3) * 0.3;
  n.D = n.container ? n.r * BODY : 0;
  n.born = old ? old.born : 0;
}
function measure(sp) {
  let E = 24;
  for (const n of sp.nodes) E = Math.max(E, Math.hypot(n.x, n.y) + n.fp);
  sp.E = E;
}
function updateFootprints(sp) {
  const fit = P.fit === '压入';
  for (const n of sp.nodes) n.fp = n.container ? (expandedSet.has(n.id) ? (fit ? n.D : getSpace(n.id).E + PAD) : n.D) : n.r * 1.6 + 2;
}
// 斥力只负责"把节点匀开",按节点自己的体(收起的盘 / 叶子)线性给;不能按 fp(就地展开后的整个疆域)给,
// 更不能按平方给:疆域越大斥力越大 → 兄弟被推得越远 → 父疆域更大 → 在上一层斥力更大,层层放大。
// 不重叠交给碰撞(半径 = fp),它只在真的挨上时起作用。
const bodyOf = (d) => (d.container ? d.D : d.r * 1.6 + 2);
function applyForces(sp) { // d3 的力在 initialize 时缓存每个节点的半径/强度,改了 fp 或参数要重新设置
  sp.sim.force('link').distance((l) => (l.distance ?? 60) * 0.5 * P.link + l.source.fp + l.target.fp);
  sp.sim.force('collide').radius((d) => d.fp + P.gap);
  sp.sim.force('charge').strength((d) => -(20 + bodyOf(d) * 4) * P.charge);
  sp.sim.force('x').strength(0.05 * P.gravity); sp.sim.force('y').strength(0.05 * P.gravity);
  sp.sim.velocityDecay(P.friction);
}
/** 视图里 contains 关系的 spin:空间里的成员绕空间中心公转(像星系自转),只在保持热量时生效 */
const spaceSpin = () => { const sp = draftSpec ?? specs[currentView] ?? {}; return (sp.relations && sp.relations[(sp.expand && sp.expand.relation) || 'contains'] || {}).spin ?? 0; };

/** 视图里 spec.forces 列出的函数节点:~fn/名字 的 code 编译成 (nodes, links, alpha, ctx) => void */
function compileForces() {
  const spec = draftSpec ?? specs[currentView] ?? {};
  if (!Array.isArray(spec.forces)) return [];
  const out = [];
  for (const name of spec.forces) {
    const id = String(name).startsWith('~') ? String(name) : '~fn/' + name;
    const code = raw.get(id) && raw.get(id).attrs && raw.get(id).attrs.code;
    if (!code) continue;
    try { const f = new Function('return (' + code + ')')(); if (typeof f === 'function') out.push(f); } catch { /* 忽略坏函数 */ }
  }
  return out;
}
function getSpace(id) {
  const key = keyOf(id);
  const old = spaces.get(key);
  if (old && old.ver === spaceVer) return old;
  const sd = compiled.space(id);
  const byId = new Map();
  const nodes = sd.nodes.map((sn, i) => {
    const o = old && old.byId.get(sn.id);
    const n = { ...sn };
    decorate(n, o);
    if (o) { n.x = o.x; n.y = o.y; }
    else { const a = i * 2.39996, rr = 14 * Math.sqrt(i + 1); n.x = Math.cos(a) * rr; n.y = Math.sin(a) * rr; if (old) n.born = performance.now(); }
    byId.set(n.id, n);
    return n;
  });
  const links = sd.edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((e) => ({ ...e, source: e.from, target: e.to }));
  const sim = d3.forceSimulation(nodes).alphaDecay(0.045)
    .force('link', d3.forceLink(links).id((d) => d.id).strength((l) => Math.min(0.5, (l.strength ?? 0.15) * (1 + Math.log2(l.count || 1) * 0.3))))
    .force('charge', d3.forceManyBody().distanceMax(900))
    .force('x', d3.forceX(0).strength(0.05)).force('y', d3.forceY(0).strength(0.05))
    .force('collide', d3.forceCollide().strength(0.9).iterations(2)) // 半径差很大(展开的疆域 vs 叶子)时一次迭代推不干净
    .stop();
  if (old) old.sim.stop();
  sim.force('pointer', pullTo(sim));
  const sp = { key, id, ver: spaceVer, nodes, byId, links, external: sd.external, sim, E: 24, warm: false };
  sp.forces = compileForces();
  sim.force('swirl', () => {
    if (!sp.warm || !heatOn()) return;
    const w0 = 0.07 * spaceSpin() * P.spin;
    if (!w0) return;
    for (const n of nodes) {
      if (n.fx != null) continue;
      const d = Math.hypot(n.x, n.y) || 1, w = w0 * Math.sqrt(40 / Math.max(d, 20));
      n.vx += (-n.y / d) * w; n.vy += (n.x / d) * w;
    }
  });
  spaces.set(key, sp);
  updateFootprints(sp);
  applyForces(sp);
  // 同步跑到稳定:进入空间时布局已经是静止的,不会挤、不会抖
  const n = nodes.length, ticks = old ? 30 : n > 2000 ? 40 : n > 500 ? 100 : 260;
  if (old) sim.alpha(0.2);
  for (let i = 0; i < ticks; i++) sim.tick();
  measure(sp);
  sp.E0 = sp.E;   // 自然疆域:疆域张力的零点(超出它才开始拉)
  sp.warm = true;
  sim.on('tick', () => onSpaceTick(sp));
  return sp;
}
/** 哪个空间里有这个节点(它的父容器的空间;父容器被过滤掉时往上找) */
function holderOf(id) {
  const chain = compiled.ancestors(id);
  for (let i = chain.length - 2; i >= 0; i--) { const sp = getSpace(chain[i]); if (sp.byId.has(id)) return sp; }
  return getSpace(null);
}
/** 就地展开的空间在画面里的"容器 + 父空间"(只有它画着的时候才有);张力靠它把反作用力还给整组 */
function groupOf(sp) {
  if (!sp || sp.id == null || sp.id === curSpaceId || !expandedSet.has(sp.id)) return null;
  const ps = holderOf(sp.id), n = ps && ps.byId.get(sp.id);
  return n && screenOffset(sp.id) ? { ps, n, sp } : null;   // sp = 子空间;ps = 它所在的父空间;n = 父空间里的容器节点
}
const simActive = (sp) => !!(sp && (sp.dragging || heated.has(sp) || sp.sim.alphaTarget() > 0 || sp.sim.alpha() > 0.02));
/** 疆域张力:超出自然疆域 E0 的成员被拉回中心(越远越强)—— 就是"越往外越大力的软约束"。
 *  就地展开时,反作用力还会推着外面的容器走(整组跟着离群点);而"进入"某个空间时,同样的软边界照样生效
 *  (防止成员被拖到天边、退出时整组缩成一个点),但**不动外层的容器** —— 你在里面根本看不见它,
 *  它偷偷挪位只会让人莫名其妙。根空间(宇宙本身)不设边界,保持自由。
 *  和"真实体积"无关:开关只决定展开时压不压、占用撑不撑大,不决定有没有疆界 —— 否则关掉它会连带废掉张力。 */
function tension(sp) {
  sp.tr = null;
  if (!(P.tether > 0) || !(sp.E0 > 0) || sp.id == null) return null;
  const k = 0.35 * P.tether * heatScale(sp.sim.alpha()), e0 = sp.E0;
  let rx = 0, ry = 0;
  for (const m of sp.nodes) {
    const e = Math.hypot(m.x, m.y) + m.fp, over = e - e0;
    if (over <= 0) continue;
    const f = k * over * shrinkLevel(over, e0), ux = m.x / (e || 1), uy = m.y / (e || 1);
    m.vx -= ux * f; m.vy -= uy * f;      // 拉回中心
    rx += ux * f; ry += uy * f;          // 反作用(只有画在外面时才用得上)
  }
  const g = groupOf(sp);
  if (g && (rx || ry)) sp.tr = { x: rx, y: ry, t: performance.now() };
  return g;
}
function onSpaceTick(sp) { // 就地展开的空间在调整时,父空间要跟着给它让位
  if (sp.forces && sp.forces.length) for (const f of sp.forces) { try { f(sp.nodes, sp.links, sp.sim.alpha(), { space: sp.key, k: transform.k }); } catch { /* 用户函数出错不该拖垮渲染 */ } }
  measure(sp);
  const g = tension(sp);
  if (g && sp.tr && simActive(g.ps)) { const sc = scOf(g.n, sp); g.n.vx += sp.tr.x * sc; g.n.vy += sp.tr.y * sc; }
  if (sp.id === null || !expandedSet.has(sp.id)) return;
  if (P.fit === '压入') return; // 压入:父空间占用固定为容器盘,内部 E 怎么变都不用给父空间让位
  // 保持热量时子空间每帧都在动:疆域半径变化够大才通知父空间,否则父空间会被不停地重新加热、抖个不停
  if (sp.sentE !== undefined && Math.abs(sp.E - sp.sentE) < 2) return;
  sp.sentE = sp.E;
  const ps = holderOf(sp.id), n = ps.byId.get(sp.id);
  if (!n) return;
  n.fp = P.fit === '压入' ? n.D : sp.E + PAD;
  applyForces(ps);
  if (!heated.has(ps) && ps.sim.alpha() < 0.08) ps.sim.alpha(0.25).restart();
}

// 热量:这一帧画到的空间(当前空间 + 就地展开的)保持一点温度,其余的冷却后停算
const heated = new Set(), drawnSpaces = new Set();
function heatSpaces() {
  const lvl = heatLevel();
  for (const sp of heated) if (!drawnSpaces.has(sp) || !lvl) { if (!sp.dragging) sp.sim.alphaTarget(0); heated.delete(sp); }
  if (!lvl) return;
  for (const sp of drawnSpaces) {
    if (heated.has(sp)) continue;
    if (!sp.dragging) sp.sim.alphaTarget(lvl);
    if (sp.sim.alpha() < lvl) sp.sim.alpha(lvl);
    sp.sim.restart(); heated.add(sp);
  }
}
/** 参数变了:平面模拟和所有空间都重新套一遍,再稍微加热让变化看得见 */
function applyPhys() {
  applyFlatForces();
  if (!isSpaces()) simulation.alpha(Math.max(simulation.alpha(), 0.3)).restart();
  for (const sp of spaces.values()) {
    updateFootprints(sp); applyForces(sp);
    if (heated.has(sp) || drawnSpaces.has(sp)) { if (!sp.dragging) sp.sim.alphaTarget(heatLevel()); sp.sim.alpha(Math.max(sp.sim.alpha(), 0.3)).restart(); }
  }
  for (const sp of heated) if (!heatOn()) { sp.sim.alphaTarget(0); heated.delete(sp); }
}

function toggleExpandSpace(id) {
  const n = compiled.node(id);
  if (!n || !n.container) return;
  const ps = holderOf(id);
  if (expandedSet.has(id)) expandedSet.delete(id);
  else expandedSet.add(id);
  savePlace();
  updateFootprints(ps); applyForces(ps);
  ps.sim.alpha(0.7).restart(); // 父空间动画地让出(或收回)位置
  renderSide();
}

const qOK = (n) => !filt || matchSet.has(n.id) || (n.container && matchAnc.has(n.id));
/** 过滤框以 = 开头:后面是一条表达式(和视图规则、保存的查询同一套) */
const exprQuery = () => (query.startsWith('=') ? query.slice(1).trim() : null);
