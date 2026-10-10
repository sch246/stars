// ---------- 类型面板(L2):类型本身就是宇宙里的节点(~module、~dependsOn),样式就是它们的属性(见 core/src/styles.ts)----------
// 「类型」下拉里:点名字 = 这个视图里显示 / 隐藏;✎ = 改它的样子(颜色、形状、大小;边类型是颜色、线宽、箭头、画法)。
// 拖滑条、选颜色时先在本地预览(改内存里的类型节点、重算视图),松手才写进宇宙(作者 viewer,能 undo);
// 写进去之后所有打开着的页面、所有没专门规定它的视图都立刻换样子。
let typeEdit = null;                 // 正在改的类型:{ name, kind }
const typePrev = new Map();          // 预览中(还没提交)的类型节点:id → 改之前的属性(null = 原来没有这个节点)
let typePrevRaf = 0;

const SHAPE_NAMES = { dot: '圆点', star: '恒星', nebula: '星云', ringed: '带环', pulsar: '脉冲星' };
function shapeIcon(shape, color) {
  const c = esc(color || '#cfd8ff');
  const body = {
    dot: `<circle cx="9" cy="9" r="4.2" fill="${c}"/>`,
    star: `<circle cx="9" cy="9" r="6.5" fill="${c}" opacity=".22"/><path d="M9 2.5v13M2.5 9h13" stroke="${c}" stroke-width=".8" opacity=".7"/><circle cx="9" cy="9" r="2.6" fill="#fff" opacity=".9"/>`,
    nebula: `<circle cx="9" cy="9" r="8" fill="${c}" opacity=".16"/><circle cx="9" cy="9" r="5.2" fill="${c}" opacity=".3"/><circle cx="9" cy="9" r="2.4" fill="${c}" opacity=".85"/>`,
    ringed: `<circle cx="9" cy="9" r="5.5" fill="${c}" opacity=".22"/><ellipse cx="9" cy="9" rx="7.8" ry="2.9" transform="rotate(-25 9 9)" fill="none" stroke="${c}" stroke-width="1.1"/><circle cx="9" cy="9" r="2.6" fill="#fff" opacity=".9"/>`,
    pulsar: `<circle cx="9" cy="9" r="5.8" fill="${c}" opacity=".28"/><path d="M9 .8v16.4M.8 9h16.4" stroke="${c}" stroke-width="1"/><circle cx="9" cy="9" r="2.3" fill="#fff" opacity=".9"/>`,
  }[shape] || '';
  return `<svg viewBox="0 0 18 18" width="18" height="18">${body}</svg>`;
}
const curSpec = () => draftSpec ?? specs[currentView] ?? {};
const typeNode = (name) => uni && uni.nodes.get('~' + name);

/** 这个视图里,某类节点的颜色 / 形状是不是被视图规则定死了(那样改类型节点在这个视图里看不出来) */
function typeOverrides(name) {
  if (!compiled || !compiled.explain) return [];
  const sample = data.nodes.find((n) => n.attrs.type === name && !n.id.startsWith('~'));
  const ex = sample && compiled.explain(sample.id);
  if (!ex) return [];
  const sp = curSpec(), out = [];
  const cr = ex.color >= 0 ? (sp.color || [])[ex.color] : null;
  if (cr && cr.by !== 'type') out.push(`颜色由视图规则 color[${ex.color}] 决定(${cr.by ? 'by ' + cr.by : cr.expr ? '表达式' : cr.value ? '固定 ' + cr.value : '规则'})`);
  const st = ex.style >= 0 ? (sp.style || [])[ex.style] : null;
  if (st && st.by !== 'type') out.push(`形状由视图规则 style[${ex.style}] 决定(${st.expr ? '表达式' : st.shape})`);
  return out;
}
function edgeOverrides(name) {
  const r = (curSpec().relations || {})[name];
  if (!r) return [];
  const keys = ['color', 'width', 'arrow', 'mode'].filter((k) => r[k] !== undefined);
  return keys.length ? [`这个视图专门规定了 ${name} 的 ${keys.map((k) => `${k}=${r[k]}`).join(' ')}(视图优先)`] : [];
}

