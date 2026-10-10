// ---------- 命令:界面上的每个操作都是一条命令 ----------
// 按钮(data-cmd)、快捷键(KEYMAP)、控制台(`)、命令面板(Ctrl K)走同一张表,写法和 CLI 一样:`名字 参数… -选项 值`;
// 写宇宙的命令(add / link / rm …)和 CLI 同名同参数。点按钮、按快捷键、点星图时,控制台里会灰显出等价的命令(回显),
// 边用边学,也能直接拿去绑键。run 的返回值:false = "此时不适用"(比如没选中东西时按 E,按键就不吞掉);字符串 = 输出。
// effect:这个命令对页面(页面桥)来说算什么 —— read 读 / ui 界面 / write 写;不写 = 页面不能用(个人设置、保存文件、开项目……)
const CMDS = new Map();
const defCmd = (name, spec) => CMDS.set(name, { name, group: '其它', ...spec });
const tokenize = cmdTokenize, quoteArg = cmdQuote;   // 切词与加引号:和 CLI、脚本共用一套(core/src/cmdline.ts)
/** 位置参数 + 选项(-t x / --type x / --proposed;-a k=v 可重复)。只有声明了 flags/bools 的命令才认选项,别的命令里 -0.5 之类原样当参数 */
function parseArgs(spec, toks) {
  const a = [], o = {};
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i], m = (spec.flags || spec.bools) && /^--?([A-Za-z][\w-]*)$/.exec(t);
    if (!m) { a.push(t); continue; }
    const k = t[1] === '-' ? m[1] : (spec.flags || {})[m[1]] || m[1];
    if ((spec.bools || []).includes(k)) { o[k] = true; continue; }
    if (!Object.values(spec.flags || {}).includes(k)) throw new Error(`不认识的选项 ${t}(用法:${spec.usage || spec.name})`);
    const v = toks[++i]; if (v === undefined) throw new Error(`选项 ${t} 需要一个值`);
    if ((spec.multi || []).includes(k)) (o[k] = o[k] || []).push(v); else o[k] = v;
  }
  return { a, o };
}
function onOff(v, cur) {
  if (v === undefined || v === 'toggle') return !cur;
  if (['on', '1', 'true', '开', 'show'].includes(v)) return true;
  if (['off', '0', 'false', '关', 'hide'].includes(v)) return false;
  throw new Error(`应为 on / off / toggle,得到 ${v}`);
}
const need = (a, n, spec) => { if (a.length < n) throw new Error('用法:' + (spec.usage || spec.name)); };
const nodeIds = (p) => { const r = []; for (const id of raw.keys()) if (id.startsWith(p) && !id.startsWith('~')) { r.push(id); if (r.length >= 60) break; } return r; };
const nodeArg = (name = 'id') => ({ name, values: nodeIds });
const projectFiles = (p, re) => { const r = []; for (const n of raw.values()) { const f = fileOf(n); if (f && re.test(f) && f.startsWith(p)) { r.push(f); if (r.length >= 60) break; } } return r; };

/** 执行一行命令。src:console / palette(你敲的)、key / ui / mouse(界面操作,回显)、remote(stars ui 遥控)、
 *  page(侧栏预览里的页面,经页面桥;from = page:<路径>,level = 它的连接级别,执行前按命令的 effect 检查)。
 *  report(可选):执行完回报 { ok, out, data, error } —— 遥控用它把输出交回给 CLI,页面桥交回给页面。
 *  run 的返回值可以是字符串(输出),也可以是 { out, data }(data 给程序用:页面、遥控) */
