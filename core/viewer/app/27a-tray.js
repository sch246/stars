// ---------- 剪贴板:Ctrl+C / Ctrl+X 把选中的节点存成一条(左下角的列表);Ctrl+V 放进选中的容器 ----------
// 复制的条目粘贴 = 复制(cp);剪切的粘贴 = 移动(mv,之后这一条变成复制);Ctrl+Shift+V = 引用(ln:也放进那里)。
// 粘贴到哪:选中的容器;选中的是文件 / 就是剪贴板里的东西 = 它所在的容器;什么都没选 = 当前空间。
// 列表里点一条 = 放到最上面(Ctrl+V 粘贴的就是它);★ 钉住 = 书签(不会被挤掉);⌖ 跳过去;⟶ 把选中的连到它。
// 和系统剪贴板互通:复制出去是一行一个 id;粘贴进来的普通文本 = 一个笔记节点,文件(截图、拖进来的文件)= 存进文件夹。
// 只存在这个浏览器里(按项目目录分开)。
const TRAY_MAX = 12, STARS_MIME = 'application/x-stars+json';
let tray = [], trayFor = null;
const trayKey = () => 'stars.tray:' + (project ? project.dir : '_');
function ensureTray() {
  const k = trayKey();
  if (k === trayFor) return;
  trayFor = k;
  try { tray = JSON.parse(localStorage.getItem(k) || '[]').filter((e) => e && Array.isArray(e.ids)); } catch { tray = []; }
}
function saveTray() { try { localStorage.setItem(trayKey(), JSON.stringify(tray)); } catch { /* 隐私模式 */ } renderTray(); }
const trayText = (e) => e.ids.join('\n');
function trayPush(ids, mode) {
  ensureTray();
  const text = ids.join('\n'), pinned = tray.find((e) => e.pinned && trayText(e) === text);
  tray = tray.filter((e) => e.pinned || trayText(e) !== text);
  if (pinned) { pinned.mode = mode; tray = [pinned, ...tray.filter((e) => e !== pinned)]; }
  else tray.unshift({ k: Math.random().toString(36).slice(2, 9), ids: [...ids], mode, t: Date.now(), pinned: false });
  let free = 0;
  tray = tray.filter((e) => e.pinned || ++free <= TRAY_MAX);
  saveTray();
}
const trayLabel = (e) => { const live = e.ids.filter((id) => raw.has(id)); const first = live[0] ?? e.ids[0]; return (raw.get(first)?.label || first) + (e.ids.length > 1 ? ` 等 ${e.ids.length} 个` : ''); };

