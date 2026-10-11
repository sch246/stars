// ---------- 浮动面板:点到 / 打开时放到最上面;拖边框挪位置 ----------
// 面板之间会相互挡住(比如项目列表和左下角的剪贴板):最近点过、最近打开的在最上面。
// 拖面板的边框(内边距那一圈空白,鼠标变成 ✥)可以挪到别处;位置记的是离它原本贴着的那两条边多远(侧栏:右、上;剪贴板:左、下……),
// 所以它照旧往原来的方向长(剪贴板、控制台往上长,侧栏改宽时右边不动),窗口大小变了跟着那两条边走;记在浏览器里。
// 双击边框 = 放回原处;panel-reset 全部放回。
// 层次:普通面板在大窗(12)下面,控制台和快捷键速查在它上面(看文件时也能敲命令);命令面板、提示、对话框、右键菜单始终在最上面。
const PM_HIGH = new Set(['console', 'keys']);
const pmOrder = ['tools', 'side', 'legend', 'timeline', 'tray', 'editor', 'review', 'projects', 'physics', 'console', 'keys'];   // 越靠后越在上面
const PM_MAXH = { side: '100vh', editor: '100vh', review: '100vh', projects: '100vh', physics: '100vh', console: '44vh', keys: '100vh' };   // 挪过的面板:高度别超出窗口
const PM_ANCHOR = { side: 'rt', legend: 'rb', tray: 'lb', console: 'lb', timeline: 'lb' };   // 贴着哪两条边(没写 = 左、上)
const PM_NAMES = { rules: 'editor', settings: 'physics' };   // panel 命令里的名字 → 元素 id
let pmPos = {}, pmDrag = null;
try { pmPos = JSON.parse(localStorage.getItem('stars.panelPos') || '{}') || {}; } catch { /* 隐私模式 / 坏数据 */ }
const pmSave = () => { try { localStorage.setItem('stars.panelPos', JSON.stringify(pmPos)); } catch { /* 隐私模式 */ } };
/** 这个面板被拖到别处了吗(layoutPanels / layoutConsole 就不再管它的位置) */
const panelMoved = (id) => !!pmPos[id];

function pmStack() {
  let lo = 2, hi = 13;
  for (const id of pmOrder) { const el = $(id); if (el) el.style.zIndex = String(PM_HIGH.has(id) ? hi++ : lo++); }
}
function pmRaise(id) {
  const i = pmOrder.indexOf(id);
  if (i < 0) return;
  if (i !== pmOrder.length - 1) { pmOrder.splice(i, 1); pmOrder.push(id); }
  pmStack();
}
/** 把记下的位置放到面板上(没记 = 回到样式表里的默认位置) */
function pmApply(id) {
  const el = $(id), p = pmPos[id];
  if (!el) return;
  if (!p) {
    if (el.classList.contains('moved')) { el.classList.remove('moved'); for (const k of ['left', 'right', 'top', 'bottom', 'transform', 'maxHeight']) el.style[k] = ''; layoutPanels(); layoutConsole(); }
    return;
  }
  el.classList.add('moved');
  const cx = (v) => Math.max(0, Math.min(innerWidth - 60, v)), cy = (v) => Math.max(0, Math.min(innerHeight - 30, v));   // 至少留一截在窗口里
  el.style.transform = 'none';
  el.style.left = p.l != null ? cx(p.l) + 'px' : 'auto';
  el.style.right = p.r != null ? cx(p.r) + 'px' : 'auto';
  el.style.top = p.t != null ? cy(p.t) + 'px' : 'auto';
  el.style.bottom = p.b != null ? cy(p.b) + 'px' : 'auto';
  if (PM_MAXH[id]) el.style.maxHeight = `min(${PM_MAXH[id]}, ${Math.max(120, innerHeight - cy(p.t ?? p.b) - 12)}px)`;
}
function pmReset(id) { delete pmPos[id]; pmSave(); pmApply(id); updateCrumbWidth(); }
function pmSetup(el) {
  if (!el || el.dataset.pm) return;
  el.dataset.pm = '1';
  el.classList.add('movable');
  // 打开(hidden 去掉)时放到最上面
  new MutationObserver((ms) => { if (!el.hidden && ms.some((m) => m.oldValue !== null)) pmRaise(el.id); })
    .observe(el, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
  pmApply(el.id);
}
for (const id of pmOrder) pmSetup($(id));
pmStack();
// 剪贴板是第一次用到时才建的
new MutationObserver(() => {
  const t = $('tray'); if (!t || t.dataset.pm) return;
  pmSetup(t); pmStack();
  new ResizeObserver(() => layoutPanels()).observe(t);   // 剪贴板变高 / 收起 / 被控制台顶掉:左边那一摞跟着让
}).observe(document.body, { childList: true });

const pmPanelOf = (t) => { const el = t && t.closest ? t.closest('.panel') : null; return el && pmOrder.includes(el.id) ? el : null; };
document.addEventListener('pointerdown', (ev) => {
  const el = pmPanelOf(ev.target);
  if (!el) return;
  pmRaise(el.id);
  // 只有按在边框(面板自己,不是里面的东西)上才是拖;滚动条也算面板自己,要躲开
  if (ev.button !== 0 || ev.target !== el) return;
  if (ev.offsetX >= el.clientLeft + el.clientWidth || ev.offsetY >= el.clientTop + el.clientHeight) return;
  const r = el.getBoundingClientRect();
  pmDrag = { el, id: el.id, dx: ev.clientX - r.left, dy: ev.clientY - r.top, x0: ev.clientX, y0: ev.clientY, moved: false };
  el.setPointerCapture(ev.pointerId);
  ev.preventDefault();
}, true);
document.addEventListener('focusin', (ev) => { const el = pmPanelOf(ev.target); if (el) pmRaise(el.id); });
addEventListener('pointermove', (ev) => {
  if (!pmDrag) return;
  const d = pmDrag;
  if (!d.moved) { if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 3) return; d.moved = true; document.body.classList.add('moving'); }
  const w = d.el.offsetWidth;
  const x = Math.max(60 - w, Math.min(innerWidth - 60, ev.clientX - d.dx)), y = Math.max(0, Math.min(innerHeight - 30, ev.clientY - d.dy));
  Object.assign(d.el.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto', transform: 'none' });
  d.el.classList.add('moved');
  updateCrumbWidth();
});
const pmDrop = () => {
  const d = pmDrag; pmDrag = null;
  if (!d || !d.moved) return;
  document.body.classList.remove('moving');
  const r = d.el.getBoundingClientRect(), p = {}, a = PM_ANCHOR[d.id] || 'lt';
  if (a[0] === 'r') p.r = Math.round(innerWidth - r.right); else p.l = Math.round(r.left);
  if (a[1] === 'b') p.b = Math.round(innerHeight - r.bottom); else p.t = Math.round(r.top);
  pmPos[d.id] = p; pmSave(); pmApply(d.id);
  if (d.id === 'tray') layoutPanels();
};
addEventListener('pointerup', pmDrop);
addEventListener('pointercancel', pmDrop);
document.addEventListener('dblclick', (ev) => { const el = pmPanelOf(ev.target); if (el && ev.target === el && panelMoved(el.id)) pmReset(el.id); });
addEventListener('resize', () => { for (const id of Object.keys(pmPos)) pmApply(id); });
