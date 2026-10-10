// ---------- 相机:唯一权威 ----------
// 画面只由 transform 决定(screen = world × k + transform),它本身就是相机。
// d3.zoom 只当输入设备;跟随不是"另一套相机",而是每帧把 transform 挪到让选中节点居中。
// 只有 stepCamera() 会在跟随时改 transform,而且每帧只推进一次 —— 别处全是只读,
// 所以镜头速度与"这一帧谁调用了它几次"无关,抖动自然消失。
const FOLLOW_EASE = 420;           // 锁定进入的平滑时长(ms);之后精确钉住,零抖动
let followId = null;               // 正在锁定的节点
let followAt = 0, camFrom = null;  // 锁定开始时镜头在哪(平滑的起点)

/** 节点相对相机原点的屏幕偏移(与 transform.x/y 无关)与该层累计缩放;现在没被画出来时 null。
 *  就地展开的祖先逐层累积平移/缩放,和 drawSpace 的几何完全一致 —— 所以"打开的文件夹
 *  内部的文件夹/文件"也算得出位置,跟随不会失效。 */
function screenOffset(id) {
  if (!compiled || id == null) return null;
  if (!isSpaces()) {
    const n = sim.get(id);
    return n && n.x !== undefined ? { x: n.x * transform.k, y: n.y * transform.k, s: transform.k } : null;
  }
  const chain = compiled.ancestors(id);
  let i = 0, sp = getSpace(null);
  if (curSpaceId !== null) { i = chain.indexOf(curSpaceId) + 1; if (i === 0) return null; sp = getSpace(curSpaceId); }
  let ox = 0, oy = 0, s = transform.k;
  for (; i < chain.length; i++) {
    const n = sp.byId.get(chain[i]);
    if (!n) return null;
    const x = ox + n.x * s, y = oy + n.y * s;
    if (chain[i] === id) return { x, y, s };
    if (!expandedSet.has(chain[i])) return null;      // 中间层没展开,后代根本没画出来
    const child = getSpace(chain[i]), sc = scOf(n, child);
    ox = x; oy = y; s *= sc; sp = child;
  }
  return null;
}
/** 选中即开始跟随(不做延迟:双击改由"原地双击"识别);取消或换目标只改目标,绝不重置镜头 —— 所以没有跃迁。 */
function scheduleFollow(id) {
  if (!(P.follow > 0) || id == null) { followId = null; camFrom = null; return; }
  if (id === followId) return;
  followId = id; followAt = performance.now(); camFrom = { x: transform.x, y: transform.y };
  d3.select(canvas).interrupt();   // 别和"适应窗口/居中"的动画抢方向盘
}
/** 让节点可见但不抢镜头(跟随会负责居中):不在当前空间画得出来就先切过去。 */
function ensureVisible(id) {
  if (screenOffset(id)) return;
  const holder = holderOf(id);
  if (holder.id !== curSpaceId) jumpTo(holder.id);
}
/** 每帧一次:把 transform 挪到让选中节点居中的位置。进入用 smoothstep 平滑,之后精确钉住。 */
function stepCamera(now) {
  if (!(P.follow > 0)) { followId = null; camFrom = null; return; }
  if (!followId) return;
  if (followId !== selected) { followId = null; camFrom = null; return; }
  const off = screenOffset(followId);
  if (!off) { followId = null; camFrom = null; return; }   // 被折叠/切走/过滤掉:就地解冻,不硬跟
  const tx = innerWidth / 2 - off.x, ty = innerHeight / 2 - off.y;
  const u = camFrom ? Math.min(1, (now - followAt) / FOLLOW_EASE) : 1, e = u * u * (3 - 2 * u);
  const nx = camFrom ? camFrom.x + (tx - camFrom.x) * e : tx;
  const ny = camFrom ? camFrom.y + (ty - camFrom.y) * e : ty;
  // 直接写 __zoom,不走 zoom.transform:后者是"发起一次缩放手势",会和用户正按下的手势互踩
  // (按背景还没移动时会把 click 吃掉),也不该每帧 emit 事件。
  if (canvas.__transition) d3.select(canvas).interrupt();
  transform = d3.zoomIdentity.translate(nx, ny).scale(transform.k);
  canvas.__zoom = transform;
}