function renderTray() {
  ensureTray();
  let el = $('tray');
  if (!tray.length || window.__STARS_STATIC__) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'tray'; el.className = 'panel';
    document.body.appendChild(el);
    el.addEventListener('click', onTrayClick);
    el.addEventListener('dblclick', (ev) => { const r = ev.target.closest('[data-trk]'); if (r && !ev.target.closest('[data-tract]')) trayGo(trayEntry(r.dataset.trk)); });
  }
  let open = true; try { open = localStorage.getItem('stars.trayOpen') !== '0'; } catch { /* 隐私模式 */ }
  el.hidden = false;
  el.classList.toggle('shut', !open);
  const rows = tray.map((e, i) => {
    const gone = e.ids.every((id) => !raw.has(id));
    return `<div class="tr-e${i === 0 ? ' top' : ''}${gone ? ' gone' : ''}" data-trk="${e.k}" title="${esc(e.ids.slice(0, 20).join('\n'))}${e.ids.length > 20 ? '\n…' : ''}">`
      + `<span class="ico" title="${e.pinned ? '书签' : e.mode === 'cut' ? '剪切的:粘贴 = 移动' : '复制的:粘贴 = 复制'}">${e.pinned ? '★' : e.mode === 'cut' ? '✂' : '⧉'}</span>`
      + `<span class="lb">${esc(trayLabel(e))}</span>`
      + `<span class="acts"><span data-tract="go" title="跳过去(选中它们)· 双击这一条也行">⌖</span><span data-tract="link" title="把选中的连到它(弹出关系类型)">⟶</span>`
      + `<span data-tract="paste" title="粘贴进选中的容器(Ctrl+V)">⇣</span><span data-tract="pin" title="${e.pinned ? '取消书签' : '钉住当书签(不会被挤掉)'}">${e.pinned ? '☆' : '★'}</span><span data-tract="rm" title="移出列表">×</span></span></div>`;
  }).join('');
  el.innerHTML = `<div class="tr-h"><span class="t" data-tract="toggle" title="收起 / 展开">剪贴板 ${open ? '▾' : '▸'}</span><span class="tag">${tray.length}</span>`
    + `<span class="mini" data-tract="clear" title="清空(书签留着)">清空</span></div>`
    + (open ? `<div class="tr-l">${rows}</div><div class="tr-f">Ctrl+C 复制 · Ctrl+X 剪切 · Ctrl+V 粘贴进选中的 · Ctrl+Shift+V 引用 · 点一条 = 放到最上面</div>` : '');
}
const trayEntry = (k) => tray.find((e) => e.k === k);
function onTrayClick(ev) {
  const act = ev.target.closest('[data-tract]'), row = ev.target.closest('[data-trk]');
  const e = row && trayEntry(row.dataset.trk);
  const a = act && act.dataset.tract;
  if (a === 'toggle') { let open = true; try { open = localStorage.getItem('stars.trayOpen') !== '0'; localStorage.setItem('stars.trayOpen', open ? '0' : '1'); } catch { /* 隐私模式 */ } renderTray(); return; }
  if (a === 'clear') { tray = tray.filter((x) => x.pinned); saveTray(); return; }
  if (!e) return;
  if (!a) { tray = [e, ...tray.filter((x) => x !== e)]; saveTray(); return; }   // 点一条 = 放到最上面
  if (a === 'go') trayGo(e);
  else if (a === 'link') {
    const from = [...selection].filter((id) => !e.ids.includes(id)), to = e.ids.filter((id) => raw.has(id));
    if (!from.length) { toast('先选中要连的节点,再点 ⟶(或者右键从节点拖过去)'); return; }
    if (!to.length) { toast('这一条里的节点都不在了', true); return; }
    const r = act.getBoundingClientRect();
    openLinkPicker({ mode: 'link', from, to, x: r.right, y: r.top - 200 });
  }
  else if (a === 'paste') pasteEntry(e, pasteTarget(e.ids), false);
  else if (a === 'pin') { e.pinned = !e.pinned; saveTray(); }
  else if (a === 'rm') { tray = tray.filter((x) => x !== e); saveTray(); }
}
function trayGo(e) {
  if (!e) return;
  const ids = e.ids.filter((id) => raw.has(id));
  if (!ids.length) { toast('这一条里的节点都不在了', true); return; }
  did(selLine(ids));
  setSelection(ids, ids[0]);
  select(ids[0], true, true);   // 让第一个出现在画面里(必要时切空间)
}