function exec(line, src = 'console', report = null, from = '', level = 'off') {
  line = String(line || '').trim();
  if (!line) { if (report) report({ ok: false, error: '空命令' }); return; }
  const toks = tokenize(line), spec = CMDS.get(toks[0]);
  const typed = src === 'console' || src === 'palette', page = src === 'page';
  let echoed = false;   // 页面的这条命令已经在控制台里显示了(被拒绝时要跟一行说明)
  if (typed) conLog(line, 'in');
  if (src === 'remote') { conLog(line + (from ? `   ← ${from}` : ''), 'remote'); if ($('console').hidden) toast(`遥控${from ? '(' + esc(from) + ')' : ''}:<code>${esc(line)}</code>`, false, 2500); }
  const fail = (e) => {
    const m = String((e && e.message) || e);
    if (report) report({ ok: false, error: m });
    if (page) { if (echoed) conLog('  ✗ ' + m, 'dim'); return; }   // 页面自己处理错误,不打扰你
    conLog(m, 'err');
    if (!typed && $('console').hidden) toast(esc(m), true);
  };
  if (!spec) { fail(`没有这个命令:${toks[0]}(help 看全部)`); return null; }
  if (page && !bridgeAllows(spec.effect, level)) {
    const need = { read: 'read', ui: 'ui', write: 'propose' }[spec.effect], who = from.startsWith('script:') ? '脚本' : '页面';
    fail(need ? `这个${who}的连接级别是「${LEVEL_NAMES[level]}」,${toks[0]} 至少要「${LEVEL_NAMES[need]}」(授权:connect ${need} ${quoteArg(from.replace(/^\w+:/, ''))})`
      : `${who}不能用 ${toks[0]}(个人设置、保存文件、开项目、跑脚本这类命令只给你自己用)`);
    return null;
  }
  if (page && spec.effect !== 'read') { conLog(line + `   ← ${from}`, 'remote'); echoed = true; }   // 页面做的界面操作和写入,控制台里都看得到
  let r;
  try { const { a, o } = parseArgs(spec, toks.slice(1)); r = spec.run(a, o, { src, from, level, author: page ? from : 'viewer' }); }
  catch (e) { fail(e); return null; }
  if (r === false) { if (typed || src === 'remote') conLog('(此时不适用)', 'dim'); if (report) report({ ok: false, error: '此时不适用' }); return false; }
  if (!typed && src !== 'remote' && !page) conLog(line, 'echo');
  const show = (v) => {
    const out = typeof v === 'string' ? v : v && typeof v.out === 'string' ? v.out : '';
    if (out && !page) { conLog(out); if ($('console').hidden && src !== 'remote') toggleConsole(true); }   // 有输出就把控制台拉出来(遥控的输出交回 CLI,页面的交回页面,不打扰)
    if (report) report({ ok: true, out, data: v && typeof v === 'object' && 'data' in v ? v.data : undefined });
  };
  if (r && typeof r.then === 'function') r.then(show, fail); else show(r);
  return r === undefined ? true : r;
}
/** 只回显、不执行:界面已经直接做了这件事(点星图选中、拖滑条……) */
function did(line) { conLog(line, 'echo'); }
document.addEventListener('click', (ev) => {
  const el = ev.target.closest && ev.target.closest('[data-cmd]');
  if (el && !ev.defaultPrevented) exec(el.dataset.cmd, 'ui');
});

// ---- 面板 ----
const PANEL_DEFS = {
  tools: { label: '工具栏', open: () => !$('tools').hidden, set: (on) => togglePanel('tools', on) },
  side: { label: '侧栏(详情 / 文件 / 日志)', open: () => !$('side').hidden, set: (on) => togglePanel('side', on) },
  rules: { label: '视图规则', open: () => !$('editor').hidden, set: (on) => toggleEditor(on) },
  timeline: { label: '时间线', open: () => !$('timeline').hidden, set: (on) => { toggleTimeline(on); layoutConsole(); } },
  review: { label: '审阅', open: () => !$('review').hidden, set: (on) => toggleReview(on) },
  projects: { label: '项目', open: () => !$('projects').hidden, set: (on) => toggleProjects(on) },
  settings: { label: '设置', open: () => !$('physics').hidden, set: (on) => togglePhysics(on) },
  types: { label: '类型筛选', open: () => !$('chips').hidden, set: (on) => { $('chips').hidden = !on; $('btn-types').classList.toggle('on', on); layoutPanels(); try { localStorage.setItem('stars.chips', on ? '1' : '0'); } catch { /* 隐私模式 */ } } },
  console: { label: '控制台', open: () => !$('console').hidden, set: (on) => toggleConsole(on) },
  keys: { label: '快捷键速查', open: () => !$('keys').hidden, set: (on) => toggleKeys(on) },
};
try { if (localStorage.getItem('stars.chips') === '1') PANEL_DEFS.types.set(true); } catch { /* 隐私模式 */ }
defCmd('panel', {
  group: '面板', effect: 'ui', title: '打开 / 关闭面板', usage: 'panel <名字> [on|off|toggle]',
  args: [{ name: '名字', values: () => Object.keys(PANEL_DEFS) }, { name: '开关', values: () => ['on', 'off', 'toggle'] }],
  palette: () => Object.entries(PANEL_DEFS).map(([k, d]) => ({ line: 'panel ' + k, title: '开 / 关 ' + d.label })),
  run: ([name, v]) => {
    if (!name) return Object.entries(PANEL_DEFS).map(([k, d]) => `${k.padEnd(9)} ${d.open() ? '开' : '关'}  ${d.label}`).join('\n');
    if (name === 'params') name = 'settings';   // 旧名字
    const d = PANEL_DEFS[name]; if (!d) throw new Error(`没有这个面板:${name}(可用:${Object.keys(PANEL_DEFS).join(' ')})`);
    d.set(onOff(v, d.open()));
  },
});

