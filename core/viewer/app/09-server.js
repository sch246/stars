// ---------- 与服务端的接口(写入需要页面内嵌的 token)----------
const token = (document.querySelector('meta[name=stars-token]') || {}).content || '';
const pvToken = (document.querySelector('meta[name=stars-preview]') || {}).content || '';   // 只用于 /preview(预览页能读到它,所以它什么也写不了)
function withP(path) { return projectId ? path + (path.includes('?') ? '&' : '?') + 'p=' + projectId : path; }
async function api(path, body) {
  if (window.__STARS_STATIC__) throw new Error('这是静态导出,只读;请连接实时查看器来保存');
  const r = await fetch(withP(path), {
    method: body ? 'POST' : 'GET',
    headers: { 'x-stars-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
const ago = (t) => {
  if (!t) return '无记录';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return '刚刚'; if (s < 3600) return Math.floor(s / 60) + ' 分钟前'; if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 60) return Math.floor(s / 86400) + ' 天前'; if (s < 86400 * 365) return Math.floor(s / 2592000) + ' 个月前';
  return (s / 31536000).toFixed(1) + ' 年前';
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