function renderChips() {
  if (typePrev.size) return;   // 正在拖滑条 / 选颜色:别把控件重画掉,松手提交后再画
  const el = $('chips');
  const counts = new Map(), sample = new Map();
  if (isSpaces()) {
    for (const n of data.nodes) { if (n.id.startsWith('~')) continue; const t = typeOf(n.id); counts.set(t, (counts.get(t) || 0) + 1); if (!sample.has(t)) sample.set(t, compiled.node(n.id) || { color: '#888', shape: 'star' }); }
  } else for (const n of sim.values()) { const t = typeOf(n.id); counts.set(t, (counts.get(t) || 0) + 1); sample.set(t, n); }
  $('types-badge').hidden = !hiddenTypes.size; $('types-badge').textContent = hiddenTypes.size ? '−' + hiddenTypes.size : '';
  const live = !window.__STARS_STATIC__;
  // 这个视图里没有的类型也列出来(调暗):样式是类型自己的,在哪个视图里都能改
  const all = new Map();
  for (const n of data.nodes) if (!n.id.startsWith('~') && n.attrs.type && !counts.has(n.attrs.type)) all.set(n.attrs.type, (all.get(n.attrs.type) || 0) + 1);
  const rows = [...[...counts].sort((a, b) => b[1] - a[1]).map(([t, c]) => [t, c, true]), ...[...all].sort((a, b) => b[1] - a[1]).map(([t, c]) => [t, c, false])];
  const nodeRows = rows.map(([t, c, inView]) => {
    const tn = typeNode(t), sm = sample.get(t) || { color: (tn && tn.attrs.color) || '#888', shape: (tn && tn.attrs.shape) || STYLE_DEFAULT_SHAPES[t] || 'star' };
    const editing = typeEdit && typeEdit.kind === 'nodeType' && typeEdit.name === t;
    return `<div class="ty-row${inView ? '' : ' off-view'}"><span class="chip ${hiddenTypes.has(t) ? '' : 'on'}" data-t="${esc(t)}" data-cmd="type ${esc(quoteArg(t))} toggle" title="${inView ? '在这个视图里显示 / 隐藏' : '这个视图里没有这类节点'}">`
      + `${shapeIcon(sm.shape || 'star', sm.color)}${esc(t)} <span class="c">${c}</span></span>`
      + (t !== '(无类型)' ? `<span class="ty-ed ${editing ? 'on' : ''}" data-cmd="type-edit ${esc(quoteArg(t))}" title="改「${esc(t)}」的样子(写到类型节点 ~${esc(t)},所有视图生效)">✎</span>` : '')
      + `</div>${editing ? nodeTypeBox(t, sm, live) : ''}`;
  }).join('');
  // 边类型:整个宇宙里用到的(和视图无关:视图只决定画不画)
  const ec = new Map();
  for (const e of data.edges) ec.set(e.type, (ec.get(e.type) || 0) + 1);
  const shownE = new Map((scene.edges || []).map((e) => [e.type, e.color]));
  const edgeRows = [...ec].sort((a, b) => b[1] - a[1]).map(([t, c]) => {
    const editing = typeEdit && typeEdit.kind === 'edgeType' && typeEdit.name === t;
    const col = shownE.get(t) || edgeTypeColor(t);
    return `<div class="ty-row"><span class="chip on ty-edge" data-cmd="type-edit ${esc(quoteArg(t))} edge" title="改「${esc(t)}」边的样子">`
      + `<i class="ty-line" style="background:${esc(col)}"></i>${esc(t)} <span class="c">${c}</span></span>`
      + `<span class="ty-ed ${editing ? 'on' : ''}" data-cmd="type-edit ${esc(quoteArg(t))} edge">✎</span></div>${editing ? edgeTypeBox(t, col, live) : ''}`;
  }).join('');
  el.innerHTML = `<div class="ty-sec">节点类型<span>点名字显示 / 隐藏 · ✎ 改样子</span></div>${nodeRows}`
    + (edgeRows ? `<div class="ty-sec">边类型</div>${edgeRows}` : '');
}
function edgeTypeColor(t) {
  const n = typeNode(t), r = (curSpec().relations || {})[t];
  return (r && r.color) || (n && n.attrs.color) || '#8a8aa8';
}

