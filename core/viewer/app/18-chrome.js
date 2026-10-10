// ---------- 侧栏宽度:拖左边缘调整(看文件时和平时各记各的),双击恢复默认 ----------
(() => {
  const grip = $('side-grip'), root = document.documentElement;
  let widths = {};
  try { widths = JSON.parse(localStorage.getItem('stars.sideW') || '{}'); } catch { /* 隐私模式 */ }
  const apply = () => { for (const [k, v] of [['--side-w', widths.info], ['--side-fw', widths.file]]) v ? root.style.setProperty(k, v + 'px') : root.style.removeProperty(k); };
  const save = () => { try { localStorage.setItem('stars.sideW', JSON.stringify(widths)); } catch { /* 隐私模式 */ } };
  apply();
  let drag = null;
  grip.addEventListener('pointerdown', (ev) => { drag = $('side').classList.contains('file') ? 'file' : 'info'; grip.setPointerCapture(ev.pointerId); document.body.classList.add('resizing'); ev.preventDefault(); });
  grip.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    widths[drag] = Math.round(Math.max(240, Math.min(innerWidth - 330, innerWidth - ev.clientX - 12)));
    apply(); updateCrumbWidth();
  });
  grip.addEventListener('pointerup', () => { if (!drag) return; drag = null; document.body.classList.remove('resizing'); save(); });
  grip.addEventListener('dblclick', () => { delete widths[$('side').classList.contains('file') ? 'file' : 'info']; apply(); save(); });
})();

// ---------- 点别处就关:项目 / 参数 / 审阅;视图规则编辑器只在没有未保存的草稿时关 ----------
// (平移、缩放不算点击 —— d3 会吞掉拖动之后的那次 click;时间线是一种模式,不在此列)
const dismissible = [
  ['projects', 'proj', () => toggleProjects(false)],
  ['physics', 'btn-phys', () => togglePhysics(false)],
  ['review', 'btn-review', () => toggleReview(false)],
  ['editor', 'btn-edit', () => { if (!editorDirty) toggleEditor(false); }],
];
document.addEventListener('click', (ev) => {
  const path = ev.composedPath(); // 点击时的路径:里面的元素就算随后被重绘移除了也认得出
  for (const [pid, bid, close] of dismissible) {
    if ($(pid).hidden || path.includes($(pid)) || path.includes($(bid))) continue;
    close();
  }
});