// ---- 视图与导航 ----
defCmd('view', {
  group: '视图', effect: 'ui', title: '切换视图(名字或序号)', usage: 'view <名字|序号>', args: [{ name: '视图', values: () => viewNames }],
  palette: () => viewNames.map((v) => ({ line: 'view ' + quoteArg(v), title: '切换到视图 ' + v })),
  run: ([v]) => {
    if (!v) return `当前:${currentView}\n可用:${viewNames.join('  ')}`;
    const name = /^\d+$/.test(v) ? viewNames[+v - 1] : v;
    if (!name || !viewNames.includes(name)) { if (/^\d+$/.test(v)) return false; throw new Error(`没有这个视图:${v}`); }
    setView(name);
  },
});
defCmd('filter', {
  group: '视图', effect: 'ui', title: '过滤节点(不带参数 = 把光标放进过滤框)', usage: 'filter [文字…]',
  run: (a) => { if (!a.length) { $('q').focus(); return; } $('q').value = a.join(' '); $('q').dispatchEvent(new Event('input')); },
});
defCmd('type', {
  group: '视图', effect: 'ui', title: '显示 / 隐藏某个类型的节点', usage: 'type <类型> [on|off|toggle]',
  args: [{ name: '类型', values: () => [...new Set(data.nodes.map((n) => typeOf(n.id)))] }, { name: '开关', values: () => ['on', 'off', 'toggle'] }],
  run: ([t, v], o, c) => { if (!t) throw new Error('用法:type <类型> [on|off|toggle]'); setTypeShown(t, onOff(v, !hiddenTypes.has(t))); },
});
defCmd('type-edit', {
  group: '视图', effect: 'ui', title: '打开「类型」面板,改某个类型的样子(颜色、形状、大小;边类型是颜色、线宽、箭头、画法)', usage: 'type-edit <类型> [edge]',
  args: [{ name: '类型', values: () => [...new Set([...data.nodes.map((n) => n.attrs.type).filter(Boolean), ...data.edges.map((e) => e.type)])] }, { name: '边', values: () => ['edge'] }],
  run: ([t, e]) => { if (!t) throw new Error('用法:type-edit <类型> [edge]'); openTypeEditor(t, e === 'edge' ? 'edgeType' : e === 'node' ? 'nodeType' : undefined); },
});
defCmd('tag', {
  group: '视图', effect: 'ui', title: '点亮 / 熄灭一个 tag(tags 视图);不带参数 = 全部清除', usage: 'tag [id]', args: [nodeArg('tag')],
  run: ([t]) => { toggleTag(t || ''); },
});
defCmd('region', {
  group: '视图', effect: 'ui', title: '点亮 / 熄灭一个保存的查询(动态区域):成员亮着,别的调暗;不带参数 = 熄灭', usage: 'region [查询名]',
  args: [{ name: '查询', values: () => (compiled ? compiled.queryResults().map((r) => r.name) : []) }],
  run: ([name]) => {
    if (name && !(compiled && compiled.queryResults().some((r) => r.name === name))) throw new Error(`没有保存的查询:${name}(queries 看全部)`);
    setRegion(name || null);
  },
});
defCmd('select', {
  group: '视图', effect: 'ui', title: '选中节点并让它出现在画面里(给几个 = 多选;不带参数 = 取消选中)。--add 追加 · --remove 移出 · --toggle 反选;'
    + '--all 画面里的全部 · --type 画面里某一类的全部 · --inside 容器里面的全部(递归,默认是选中的容器)',
  usage: 'select [id…] [--add|--remove|--toggle] [--all] [--type 类型] [--inside]', flags: { type: 'type', t: 'type' }, bools: ['add', 'remove', 'toggle', 'all', 'inside'], args: [nodeArg()],
  palette: () => [{ line: 'select --all', title: '全选画面里的节点' }, ...(selection.size ? [{ line: 'select --inside', title: '选中选中的容器里面的全部' }] : [])],
  run: (ids, o) => {
    for (const id of ids) if (!raw.has(id)) throw new Error(`节点不存在:${id}`);
    const mode = o.toggle ? 'toggle' : o.remove ? 'remove' : o.add ? 'add' : 'replace';
    if (mode === 'replace' && !o.all && !o.type && !o.inside && ids.length <= 1) { select(ids[0] || null, true); return; }
    let pool = ids;
    if (o.inside) { if (!compiled) return false; pool = descendantsOf(ids.length ? ids : [...selection]); }
    else if (o.all || o.type) pool = screenNodes().map((p) => p.id).filter((id) => !o.type || typeOf(id) === o.type);
    const next = combine(selection, pool, mode);
    setSelection(next, (mode === 'add' || mode === 'toggle') && pool.length === 1 && next.has(pool[0]) ? pool[0] : undefined);
    return { data: { selected: [...selection] } };   // 不出字:有输出会把控制台拉出来(数量在状态栏里);页面 / 遥控拿 data
  },
});
defCmd('screen', {
  group: '视图', effect: 'read', title: '画面里节点的位置(屏幕坐标,像素);给 id 只看这些。页面、脚本、测试用',
  usage: 'screen [id…]', args: [nodeArg()],
  run: (ids) => {
    const want = ids.length ? new Set(ids) : null, pos = {};
    for (const p of screenNodes()) if (!want || want.has(p.id)) pos[p.id] = [Math.round(p.sx), Math.round(p.sy)];
    return { out: Object.entries(pos).map(([id, [x, y]]) => `${String(x).padStart(5)} ${String(y).padStart(5)}  ${id}`).join('\n') || '(都不在画面里)', data: pos };
  },
});
defCmd('edge', {
  group: '视图', effect: 'ui', title: '选中一条边(侧栏里能改类型、反转、删除;也可以直接点星图上的边)', usage: 'edge <from> <type> <to>',
  args: [nodeArg('from'), { name: '类型', values: () => [...new Set(data.edges.map((e) => e.type))] }, nodeArg('to')],
  run: ([from, type, to]) => {
    if (!to) throw new Error('用法:edge <from> <type> <to>');
    if (!uni.edges.has(edgeKey(from, type, to))) throw new Error(`没有这条边:${from} -${type}-> ${to}`);
    select(null); selEdge = { from, type, to, lifted: false, count: 1 }; renderSide();
  },
});
defCmd('cancel', {
  group: '视图', effect: 'ui', title: '取消:关掉最上层的浮层,或清空过滤与选中',
  run: () => {
    const ae = document.activeElement;
    if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) { ae.blur(); return; }
    if (!$('lightbox').hidden) { $('lightbox').hidden = true; return; }
    if (!$('palette').hidden) { togglePalette(false); return; }
    if (!$('keys').hidden) { toggleKeys(false); return; }
    if (replay) { exitReplay(); return; }
    if (draftOn) { exitDraft(); return; }
    if (!$('projects').hidden) { toggleProjects(false); return; }
    if (!$('physics').hidden) { togglePhysics(false); return; }
    if (!selected && !$('q').value && fp && fp.pinned) { fp.pinned = false; syncFile(null); fpState(); return; }   // 什么都没选时再按一次 Esc:取消固定、收起
    $('q').value = ''; query = ''; qActive = null; computeMatches(); select(null); renderSide();
  },
});
defCmd('fit', { group: '镜头', effect: 'ui', title: '适应窗口', run: () => fit() });
defCmd('bg', {
  group: '显示', title: '背景:星系 / 星点 / 无', usage: 'bg [galaxy|dots|none|next]', args: [{ name: '背景', values: () => ['galaxy', 'dots', 'none', 'next'] }],
  palette: () => BG_MODES.map((m, i) => ({ line: 'bg ' + m, title: '背景:' + PHYS.bg.names[i] })),
  run: ([m]) => {
    const i = m === undefined || m === 'next' ? bgMode + 1 : BG_MODES.indexOf(m);
    if (i < 0) throw new Error('应为 galaxy / dots / none / next');
    setBg(i);
  },
});
defCmd('bounds', {
  group: '显示', title: '文件夹的边界与半透明底', usage: 'bounds [on|off|toggle]', args: [{ name: '开关', values: () => ['on', 'off', 'toggle'] }],
  palette: () => [{ line: 'bounds toggle', title: '开 / 关文件夹边界' }],
  run: ([v]) => setBounds(onOff(v, showBounds)),
});