function nodeTypeBox(t, sm, live) {
  const n = typeNode(t), a = (n && n.attrs) || {};
  const color = a.color || sm.color || '#cfd8ff', shape = a.shape || STYLE_DEFAULT_SHAPES[t] || 'star', scale = a.scale ? Number(a.scale) : 1;
  const unset = (k) => a[k] !== undefined ? `<span class="mini" data-tsu="${k}" title="去掉,用默认">默认</span>` : '';
  const notes = typeOverrides(t);
  return `<div class="ty-box" data-tname="${esc(t)}" data-tkind="nodeType">
    <div class="ty-l"><span class="k">颜色</span><input type="color" data-ts="color" value="${esc(color)}"${live ? '' : ' disabled'}>${unset('color')}</div>
    <div class="ty-l"><span class="k">形状</span>${STYLE_SHAPES.map((s) => `<span class="ty-shape ${s === shape ? 'on' : ''}" data-tset="shape=${s}" title="${SHAPE_NAMES[s] || s}">${shapeIcon(s, color)}</span>`).join('')}${unset('shape')}</div>
    <div class="ty-l"><span class="k">大小</span><input type="range" min="0.3" max="3" step="0.05" data-ts="scale" value="${scale}"${live ? '' : ' disabled'}><span class="v">×${scale.toFixed(2)}</span>${unset('scale')}</div>
    ${notes.map((x) => `<div class="ty-note">这个视图里${esc(x)};这里改的在别的视图里看得见</div>`).join('')}
    <div class="ty-foot"><span class="tag">~${esc(t)}</span>${n ? (n.label && n.label !== t ? ` <span>${esc(n.label)}</span>` : '') : ' <span class="tag">(改了就会建这个类型节点)</span>'}${live ? '' : ' <span class="tag">静态导出:只能预览</span>'}</div>
  </div>`;
}
function edgeTypeBox(t, col, live) {
  const n = typeNode(t), a = (n && n.attrs) || {};
  const width = a.width ? Number(a.width) : 1;
  const unset = (k) => a[k] !== undefined ? `<span class="mini" data-tsu="${k}" title="去掉,用视图的默认">默认</span>` : '';
  const seg = (k, opts) => `<span class="seg">${opts.map(([v, label]) => `<span class="${(a[k] ?? '') === v ? 'on' : ''}" data-tset="${k}=${v}">${label}</span>`).join('')}</span>`;
  const notes = edgeOverrides(t);
  return `<div class="ty-box" data-tname="${esc(t)}" data-tkind="edgeType">
    <div class="ty-l"><span class="k">颜色</span><input type="color" data-ts="color" value="${esc(a.color || col)}"${live ? '' : ' disabled'}>${unset('color')}</div>
    <div class="ty-l"><span class="k">线宽</span><input type="range" min="0.3" max="5" step="0.1" data-ts="width" value="${width}"${live ? '' : ' disabled'}><span class="v">${width.toFixed(1)}</span>${unset('width')}</div>
    <div class="ty-l"><span class="k">箭头</span>${seg('arrow', [['', '默认'], ['true', '→ 有'], ['false', '— 无']])}</div>
    <div class="ty-l"><span class="k">画法</span>${seg('mode', [['', '默认'], ['line', '实线'], ['faint', '淡线'], ['hidden', '不画']])}</div>
    ${notes.map((x) => `<div class="ty-note">${esc(x)}</div>`).join('')}
    <div class="ty-foot"><span class="tag">~${esc(t)}</span>${n ? (n.label && n.label !== t ? ` <span>${esc(n.label)}</span>` : '') : ' <span class="tag">(改了就会建这个类型节点)</span>'}</div>
  </div>`;
}

