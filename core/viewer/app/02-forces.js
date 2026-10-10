// ---------- 力导向 ----------
const simulation = d3.forceSimulation()
  .force('link', d3.forceLink().id((d) => d.id))
  .force('charge', d3.forceManyBody().distanceMax(500))
  .force('center', d3.forceCenter(0, 0).strength(0.05))
  .force('gx', d3.forceX(0)).force('gy', d3.forceY(0))
  .force('collide', d3.forceCollide())
  .alphaDecay(0.012);
/** 把参数套到平面模拟上(d3 在 initialize 时缓存每个节点的值,所以参数变了要重新设一遍) */
function applyFlatForces() {
  simulation.force('link').distance((l) => (l.distance ?? 90) * P.link + l.source.r + l.target.r).strength((l) => l.strength ?? 0.3);
  simulation.force('charge').strength((d) => (d.tx !== undefined ? 0 : -(18 + d.r * d.r * 1.1) * P.charge)); // 有 tag 锚点的节点不互斥:位置由锚点给,碰撞防重叠
  simulation.force('gx').strength((d) => (d.tx !== undefined ? 0 : 0.012 * P.gravity));
  simulation.force('gy').strength((d) => (d.tx !== undefined ? 0 : 0.012 * P.gravity));
  simulation.force('collide').radius((d) => d.r * 1.3 + P.gap - 1);
  simulation.velocityDecay(P.friction).alphaTarget(heatLevel());
}
applyFlatForces();

// 拖动 = 施加一个力:每一帧都按"当前指针位置 vs 元素当前位置"重算拉力的目标(弹簧),和别的自定义力一样
// 按温度缩放 —— 不钉住、不改温度,周围的节点通过平常的力去响应它。
// 关键是它按当前相机/空间重算:指针停在一边不动,力就持续朝那边给(锁定/相机跟着走时元素钉在中心,
// 目标始终在它前方,于是像开飞船一样越跑越快);不锁定时相机不动,目标就是指针的世界位置,元素自然靠过去停住。
const pullTo = (sim) => (alpha) => {
  if (!drag || !drag.moved || drag.op || drag.sim !== sim || !drag.n) return;
  const n = drag.n, k = 0.35 * P.dragForce * heatScale(alpha);
  const off = screenOffset(n.id);   // 节点所在空间的屏幕原点 + 累计缩放(就地展开的祖先也算在内)
  let tx, ty;
  if (off) { const ox = transform.x + off.x - n.x * off.s, oy = transform.y + off.y - n.y * off.s; tx = (drag.px - ox) / off.s; ty = (drag.py - oy) / off.s; }
  else { tx = (drag.px - transform.x) / transform.k; ty = (drag.py - transform.y) / transform.k; }
  const gg = drag.g, dsp = drag.h && drag.h.sp;   // dsp = 被拖节点所在的空间(就地展开的,或已经"进入"的)
  let cap = Infinity, sCap = 1;
  if (dsp && dsp.id != null && dsp.E0 > 0) { cap = shrinkCap(dsp.E0); const r = Math.hypot(tx, ty); if (r > cap && r > 0) sCap = cap / r; }   // 成员侧有界(软约束的另一半:硬上限)
  n.vx += (tx * sCap - n.x) * k; n.vy += (ty * sCap - n.y) * k;
  for (const m of drag.group || []) { m.vx += (tx * sCap - m.x) * k * 0.7; m.vy += (ty * sCap - m.y) * k * 0.7; }   // 多选:同一空间里选中的都拉向指针
  // 拖的是就地展开空间里的成员:按"收缩到了多少"把拖动力的一部分**同步**分给整组 ——
  // 从第一刻起,收缩和整组受力一起增长(没有死区),成员像把手,整组跟着指针走。
  // 这里用**没有截断**的世界误差:成员到不了指针的部分,由整组去走。
  if (gg && P.tether > 0 && gg.sp.E0 > 0) {
    const c = shrinkLevel(Math.hypot(n.x, n.y) + n.fp - gg.sp.E0, gg.sp.E0);
    if (c > 0) { const kg = k * P.tether * c, cs = scOf(gg.n, gg.sp); gg.n.vx += (tx - n.x) * cs * kg; gg.n.vy += (ty - n.y) * cs * kg; }
  }
  pullDbg = { gg: !!gg, cap: cap === Infinity ? null : Math.round(cap), sCap: +sCap.toFixed(4), m: Math.round(Math.hypot(n.x, n.y)) };
};
simulation.force('pointer', pullTo(simulation));

