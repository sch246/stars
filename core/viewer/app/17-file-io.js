// ---- 文件的载入、保存、冲突 ----
/** 侧栏跟着选中走:选中的是文件就显示它,不是就收起(有修改先自动保存)。固定(📌)了的文件不跟:选中别的,上面的详情换,下面的文件不换 */
function syncFile(n) {
  const id = n && fileOf(n) && !window.__STARS_STATIC__ ? n.id : null;
  if (fp && fp.id === id) return;
  if (fp && fp.pinned) return;
  if (fp) releaseFile();
  $('side').classList.toggle('file', !!id);
  if (id) loadFile(id);
}
let fpNext = null;   // open 命令给下一次载入的要求:{ id, want, focus }
async function loadFile(id) {
  const path = fileOf(raw.get(id));
  const req = fpNext && fpNext.id === id ? fpNext : null; fpNext = null;
  const cur = fp = { id, path, info: null, text: '', base: '', full: false, indent: '  ', want: req && req.want, handler: null,
    opts: { html: !!P.mdHtml, scripts: !!P.htmlScripts || ![null, 'off'].includes(grantOf(path)), live: !!P.htmlLive, split: false } };   // 这个预览自己的开关,默认来自设置 → 文件预览;单独授权过连接的页面打开就跑脚本
  $('fp-body').innerHTML = '<div id="fp-media">载入中…</div>'; $('fp-state').textContent = ''; $('fp-more').hidden = true; fpBar(null);
  $('fp-save').style.display = 'none'; $('fp-with').innerHTML = ''; $('fp-remember').hidden = true;
  let info;
  try { info = await api('/api/file?head=' + HEAD + '&path=' + enc(path)); }
  catch (e) { if (fp === cur) $('fp-body').innerHTML = `<div id="fp-media">打不开:${esc(e.message)}</div>`; return; }
  if (fp !== cur) return;
  cur.info = info; cur.text = cur.base = normEol(info.content ?? ''); cur.full = info.kind === 'text' && !info.partial;
  cur.indent = info.content && /\n\t/.test(info.content) ? '\t' : '  ';
  $('fp-code').href = 'vscode://file/' + info.abs.replace(/\\/g, '/');
  renderFileBody();
  clearInterval(fpPoll); fpPoll = setInterval(checkDisk, 3000);
  const orphan = fpOrphan && fpOrphan.id === id ? fpOrphan : null;
  if (orphan) { // 上次切走时没能保存的修改:放回来,让你决定
    fpOrphan = null;
    await loadFull(); if (fp !== cur) return;
    cur.text = orphan.content; refreshBody();   // 基线是磁盘版本,所以它是脏的
    fpBar(`你上次切走时的修改没能保存:文件在你打开之后被别处改过了。<span class="btn" data-fp="load">载入磁盘版本(丢弃我的)</span><span class="btn" data-fp="force">用我的覆盖</span>`);
  }
  if (req && req.focus) focusPrimary();
}
/** 开头 → 全文(可编辑);保留光标与滚动位置 */
async function loadFull() {
  const cur = fp;
  if (!cur || cur.full || cur.loading || !cur.info || cur.info.kind !== 'text' || !cur.info.editable) return;
  cur.loading = true;
  let info;
  try { info = await api('/api/file?path=' + enc(cur.path)); } catch (e) { cur.loading = false; fpBar('载入全文失败:' + esc(e.message)); return; }
  cur.loading = false;
  if (fp !== cur) return;
  cur.info = info; cur.full = true; cur.text = cur.base = normEol(info.content);
  refreshBody();
}
/** 收起文件;有未保存的修改就在后台保存,失败了把修改留下来,提示你回去处理 */
function releaseFile() {
  const cur = fp; fp = null; clearInterval(fpPoll); clearTimeout(formSaveTimer);
  $('side').classList.remove('file'); $('fp-body').innerHTML = ''; fpBar(null);
  if (!fpDirty(cur)) return;
  const content = cur.text;
  api('/api/file', saveBody(cur, content, false))
    .then(() => toast(`已保存 ${esc(cur.path)}`))
    .catch((e) => { fpOrphan = { id: cur.id, content }; toast(`${esc(cur.path)} 的修改没能保存:${esc(e.message)} <span class="btn" data-sel="${esc(cur.id)}">回去处理</span>`, true, 15000); });
}
function focusEditor() { const t = $('fp-text'); if (t) t.focus(); }
/** 磁盘上的文件变了吗?没改过就静默载入(保留光标与滚动),改过就提示 */
async function checkDisk() {
  if (!fp || !fp.info || document.hidden || fp.checking) return;   // 实时信号和定时检查撞在一起时只查一次
  const cur = fp;
  cur.checking = true;
  try { await checkDiskNow(cur); } finally { cur.checking = false; }
}
async function checkDiskNow(cur) {
  let st;
  try { st = await api('/api/file?stat=1&path=' + enc(cur.path)); } catch { return; }
  if (fp !== cur || Math.abs(st.mtime - cur.info.mtime) <= 1) return;
  if (st.mtime === cur.conflictAt && fpDirty(cur)) return;   // 这一版的冲突已经提示过了:不再重复要
  if (fpDirty(cur)) {
    // 磁盘上的新版本恰好就是我改成的样子(别处存了同样的内容):不算冲突,基线跟上即可
    let disk = null;
    try { disk = await fetchDisk(cur); } catch { /* 下面按冲突提示 */ }
    if (fp !== cur) return;
    if (disk && disk.kind === 'text' && normEol(disk.content) === cur.text) { cur.info = disk; cur.base = cur.text; fpState(); return; }
    cur.conflictAt = st.mtime;
    fpBar(`磁盘上的文件在 ${ago(st.mtime)} 被改过了,和你未保存的修改冲突。<span class="btn" data-fp="load">载入磁盘版本</span><span class="btn" data-fp="force">用我的覆盖</span>`);
    return;
  }
  await reloadFile(`已载入磁盘上的新版本(${ago(st.mtime)})`);
}
/** 重新要一份磁盘上的版本。手上有全文就带着基线的哈希去要:服务端还记得那一版,就只回改动的一段,
 *  这边拼回来、核对哈希(对不上 —— 比如请求期间刚保存过 —— 就再要整份)。没有全文的(只看了开头)照旧要开头 */