// ---- 空间 ----
defCmd('expand', {
  group: '空间', effect: 'ui', title: '就地展开 / 收起(默认是选中的)', usage: 'expand [id]', args: [nodeArg()],
  run: ([id]) => { id = id || selected; if (!id) return false; if (isSpaces()) toggleExpandSpace(id); else toggleExpand(id); },
});
defCmd('collapse-all', {
  group: '空间', effect: 'ui', title: '全部收起',
  run: () => { if (isSpaces()) { expandedSet.clear(); spaceVer++; renderStatus(); } else { manual.clear(); auto.clear(); recompute(false); } savePlace(); },
});
defCmd('enter', {
  group: '空间', effect: 'ui', title: '进入选中的空间;选中的是文件就打开它(= open)', usage: 'enter [id]', args: [nodeArg()],
  run: ([id]) => {
    id = id || selected; if (!id) return false;
    if (isSpaces() && compiled.node(id)?.container) { if (!enterSpace(id, true)) jumpTo(id); return; }
    if (fileOf(raw.get(id))) return CMDS.get('open').run([id], {});
    return false;
  },
});
defCmd('exit', { group: '空间', effect: 'ui', title: '回到上一层空间', run: () => { if (!isSpaces()) return false; exitSpace(true); } });
defCmd('jump', {
  group: '空间', effect: 'ui', title: '跳到某个空间(不带参数 = 最外层)', usage: 'jump [id]', args: [nodeArg()],
  run: ([id]) => { if (id && !raw.has(id)) throw new Error(`节点不存在:${id}`); jumpTo(id || null); },
});

