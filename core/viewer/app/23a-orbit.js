// ---------- 开普勒轨道(设置 → 运动 → 开普勒轨道;默认关)----------
// 收起的容器是一个旋转的小星系;放大进去时粒子长成节点、落到布局里的位置,旋转就没了。打开这个设置后旋转留着:
// 星系(进入的、就地展开的;最外层的宇宙不算)里的成员绕空间中心公转。轨道是以中心为焦点的椭圆,远点就是它在布局里的位置 ——
// 大半时间待在自己的位置附近,周期性地朝中心掉下去、贴着中心绕过去(越近越快:开普勒第二定律)再回来;
// 轨道越大周期越长(第三定律:T ∝ a^1.5)。设置的数值是离心率:越大越扁、越贴着中心掠过。方向和收起时星系的旋臂一样。
// 只改画的位置:布局(力导向)不动,关掉就回到原样。**所有东西一直在转** —— 指着的、选中的、以及你放大进去的那个容器,
// 在它外层的空间里都照常走(外面那层是当"上下文"画的,镜头跟着那个容器,所以它是钉在中间、周围在转);
// 拖动时从它在轨道上的位置接着拖,松手后轨道就地重起(远点就是落点),所以它会停在原地接着转。
//
// **位置只有一个定义处**:dispOf(节点)= 它这一刻画在哪(它自己空间的坐标)。轨道位置只依赖这个节点自己
// (布局位置 + 相位 + 时间),所以任何地方、任何时候都能问 —— 不要求它的空间这一帧已经被画过。
// 相机进出、拖拽、连线、命中全走它,免得同一处位置在不同代码 / 不同帧里算出两个答案。
// (以前的写法是"画的时候顺手算、结果记在 n.ofr 上,没算到就退回布局位置";进入一个**就地展开**的容器时
//  外层不再当上下文画,于是退出取到的就是布局位置而不是轨道位置 —— 镜头会偏出去一截。)
const orbitE = () => (isSpaces() && P.orbit > 0 ? Math.min(0.95, P.orbit) : 0);
const orbitOn = (sp) => !!sp && sp.id != null && orbitE() > 0;
let orbitFrame = 0;          // 每帧加一(drawSpacesFrame 开头);节点上记着最近一次算轨道是哪一帧
/** 节点这一帧画在哪(所在空间的坐标):算过轨道就是轨道上的位置,否则是布局里的位置。
 *  这一帧还没算过就**按需补算**(它的空间可能因为"你在它里面"而没被画出来)。 */
const dispOf = (n) => {
  if (!n) return n;
  const m = n.real || n;                       // 展开中的代理对象:位置算在真节点上
  if (m.ofr === orbitFrame) return { x: m.ox, y: m.oy };
  if (!orbitOn(m._sp)) return n;               // 不在会转的空间里(最外层的宇宙):就是布局位置
  orbitNode(m, performance.now());
  return { x: m.ox, y: m.oy };
};
function orbitBegin() {
  orbitFrame++;
}
/** 一个节点这一刻在轨道上的位置(一帧只算一次,时间记在 n.ot 上) */
function orbitNode(n, now) {
  const dt = n.ot ? Math.min(100, Math.max(0, now - n.ot)) : 0;
  n.ot = now;
  const ecc = orbitE(), flat = Math.sqrt(1 - ecc * ecc), speed = Math.max(0, P.spin);
  if (n.om === undefined) n.om = n.phase;   // 起点:轨道上一个固定的随机位置(phase 是每个节点自己的随机数)
  if (n.oa === undefined) n.oa = 1;         // 0 = 还挂在"刚拖完"的状态上(下一帧就地重起轨道),1 = 正常在轨道上
  if (drag && drag.pulling && (drag.n === n || (drag.group && drag.group.includes(n)))) {
    // 正被拖着:布局位置挪到它上一帧在轨道上的位置(画面上不跳),拖动期间不走轨道
    if (n.oa > 0 && n.ofr === orbitFrame - 1) { n.x = n.ox; n.y = n.oy; n.vx = 0; n.vy = 0; }
    n.oa = 0;
  } else if (n.oa === 0) {
    // 刚松手:轨道就地重起 —— 远点(相位 π)就是它现在的位置,画出来和布局位置重合,不会滑走。
    // 不重起的话相位还是拖之前那个,松手后它会照旧轨道滑到另一头(看上去就是被扔到了别的地方)。
    n.oa = 1; n.om = Math.PI;
  }
  const R = Math.hypot(n.x, n.y);
  n.ofr = orbitFrame;
  if (R < 1 || n.oa === 0) { n.ox = n.x; n.oy = n.y; return; }
  const a = R / (1 + ecc), T = Math.min(120e3, Math.max(8e3, 30e3 * Math.pow(a / 120, 1.5)));
  n.om = (n.om + TAU * speed * dt / T) % TAU;
  let E = n.om + ecc * Math.sin(n.om);   // 开普勒方程 E − e·sinE = M,牛顿法几步就够
  for (let i = 0; i < 5; i++) E -= (E - ecc * Math.sin(E) - n.om) / (1 - ecc * Math.cos(E));
  // 轨道平面里:焦点在原点,近点在 +x,远点(距离 R)在 −x。整个转一下,让远点落在布局位置上
  const px = a * (Math.cos(E) - ecc), py = a * flat * Math.sin(E), c = -n.x / R, s = -n.y / R;
  const qx = c * px - s * py, qy = s * px + c * py;
  n.ox = n.x + (qx - n.x) * n.oa; n.oy = n.y + (qy - n.y) * n.oa;
}
/** 这个空间里每个节点这一帧在轨道上的位置(一帧只算一次) */
function orbitStep(sp, now) {
  if (!orbitOn(sp) || sp.ofr === orbitFrame) return;
  sp.ofr = orbitFrame;
  for (const n of sp.nodes) orbitNode(n, now);
}
