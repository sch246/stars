// ---------- 和服务端说话的一层:调接口(call)、收事件(listen)、项目里文件的地址(fileUrl / rawUrl)----------
// 上面的代码只通过 transport 说话。默认的实现是 HTTP:fetch /api/*(带页面内嵌的 token)+ EventSource /events + /preview 地址;
// 静态导出没有服务端:只读,快照内嵌在页面里。别的宿主(以后的 VS Code 面板:postMessage 接到插件后台,后台用 hub.ts + localApi)
// 在页面脚本之前放一个 window.__STARS_TRANSPORT__,实现同样的几个方法就行。
const token = (document.querySelector('meta[name=stars-token]') || {}).content || '';
const pvToken = (document.querySelector('meta[name=stars-preview]') || {}).content || '';   // 只用于 /preview(预览页能读到它,所以它什么也写不了)
function withP(path) { return projectId ? path + (path.includes('?') ? '&' : '?') + 'p=' + projectId : path; }
const encPath = (path) => path.split('/').map(encodeURIComponent).join('/');
function httpTransport() {
  return {
    kind: 'http',
    /** 调一个接口:没有 body = GET;出错抛带服务端说明的 Error */
    async call(path, body) {
      const r = await fetch(withP(path), {
        method: body ? 'POST' : 'GET',
        headers: { 'x-stars-token': token, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      return j;
    },
    /** 收事件:on.message 收快照 / 增量(data.type),其余键是具名事件(config / closed / ui …),on.error 连接断了;返回关闭函数 */
    listen(on) {
      const es = new EventSource(withP('/events'));
      es.onmessage = (ev) => on.message(JSON.parse(ev.data));
      es.onerror = () => on.error && on.error();
      for (const [name, f] of Object.entries(on)) if (name !== 'message' && name !== 'error') es.addEventListener(name, (ev) => f(JSON.parse(ev.data)));
      return () => es.close();
    },
    /** 项目里一个文件的地址(侧栏预览、视图脚本、脚本的模块);version 变了浏览器就重新取(整串模块跟着换) */
    fileUrl: (path, version) => `/preview/${pvToken}/${(project && project.id) || '_'}/${version ? `~v${version}/` : ''}` + encPath(path),
    /** 图片(<img> 带不了请求头,token 放在地址里) */
    rawUrl: (path, v) => withP('/api/raw?path=' + encodeURIComponent(path) + '&t=' + token) + (v ? '&v=' + v : ''),
  };
}
function staticTransport() {
  const ro = () => { throw new Error('这是静态导出,只读;请连接实时查看器来保存'); };
  return {
    kind: 'static',
    call: async () => ro(),
    listen(on) { on.message(window.__STARS_STATIC__); return () => {}; },
    fileUrl: () => ro(),
    rawUrl: () => '',
  };
}
const transport = window.__STARS_TRANSPORT__ || (window.__STARS_STATIC__ ? staticTransport() : httpTransport());
function api(path, body) { return transport.call(path, body); }
const ago = (t) => {
  if (!t) return '无记录';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return '刚刚'; if (s < 3600) return Math.floor(s / 60) + ' 分钟前'; if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 60) return Math.floor(s / 86400) + ' 天前'; if (s < 86400 * 365) return Math.floor(s / 2592000) + ' 个月前';
  return (s / 31536000).toFixed(1) + ' 年前';
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
