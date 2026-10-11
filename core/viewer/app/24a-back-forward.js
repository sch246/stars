// ---------- 后退 / 前进(Alt ← / →,鼠标侧键):像浏览器一样在走过的地方之间来回 ----------
// 一步 = 「哪个视图、哪个空间、选中了谁」。进出空间、跳转、选中一个节点、换视图都算走了一步;一连串的变化(比如跳转 + 选中)
// 400ms 内合成一步。取消选中、多选不算一步(不记,也不丢:后退时先回到最近记下的那一步)。后退之后再走到别处,前面的就丢掉
// (和浏览器一样)。只在内存里,刷新、换项目就清空。
const NAV_MAX = 200;
let navStack = [], navAt = -1, navTimer = 0, navApplying = false, navLand = null;   // navLand:最近一次走回去落在哪(选中的节点删了时和记下的不一样)
const navHere = () => ({ view: currentView, space: isSpaces() ? curSpaceId : null, sel: selection.size > 1 ? undefined : selected });
const navSame = (a, b) => !!a && !!b && a.view === b.view && a.space === b.space && a.sel === b.sel;
function navNote() {
  if (navApplying) return;
  clearTimeout(navTimer);
  navTimer = setTimeout(navFlush, 400);
}
/** 把现在的位置记成一步(要是值得记的话) */
function navFlush() {
  clearTimeout(navTimer); navTimer = 0;
  if (!compiled) return;
  const h = navHere(), cur = navStack[navAt];
  if (h.sel === undefined || navSame(h, cur)) return;                                        // 多选 / 没动
  if (h.sel === null && cur && cur.view === h.view && cur.space === h.space) return;          // 只是取消了选中
  navStack.length = navAt + 1;   // 后退之后又走了新的一步:前面那些不要了
  navStack.push(h);
  if (navStack.length > NAV_MAX) navStack.splice(0, navStack.length - NAV_MAX);
  navAt = navStack.length - 1;
}
/** 第一次编译好:把起点记成第一步(后退能一直退回到这里) */
function navSeed() { if (navAt < 0 && compiled) navFlush(); }
function navReset() { clearTimeout(navTimer); navTimer = 0; navStack = []; navAt = -1; }
/** 走 d 步(-1 后退,+1 前进);走不了返回 false */
function navStep(d) {
  if (navTimer) navFlush();   // 还没记下的那一步先记上,后退才回得到它之前
  const h = navHere(), cur = navStack[navAt];
  let i = navAt;
  const drift = cur && !navSame(h, cur) && !(navLand && navLand.at === navAt && navSame(h, navLand.h));
  if (d < 0 && drift) i = navAt + 1;   // 记下之后又取消了选中 / 多选了:后退先回到记下的那一步
  for (i += d; i >= 0 && i < navStack.length; i += d) if (navUsable(navStack[i])) break;
  if (i < 0 || i >= navStack.length) return false;
  navAt = i; navGo(navStack[i]);
  return true;
}
/** 这一步还去得了吗(视图还在、空间还是容器;选中的节点删了没关系,只回到空间) */
function navUsable(h) {
  if (!viewNames.includes(h.view)) return false;
  if (h.view !== currentView) return true;   // 换过去之后再核对
  return h.space === null || !!compiled?.node(h.space)?.container;
}
function navGo(h) {
  navApplying = true;   // 走回去的这一路不算新的一步
  try {
    if (h.view !== currentView) setView(h.view);
    const sel = h.sel && raw.has(h.sel) ? h.sel : null;
    if (isSpaces()) {
      const space = h.space === null || compiled?.node(h.space)?.container ? h.space : curSpaceId;
      if (space !== curSpaceId) jumpTo(space);
      select(sel, !!sel && !!pathWithin(curSpaceId, sel));   // 选中的在这个空间里看得见才挪镜头(不然 reveal 会跳到别的空间去)
    } else select(sel, !!sel);
  } finally { clearTimeout(navTimer); navTimer = 0; navLand = { at: navAt, h: navHere() }; setTimeout(() => { navApplying = false; }, 0); }
}

// 鼠标侧键(后退 = 3,前进 = 4):浏览器自己会在松开时翻页,拦下来
addEventListener('mouseup', (ev) => {
  if (ev.button !== 3 && ev.button !== 4) return;
  ev.preventDefault();
  exec(ev.button === 3 ? 'back' : 'forward', 'mouse');
});