/** 本地预览:直接改内存里的类型节点,重算视图(每帧最多一次);提交前先还原 */
function typePreview(name, kind, key, value) {
  if (!uni) return;
  const id = '~' + name;
  let n = uni.nodes.get(id);
  if (!typePrev.has(id)) typePrev.set(id, n ? { ...n.attrs } : null);
  if (!n) { n = { id, label: name, attrs: { kind } }; uni.nodes.set(id, n); }
  n.attrs = { ...n.attrs, [key]: value };
  if (!typePrevRaf) typePrevRaf = requestAnimationFrame(() => { typePrevRaf = 0; recompute(true); });
}
function typePrevRevert() {
  for (const [id, before] of typePrev) {
    if (before === null) uni.nodes.delete(id);
    else { const n = uni.nodes.get(id); if (n) n.attrs = before; }
  }
  typePrev.clear();
  if (typePrevRaf) { cancelAnimationFrame(typePrevRaf); typePrevRaf = 0; }
}
/** 写进宇宙:改的是类型节点 ~name(不在就建),和 CLI 的 type-set 同一个操作 */
// 只在控制台里回显等价的命令(不把控制台拉出来挡住面板):样子变了就是反馈
async function typeCommit(name, kind, set, unset = []) {
  typePrevRevert();
  const parts = [...Object.entries(set).map(([k, v]) => `-a ${k}=${v}`), ...unset.map((k) => `--unset ${k}`)];
  try {
    const op = styleOp(uni, name, set, unset, kind);
    did(`type-set ${quoteArg(name)} ${parts.join(' ')}${op.op === 'addNode' && kind === 'edgeType' ? ' -a kind=edgeType' : ''}`);
    await commitOp(op, `~ 类型 ${name}`, null);
  } catch (e) { toast(esc(e.message), true); recompute(true); }
}

$('chips').addEventListener('input', (ev) => {
  const inp = ev.target.closest('[data-ts]'), box = ev.target.closest('.ty-box');
  if (!inp || !box) return;
  const v = inp.value, k = inp.dataset.ts;
  const out = inp.parentElement.querySelector('.v');
  if (out) out.textContent = k === 'scale' ? '×' + Number(v).toFixed(2) : Number(v).toFixed(1);
  typePreview(box.dataset.tname, box.dataset.tkind, k, v);
});
$('chips').addEventListener('change', (ev) => {
  const inp = ev.target.closest('[data-ts]'), box = ev.target.closest('.ty-box');
  if (!inp || !box) return;
  if (window.__STARS_STATIC__) return;   // 静态导出:预览留着,写不进去
  typeCommit(box.dataset.tname, box.dataset.tkind, { [inp.dataset.ts]: inp.value });
});
$('chips').addEventListener('click', (ev) => {
  const box = ev.target.closest('.ty-box');
  if (!box) return;
  const s = ev.target.closest('[data-tset]'), u = ev.target.closest('[data-tsu]');
  if (s) {
    const [k, v] = s.dataset.tset.split('=');
    if (v === '') { if (typeNode(box.dataset.tname)?.attrs[k] !== undefined) typeCommit(box.dataset.tname, box.dataset.tkind, {}, [k]); return; }
    typeCommit(box.dataset.tname, box.dataset.tkind, { [k]: v });
  } else if (u) typeCommit(box.dataset.tname, box.dataset.tkind, {}, [u.dataset.tsu]);
});

/** 打开类型面板并展开某个类型的编辑框(侧栏里点类型、type-edit 命令) */
function openTypeEditor(name, kind) {
  const k = kind || (data.edges.some((e) => e.type === name) && !data.nodes.some((n) => n.attrs.type === name) ? 'edgeType' : 'nodeType');
  typeEdit = typeEdit && typeEdit.name === name && typeEdit.kind === k ? null : { name, kind: k };
  if ($('chips').hidden) PANEL_DEFS.types.set(true);
  renderChips();
  const box = $('chips').querySelector('.ty-box');
  if (box) box.scrollIntoView({ block: 'nearest' });
}