// ---- 文件 ----
defCmd('open', {
  group: '文件', effect: 'ui', title: '打开节点的文件:侧栏里按它的种类显示(--with 指定视图;--remember / --forget 记住或忘掉这类扩展名的打开方式;--full 全屏看图)',
  usage: 'open [id|文件路径] [--with text|markdown|form|image|universe|info] [--remember|--forget] [--full]',
  flags: { with: 'with', w: 'with' }, bools: ['remember', 'forget', 'full'], args: [nodeArg()],
  palette: () => [{ line: 'open ', title: '打开一个文件', more: true }, ...(fp && fp.info ? handlersFor(fpDesc()).map(({ h }) => ({ line: `open ${quoteArg(fp.id)} --with ${h.id}`, title: `用「${h.label}」看 ${fp.path}` })) : [])],
  run: ([id], o) => {
    id = id || selected; if (!id) return false;
    if (!raw.has(id)) { const n = [...raw.values()].find((x) => x.attrs.file === id); if (!n) throw new Error(`节点不存在:${id}`); id = n.id; }
    if (o.with && !FILE_HANDLERS.some((h) => h.id === o.with)) throw new Error(`没有这个视图:${o.with}(可用:${FILE_HANDLERS.map((h) => h.id).join(' ')})`);
    const path = fileOf(raw.get(id));
    if (!path) { if (id !== selected) select(id, true); return; }
    const ext = extOf(path);
    if (o.forget) { delete openWith[ext]; saveOpenWith(); }
    else if (o.remember) { const h = o.with || (fp && fp.id === id ? fp.handler : null); if (h) { openWith[ext] = h; saveOpenWith(); } }
    if (o.full) { if (fileTypeOf(path) !== 'image' || window.__STARS_STATIC__) return false; showLightbox(path); }
    const focus = !o.with && !o.remember && !o.forget && !o.full;   // 双击 / 回车打开:光标放进去;切视图、记住、看大图不抢焦点
    if (fp && fp.id === id) {
      if (o.with) fp.want = o.with;
      if (fp.info && (o.with || o.remember || o.forget)) renderFileBody();
      if (focus) focusPrimary();
      return;
    }
    fpNext = { id, want: o.with, focus };
    if (fp && fp.pinned) fp.pinned = false;   // 明确要打开别的文件:固定让位
    select(id, true);
  },
});
defCmd('preview', {
  group: '文件', effect: 'ui', title: '侧栏预览的开关:html(Markdown 渲染 HTML)、scripts(HTML 运行脚本)、live(HTML 实时)、split(并排编辑);reload 重新加载',
  usage: 'preview <html|scripts|live|split> [on|off|toggle] · preview reload',
  args: [{ name: '开关', values: () => ['html', 'scripts', 'live', 'split', 'reload'] }, { name: '值', values: () => ['on', 'off', 'toggle'] }],
  palette: () => (fp && fp.info && ['markdown', 'html'].includes(fp.handler) ? [
    ...(fp.handler === 'markdown' ? [{ line: 'preview html toggle', title: 'Markdown:开 / 关渲染 HTML' }] : [{ line: 'preview scripts toggle', title: 'HTML 预览:开 / 关脚本' }, { line: 'preview live toggle', title: 'HTML 预览:开 / 关实时' }, { line: 'preview reload', title: 'HTML 预览:重新加载' }]),
    { line: 'preview split toggle', title: '开 / 关并排编辑' }] : []),
  run: ([k, v]) => {
    if (!fp || !fp.info || !['markdown', 'html'].includes(fp.handler)) return false;
    if (k === 'reload') { if (fp.renderView) fp.renderView(); return; }
    if (!['html', 'scripts', 'live', 'split'].includes(k)) throw new Error('用法:preview <html|scripts|live|split> [on|off|toggle] · preview reload');
    fp.opts[k] = onOff(v, !!fp.opts[k]);
    if (k === 'split') renderFileBody(); else if (fp.renderView) fp.renderView();
  },
});
defCmd('connect', {
  group: '文件', title: '页面连接:侧栏 HTML 预览(或给路径:某个页面 / 脚本)里的 window.stars 能调哪些命令(按路径记在 ~/.config/stars/grants.llf;default = 用设置里的默认);不带参数列出',
  usage: 'connect [off|read|ui|propose|write|default] [页面或脚本的路径]', args: [{ name: '级别', values: () => [...BRIDGE_LEVELS, 'default'] }, { name: '路径', values: (p) => projectFiles(p, /\.(html?|m?js)$/i) }],
  palette: () => (fp && fp.info && fp.handler === 'html' ? [...BRIDGE_LEVELS, 'default'].map((l) => ({ line: 'connect ' + l, title: `这个页面的连接:${LEVEL_NAMES[l] || '用默认'}` })) : []),
  run: ([lv, path]) => {
    if (!lv) {
      const rows = [];
      try {
        const pages = llfFind(llfParseDoc(userCfg.grants.text, CFG_OPTS), ['pages']);
        for (const d of pages && pages.kind === 'map' ? pages.entries : []) for (const e of d.kind === 'map' ? d.entries : []) rows.push(`  ${String(e.value ?? '').padEnd(8)} ${d.key}/${e.key}`);
      } catch { /* 坏文件 */ }
      const cur = fp && fp.info && fp.handler === 'html' ? `这个页面(${fp.path}):${LEVEL_NAMES[levelOf(fp.path)]}${grantOf(fp.path) ? '' : '(默认)'}${fp.opts.scripts ? '' : ';不过脚本没开,现在连不上'}\n` : '';
      return cur + `默认:${LEVEL_NAMES[P.pageBridge] || P.pageBridge}(设置 → 文件预览 → 页面连接)\n` + (rows.length ? '单独授权过的页面:\n' + rows.join('\n') : '(还没有单独授权过的页面)');
    }
    if (lv !== 'default' && !bridgeIsLevel(lv)) throw new Error('应为 off / read / ui / propose / write / default');
    path = path ? path.replace(/^\.\//, '') : fp && fp.info && fp.handler === 'html' ? fp.path : null;   // 不给路径 = 侧栏里的 HTML 页面
    if (!path) return false;
    setGrant(path, lv === 'default' ? null : lv);
  },
});
defCmd('run', {
  group: '脚本', title: '在查看器里跑一个 JS 脚本(隐藏的沙箱里,用页面桥调命令;级别同页面:connect <级别> <路径>);不带参数列出正在跑的',
  usage: 'run [脚本.js] [参数…]', args: [{ name: '脚本', values: (p) => projectFiles(p, /\.m?js$/i) }],
  run: ([path, ...args]) => {
    if (!path) return [...scripts.values()].map((s) => `${s.path.padEnd(24)} ${s.state}  ${LEVEL_NAMES[s.b.level]}  ${ago(s.started)}`).join('\n') || '(没有正在跑的脚本)';
    if (raw.has(path) && fileOf(raw.get(path))) path = fileOf(raw.get(path));
    return runScript(path.replace(/^\.\//, ''), args);
  },
});
defCmd('stop', {
  group: '脚本', title: '停掉正在跑(或还在监听)的脚本;不带参数 = 全部', usage: 'stop [脚本路径]', args: [{ name: '脚本', values: () => [...scripts.keys()] }],
  run: ([path]) => {
    const list = path ? [scripts.get(path.replace(/^\.\//, ''))].filter(Boolean) : [...scripts.values()];
    if (!list.length) return path ? false : '(没有正在跑的脚本)';
    for (const s of list) { if (!s.finished) { s.finished = true; s.resolve({ out: `■ ${s.path} 被停止` }); } stopScript(s, null); }
    return `已停止 ${list.map((s) => s.path).join('、')}`;
  },
});
defCmd('edit', {
  group: '文件', effect: 'ui', title: '在原文里编辑侧栏的文件(当前是别的视图就切到原文)',
  run: () => {
    if (!fp || !fp.info || fp.info.kind !== 'text') return false;
    if (fp.handler !== 'text') { fp.want = 'text'; renderFileBody(); }
    focusEditor();
  },
});
defCmd('dbl', {
  group: '设置', title: '双击某类节点时执行的命令($id / $path / $dir 换成那个节点的);dbl reset [类型] 恢复默认;不带参数列出全部',
  usage: 'dbl [类型] [命令…] · dbl reset [类型]',
  args: [{ name: '类型', values: () => ['reset', ...Object.keys(DBL_TYPES)] }, { name: '命令', values: () => [...CMDS.keys()] }],
  run: ([t, ...cmd]) => {
    if (!t) return Object.keys(DBL_TYPES).map((k) => `${k.padEnd(10)} ${DBL.get(k) ?? '(按 file)'}${DBL.get(k) !== DEF_DBL.get(k) ? '   (改过)' : ''}`).join('\n');
    if (t === 'reset') { for (const k of cmd.length ? cmd : Object.keys(DBL_TYPES)) setDbl(k, undefined); return; }
    if (!(t in DBL_TYPES)) throw new Error(`没有这个种类:${t}(可用:${Object.keys(DBL_TYPES).join(' ')})`);
    if (!cmd.length) return `${t} → ${DBL.get(t) ?? '(按 file)'}${DEF_DBL.has(t) ? `   默认:${DEF_DBL.get(t)}` : ''}`;
    const line = cmd.length === 1 ? cmd[0] : cmd.map(quoteArg).join(' ');
    if (!CMDS.has(tokenize(line)[0])) throw new Error(`没有这个命令:${tokenize(line)[0]}`);
    setDbl(t, line);
  },
});
defCmd('pin', {
  group: '文件', effect: 'read', title: '固定侧栏里的文件:单击选中别的节点时不换(双击 / open 照样打开别的文件;什么都没选时按 Esc 取消固定)。页面也能固定自己',
  usage: 'pin [on|off|toggle]', args: [{ name: '开关', values: () => ['on', 'off', 'toggle'] }],
  run: ([v]) => {
    if (!fp) return false;
    fp.pinned = onOff(v, !!fp.pinned);
    fpState();
    if (!fp.pinned) { const n = selected && raw.get(selected); if (!n || n.id !== fp.id) syncFile(n || null); }   // 取消固定:侧栏回到跟着选中走
  },
});
defCmd('save', { group: '文件', title: '保存侧栏里的文件(Ctrl+S)', run: () => { if (!fp || !fp.full) return false; return saveFile(false); } });

// ---- 设置(写回 ~/.config/stars/settings.llf)与快捷键(keys.llf)----
const fmtParam = (k) => (PHYS[k].toggle ? (P[k] ? 'on' : 'off') : String(P[k]));
function resetParams(k) {
  if (k && !PHYS[k]) throw new Error(`没有这个设置:${k}`);
  let doc = null; try { doc = llfParseDoc(userCfg.settings.text, CFG_OPTS); } catch { /* 坏文件:只按当前值判断 */ }
  // 文件里写了(哪怕写的是不合法的值、或正好等于默认值)也删掉,恢复默认 = 个人文件里不再有这一项
  for (const key of k ? [k] : Object.keys(PHYS)) if (P[key] !== PHYS[key].def || (doc && llfFind(doc, SET.items[key].path))) setParam(key, PHYS[key].def);
}
defCmd('param', {
  group: '设置', title: '查看 / 设置一项设置(写回个人设置文件);param reset [名字] 恢复默认', usage: 'param [名字] [值|on|off|toggle] · param reset [名字]',
  args: [{ name: '名字', values: () => ['reset', ...Object.keys(PHYS)] },
    { name: '值', values: (p, a) => (a[0] === 'reset' ? Object.keys(PHYS) : PHYS[a[0]]?.choices || (PHYS[a[0]]?.toggle ? ['on', 'off', 'toggle'] : [])) }],
  palette: () => [{ line: 'param reset', title: '设置全部恢复默认' }, ...Object.entries(PHYS).map(([k, d]) => (d.toggle
    ? { line: `param ${k} toggle`, title: '开 / 关 ' + d.label }
    : d.choices ? { line: `param ${k} `, title: `${d.label}:${d.choices.join(' / ')}(现在 ${P[k]})`, more: true }
    : { line: `param ${k} `, title: `设置 ${d.label}(现在 ${fmtParam(k)})`, more: true }))],
  run: ([k, v]) => {
    if (!k) return Object.entries(PHYS).map(([key, d]) => `${key.padEnd(10)} ${fmtParam(key).padEnd(7)} ${d.label}${P[key] !== d.def ? '   (改过)' : ''}`).join('\n');
    if (k === 'reset') { resetParams(v); return; }
    const d = PHYS[k]; if (!d) throw new Error(`没有这个设置:${k}(param 列出全部)`);
    if (v === undefined) return `${k} = ${fmtParam(k)}   ${d.label}:${d.hint}${P[k] !== d.def ? `\n  (默认 ${formatSetting(SET.items[k].w, d.def)})` : ''}`;
    let x;
    if (d.toggle) x = onOff(v, P[k] > 0) ? 1 : 0;
    else { x = parseSetting(SET.items[k].w, v); if (x === undefined) throw new Error(d.choices ? `应为 ${d.choices.join(' / ')}` : `${v} 不是合法的值`); }
    setParam(k, x);
  },
});
defCmd('bind', {
  group: '设置', title: '把一个键绑到一条命令(写回个人快捷键文件);bind reset [键] 恢复默认;不带参数列出全部', usage: 'bind <键> <命令…> · bind reset [键] · bind',
  args: [{ name: '键', values: () => ['reset', ...keyMap.keys()] }, { name: '命令', values: () => [...CMDS.keys()] }],
  palette: () => [{ line: 'bind ', title: '绑定快捷键', more: true }, { line: 'bind reset', title: '快捷键全部恢复默认' }],
  run: ([k, ...cmd]) => {
    if (!k) return KEYMAP.map(([key, line]) => `${keyLabel(key).padEnd(8)} ${line}${DEF_KEY.get(key) !== line ? '   (改过)' : ''}`).join('\n');
    if (k === 'reset') {
      const keys = cmd.length ? cmd.map(normKey) : [...bindingsOf(userCfg.keys.text).keys()];
      for (const key of keys) setBinding(key, undefined);
      return;
    }
    if (!cmd.length) { const key = normKey(k); return `${keyLabel(key)} → ${keyMap.get(key) ?? '(没有绑定)'}${DEF_KEY.has(key) ? `   默认:${DEF_KEY.get(key)}` : ''}`; }
    const line = cmd.length === 1 ? cmd[0] : cmd.map(quoteArg).join(' ');   // bind g "view tags" 与 bind g view tags 一样
    if (!CMDS.has(tokenize(line)[0])) throw new Error(`没有这个命令:${tokenize(line)[0]}`);
    setBinding(k, line);
  },
});
defCmd('unbind', {
  group: '设置', title: '取消一个键(默认的键记成 _,自己加的直接删掉)', usage: 'unbind <键>', args: [{ name: '键', values: () => [...keyMap.keys()] }],
  run: ([k]) => { if (!k) throw new Error('用法:unbind <键>'); setBinding(k, null); },
});

// ---- 时间线 ----
const TL_ACTS = { prev: '上一个提交', next: '下一个提交', first: '最早的提交', now: '回到现在', play: '播放 / 暂停', scope: '宇宙文件的历史 ↔ 文件夹的历史', more: '再往前载入一批' };
defCmd('timeline', {
  group: '时间线', effect: 'ui', title: '时间线操作(先 panel timeline 打开)', usage: 'timeline <' + Object.keys(TL_ACTS).join('|') + '>', args: [{ name: '动作', values: () => Object.keys(TL_ACTS) }],
  palette: () => Object.entries(TL_ACTS).map(([k, t]) => ({ line: 'timeline ' + k, title: '时间线:' + t })),
  run: ([act]) => {
    if (act === 'now') { if (!replay) return false; exitReplay(); return; }
    if (!(act in TL_ACTS)) throw new Error('用法:timeline <' + Object.keys(TL_ACTS).join('|') + '>');
    if ($('timeline').hidden) return false;
    if (act === 'prev' || act === 'next') return stepCommit(act === 'prev' ? -1 : 1);
    return { first: tlFirst, play: tlPlay, scope: tlScope, more: tlMore }[act]();
  },
});

// ---- 项目 ----
defCmd('project', {
  group: '项目', title: '列出已打开的项目;带目录 = 打开那个文件夹(--create 没有宇宙就新建);--close [目录] 关掉一个打开着的项目(默认当前的)', usage: 'project [目录] [--create] · project --close [目录]', bools: ['create', 'close'],
  run: ([dir], o) => {
    if (window.__STARS_STATIC__) throw new Error('静态导出不能切换项目');
    if (o.close) return api('/api/projects').then((r) => {
      openList = r.open;
      const want = dir ? dir.replace(/[\\/]+$/, '') : null;
      const p = want ? r.open.find((x) => x.dir === want || x.name === want || x.id === want) : r.open.find((x) => project && x.id === project.id);
      if (!p) throw new Error(`没有打开着的项目:${dir}`);
      return closeProject(p.id);
    });
    if (!dir) return api('/api/projects').then((r) => r.open.map((p) => `${project && p.id === project.id ? '*' : ' '} ${p.name}  ${p.dir}`)
      .concat(r.recent.length ? ['最近:', ...r.recent.map((d) => `  ${d.dir}${d.hasUniverse ? '' : '   (还没有宇宙,加 --create 新建)'}`)] : []).join('\n'));
    return openDir(dir, !!o.create);
  },
});

// ---- 审阅 ----
defCmd('review', {
  group: '审阅', effect: 'write', title: '全部接受 / 全部拒绝待审阅的提议', usage: 'review <accept-all|reject-all>', args: [{ name: '动作', values: () => ['accept-all', 'reject-all'] }],
  palette: () => [{ line: 'review accept-all', title: '接受全部提议' }, { line: 'review reject-all', title: '拒绝全部提议' }],
  run: ([act], o, c) => {
    noProposing(c, '批量确认 / 拒绝提议');
    const l = proposed();
    if (act === 'accept-all') { if (!l.length) return '没有待审阅的提议'; return write(batchOps(l, acceptOp), `已接受全部 ${l.length} 条`, c.author); }
    if (act === 'reject-all') { if (!l.length) return '没有待审阅的提议'; if (c.src !== 'page' && !confirm(`拒绝并删除全部 ${l.length} 条提议?(之后可以撤销)`)) return; return write(batchOps(l, rejectOp), `已拒绝全部 ${l.length} 条`, c.author); }
    throw new Error('用法:review <accept-all|reject-all>');
  },
});