// ---- 粘贴 ----
/** 粘贴到哪:选中的容器;选中的是文件 / 是要粘贴的东西本身 = 它所在的容器;没选 = 当前空间 */
function pasteTarget(exclude = []) {
  const s = selected;
  if (!s || !raw.has(s) || !compiled) return isSpaces() ? curSpaceId : null;
  if (exclude.includes(s) || raw.get(s).attrs.type === 'file') return compiled.parentOf(s) ?? null;
  return s;
}
/** 粘贴一条:剪切的 = 移动(之后这一条变成复制,id 换成移动后的),复制的 = 复制,asRef = 引用 */
function pasteEntry(e, target, asRef) {
  if (!e) { toast('剪贴板是空的(先选中节点按 Ctrl+C)'); return; }
  if (window.__STARS_STATIC__ || replay) { toast('静态导出 / 回放里不能改宇宙', true); return; }
  const ids = e.ids.filter((id) => raw.has(id));
  if (!ids.length) { toast('这一条里的节点都不在了', true); return; }
  const mode = asRef ? 'ref' : e.mode === 'cut' ? 'move' : 'copy';
  const chk = opCheck({ mode, items: ids }, { id: target });
  if (chk.bad) { toast(esc(chk.bad), true); return; }
  if (chk.same) { toast(`已经在「${esc(lblOf(target))}」里了`); return; }
  return arrangeNow(mode, ids, target, { echo: true }).then((r) => {
    if (mode === 'move' && r && r.n) { e.ids = r.result; e.mode = 'copy'; saveTray(); }
    return r;
  }).catch(() => {});
}
/** 粘贴进来的普通文本:一个笔记节点(标签是第一行),放进目标容器 */
function pasteText(text, target) {
  if (window.__STARS_STATIC__ || replay) return;
  const d = new Date(), pad = (x) => String(x).padStart(2, '0');
  let id = `note/${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  for (let i = 2; raw.has(id); i++) id = id.replace(/(-\d+)?$/, '') + '-' + i;
  const first = text.trim().split('\n')[0].trim().slice(0, 40) || '笔记';
  const ops = [{ op: 'addNode', id, label: first, attrs: { type: 'note', summary: text.trim().slice(0, 8000) } }];
  if (target != null) ops.push({ op: 'addEdge', from: target, type: compiled ? compiled.relation : 'contains', to: id, attrs: {} });
  did(`add ${quoteArg(id)} ${quoteArg(first)} -t note -s …${target != null ? `   # 放进 ${target}` : ''}`);
  commitOp(ops.length === 1 ? ops[0] : { op: 'batch', ops }, `+ 笔记 ${first}`, null)
    .then(() => { setSelection([id], id); toast(`粘贴成笔记:${esc(first)} · <span data-cmd="undo" style="cursor:pointer;text-decoration:underline">撤销</span>`); })
    .catch((err) => toast(esc(err.message), true));
}
/** 外面来的文件存进容器:文件夹 = 存进去;概念之类 = 存进项目根,再让它也装着 */
async function uploadFiles(files, target) {
  if (window.__STARS_STATIC__ || replay) { toast('静态导出 / 回放里不能存文件', true); return; }
  const list = [...files].filter((f) => f.size > 0 || f.type);
  if (!list.length) { toast('文件夹拖不进来(只能拖文件)', true); return; }
  const total = list.reduce((a, f) => a + f.size, 0);
  if (total > 48 << 20) { toast(`太大了(${fmtBytes(total)});一次最多 48 MB`, true); return; }
  if (!fsMount()) { toast('这个宇宙没有对应的文件夹(没有扫描过的根目录),存不了文件', true); return; }
  const dir = target != null && isFsDir(target) ? target : null, container = dir ? null : target;
  const read = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(r.error); r.readAsDataURL(f); });
  try {
    const payload = await Promise.all(list.map(async (f) => ({ name: f.name || `pasted.${(f.type.split('/')[1] || 'bin').replace(/\W/g, '')}`, b64: await read(f) })));
    did(`# 存进 ${dir ?? fsMount()}:${payload.map((p) => p.name).join('、')}`);
    const r = await api('/api/upload', { dir, container, files: payload, rel: compiled ? compiled.relation : 'contains', author: 'viewer' });
    await waitApplied(r.n);
    setSelection(r.created, r.created[0]);
    toast(`存进「${esc(lblOf(dir ?? fsMount()))}」:${r.created.map(esc).join('、')} · <span data-cmd="undo" style="cursor:pointer;text-decoration:underline">撤销</span>`, false, 4500);
  } catch (err) { toast(esc(err.message), true); }
}

