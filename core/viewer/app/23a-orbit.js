// ---------- 开普勒轨道(设置 → 运动 → 开普勒轨道;默认关)----------
// 收起的容器是一个旋转的小星系;放大进去时粒子长成节点、落到布局里的位置,旋转就没了。打开这个设置后旋转留着:
// 星系(进入的、就地展开的;最外层的宇宙不算)里的成员绕空间中心公转。轨道是以中心为焦点的椭圆,远点就是它在布局里的位置 ——
// 大半时间待在自己的位置附近,周期性地朝中心掉下去、贴着中心绕过去(越近越快:开普勒第二定律)再回来;
// 轨道越大周期越长(第三定律:T ∝ a^1.5)。设置的数值是离心率:越大越扁、越贴着中心掠过。方向和收起时星系的旋臂一样。
// 只改画的位置:布局(力导向)不动,关掉就回到原样。指着的、选中的、以及你所在的那串容器停在轨道上不走(点得到、镜头稳);
// 拖动时从它在轨道上的位置接着拖,松手后再慢慢回到(新的)轨道上。
const orbitE = () => (isSpaces() && P.orbit > 0 ? Math.min(0.95, P.orbit) : 0);
const orbitOn = (sp) => !!sp && sp.id != null && orbitE() > 0;
let orbitFrame = 0;          // 每帧加一(drawSpacesFrame 开头);节点上记着最近一次算轨道是哪一帧
let orbitStill = new Set();  // 这一帧不走的:指着的、选中的、所在空间那一串
/** 节点这一帧画在哪(所在空间的坐标):算过轨道就是轨道上的位置,否则是布局里的位置 */
const dispOf = (n) => (n && orbitFrame && n.ofr === orbitFrame ? { x: n.ox, y: n.oy } : n);
function orbitBegin() {
  orbitFrame++;
  if (!orbitE()) return;
  orbitStill = new Set(selection);
  if (hovered) orbitStill.add(hovered.id);
  if (curSpaceId != null) for (const id of compiled.ancestors(curSpaceId)) orbitStill.add(id);
}
/** 这个空间里每个节点这一帧在轨道上的位置(一帧只算一次) */
function orbitStep(sp, now) {
  if (!orbitOn(sp) || sp.ofr === orbitFrame) return;
  sp.ofr = orbitFrame;
  const ecc = orbitE(), flat = Math.sqrt(1 - ecc * ecc), speed = Math.max(0, P.spin);
  for (const n of sp.nodes) {
    const dt = n.ot ? Math.min(100, Math.max(0, now - n.ot)) : 0;
    n.ot = now;
    if (n.om === undefined) n.om = n.phase;   // 起点:轨道上一个固定的随机位置(phase 是每个节点自己的随机数)
    if (n.oa === undefined) n.oa = 1;         // 0 = 就在布局位置上,1 = 完全在轨道上(拖完从 0 慢慢回到 1)
    if (drag && drag.pulling && (drag.n === n || (drag.group && drag.group.includes(n)))) {
      // 正被拖着:布局位置挪到它上一帧在轨道上的位置(画面上不跳),拖动期间不走轨道
      if (n.oa > 0 && n.ofr === orbitFrame - 1) { n.x = n.ox; n.y = n.oy; n.vx = 0; n.vy = 0; }
      n.oa = 0;
    } else if (n.oa < 1) n.oa = Math.min(1, n.oa + dt / 1500);
    const R = Math.hypot(n.x, n.y);
    n.ofr = orbitFrame;
    if (R < 1 || n.oa === 0) { n.ox = n.x; n.oy = n.y; continue; }
    const a = R / (1 + ecc), T = Math.min(120e3, Math.max(8e3, 30e3 * Math.pow(a / 120, 1.5)));
    if (!orbitStill.has(n.id)) n.om = (n.om + TAU * speed * dt / T) % TAU;
    let E = n.om + ecc * Math.sin(n.om);   // 开普勒方程 E − e·sinE = M,牛顿法几步就够
    for (let i = 0; i < 5; i++) E -= (E - ecc * Math.sin(E) - n.om) / (1 - ecc * Math.cos(E));
    // 轨道平面里:焦点在原点,近点在 +x,远点(距离 R)在 −x。整个转一下,让远点落在布局位置上
    const px = a * (Math.cos(E) - ecc), py = a * flat * Math.sin(E), c = -n.x / R, s = -n.y / R;
    const qx = c * px - s * py, qy = s * px + c * py;
    n.ox = n.x + (qx - n.x) * n.oa; n.oy = n.y + (qy - n.y) * n.oa;
  }
}
