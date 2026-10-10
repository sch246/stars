// ---------- 文件:选中文件节点,侧栏下半就是它的内容(不依赖 VS Code,像原版星罗)----------
// 点一下就打开,所以要轻:先只要开头 24 KB(只读预览),点进编辑框或滚到底才载入全文、变成可编辑。
// 切走(点别处 / 选别的节点)时有未保存的修改就自动保存;保存被拒(别处改过)就留着修改,提示你回去处理。
// 磁盘上变了(实时信号 / 每 3 秒查一次修改时间):没改过就直接载入,改过就提示冲突。
const fileOf = (n) => (n && typeof n.attrs.file === 'string' && n.attrs.type !== 'dir' && !n.attrs.file.endsWith('/') ? n.attrs.file : null);
const HEAD = 24 << 10;
let fp = null;          // { id, path, info, text, base, full, indent, handler, want }
// 脏不是一个标志位,而是算出来的:当前文本 ≠ 基线(打开 / 上次保存 / 载入磁盘版本时的内容)。改了再改回来就是干净的,
// 不会白白保存、也不会在关页面时拦你。两边都按"换行折成 LF"比(<textarea> 本来就会这样折;CRLF 文件保存时服务端再还原)。
const normEol = textNormEol;
// 保存只传改动的一段 + 基线的哈希(服务端按内容核对基线,对不上就是别处改过了);「用我的覆盖」才传整份
const saveBody = (cur, content, force) => (force ? { path: cur.path, content, mtime: null } : { path: cur.path, patch: textDiff(cur.base, content), baseHash: textHash(cur.base) });
const fpDirty = (f = fp) => !!(f && f.full && f.info && f.info.kind === 'text' && f.text !== f.base);
let fpPoll = null, fpOrphan = null;
let barSeq = 0;          // 每条提示一个序号:定时消失只清掉自己,不清后来的提示
const fpBar = (html, kind) => { barSeq++; const b = $('fp-bar'); b.hidden = !html; b.className = kind || ''; b.innerHTML = html || ''; };
const fpFlash = (html) => { fpBar(html, 'info'); const n = barSeq; setTimeout(() => { if (barSeq === n) fpBar(null); }, 2500); };
let toastTimer = null;
function toast(html, bad, ms = 4000) {
  const t = $('toast'); t.innerHTML = html; t.className = bad ? 'bad' : ''; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
$('toast').addEventListener('click', (ev) => { const b = ev.target.closest('[data-sel]'); if (b) { $('toast').hidden = true; select(b.dataset.sel, true); } });
const enc = encodeURIComponent;

// ---------- 文件类型处理器:每类文件有自己的侧栏视图;文本文件的「原文」视图始终可用 ----------
// 处理器自己判断能不能接这个文件:{ role: 'default' | 'available', priority } 或 false。
// 选哪个:这次指定的(打开方式 / open --with)> 记住的(按扩展名,open --remember)> 优先级最高的默认 > 原文。
// 所有视图共用同一份文本缓冲 fp.text:在表单里改、切到原文看,改动都在;保存、冲突检测、切走自动保存都按它来。
const extOf = (p) => ((/\.([^./]+)$/.exec(p) || [])[1] || '').toLowerCase();
const IMG_EXT = /^(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/, MD_EXT = /^(md|markdown|mdown|mkd)$/;
/** 表单能编辑的格式:llf / json(含 .jsonc)/ toml */
const formFormatOf = (path) => { const e = extOf(path); return e === 'llf' || e === 'toml' ? e : e === 'json' || e === 'jsonc' ? 'json' : null; };
/** 不读文件就能判断的种类(双击、选默认视图用):image / markdown / form / universe / file */
const fileTypeOf = (path) => { const e = extOf(path); return IMG_EXT.test(e) ? 'image' : MD_EXT.test(e) ? 'markdown' : /^(html?|xhtml)$/.test(e) ? 'html' : formFormatOf(path) ? 'form' : e === 'stars' ? 'universe' : 'file'; };
const FILE_HANDLERS = [
  { id: 'text', label: '原文', match: (d) => (d.kind === 'text' ? { role: 'available' } : false), mount: mountText },
  { id: 'image', label: '图片', match: (d) => (d.kind === 'image' ? { role: 'default', priority: 10 } : false), mount: mountImage },
  { id: 'markdown', label: '预览', match: (d) => (d.kind === 'text' && MD_EXT.test(d.ext) ? { role: 'default', priority: 10 } : false), mount: mountMarkdown },
  { id: 'html', label: '预览', match: (d) => (d.kind === 'text' && /^(html?|xhtml)$/.test(d.ext) ? { role: 'default', priority: 10 } : false), mount: mountHtml },
  // JSON 太大(比如 package-lock.json)时表单不当默认:几千行的表单又慢又没用
  { id: 'form', label: '表单', match: (d) => (d.kind === 'text' && formFormatOf(d.path) ? { role: d.ext === 'llf' || d.size <= 256 << 10 ? 'default' : 'available', priority: 10 } : false), mount: mountForm },
  { id: 'universe', label: '宇宙', match: (d) => (d.kind === 'text' && d.ext === 'stars' ? { role: 'default', priority: 10 } : false), mount: mountUniverse },
  { id: 'info', label: '信息', match: (d) => (d.kind === 'binary' || d.kind === 'large' ? { role: 'default' } : false), mount: mountInfo },
];
let openWith = {};
try { openWith = JSON.parse(localStorage.getItem('stars.openWith') || '{}'); } catch { /* 隐私模式 */ }
const saveOpenWith = () => { try { localStorage.setItem('stars.openWith', JSON.stringify(openWith)); } catch { /* 隐私模式 */ } };
const fpDesc = () => ({ path: fp.path, ext: extOf(fp.path), kind: fp.info.kind, size: fp.info.size });
function handlersFor(d) {
  return FILE_HANDLERS.map((h) => ({ h, m: h.match(d) })).filter((x) => x.m)
    .sort((a, b) => ((b.m.role === 'default') - (a.m.role === 'default')) || ((b.m.priority || 0) - (a.m.priority || 0)));
}
function pickHandler(d, want) {
  const list = handlersFor(d), has = (id) => list.some((x) => x.h.id === id);
  if (want && has(want)) return want;
  if (openWith[d.ext] && has(openWith[d.ext])) return openWith[d.ext];
  return list.length ? list[0].h.id : null;
}

function fpState() {
  if (!fp) return;
  $('fp-pin').classList.toggle('on', !!fp.pinned);
  if (!fp.info) return;
  const i = fp.info;
  $('fp-state').innerHTML = (fpDirty() ? '<span class="dirty">● 未保存</span> · ' : '') + `${fmtBytes(i.size)} · 改于 ${ago(i.mtime)}`
    + (i.readonly ? ' · 只读' : i.kind === 'text' && !i.editable ? ' · 超过 2 MB,只读' : '');
  $('fp-save').style.display = fp.full && i.editable && (fpDirty() || fp.handler === 'text') ? '' : 'none';
  const more = $('fp-more');
  more.hidden = !(i.kind === 'text' && !fp.full);
  if (!more.hidden) more.textContent = `只显示了开头 ${fmtBytes(new Blob([fp.text || '']).size)} / ${fmtBytes(i.size)}` + (i.editable ? ' · 点进编辑框或滚到底载入全部' : '');
}
function gutter() {
  const t = $('fp-text'); if (!t || !fp) return;
  const lines = t.value.split('\n').length;
  if (lines !== fp.lines) { fp.lines = lines; $('fp-gutter').textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n'); }
  $('fp-gutter').scrollTop = t.scrollTop;
}
const gutterSoon = debounce(gutter, 120);
const markDirty = debounce(() => { if (fp) fpState(); }, 120);   // 状态栏跟着重算(脏是比出来的)

/** 按当前文件挑视图并挂上去;「打开方式」不止一个时显示成分段按钮,旁边的「记住」= 以后这类扩展名都用它 */
function renderFileBody() {
  const d = fpDesc(), list = handlersFor(d);
  fp.handler = pickHandler(d, fp.want);
  const id = esc(quoteArg(fp.id)), remembered = openWith[d.ext] === fp.handler;
  $('fp-with').innerHTML = list.length > 1 ? list.map(({ h }) => `<span class="${h.id === fp.handler ? 'on' : ''}" data-cmd="open ${id} --with ${h.id}" title="用「${esc(h.label)}」看">${esc(h.label)}</span>`).join('') : '';
  $('fp-remember').hidden = list.length < 2 || !d.ext;
  $('fp-remember').classList.toggle('on', remembered);
  $('fp-remember').dataset.cmd = `open ${quoteArg(fp.id)} --with ${fp.handler} ${remembered ? '--forget' : '--remember'}`;
  $('fp-remember').title = remembered ? `已记住:.${d.ext} 文件用「${FILE_HANDLERS.find((h) => h.id === fp.handler).label}」打开(再点取消)` : `以后 .${d.ext} 文件都用「${(FILE_HANDLERS.find((h) => h.id === fp.handler) || {}).label}」打开`;
  const body = $('fp-body');
  body.className = 'h-' + (fp.handler || 'none'); body.innerHTML = '';
  fp.renderView = null; fp.onEditRender = false; setPageBridge(null);
  const h = FILE_HANDLERS.find((x) => x.id === fp.handler);
  if (h) h.mount(body); else body.innerHTML = '<div id="fp-media">没有能打开它的视图</div>';
  fpState();
}
/** 内容变了(载入全文 / 磁盘上的新版本):原文视图就地更新(保留光标与滚动),别的视图重画 */
function refreshBody() {
  const t = $('fp-text');
  if (t && (fp.handler === 'text' || fp.opts.split)) {   // 原文(或并排时上面的编辑器)就地更新,预览跟着重画
    const focused = document.activeElement === t, keep = [t.selectionStart, t.selectionEnd, t.scrollTop];
    t.value = fp.text; t.readOnly = !fp.full || !fp.info.editable; gutter();
    [t.selectionStart, t.selectionEnd, t.scrollTop] = keep; if (focused) t.focus();
    if (fp.renderView) fp.renderView();
    fpState();
  } else {
    const sc = $('fp-body').firstElementChild ? $('fp-body').firstElementChild.scrollTop : 0;
    renderFileBody();
    if ($('fp-body').firstElementChild) $('fp-body').firstElementChild.scrollTop = sc;
  }
}
/** 打开后把光标放到该放的地方:原文 → 编辑框;表单 → 第一个输入 */
function focusPrimary() {
  if (!fp) return;
  if (fp.handler === 'text') { focusEditor(); return; }
  const el = $('fp-body').querySelector('input:not([type=range]):not([disabled]), textarea:not([disabled])');
  if (el) el.focus();
}

// ---- 原文 ----
function mountText(body) {
  body.innerHTML = '<pre id="fp-gutter"></pre><textarea id="fp-text" spellcheck="false" autocomplete="off"></textarea>';
  const t = $('fp-text');
  t.value = fp.text; t.readOnly = !fp.full || !fp.info.editable; fp.lines = 0; gutter();
  t.addEventListener('focus', () => loadFull());
  t.addEventListener('scroll', () => { $('fp-gutter').scrollTop = t.scrollTop; if (!fp.full && t.scrollTop + t.clientHeight > t.scrollHeight - 120) loadFull(); });
  t.addEventListener('input', () => { fp.text = t.value; markDirty(); gutterSoon(); if (fp.onEditRender) pvRenderSoon(); });
  t.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveFile(false); }
    else if (ev.key === 'Tab' && !ev.shiftKey && !t.readOnly) { ev.preventDefault(); document.execCommand('insertText', false, fp.indent); }
  });
}
// ---- 图片(点一下全屏看)----
const rawUrl = (path, v) => withP('/api/raw?path=' + enc(path) + '&t=' + token) + (v ? '&v=' + v : '');
function mountImage(body) {
  body.innerHTML = `<div id="fp-media"><img alt="${esc(fp.path)}" title="点一下全屏看" style="cursor:zoom-in" src="${rawUrl(fp.path, fp.info.mtime)}" data-cmd="open ${esc(quoteArg(fp.id))} --full"></div>`;
}
function showLightbox(path) {
  const lb = $('lightbox');
  lb.querySelector('img').src = rawUrl(path, Date.now()); lb.hidden = false;
}
$('lightbox').addEventListener('click', () => { $('lightbox').hidden = true; });
// ---- 二进制 / 太大 ----
function mountInfo(body) {
  body.innerHTML = `<div id="fp-media">${fp.info.kind === 'large' ? `文件太大(${fmtBytes(fp.info.size)}),不在这里显示` : `二进制文件(${fmtBytes(fp.info.size)}),无法以文本显示`}<br><span class="tag">可以用右上角的 VS Code 打开</span></div>`;
}