// ---- 键盘(用浏览器的 copy / cut / paste 事件:侧栏里选中的文字照常复制)----
const typingNow = () => { const ae = document.activeElement; return !!ae && (['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName) || ae.isContentEditable); };
const textSelected = () => { const s = window.getSelection(); return !!s && !s.isCollapsed && !!String(s).trim(); };
function onCopyCut(ev, mode) {
  if (typingNow() || textSelected() || !selection.size || !$('lightbox').hidden) return;
  ev.preventDefault();
  const ids = [...selection];
  ev.clipboardData.setData('text/plain', ids.join('\n'));
  ev.clipboardData.setData(STARS_MIME, JSON.stringify({ project: project ? project.dir : null, ids, mode }));
  trayPush(ids, mode);
  did(mode === 'cut' ? 'cut' : 'copy');
}
document.addEventListener('copy', (ev) => onCopyCut(ev, 'copy'));
document.addEventListener('cut', (ev) => onCopyCut(ev, 'cut'));
let pasteRefUntil = 0;
addEventListener('keydown', (ev) => { if (isCtrl(ev) && ev.shiftKey && ev.key.toLowerCase() === 'v') pasteRefUntil = performance.now() + 1000; }, true);
document.addEventListener('paste', (ev) => {
  if (typingNow() || !ev.clipboardData) return;
  const dt = ev.clipboardData, files = [...dt.files], text = dt.getData('text/plain');
  let refs = null;
  try { const j = dt.getData(STARS_MIME); if (j) refs = JSON.parse(j); } catch { /* 别的程序放的 */ }
  ensureTray();
  const asRef = performance.now() < pasteRefUntil;
  pasteRefUntil = 0;
  // 星罗自己复制的:按剪贴板里的那一条粘贴(没有私有格式时,文字和列表里某一条完全一样也算)
  let e = refs && tray.find((x) => trayText(x) === refs.ids.join('\n'));
  if (!e && !refs && text) e = tray.find((x) => trayText(x) === text.replace(/\r\n/g, '\n').trim());
  if (refs && refs.project && project && refs.project !== project.dir && !e) { ev.preventDefault(); toast('剪贴板里是另一个项目的节点', true); return; }
  if (refs && !e) e = { ids: refs.ids, mode: refs.mode };
  if (e) { ev.preventDefault(); pasteEntry(e, pasteTarget(e.ids), asRef); return; }
  if (files.length) { ev.preventDefault(); uploadFiles(files, pasteTarget()); return; }
  if (text && text.trim()) { ev.preventDefault(); pasteText(text, pasteTarget()); }
});

// ---- 外面的文件拖进来 ----
let dropHover = null;   // [x, y]
const hasFiles = (ev) => !!ev.dataTransfer && [...ev.dataTransfer.types].includes('Files');
function dropTargetAt(px, py) {
  const h = hitAt(px, py);
  if (h && h.n) return !h.domain && raw.get(h.n.id)?.attrs.type === 'file' ? compiled.parentOf(h.n.id) ?? null : h.n.id;
  return isSpaces() ? curSpaceId : regionAt(px, py);
}
addEventListener('dragover', (ev) => { if (hasFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = ev.target === canvas ? 'copy' : 'none'; dropHover = ev.target === canvas ? canvasXY(ev) : null; } });
addEventListener('dragleave', (ev) => { if (!ev.relatedTarget) dropHover = null; });
addEventListener('drop', (ev) => {
  if (!hasFiles(ev)) return;
  ev.preventDefault();   // 别让浏览器跳去打开这个文件
  dropHover = null;
  if (ev.target !== canvas) return;
  uploadFiles(ev.dataTransfer.files, dropTargetAt(...canvasXY(ev)));
});
overlayDrawers.push(() => {
  if (!dropHover) return;
  const [x, y] = dropHover, t = dropTargetAt(x, y), dir = t != null && isFsDir(t) ? t : fsMount();
  const pos = t != null ? screenNodes().find((p) => p.id === t) : null;
  if (pos) { ctx.strokeStyle = 'rgba(123,224,160,0.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pos.sx, pos.sy, Math.max(16, pos.r + 4), 0, TAU); ctx.stroke(); }
  const text = !fsMount() ? '这个宇宙没有对应的文件夹,存不了文件' : `存进「${lblOf(dir)}」${t != null && t !== dir ? `,让「${lblOf(t)}」也装着` : ''}`;
  ctx.font = '11px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(8,10,24,0.88)'; ctx.fillRect(x + 16, y + 18, ctx.measureText(text).width + 12, 18);
  ctx.fillStyle = fsMount() ? '#9ef0c0' : '#ff8aa0'; ctx.fillText(text, x + 22, y + 21);
});

// ---- 命令与菜单 ----
defCmd('copy', {
  group: '剪贴板', effect: 'ui', title: '复制:把选中的(或给的)节点存进剪贴板(Ctrl+C);粘贴 = 复制一份', usage: 'copy [id…]', args: [nodeArg()],
  run: (a) => { const ids = a.length ? a : [...selection]; if (!ids.length) return false; trayPush(ids, 'copy'); try { navigator.clipboard?.writeText(ids.join('\n')).catch(() => {}); } catch { /* 不是安全上下文 */ } },
});
defCmd('cut', {
  group: '剪贴板', effect: 'ui', title: '剪切:把选中的(或给的)节点存进剪贴板(Ctrl+X);粘贴 = 移动过去', usage: 'cut [id…]', args: [nodeArg()],
  run: (a) => { const ids = a.length ? a : [...selection]; if (!ids.length) return false; trayPush(ids, 'cut'); try { navigator.clipboard?.writeText(ids.join('\n')).catch(() => {}); } catch { /* 不是安全上下文 */ } },
});
defCmd('paste', {
  group: '剪贴板', effect: 'write', title: '粘贴剪贴板最上面那一条(--entry 第几条)到容器(不给 = 选中的容器;--here = 当前空间);--ref = 引用', usage: 'paste [容器] [--ref] [--here] [--entry n]',
  flags: { entry: 'entry' }, bools: ['ref', 'here'], args: [nodeArg('容器')],
  run: ([target], o) => {
    ensureTray();
    const e = tray[(Number(o.entry) || 1) - 1];
    if (!e) return false;
    if (target && !raw.has(target)) throw new Error(`节点不存在:${target}`);
    return pasteEntry(e, target || (o.here ? (isSpaces() ? curSpaceId : null) : pasteTarget(e.ids)), !!o.ref);
  },
});
defCmd('tray', {
  group: '剪贴板', effect: 'ui', title: '剪贴板:列出;clear 清空(书签留着);pin / rm <第几条>', usage: 'tray [clear|pin n|rm n]', args: [{ name: '动作', values: () => ['clear', 'pin', 'rm'] }],
  run: ([act, n]) => {
    ensureTray();
    const e = tray[(Number(n) || 1) - 1];
    if (act === 'clear') { tray = tray.filter((x) => x.pinned); saveTray(); return; }
    if (act === 'pin' || act === 'rm') { if (!e) return false; if (act === 'pin') e.pinned = !e.pinned; else tray = tray.filter((x) => x !== e); saveTray(); return; }
    return { out: tray.map((x, i) => `${String(i + 1).padStart(2)} ${x.pinned ? '★' : x.mode === 'cut' ? '✂' : '⧉'} ${trayLabel(x)}`).join('\n') || '(剪贴板是空的)', data: tray };
  },
});
menuProviders.push((id, ids) => {
  if (window.__STARS_STATIC__ || replay) return [];
  ensureTray();
  const top = tray[0], out = [];
  if (id) out.push({ label: '复制', key: 'Ctrl C', cmd: 'copy' }, { label: '剪切', key: 'Ctrl X', cmd: 'cut' });
  if (top) {
    const target = id ? pasteTarget(top.ids) : (isSpaces() ? curSpaceId : null);
    out.push({ label: `粘贴「${trayLabel(top)}」到「${lblOf(target)}」`, key: 'Ctrl V', run: () => pasteEntry(top, target, false) });
    if (id && !top.ids.includes(id)) out.push({ label: `把选中的连到「${trayLabel(top)}」…`, run: () => openLinkPicker({ mode: 'link', from: ids.length ? ids : [id], to: top.ids.filter((x) => raw.has(x)), x: innerWidth / 2 - 120, y: innerHeight / 3 }) });
  }
  return out;
});
PANEL_DEFS.tray = { label: '剪贴板', open: () => !!$('tray') && !$('tray').hidden && !$('tray').classList.contains('shut'), set: (on) => { try { localStorage.setItem('stars.trayOpen', on ? '1' : '0'); } catch { /* 隐私模式 */ } renderTray(); } };