// 轨道关系:给"子"一个切向速度,像行星绕恒星转。转速随轨道半径衰减。
simulation.force('swirl', (alpha) => {
  const hs = heatScale(alpha);
  for (const l of links) {
    const spin = l.spin ?? (l.mode === 'orbit' ? 1 : 0);
    if (!spin || (l.mode !== 'orbit' && l.mode !== 'region')) continue;
    const s = l.source, t = l.target;
    if (t.fx != null) continue;
    const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy) || 1;
    const w = 0.07 * spin * P.spin * Math.sqrt(40 / d) * hs;
    t.vx += (-dy / d) * w; t.vy += (dx / d) * w;
  }
});

// tag 视图:每个节点被拉向自己的锚点(见 layoutTags)。只拉向"组心"是不行的 —— 初始位置随机时所有组心都在中间,
// 各组永远分不开,结果是一个均匀的圆盘。
simulation.force('tags', (alpha) => {
  const k = 0.3 * alpha;
  for (const n of simulation.nodes()) if (n.tx !== undefined) { n.vx += (n.tx - n.x) * k; n.vy += (n.ty - n.y) * k; }
});
/**
 * 按 tag 的层级做圆堆积(d3.pack):顶层 tag 一团,团里按第二层 tag 再分小团,节点是最里面的圆。
 * 结果作为每个节点的锚点;新节点直接出生在锚点上,所以上万个节点也不会"爆炸"。只在节点集合变化时重算。
 */
let tagKey = '';
let tagGroups = [];                // tag 团的位置(第 1、2 层),用来在团上写名字
function layoutTags(nodes) {
  const tagged = nodes.some((n) => n.tags && n.tags.length);
  const key = tagged ? nodes.length + '|' + nodes.map((n) => n.id).join('\n').length : '';
  if (key === tagKey && (!tagged || nodes.every((n) => n.tx !== undefined))) return; // 节点对象换过(切项目)就得重算
  tagKey = key;
  if (!tagged) { for (const n of nodes) { n.tx = undefined; n.ty = undefined; } tagGroups = []; return; }
  const root = { kids: new Map(), leaves: [] };
  for (const n of nodes) {
    let g = root;
    for (const t of n.tags || []) { let c = g.kids.get(t); if (!c) { c = { kids: new Map(), leaves: [] }; g.kids.set(t, c); } g = c; }
    g.leaves.push(n);
  }
  const toH = (g, id) => ({ id, children: [...[...g.kids].map(([t, c]) => toH(c, t)), ...g.leaves.map((n) => ({ n }))] });
  const h = d3.hierarchy(toH(root, null), (d) => d.children);
  d3.pack().radius((d) => d.data.n.r * 1.5 + 3).padding((d) => (d.depth === 0 ? 40 : d.depth === 1 ? 14 : 4))(h);
  const leaves = h.leaves().filter((l) => l.data.n);
  const mx = leaves.reduce((a, l) => a + l.x, 0) / leaves.length, my = leaves.reduce((a, l) => a + l.y, 0) / leaves.length;
  for (const l of leaves) { l.data.n.tx = l.x - mx; l.data.n.ty = l.y - my; } // 锚点的重心放在原点,和 forceCenter 不打架
  tagGroups = h.descendants().filter((d) => d.depth >= 1 && d.depth <= 2 && !d.data.n && d.data.id)
    .map((d) => ({ id: d.data.id, x: d.x - mx, y: d.y - my, r: d.r, depth: d.depth }));
}

// 域与域之间互相推开(祖孙除外),让每个域保持独立的疆界
simulation.force('regions', (alpha) => {
  const hs = heatScale(alpha);
  for (const r of regions) {
    let cx = 0, cy = 0;
    for (const m of r.members) { cx += m.x; cy += m.y; }
    r.cx = cx / r.members.length; r.cy = cy / r.members.length;
    r.rad = Math.max(...r.members.map((m) => Math.hypot(m.x - r.cx, m.y - r.cy) + m.r * 1.6)) + 14;
  }
  for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
    const a = regions[i], b = regions[j];
    if (a.ancestors.has(b.id) || b.ancestors.has(a.id)) continue;
    const dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy) || 1, gap = a.rad + b.rad + 24 - d;
    if (gap <= 0) continue;
    const f = Math.min(gap * 0.012, 2.5) * hs, ux = dx / d, uy = dy / d;
    for (const m of a.members) { m.vx -= ux * f; m.vy -= uy * f; }
    for (const m of b.members) { m.vx += ux * f; m.vy += uy * f; }
  }
});
