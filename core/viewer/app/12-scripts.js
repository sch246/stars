// ---------- 脚本:run tools/x.js —— 在隐藏的沙箱 iframe 里跑一个 JS 模块,接上页面桥(级别、提议、日志作者都和页面一样)----------
// 脚本拿到的 stars 和页面里的一样(exec / cmd / graph / on / store / print / exit),全局还有 args。可以 export default async (stars, args) => {…},
// 也可以直接写顶层代码;console.log 转到控制台。跑完了:没订阅事件就关掉;订阅了就一直听着,直到 stop 或 stars.exit()。
// 写入的作者是 script:<路径>;没单独授权的脚本用设置里的默认级别(默认「读」),要写就 connect propose <路径>。
const scriptRunner = (nonce, url, args) => `
globalThis.args = ${JSON.stringify(args).replace(/</g, '\\u003c')};
const fmt = (x) => typeof x === 'string' ? x : x instanceof Error ? (x.stack || String(x)) : (() => { try { return JSON.stringify(x); } catch (e) { return String(x); } })();
for (const k of ['log', 'info', 'warn', 'error']) { const o = console[k].bind(console); console[k] = (...a) => { o(...a); stars.print((k === 'error' ? '✗ ' : k === 'warn' ? '⚠ ' : '') + a.map(fmt).join(' ')); }; }
const done = (ok, value) => parent.postMessage({ stars: ${JSON.stringify(nonce)}, kind: 'done', ok, value }, '*');
addEventListener('error', (e) => console.error(e.error || e.message));
addEventListener('unhandledrejection', (e) => console.error('未处理的异常:', e.reason));
try {
const m = await import(${JSON.stringify(url)});
let v = typeof m.default === 'function' ? await m.default(stars, globalThis.args) : undefined;
v = v === undefined ? null : v;
try { structuredClone(v); } catch (e) { v = fmt(v); }
done(true, v);
} catch (e) { done(false, fmt(e)); }
`;
function runScript(path, args) {
  if (window.__STARS_STATIC__) throw new Error('静态导出不能跑脚本');
  if (!/\.m?js$/i.test(path)) throw new Error('查看器里只能跑 .js / .mjs(.ts 用 stars run 在 Node 里跑)');
  const level = levelOf(path);
  if (level === 'off') throw new Error(`${path} 的连接级别是「关」:先 connect read ${quoteArg(path)}(或更高)`);
  const old = scripts.get(path);
  if (old) stopScript(old, '重新运行');
  const nonce = bridgeNonce(), f = document.createElement('iframe');
  f.hidden = true; f.title = '脚本 ' + path; f.setAttribute('sandbox', 'allow-scripts');
  const dir = path.includes('/') ? path.replace(/[^/]*$/, '') : '';
  f.srcdoc = `<!doctype html><meta charset="utf-8"><base href="${esc(location.origin + previewUrl(dir))}">${bridgeShim(nonce)}`
    + `<script type="module">${scriptRunner(nonce, location.origin + previewUrl(path) + '?v=' + Date.now(), args)}<\/script>`;
  const b = { nonce, frame: f, path, level, subs: new Set(), kind: 'script', author: 'script:' + path };
  const s = { path, frame: f, b, started: Date.now(), state: '运行中', finished: false };
  const p = new Promise((ok, no) => { s.resolve = ok; s.reject = no; });
  scripts.set(path, s); bridges.set(nonce, b);
  document.body.appendChild(f);
  return p;
}
/** 脚本结束:ok = true / false / 'exit'(stars.exit()) */
function scriptDone(s, ok, value) {
  if (ok === 'exit') { if (!s.finished) { s.finished = true; s.resolve({ out: `■ ${s.path} 退出了` }); } stopScript(s, null); return; }
  if (s.finished) return;
  s.finished = true;
  if (ok !== true) { stopScript(s, null); s.reject(new Error(`${s.path} 出错了:${value}`)); return; }
  const listening = [...s.b.subs];
  if (listening.length) s.state = '监听中 ' + listening.join(' / '); else stopScript(s, null);
  const v = value === null ? '' : ':' + (typeof value === 'string' ? value : JSON.stringify(value));
  s.resolve({ out: `✓ ${s.path} 跑完了${v}${listening.length ? `(还在监听 ${listening.join(' / ')};stop ${quoteArg(s.path)} 停掉)` : ''}`, data: value });
}
function stopScript(s, why) {
  s.frame.remove(); bridges.delete(s.b.nonce);
  if (scripts.get(s.path) === s) scripts.delete(s.path);
  if (!s.finished) { s.finished = true; s.reject(new Error(`${s.path} 被停止${why ? ':' + why : ''}`)); }
  else if (why) conLog(`■ ${s.path} 停了:${why}`, 'dim');
}
