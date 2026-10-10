// ---- Markdown 预览:零依赖的小渲染器;项目里的相对链接点了就在星图里打开那个文件 ----
// 「渲染 HTML」关着:原始 HTML 原样显示成文字;开着:照样渲染,但先清理(只留排版用的标签和属性,去掉脚本、iframe、表单、
// 事件属性、javascript: 链接;id 加前缀,免得和查看器自己的元素撞名)。
function mountMarkdown(body) {
  fp.onEditRender = true;
  mountPreview(body, (pane) => {
    const sc = pane.querySelector('#fp-md') ? pane.querySelector('#fp-md').scrollTop : 0;
    const html = fp.opts.html, out = renderMarkdown(fp.text, fp.path, html);
    pane.innerHTML = previewBar([[`preview html toggle`, '渲染 HTML', html, '把 Markdown 里的原始 HTML 也渲染出来(先清理掉脚本等);新预览的默认在设置 → 文件预览'],
      [`preview split toggle`, '并排编辑', fp.opts.split, '上面编辑原文,下面实时看预览']])
      + `<div id="fp-md" class="md">${html ? sanitizeHtml(out, fp.path) : out}${fp.full ? '' : '<p class="md-more">…(只载入了开头,滚到底载入全部)</p>'}</div>`;
    const md = pane.querySelector('#fp-md');
    md.scrollTop = sc;
    md.addEventListener('scroll', () => { if (!fp.full && md.scrollTop + md.clientHeight > md.scrollHeight - 80) loadFull(); });
  });
}
function mdResolve(base, rel) {   // 相对 base 文件所在目录解析成项目里的路径
  const parts = (rel.startsWith('/') ? [] : base.split('/').slice(0, -1));
  for (const seg of rel.replace(/^\//, '').split('/')) { if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg); }
  return parts.join('/');
}
const mdSlug = (t) => t.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
function mdHref(href, base, img) {
  const u = href.replace(/&amp;/g, '&').trim();
  if (/^(javascript|data|vbscript|file):/i.test(u)) return null;
  if (/^(https?:|mailto:)/i.test(u) || u.startsWith('//')) return { ext: u };
  if (u.startsWith('#')) return { anchor: mdSlug(decodeURIComponent(u.slice(1))) };
  let path;
  try { path = mdResolve(base, decodeURIComponent(u.split(/[?#]/)[0])); } catch { return null; }
  return img ? { ext: rawUrl(path) } : { open: path };
}
/** 引用式链接的定义([标签]: 地址),整篇文档共用;renderMarkdown 进来时收集 */
let mdRefs = new Map();
const mdRefKey = (l) => l.replace(/&(amp|lt|gt|quot);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"' }[e])).trim().replace(/\s+/g, ' ').toLowerCase();
function mdImg(alt, src, base) { const h = mdHref(src, base, true); return h && h.ext ? `<img alt="${alt}" src="${esc(h.ext)}">` : null; }
function mdLink(t, href, base) {
  const h = mdHref(href, base, false);
  if (!h) return t;
  if (h.ext) return `<a href="${esc(h.ext)}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  if (h.anchor !== undefined) return `<a data-anchor="${esc(h.anchor)}">${t}</a>`;
  return `<a data-open="${esc(h.open)}" title="${esc(h.open)}">${t}</a>`;
}
function mdInline(s, base) {   // s 已转义(或只含占位符和转义过的文字)
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (all, alt, src) => mdImg(alt, src, base) ?? all);
  // 引用式:![替代文字][标签]、[文字][标签]、[文字][](标签 = 文字)、[文字](只在有这个定义时)—— README 的徽章多是这么写的
  s = s.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (all, alt, ref) => { const u = mdRefs.get(mdRefKey(ref || alt)); return (u && mdImg(alt, u, base)) ?? all; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (all, t, href) => mdLink(t, href, base));
  s = s.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (all, t, ref) => { const u = mdRefs.get(mdRefKey(ref || t)); return u ? mdLink(t, u, base) : all; });
  s = s.replace(/\[([^\]]+)\](?![(\[:])/g, (all, t) => { const u = mdRefs.size && !/^[ xX]$/.test(t) ? mdRefs.get(mdRefKey(t)) : null; return u ? mdLink(t, u, base) : all; });
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  s = s.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}
/** 一段行内原文 → HTML。html 开着时原始标签原样保留(之后统一清理),只转义标签之外的文字;代码里的标签永远是文字 */
const MD_TAG = /(<\/?[A-Za-z][\w-]*(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?>|<!--[\s\S]*?-->)/;
function mdText(raw, base, html) {
  if (!html) return mdInline(esc(raw), base);
  const keep = [], hold = (x) => { keep.push(x); return `\u0001${keep.length - 1}\u0001`; };
  let s = raw.replace(/`([^`]+)`/g, (_, c) => hold(`<code>${esc(c)}</code>`));
  s = s.split(MD_TAG).map((part, i) => (i % 2 ? hold(part) : esc(part))).join('');
  return mdInline(s, base).replace(/\u0001(\d+)\u0001/g, (_, i) => keep[+i]);
}
const MD_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const MD_HTML_BLOCK = /^\s{0,3}(<\/?[A-Za-z][\w-]*(\s|\/?>|$)|<!--)/;
/** 整篇:先收走引用式链接的定义行(代码块里的不算),再逐块渲染 */
function renderMarkdown(src, base, html) {
  const refs = new Map(), keep = [];
  let fence = null;
  for (const l of src.replace(/\r\n?/g, '\n').split('\n')) {
    const f = /^\s*(```+|~~~+)/.exec(l);
    if (f && (!fence || f[1].startsWith(fence))) fence = fence ? null : f[1];
    const m = !fence && !f && /^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/.exec(l);
    if (m) { const k = mdRefKey(esc(m[1])); if (!refs.has(k)) refs.set(k, m[2]); } else keep.push(l);
  }
  mdRefs = refs;
  return mdBlocks(keep.join('\n'), base, html);
}
function mdBlocks(src, base, html) {
  const lines = src.split('\n'), para = [];
  let out = '', i = 0;
  const flush = () => { if (para.length) { out += `<p>${mdText(para.join('\n'), base, html).replace(/ {2,}\n/g, '<br>').replace(/\n/g, ' ')}</p>`; para.length = 0; } };
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if ((m = /^\s*(```+|~~~+)\s*([\w+#.-]*)/.exec(l))) {
      flush(); const fence = m[1], buf = []; i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fence)) buf.push(lines[i++]);
      i++; out += `<pre><code${m[2] ? ` class="lang-${esc(m[2])}"` : ''}>${esc(buf.join('\n'))}</code></pre>`; continue;
    }
    if (html && !para.length && MD_HTML_BLOCK.test(l)) {   // HTML 块:到空行为止原样保留(之后统一清理)
      const buf = [];
      while (i < lines.length && lines[i].trim()) buf.push(lines[i++]);
      out += buf.join('\n') + '\n'; continue;
    }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l))) { flush(); out += `<h${m[1].length} id="md-${esc(mdSlug(m[2]))}">${mdText(m[2], base, html)}</h${m[1].length}>`; i++; continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out += '<hr>'; i++; continue; }
    if (/^\s*>/.test(l)) {
      flush(); const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out += `<blockquote>${mdBlocks(buf.join('\n'), base, html)}</blockquote>`; continue;
    }
    if (/\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush();
      const head = cells(l), al = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      i += 2; const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
      const td = (tag, c, k) => `<${tag}${al[k] ? ` style="text-align:${al[k]}"` : ''}>${mdText(c, base, html)}</${tag}>`;
      out += `<table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => td('td', c, k)).join('')}</tr>`).join('')}</tbody></table>`;
      continue;
    }
    if (MD_ITEM.test(l)) {   // 列表:连续的项、比项缩进更深的续行、夹在中间的空行;同一层换了列表种类(- → 1.)另起一个
      flush(); const start = i, base0 = MD_ITEM.exec(l)[1].length, ord = /\d/.test(MD_ITEM.exec(l)[2]);
      i++;
      while (i < lines.length) {
        const x = lines[i], ind = /^\s*/.exec(x)[0].length, mi = MD_ITEM.exec(x);
        if (mi && ind <= base0 + 1 && /\d/.test(mi[2]) !== ord) break;
        if (mi && ind >= base0) { i++; continue; }
        if (x.trim() && ind > base0) { i++; continue; }
        if (!x.trim() && i + 1 < lines.length && (MD_ITEM.test(lines[i + 1]) || /^\s*/.exec(lines[i + 1])[0].length > base0) && /^\s*/.exec(lines[i + 1])[0].length >= base0 && lines[i + 1].trim()) { i++; continue; }
        break;
      }
      out += mdList(lines.slice(start, i), base0, base, html); continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l.trim()); i++;
  }
  flush();
  return out;
}
function mdList(lines, base0, base, html) {
  const items = [];
  for (const l of lines) {
    const m = MD_ITEM.exec(l);
    if (m && m[1].length <= base0 + 1) items.push({ head: m[3], rest: [], ordered: /\d/.test(m[2]) });
    else if (items.length) items[items.length - 1].rest.push(l.slice(Math.min(/^\s*/.exec(l)[0].length, base0 + 2)));
  }
  const tag = items[0] && items[0].ordered ? 'ol' : 'ul';
  return `<${tag}>` + items.map((it) => {
    const task = /^\[([ xX])\]\s+/.exec(it.head);
    const head = (task ? `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> ` : '') + mdText(task ? it.head.slice(task[0].length) : it.head, base, html);
    return `<li>${head}${it.rest.join('\n').trim() ? mdBlocks(it.rest.join('\n'), base, html) : ''}</li>`;
  }).join('') + `</${tag}>`;
}
// 清理:白名单里的标签和属性才留下;整段丢掉脚本、样式表、iframe、表单等;链接和图片按项目路径改写
const SAFE_TAGS = new Set(('a abbr b bdi bdo blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure font '
  + 'h1 h2 h3 h4 h5 h6 hr i img input ins kbd li mark ol p picture pre q rp rt ruby s samp small source span strike strong sub summary sup '
  + 'table tbody td tfoot th thead time tr tt u ul var wbr audio video').split(' '));
const DROP_TAGS = new Set('script style iframe frame frameset object embed applet link meta base noscript template form textarea select button svg math'.split(' '));
const SAFE_ATTRS = new Set('href src alt title width height align valign colspan rowspan open id name start reversed type checked disabled class lang dir datetime cite color face size style controls loop muted poster data-open data-anchor'.split(' '));
function sanitizeHtml(html, base) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;   // template 里的内容是惰性的:脚本不跑、图片不加载
  const walk = (parent) => {
    for (const el of [...parent.children]) {
      const tag = el.tagName.toLowerCase();
      if (DROP_TAGS.has(tag)) { el.remove(); continue; }
      walk(el);
      if (!SAFE_TAGS.has(tag)) { el.replaceWith(...el.childNodes); continue; }   // 不认识的标签:去壳留内容
      for (const a of [...el.attributes]) if (!SAFE_ATTRS.has(a.name.toLowerCase())) el.removeAttribute(a.name);
      if (tag === 'input') { if (el.getAttribute('type') !== 'checkbox') { el.remove(); continue; } el.setAttribute('disabled', ''); }
      if (el.hasAttribute('style')) el.setAttribute('style', el.getAttribute('style').replace(/position\s*:\s*(fixed|sticky)/gi, '').replace(/url\s*\(/gi, ''));
      if (el.id && !el.id.startsWith('md-')) el.id = 'md-' + el.id;
      if (el.hasAttribute('href')) {
        const h = mdHref(el.getAttribute('href'), base, false);
        el.removeAttribute('href');
        if (h && h.ext) { el.setAttribute('href', h.ext); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
        else if (h && h.anchor !== undefined) el.dataset.anchor = h.anchor;
        else if (h && h.open) { el.dataset.open = h.open; el.title = el.title || h.open; }
      }
      if (el.hasAttribute('src')) { const h = mdHref(el.getAttribute('src'), base, true); if (h && h.ext) el.setAttribute('src', h.ext); else el.removeAttribute('src'); }
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}
$('fp-body').addEventListener('click', (ev) => {   // 预览里的链接:项目里的文件 → 在星图里打开;#锚点 → 滚过去
  const a = ev.target.closest('#fp-md a[data-open], #fp-md a[data-anchor]'); if (!a) return;
  ev.preventDefault();
  if (a.dataset.anchor !== undefined) { const h = $('fp-md').querySelector(`[id="md-${CSS.escape(a.dataset.anchor)}"]`); if (h) h.scrollIntoView({ behavior: 'smooth' }); return; }
  exec('open ' + quoteArg(a.dataset.open), 'ui');
});

// ---- HTML 预览:沙箱 iframe(不同源,碰不到查看器和 token)。脚本:每个预览可开关;实时:跟着编辑器里没保存的改动走,
// 关掉则显示保存了的版本。项目里其它文件变了(serve --watch 的实时信号)也刷新 —— 像 VS Code 的 Live Preview。
// 相对路径的 css / js / 图片从 /preview/<token>/<项目>/… 取,所以页面引用的资源都能加载。
const previewUrl = (path) => `/preview/${pvToken}/${(project && project.id) || '_'}/` + path.split('/').map(encodeURIComponent).join('/');
function mountHtml(body) {
  fp.onEditRender = !!fp.opts.live;
  mountPreview(body, (pane) => {
    const o = fp.opts, level = o.scripts ? levelOf(fp.path) : 'off';
    fp.onEditRender = !!o.live;
    if (!pane.querySelector('iframe')) pane.innerHTML = '<div class="pv-bar"></div><iframe id="fp-html" referrerpolicy="no-referrer" title="HTML 预览"></iframe>';
    htmlBar(pane);
    const old = pane.querySelector('iframe'), f = document.createElement('iframe');   // 换一个新的 iframe = 干净地重新加载
    f.id = 'fp-html'; f.title = 'HTML 预览'; f.referrerPolicy = 'no-referrer';
    f.setAttribute('sandbox', o.scripts ? 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox' : '');
    const nonce = level === 'off' ? null : bridgeNonce();   // 页面桥:每次载入换一个暗号,旧页面发来的消息不再认
    if (o.live) {
      const dir = fp.path.includes('/') ? fp.path.replace(/[^/]*$/, '') : '';
      f.srcdoc = bridgeInject(fp.text, `<base href="${esc(location.origin + previewUrl(dir))}">` + (nonce ? bridgeShim(nonce) : ''));
    } else f.src = previewUrl(fp.path) + '?v=' + Math.round(fp.info.mtime) + (nonce ? '&bridge=' + nonce : '');
    old.replaceWith(f);
    setPageBridge(nonce ? { nonce, frame: f, path: fp.path, level, subs: new Set(), kind: 'page', author: 'page:' + fp.path } : null);
    // 第二次 load = 页面里点了链接、换成了别的文档:断开(事件不再发过去;要连就 ↻ 重新加载,或在星图里打开那个文件)
    let loads = 0;
    if (nonce) f.addEventListener('load', () => { if (++loads > 1 && bridge && bridge.frame === f) setPageBridge(null); });
  });
}
/** HTML 预览的工具条:脚本 / 实时 / 并排 / 重新加载;开了脚本时还有「连接」(页面桥的级别);最右是新标签页 */
function htmlBar(pane) {
  const o = fp.opts, lv = levelOf(fp.path), own = grantOf(fp.path) !== null;
  const conn = o.scripts ? `<span class="pv-conn" title="这个页面能通过 window.stars 调哪些命令:读(查询、快照、订阅变化)/ 界面(再加选中、镜头、视图)/ 提议(再加写,但新增的都要你在审阅里确认)/ 写。按页面记在 ~/.config/stars/grants.llf(单独选过、不是「关」的页面,打开时自动运行脚本)${own ? '' : ';现在用的是设置里的默认'}">连接 <span class="seg">`
    + BRIDGE_LEVELS.map((l) => `<span class="${l === lv ? 'on' : ''}" data-cmd="connect ${l}">${LEVEL_NAMES[l]}</span>`).join('') + `</span>${own ? '' : '<span class="tag">默认</span>'}</span>` : '';
  pane.querySelector('.pv-bar').outerHTML = previewBar([
    ['preview scripts toggle', '脚本', o.scripts, '允许这个预览运行 JavaScript(在沙箱里);新预览的默认在设置 → 文件预览'],
    ['preview live toggle', '实时', o.live, '跟着编辑器里还没保存的改动走;关掉则只显示保存了的版本(保存后刷新)'],
    ['preview split toggle', '并排编辑', o.split, '上面编辑原文,下面看预览'],
    ['preview reload', '↻ 重新加载'],
  ]).slice(0, -'</div>'.length) + conn
    + `<a class="pv-opt act pv-out" href="${esc(previewUrl(fp.path))}" target="_blank" rel="noopener" title="在新标签页里打开(同样在沙箱里;那里没有页面桥)">新标签页 ↗</a></div>`;
}