// ---- 预览的公共部分:每个预览自己的开关(这个文件开着时有效;新预览的默认值在设置 → 文件预览里)、并排编辑 ----
// 并排编辑:上面是原文编辑器,下面是预览,打字时预览跟着走(Markdown 总是跟着;HTML 在「实时」打开时跟着)。
function previewBar(items) {
  return '<div class="pv-bar">' + items.map(([cmd, label, on, title]) =>
    `<span class="pv-opt ${on === undefined ? 'act' : on ? 'on' : ''}" data-cmd="${esc(cmd)}" title="${esc(title || '')}">${on === undefined ? '' : `<i>${on ? '☑' : '☐'}</i>`}${esc(label)}</span>`).join('') + '</div>';
}
/** 预览类视图的骨架:并排时上面挂原文编辑器;renderView(paneEl) 画预览,打字时被再次调用 */
function mountPreview(body, renderView) {
  if (fp.opts.split && fp.info.kind === 'text') {
    body.classList.add('split');
    body.innerHTML = '<div class="sp-edit"></div><div class="sp-view"></div>';
    mountText(body.querySelector('.sp-edit'));
    if (!fp.full) loadFull();
  } else body.innerHTML = '<div class="sp-view"></div>';
  const pane = body.querySelector('.sp-view');
  fp.renderView = () => renderView(pane);
  fp.renderView();
}
const pvRenderSoon = debounce(() => { if (fp && fp.renderView && fp.onEditRender) fp.renderView(); }, 250);
