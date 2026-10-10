// ---------- 页面桥(见 core/src/bridge.ts):侧栏 HTML 预览里的页面通过 postMessage 调命令 ----------
// 页面拿不到 token。查看器只认当前挂着的那个 iframe 发来的、带着这次暗号的消息;命令照常走 exec(src = page),
// 执行前按命令的 effect 和页面的级别检查。级别按「项目目录 + 页面路径」记在 ~/.config/stars/grants.llf,没记的用设置里的默认。
const LEVEL_NAMES = { off: '关', read: '读', ui: '界面', propose: '提议', write: '写' };
const bridgeNonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
const projDir = () => (project && project.dir) || '_';
function grantOf(path) {
  try { const n = llfFind(llfParseDoc(userCfg.grants.text, CFG_OPTS), ['pages', projDir(), path]); if (n && n.kind === 'str' && bridgeIsLevel(n.value.trim())) return n.value.trim(); }
  catch { /* 坏文件:按默认 */ }
  return null;
}
const levelOf = (path) => grantOf(path) || (bridgeIsLevel(P.pageBridge) ? P.pageBridge : 'read');
function setGrant(path, level) { cfgEdit('grants', { path: ['pages', projDir(), path], value: level === null ? undefined : level }); grantsChanged(); }
/** 授权或默认值变了:要加上 / 去掉 window.stars 就重新载入页面;只是级别变了就就地改(页面会收到 level 事件) */
function grantsChanged() {
  for (const s of [...scripts.values()]) {   // 跑着的脚本:关了就停,别的级别就地改
    const lv = levelOf(s.path);
    if (lv === 'off') stopScript(s, '连接被关掉了');
    else if (lv !== s.b.level) { s.b.level = lv; bridgePost(s.b, 'level', lv); }
  }
  if (!fp || fp.handler !== 'html' || !fp.renderView || !fp.info) return;
  const lv = fp.opts.scripts ? levelOf(fp.path) : 'off', cur = bridge && bridge.path === fp.path ? bridge.level : 'off';
  if ((lv === 'off') !== (cur === 'off')) { fp.renderView(); return; }
  if (bridge && lv !== bridge.level) { bridge.level = lv; bridgePost(bridge, 'level', lv); }
  const pane = $('fp-body').querySelector('.sp-view');
  if (pane && pane.querySelector('.pv-bar')) htmlBar(pane);
}
function setPageBridge(b) { if (bridge) bridges.delete(bridge.nonce); bridge = b; if (b) bridges.set(b.nonce, b); }
function bridgePost(b, event, value) {
  if (!b.subs.has(event) || !b.frame.isConnected || !b.frame.contentWindow) return;
  try { b.frame.contentWindow.postMessage({ stars: b.nonce, event, value }, '*'); } catch { /* 克隆不了的值:这次不发 */ }
}
function bridgeEmit(event, value) { for (const b of bridges.values()) bridgePost(b, event, value); }
/** 按页面存的小数据(沙箱里的页面没有 localStorage):存在查看器这边,按项目目录 + 页面路径分开 */
function bridgeStore(b, m) {
  const k = 'stars.page:' + projDir() + ':' + b.path;
  let obj = {};
  try { obj = JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch { /* 隐私模式 / 坏数据 */ }
  if (m.op === 'get') return Object.prototype.hasOwnProperty.call(obj, m.key) ? obj[m.key] : null;
  if (m.op === 'keys') return Object.keys(obj);
  if (m.key === '__proto__') throw new Error('不能用这个键');
  if (m.op === 'set') obj[m.key] = m.value === undefined ? null : JSON.parse(JSON.stringify(m.value));
  else if (m.op === 'del') delete obj[m.key];
  else throw new Error('store 只有 get / set / del / keys');
  localStorage.setItem(k, JSON.stringify(obj));
  return true;
}
window.addEventListener('message', (ev) => {
  const m = ev.data, b = m && typeof m === 'object' ? bridges.get(m.stars) : null;
  if (!b || !b.frame.isConnected || ev.source !== b.frame.contentWindow) return;
  const reply = (ok, v) => {
    if (m.id === undefined) return;
    try { ev.source.postMessage(ok ? { stars: b.nonce, re: m.id, ok: true, value: v } : { stars: b.nonce, re: m.id, ok: false, error: String(v) }, '*'); }
    catch (e) { ev.source.postMessage({ stars: b.nonce, re: m.id, ok: false, error: '结果传不回页面:' + e.message }, '*'); }
  };
  try {
    if (m.kind === 'sub') { if (['change', 'select', 'level'].includes(m.event)) b.subs.add(m.event); return; }
    if (m.kind === 'info') { reply(true, { runner: b.kind, path: b.path, project: project ? { id: project.id, name: project.name, dir: project.dir } : null, level: b.level, selected, view: currentView }); return; }
    if (m.kind === 'graph') { reply(true, { nodes: data.nodes, edges: data.edges, proposals: data.proposals || {}, n: lastN }); return; }
    if (m.kind === 'store') { reply(true, bridgeStore(b, m)); return; }
    if (m.kind === 'print') { conLog(`[${b.path.replace(/^.*\//, '')}] ${String(m.text ?? '')}`, /^✗ /.test(m.text) ? 'err' : ''); return; }
    if (m.kind === 'exit' || m.kind === 'done') { const s = scripts.get(b.path); if (s && s.b === b) scriptDone(s, m.kind === 'exit' ? 'exit' : m.ok, m.value); return; }
    if (m.kind === 'exec' || m.kind === 'cmd') {
      const line = m.kind === 'cmd' ? cmdLine(String(m.name), Array.isArray(m.args) ? m.args : []) : String(m.line || '');
      const spec = CMDS.get(tokenize(line)[0] || '');
      if (b.kind === 'page' && spec && spec.effect === 'ui' && bridgeAllows('ui', b.level) && fp && fp.path === b.path && !fp.pinned) { fp.pinned = true; fpState(); }   // 页面动界面(选中、跳转……):先把自己固定住,不然选中别的就把自己换掉了
      exec(line, 'page', (r) => reply(r.ok, r.ok ? { out: r.out, data: r.data } : r.error), b.author, b.level);
      return;
    }
    throw new Error('不认识的请求:' + m.kind);
  } catch (e) { reply(false, (e && e.message) || e); }
});
const htmlRefreshSoon = debounce(() => { if (fp && fp.handler === 'html' && fp.renderView) fp.renderView(); }, 300);