async function fetchDisk(cur) {
  const q = '/api/file?' + (cur.full ? '' : 'head=' + HEAD + '&') + 'path=' + enc(cur.path);
  if (!cur.full) return api(q);
  const base = cur.base, info = await api(q + '&since=' + enc(textHash(base)));
  if (!info.patch) return info;
  let text = null;
  try { text = textPatch(base, info.patch); } catch { /* 补丁对不上这份基线 */ }
  if (text === null || textHash(text) !== info.hash) return api(q);
  delete info.patch; info.content = text;
  return info;
}
async function reloadFile(note) {
  const cur = fp; if (!cur) return;
  let info;
  try { info = await fetchDisk(cur); } catch (e) { fpBar('重新载入失败:' + esc(e.message)); return; }
  if (fp !== cur) return;
  cur.info = info; cur.text = cur.base = normEol(info.content ?? ''); cur.full = info.kind === 'text' && !info.partial;
  refreshBody();
  if (note) fpFlash(esc(note)); else fpBar(null);
}
async function saveFile(force) {
  if (!fp || !fp.full || !fp.info.editable) return;
  const cur = fp, content = cur.text;
  if (!force && !fpDirty(cur)) { fpFlash('没有改动,不用保存'); return; }   // 和基线一样:连请求都不发
  try {
    const r = await api('/api/file', saveBody(cur, content, force));
    cur.info = { ...cur.info, mtime: r.mtime, size: r.size, content };
    cur.base = content;   // 新基线;保存期间又改了的话,当前文本 ≠ 基线,自然还是脏的
    if (cur.handler === 'html' && !cur.opts.live) htmlRefreshSoon();   // 只看保存版本的 HTML 预览:存完刷新
    fpFlash('已保存');
  } catch (e) {
    if (/改过/.test(e.message)) fpBar(`保存被拒绝:文件在你打开之后被别处改过了。<span class="btn" data-fp="load">载入磁盘版本(丢弃我的)</span><span class="btn" data-fp="force">用我的覆盖</span>`);
    else fpBar('保存失败:' + esc(e.message));
  }
  fpState();
}
$('fp-bar').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-fp]'); if (!b) return;
  if (b.dataset.fp === 'load') reloadFile('已载入磁盘版本'); else saveFile(true);
});
addEventListener('beforeunload', (ev) => { if (fpDirty()) { ev.preventDefault(); ev.returnValue = ''; } });
