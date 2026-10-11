// ---------- 剪贴板:Ctrl+C / Ctrl+X 把选中的节点存成一条(左下角的列表);Ctrl+V 放进选中的容器 ----------
// 复制的条目粘贴 = 复制(cp);剪切的粘贴 = 移动(mv,之后这一条变成复制);Ctrl+Shift+V = 引用(ln:也放进那里)。
// 粘贴到哪:选中的容器;选中的是文件 / 就是剪贴板里的东西 = 它所在的容器;什么都没选 = 当前空间。
// 列表里点一条 = 放到最上面,并写回系统剪贴板(Ctrl+V 粘贴的就是它);★ 钉住 = 书签(不会被挤掉);⌖ 跳过去;⟶ 把选中的连到它。
// 和系统剪贴板互通:复制出去是一行一个 id;外面复制的东西:
//   文字 = 在文件夹里粘贴成文件(名字取第一行),在概念里 / 背景上粘贴成笔记节点(太长也存成文件);Ctrl+Shift+V = 换另一种;
//   文件(截图、文件管理器里复制的)= 存进文件夹(概念 = 存进项目根,概念也装着)。
// 现在按 Ctrl+V 会怎样:pastePlan 一处决定 —— 列表底下的提示、右键菜单、真正的粘贴都用它。
// 读得到系统剪贴板时(Chrome / Edge 允许过一次之后),窗口拿回焦点就读:外面复制的显示成列表最上面的「外部」一行。
// 列表只存在这个浏览器里(按项目目录分开)。
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
  if ((!tray.length && !clipExt) || window.__STARS_STATIC__ || replay) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'tray'; el.className = 'panel';
    document.body.appendChild(el);
    el.addEventListener('click', onTrayClick);
    el.addEventListener('dblclick', (ev) => { const r = ev.target.closest('[data-trk]'); if (r && !ev.target.closest('[data-tract]')) trayGo(trayEntry(r.dataset.trk)); });
  }
  let open = true; try { open = localStorage.getItem('stars.trayOpen') !== '0'; } catch { /* 隐私模式 */ }
  el.hidden = false;
  el.classList.toggle('shut', !open);
  const ext = clipExt ? `<div class="tr-e top ext" data-trext="1" title="${esc(clipExtTitle())}">`
    + `<span class="ico" title="外面复制的(系统剪贴板里现在是它)">⇲</span><span class="lb">${esc(clipExtLabel())}</span>`
    + `<span class="acts"><span data-tract="xpaste" title="粘贴进选中的容器(Ctrl+V)">⇣</span></span></div>` : '';
  const rows = tray.map((e, i) => {
    const gone = e.ids.every((id) => !raw.has(id));
    return `<div class="tr-e${i === 0 && !clipExt ? ' top' : ''}${gone ? ' gone' : ''}" data-trk="${e.k}" title="${esc(e.ids.slice(0, 20).join('\n'))}${e.ids.length > 20 ? '\n…' : ''}">`
      + `<span class="ico" title="${e.pinned ? '书签' : e.mode === 'cut' ? '剪切的:粘贴 = 移动' : '复制的:粘贴 = 复制'}">${e.pinned ? '★' : e.mode === 'cut' ? '✂' : '⧉'}</span>`
      + `<span class="lb">${esc(trayLabel(e))}</span>`
      + `<span class="acts"><span data-tract="go" title="跳过去(选中它们)· 双击这一条也行">⌖</span><span data-tract="link" title="把选中的连到它(弹出关系类型)">⟶</span>`
      + `<span data-tract="paste" title="粘贴进选中的容器">⇣</span><span data-tract="pin" title="${e.pinned ? '取消书签' : '钉住当书签(不会被挤掉)'}">${e.pinned ? '☆' : '★'}</span><span data-tract="rm" title="移出列表">×</span></span></div>`;
  }).join('');
  el.innerHTML = `<div class="tr-h"><span class="t" data-tract="toggle" title="收起 / 展开">剪贴板 ${open ? '▾' : '▸'}</span><span class="tag">${tray.length + (clipExt ? 1 : 0)}</span>`
    + (clipPerm === 'prompt' ? `<span class="mini" data-tract="peek" title="让星罗读系统剪贴板:外面复制的文字 / 图片会显示在这里(浏览器会问一次)">看外部</span>` : '')
    + (tray.length ? `<span class="mini" data-tract="clear" title="清空(书签留着)">清空</span>` : '') + '</div>'
    + (open ? `<div class="tr-l">${ext}${rows}</div><div class="tr-f">${trayFoot()}</div>` : '');
}
/** 列表底下:现在按 Ctrl+V / Ctrl+Shift+V 会怎样 */
function trayFoot() {
  const src = clipNow();
  if (!src) return 'Ctrl+C 复制 · Ctrl+X 剪切 · Ctrl+V 粘贴进选中的';
  const target = pasteTarget(src.entry ? src.entry.ids : []), p = pastePlan(src, target, false), q = pastePlan(src, target, true);
  const line = (k, x) => `<div class="${x.ok ? '' : 'no'}"><kbd>${k}</kbd> ${esc(x.desc)}</div>`;
  return line('Ctrl V', p) + (q.desc !== p.desc ? line('Ctrl Shift V', q) : '')
    + (clipPerm === 'unsupported' && !src.ext ? '<div class="tr-n">外面复制的东西,这个浏览器只在按 Ctrl+V 时才给看</div>' : '');
}
const trayEntry = (k) => tray.find((e) => e.k === k);
function onTrayClick(ev) {
  const act = ev.target.closest('[data-tract]'), row = ev.target.closest('[data-trk]');
  const e = row && trayEntry(row.dataset.trk);
  const a = act && act.dataset.tract;
  if (a === 'toggle') { let open = true; try { open = localStorage.getItem('stars.trayOpen') !== '0'; localStorage.setItem('stars.trayOpen', open ? '0' : '1'); } catch { /* 隐私模式 */ } renderTray(); return; }
  if (a === 'clear') { tray = tray.filter((x) => x.pinned); saveTray(); return; }
  if (a === 'peek') { readClip(true); return; }
  if (a === 'xpaste') { const src = clipNow(); if (src && src.ext) runPlan(pastePlan(src, pasteTarget(), false)); return; }
  if (!e) return;
  if (!a) { tray = [e, ...tray.filter((x) => x !== e)]; writeClip(e); saveTray(); return; }   // 点一条 = 放到最上面,写回系统剪贴板
  if (a === 'go') trayGo(e);
  else if (a === 'link') {
    const from = [...selection].filter((id) => !e.ids.includes(id)), to = e.ids.filter((id) => raw.has(id));
    if (!from.length) { toast('先选中要连的节点,再点 ⟶(或者右键从节点拖过去)'); return; }
    if (!to.length) { toast('这一条里的节点都不在了', true); return; }
    const r = act.getBoundingClientRect();
    openLinkPicker({ mode: 'link', from, to, x: r.right, y: r.top - 200 });
  }
  else if (a === 'paste') runPlan(pastePlan({ entry: e }, pasteTarget(e.ids), false));
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

// ---- 现在剪贴板里是什么 ----
let clipExt = null;      // 外面复制的(系统剪贴板里现在是它):{ kind: 'text', text } | { kind: 'files', files };null = 列表最上面那条(或者不知道)
let clipWrote = null;    // 星罗上次写进系统剪贴板的文字:读回来还是它 = 不算外部
let clipPerm = 'unsupported';   // 能不能静默读系统剪贴板:granted · prompt(问一次)· denied · unsupported(Firefox / Safari)
/** 现在按 Ctrl+V 粘贴的东西:{ entry } | { text, ext } | { files, ext };外面复制的(读得到时)优先,不然是列表最上面那条 */
function clipNow() {
  ensureTray();
  if (clipExt) return clipExt.kind === 'text' ? { text: clipExt.text, ext: true } : { files: clipExt.files, ext: true };
  return tray[0] ? { entry: tray[0] } : null;
}
const firstLine = (text) => text.trim().split('\n')[0].trim();
function clipExtLabel() {
  if (!clipExt) return '';
  if (clipExt.kind === 'text') return '外部 · ' + (firstLine(clipExt.text).slice(0, 40) || '(空白)');
  const f = clipExt.files;
  if (f.length === 1 && f[0].type.startsWith('image/')) return `外部 · 图片 ${(f[0].type.split('/')[1] || '').toUpperCase()} ${fmtBytes(f[0].size)}`;
  return `外部 · 文件 ${f[0].name}${f.length > 1 ? ` 等 ${f.length} 个` : ''}`;
}
const clipExtTitle = () => (!clipExt ? '' : clipExt.kind === 'text' ? clipExt.text.slice(0, 600) + (clipExt.text.length > 600 ? '\n…' : '') : clipExt.files.map((f) => f.name).join('\n'));
/** 星罗把这些 id 写进了系统剪贴板(复制、剪切、点列表里的一条) */
function noteWrote(text) { clipWrote = text; clipExt = null; }
function writeClip(e) {
  const t = trayText(e);
  noteWrote(t);
  try { navigator.clipboard?.writeText(t).catch(() => {}); } catch { /* 不是安全上下文 */ }
}
/** 外面复制的是不是其实是列表里的一条(星罗复制出去的文字又回来了):是就把那条放到最上面 */
function adoptClip(ext) {
  if (ext && ext.kind === 'text') {
    const norm = ext.text.replace(/\r\n/g, '\n').trim(), e = tray.find((x) => trayText(x) === norm);
    if (e) { if (tray[0] !== e) { tray = [e, ...tray.filter((x) => x !== e)]; try { localStorage.setItem(trayKey(), JSON.stringify(tray)); } catch { /* 隐私模式 */ } } ext = null; }
    else if (norm === clipWrote) ext = null;
  }
  clipExt = ext;
  renderTray();
}
/** 读系统剪贴板(ask = 用户点了「看外部」,浏览器可能弹一次权限确认) */
async function readClip(ask = false) {
  if (window.__STARS_STATIC__ || replay || !navigator.clipboard?.read || (!ask && clipPerm !== 'granted')) return;
  let items;
  try { items = await navigator.clipboard.read(); }
  catch { if (ask) toast('浏览器没让读剪贴板(地址栏左边的权限里可以改)', true); return; }
  ensureTray();
  let ext = null;
  try {
    for (const it of items) {
      const img = it.types.find((t) => t.startsWith('image/'));
      if (img) { const b = await it.getType(img); ext = { kind: 'files', files: [new File([b], 'image.' + (img.split('/')[1] || 'png'), { type: img })] }; break; }
      if (it.types.includes('text/plain')) { const t = await (await it.getType('text/plain')).text(); if (t.trim()) ext = { kind: 'text', text: t }; break; }
    }
  } catch { return; }
  adoptClip(ext);
}
(async () => {
  try {
    const st = await navigator.permissions.query({ name: 'clipboard-read' });
    const upd = () => { clipPerm = st.state; if (clipPerm === 'granted') readClip(); else renderTray(); };
    st.onchange = upd; upd();
  } catch { clipPerm = 'unsupported'; }   // Firefox / Safari:不认这个权限名,也不让静默读
})();
addEventListener('focus', () => { readClip(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) readClip(); });

// ---- 粘贴 ----
const NOTE_MAX = 2000, NOTE_LINES = 30;   // 文字比这长:在概念里也存成文件(概念装着它),不塞进节点的属性里
/** 粘贴到哪:选中的容器;选中的是文件 / 是要粘贴的东西本身 = 它所在的容器;没选 = 当前空间 */
function pasteTarget(exclude = []) {
  const s = selected;
  if (!s || !raw.has(s) || !compiled) return isSpaces() ? curSpaceId : null;
  if (exclude.includes(s) || raw.get(s).attrs.type === 'file') return compiled.parentOf(s) ?? null;
  return s;
}
const noteLabel = (text) => firstLine(text).slice(0, 40) || '笔记';
const stampNow = () => { const d = new Date(), pad = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };
/** 粘贴成文件时的文件名:第一行(去掉 Markdown 标题的 #)+ .md;整段是 JSON = 粘贴-时间.json */
function pasteFileName(text) {
  const t = text.trim();
  if (/^[[{]/.test(t)) { try { JSON.parse(t); return `粘贴-${stampNow()}.json`; } catch { /* 不是 JSON */ } }
  const base = firstLine(t).replace(/^#+\s*/, '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 40).trim();
  return (base || `粘贴-${stampNow()}`) + '.md';
}
/**
 * 剪贴板里的东西(src:{ entry } | { text } | { files })粘贴进 target 会怎样:{ ok, desc, run }。提示、菜单、真正的粘贴都用它。
 * alt = Ctrl+Shift+V:条目 = 引用(也放进那里);文字 = 换另一种(文件 ↔ 笔记)。
 */
function pastePlan(src, target, alt) {
  const where = (t) => `「${lblOf(t)}」`;
  if (src.entry) {
    const e = src.entry, ids = e.ids.filter((id) => raw.has(id));
    if (!ids.length) return { ok: false, desc: '这一条里的节点都不在了' };
    const mode = alt ? 'ref' : e.mode === 'cut' ? 'move' : 'copy';
    const chk = opCheck({ mode, items: ids }, { id: target });
    if (chk.bad) return { ok: false, desc: chk.bad };
    if (chk.same) return { ok: false, desc: `「${trayLabel(e)}」已经在${where(target)}里了` };
    return { ok: true, desc: `把「${trayLabel(e)}」${{ copy: '复制进', move: '移动到', ref: '引用进' }[mode]}${where(target)}`, run: () => pasteEntry(e, target, alt) };
  }
  if (src.files) {
    if (!fsMount()) return { ok: false, desc: '这个宇宙没有对应的文件夹,存不了文件' };
    const f = fileTarget(target, src.files[0].name || 'pasted', false);
    return { ok: true, desc: `存成文件 ${f.path}${src.files.length > 1 ? ` 等 ${src.files.length} 个` : ''}${f.container != null ? `,${where(f.container)}也装着` : ''}`, run: () => uploadFiles(src.files, target) };
  }
  const text = src.text, fs = !!fsMount();
  const long = text.length > NOTE_MAX || text.split('\n').length > NOTE_LINES;
  let asFile = fs && ((target != null && isFsDir(target)) || long);
  if (alt && fs) asFile = !asFile;
  if (asFile) {
    const name = pasteFileName(text), f = fileTarget(target, name, false);
    return { ok: true, desc: `新建文件 ${f.path}${f.container != null ? `,${where(f.container)}也装着` : ''}`, run: () => uploadFiles([new File([text], name, { type: 'text/plain' })], target, '粘贴成文件') };
  }
  return { ok: true, desc: `新建笔记「${noteLabel(text)}」${target != null ? `,放进${where(target)}` : ''}`, run: () => pasteText(text, target) };
}
function runPlan(p) {
  if (!p.ok) { toast(esc(p.desc), true); return; }
  return p.run();
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
/** 粘贴进来的文字当笔记:一个节点(标签是第一行,全文在 summary 里),放进目标容器 */
function pasteText(text, target) {
  if (window.__STARS_STATIC__ || replay) return;
  let id = `note/${stampNow()}`;
  for (let i = 2; raw.has(id); i++) id = id.replace(/(-\d+)?$/, '') + '-' + i;
  const first = noteLabel(text);
  const ops = [{ op: 'addNode', id, label: first, attrs: { type: 'note', summary: text.trim() } }];
  if (target != null) ops.push({ op: 'addEdge', from: target, type: compiled ? compiled.relation : 'contains', to: id, attrs: {} });
  did(`add ${quoteArg(id)} ${quoteArg(first)} -t note -s …${target != null ? `   # 放进 ${target}` : ''}`);
  return commitOp(ops.length === 1 ? ops[0] : { op: 'batch', ops }, `+ 笔记 ${first}`, null)
    .then(() => { setSelection([id], id); toast(`粘贴成笔记:${esc(first)} · <span data-cmd="undo" style="cursor:pointer;text-decoration:underline">撤销</span>`); })
    .catch((err) => toast(esc(err.message), true));
}
/** 外面来的文件存进容器:文件夹 = 存进去;概念之类 = 存进项目根,再让它也装着 */
async function uploadFiles(files, target, verb = '存进') {
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
    did(`# ${verb} ${dir ?? fsMount()}:${payload.map((p) => p.name).join('、')}`);
    const r = await api('/api/upload', { dir, container, files: payload, rel: compiled ? compiled.relation : 'contains', author: 'viewer' });
    await waitApplied(r.n);
    setSelection(r.created, r.created[0]);
    toast(`${esc(verb)}「${esc(lblOf(dir ?? fsMount()))}」:${r.created.map(esc).join('、')} · <span data-cmd="undo" style="cursor:pointer;text-decoration:underline">撤销</span>`, false, 4500);
    return r;
  } catch (err) { toast(esc(err.message), true); }
}

// ---- 键盘(用浏览器的 copy / cut / paste 事件:侧栏里选中的文字照常复制)----
const typingNow = () => { const ae = document.activeElement; return !!ae && (['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName) || ae.isContentEditable); };
const textSelected = () => { const s = window.getSelection(); return !!s && !s.isCollapsed && !!String(s).trim(); };
function onCopyCut(ev, mode) {
  if (typingNow() || textSelected() || !selection.size || !$('lightbox').hidden) {   // 页面里的文字照常复制:它就是外部剪贴板里的新东西
    const sel = String(window.getSelection() || '');
    setTimeout(() => { if (clipPerm === 'granted') readClip(); else if (sel.trim()) adoptClip({ kind: 'text', text: sel }); }, 30);
    return;
  }
  ev.preventDefault();
  const ids = [...selection];
  ev.clipboardData.setData('text/plain', ids.join('\n'));
  ev.clipboardData.setData(STARS_MIME, JSON.stringify({ project: project ? project.dir : null, ids, mode }));
  noteWrote(ids.join('\n'));
  trayPush(ids, mode);
  did(mode === 'cut' ? 'cut' : 'copy');
}
document.addEventListener('copy', (ev) => onCopyCut(ev, 'copy'));
document.addEventListener('cut', (ev) => onCopyCut(ev, 'cut'));
let pasteAltUntil = 0;
addEventListener('keydown', (ev) => { if (isCtrl(ev) && ev.shiftKey && ev.key.toLowerCase() === 'v') pasteAltUntil = performance.now() + 1000; }, true);
document.addEventListener('paste', (ev) => {
  if (typingNow() || !ev.clipboardData) return;
  const dt = ev.clipboardData, files = [...dt.files], text = dt.getData('text/plain');
  let refs = null;
  try { const j = dt.getData(STARS_MIME); if (j) refs = JSON.parse(j); } catch { /* 别的程序放的 */ }
  ensureTray();
  const alt = performance.now() < pasteAltUntil;
  pasteAltUntil = 0;
  // 星罗自己复制的:按剪贴板里的那一条粘贴(没有私有格式时,文字和列表里某一条完全一样也算)
  let e = refs && tray.find((x) => trayText(x) === refs.ids.join('\n'));
  if (!e && !refs && text) e = tray.find((x) => trayText(x) === text.replace(/\r\n/g, '\n').trim());
  if (refs && refs.project && project && refs.project !== project.dir && !e) { ev.preventDefault(); toast('剪贴板里是另一个项目的节点', true); return; }
  if (refs && !e) e = { ids: refs.ids, mode: refs.mode };
  const src = e ? { entry: e } : files.length ? { files } : text && text.trim() ? { text } : null;
  if (!src) return;
  ev.preventDefault();
  adoptClip(e ? null : files.length ? { kind: 'files', files } : { kind: 'text', text });   // 现在知道系统剪贴板里是什么了
  runPlan(pastePlan(src, pasteTarget(e ? e.ids : []), alt));
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
  run: (a) => { const ids = a.length ? a : [...selection]; if (!ids.length) return false; trayPush(ids, 'copy'); writeClip(tray[0]); },
});
defCmd('cut', {
  group: '剪贴板', effect: 'ui', title: '剪切:把选中的(或给的)节点存进剪贴板(Ctrl+X);粘贴 = 移动过去', usage: 'cut [id…]', args: [nodeArg()],
  run: (a) => { const ids = a.length ? a : [...selection]; if (!ids.length) return false; trayPush(ids, 'cut'); writeClip(tray[0]); },
});
defCmd('paste', {
  group: '剪贴板', effect: 'write', title: '粘贴剪贴板里现在的东西(外面复制的优先;--entry 第几条 = 列表里那一条)到容器(不给 = 选中的容器;--here = 当前空间);--alt = 另一种(条目 = 引用,文字 = 文件 ↔ 笔记)',
  usage: 'paste [容器] [--alt] [--here] [--entry n] [--dry]', flags: { entry: 'entry' }, bools: ['alt', 'ref', 'here', 'dry'], args: [nodeArg('容器')],
  run: ([target], o) => {
    ensureTray();
    const src = o.entry ? (tray[Number(o.entry) - 1] ? { entry: tray[Number(o.entry) - 1] } : null) : clipNow();
    if (!src) return false;
    if (target && !raw.has(target)) throw new Error(`节点不存在:${target}`);
    const p = pastePlan(src, target || (o.here ? (isSpaces() ? curSpaceId : null) : pasteTarget(src.entry ? src.entry.ids : [])), !!(o.alt || o.ref));
    if (o.dry) return { out: (p.ok ? '' : '✗ ') + p.desc, data: { ok: p.ok, desc: p.desc } };
    if (!p.ok) throw new Error(p.desc);
    return p.run();
  },
});
defCmd('tray', {
  group: '剪贴板', effect: 'ui', title: '剪贴板:列出;clear 清空(书签留着);pin / rm <第几条>', usage: 'tray [clear|pin n|rm n]', args: [{ name: '动作', values: () => ['clear', 'pin', 'rm'] }],
  run: ([act, n]) => {
    ensureTray();
    const e = tray[(Number(n) || 1) - 1];
    if (act === 'clear') { tray = tray.filter((x) => x.pinned); saveTray(); return; }
    if (act === 'pin' || act === 'rm') { if (!e) return false; if (act === 'pin') e.pinned = !e.pinned; else tray = tray.filter((x) => x !== e); saveTray(); return; }
    const lines = tray.map((x, i) => `${String(i + 1).padStart(2)} ${x.pinned ? '★' : x.mode === 'cut' ? '✂' : '⧉'} ${trayLabel(x)}`);
    if (clipExt) lines.unshift(` ⇲ ${clipExtLabel()}`);
    return { out: lines.join('\n') || '(剪贴板是空的)', data: { external: clipExt && (clipExt.kind === 'text' ? { text: clipExt.text } : { files: clipExt.files.map((f) => ({ name: f.name, type: f.type, size: f.size })) }), entries: tray } };
  },
});
menuProviders.push((id, ids) => {
  if (window.__STARS_STATIC__ || replay) return [];
  const src = clipNow(), out = [];
  if (id) out.push({ label: '复制', key: 'Ctrl C', cmd: 'copy' }, { label: '剪切', key: 'Ctrl X', cmd: 'cut' });
  if (src) {   // 和按 Ctrl+V 是同一个决定(pastePlan)
    const target = id ? pasteTarget(src.entry ? src.entry.ids : []) : (isSpaces() ? curSpaceId : null);
    const p = pastePlan(src, target, false), q = pastePlan(src, target, true);
    out.push({ label: '粘贴:' + p.desc, key: 'Ctrl V', disabled: !p.ok, run: () => runPlan(p) });
    if (q.desc !== p.desc && q.ok) out.push({ label: (src.entry ? '粘贴引用:' : '换一种粘贴:') + q.desc, key: 'Ctrl Shift V', run: () => runPlan(q) });
    const top = src.entry;
    if (id && top && !top.ids.includes(id)) out.push({ label: `把选中的连到「${trayLabel(top)}」…`, run: () => openLinkPicker({ mode: 'link', from: ids.length ? ids : [id], to: top.ids.filter((x) => raw.has(x)), x: innerWidth / 2 - 120, y: innerHeight / 3 }) });
  }
  return out;
});
PANEL_DEFS.tray = { label: '剪贴板', open: () => !!$('tray') && !$('tray').hidden && !$('tray').classList.contains('shut'), set: (on) => { try { localStorage.setItem('stars.trayOpen', on ? '1' : '0'); } catch { /* 隐私模式 */ } renderTray(); } };
