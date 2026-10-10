// ---------- 快捷键速查(?):由键位表生成,所以永远和实际一致 ----------
function toggleKeys(on) {
  $('keys').hidden = !on; if (!on) return;
  const groups = new Map();
  for (const [k, line] of KEYMAP) {
    const c = CMDS.get(line.split(' ')[0]); const g = c ? c.group : '其它';
    if (!groups.has(g)) groups.set(g, new Map());
    const byLine = groups.get(g); if (!byLine.has(line)) byLine.set(line, { c, keys: [] }); byLine.get(line).keys.push(k);
  }
  const desc = (line, c) => {
    const [name, arg] = tokenize(line);
    if (name === 'panel') return '开 / 关 ' + (PANEL_DEFS[arg]?.label || arg);
    if (name === 'view') return '切换到第 ' + arg + ' 个视图';
    if (name === 'timeline') return '时间线:' + (TL_ACTS[arg] || arg);
    if (name === 'bg') return '切换背景';
    return c ? c.title : line;
  };
  let html = '<div id="ed-head" style="margin-bottom:8px"><b>快捷键</b><span>键位 → 命令;按 <kbd>`</kbd> 打开控制台可以直接敲命令,<kbd>Ctrl</kbd> <kbd>K</kbd> 搜索全部命令</span></div><div class="cols">';
  for (const [g, byLine] of groups) {
    const rows = [...byLine];
    // 1–9 视图合成一行
    const views = rows.filter(([l]) => /^view \d$/.test(l));
    const other = rows.filter(([l]) => !/^view \d$/.test(l));
    html += `<div class="grp"><b>${esc(g)}</b>`
      + other.map(([l, { c, keys }]) => `<div class="k"><span>${keys.map((k) => `<kbd>${esc(keyLabel(k))}</kbd>`).join(' ')}</span><span>${esc(desc(l, c))}<code>${esc(l)}</code></span></div>`).join('')
      + (views.length ? `<div class="k"><span><kbd>1</kbd>–<kbd>9</kbd></span><span>切换到第 N 个视图<code>view N</code></span></div>` : '')
      + '</div>';
  }
  html += `<div class="grp"><b>鼠标</b>`
    + [['单击', '选中(回显成 select);点在边上 = 选中这条边'], ['Ctrl / ⌘ + 单击', '加进 / 移出选中(多选);Shift + 单击 = 移出'], ['双击', '按节点种类执行命令(容器就地展开 / 收起、文件打开、图片全屏;设置 → 快捷键 → 双击)'], ['滚轮', '缩放:放大进入空间,缩小回到外层'],
      ['拖动', '平移镜头;拖节点 = 给它一个拉力(多选时选中的一起拉)'], ['Shift / Ctrl / Alt + 拖节点', '移动 / 复制 / 引用进另一个容器(文件在磁盘上真的搬;停在收起的容器上会展开)'],
      ['右键拖背景', '框选:不按 = 重选 · Ctrl 追加 · Shift 减去 · Ctrl+Shift 反选'], ['右键从节点拖', '建关系(到另一个节点松开,选类型)'], ['右键单击', '菜单'],
      ['Ctrl C / X / V', '复制 / 剪切 / 粘贴进选中的容器(Ctrl+Shift+V = 引用);文本粘贴成笔记,文件存进文件夹'], ['把文件拖进来', '存进指着的文件夹'], ['拖侧栏左边', '调整侧栏宽度']]
      .map(([k, t]) => `<div class="k"><span>${k}</span><span>${t}</span></div>`).join('') + '</div></div>';
  $('keys').innerHTML = html;
}
dismissible.push(['keys', 'hint', () => toggleKeys(false)]);

window.__stars = { nodes: () => simulation.nodes(), transform: () => transform, scene: () => scene, regions: () => regions, perf, hits: () => frameHits, space: () => curSpaceId, enter: (id) => enterSpace(id, true), exit: () => exitSpace(true), rho: () => (curSpaceId === null ? null : getSpace(curSpaceId).E * transform.k / 0.92 / enterT()), expand: (id) => toggleExpandSpace(id), expanded: () => [...expandedSet], getSpace: (id) => getSpace(id ?? null), hasNode: (id) => !!uni && uni.nodes.has(id), project: () => project, P, heated: () => [...heated].map((sp) => sp.key), flatTarget: () => simulation.alphaTarget(), spaceTarget: (id) => getSpace(id ?? null).sim.alphaTarget(), select: (id) => select(id, false), offset: (id) => screenOffset(id), follow: () => ({ id: followId }), tap: () => (lastTap ? { id: lastTap.id, age: Math.round(performance.now() - lastTap.t) } : null), dragInfo: () => (drag ? { id: drag.n && drag.n.id, sp: drag.h && drag.h.sp && drag.h.sp.key, domain: !!(drag.h && drag.h.domain), g: drag.g ? { n: drag.g.n.id, sp: drag.g.sp.key } : null, push: pullDbg } : null), file: () => fp && { id: fp.id, full: fp.full, dirty: fp.dirty, kind: fp.info && fp.info.kind }, nodeCount: () => uni.nodes.size, lastN: () => lastN, recompute, manual, auto, compiled: () => compiled }; // 调试/自动化用
// 旧版的「真实体积」是一个开关(既管半径又管展开形态):有它就一次性拆成 fit + volRadius,再把这个键删掉
(function migrateCompactSetting() {
  let doc; try { doc = llfParseDoc(userCfg.settings.text, CFG_OPTS); } catch { return; }
  const old = llfFind(doc, ['volume', 'compact']); if (!old) return;
  if (llfFind(doc, ['volume', 'fit']) || llfFind(doc, ['volume', 'volRadius'])) return;   // 已经拆过了
  const one = old.kind === 'str' && /^(true|on|yes|1|开)$/i.test(old.value.trim());
  cfgEdit('settings', { path: ['volume', 'fit'], value: one ? '压入' : '铺开' });
  cfgEdit('settings', { path: ['volume', 'volRadius'], value: one ? 'true' : 'false' });
  cfgEdit('settings', { path: ['volume', 'compact'], value: undefined });
})();
// 旧版把设置存在浏览器里(stars.phys / stars.bg / stars.bounds):个人设置文件还不存在时,搬过去一次
(function migrateLegacySettings() {
  let legacy;
  try {
    if (localStorage.getItem('stars.cfgMigrated')) return;
    legacy = { phys: JSON.parse(localStorage.getItem('stars.phys') || 'null'), bg: localStorage.getItem('stars.bg'), bounds: localStorage.getItem('stars.bounds') };
    localStorage.setItem('stars.cfgMigrated', '1');
  } catch { return; }
  if (userCfg.settings.exists) return;
  const want = {};
  for (const [k, v] of Object.entries(legacy.phys || {})) if (PHYS[k] && typeof v === typeof PHYS[k].def && v !== PHYS[k].def) want[k] = v;
  if (legacy.bg != null && BG_MODES[+legacy.bg % 3] && BG_MODES[+legacy.bg % 3] !== PHYS.bg.def) want.bg = BG_MODES[+legacy.bg % 3];
  if (legacy.bounds === '0') want.bounds = 0;
  const keys = Object.keys(want);
  if (!keys.length) return;
  for (const k of keys) setParam(k, want[k]);
  toast(`已把浏览器里的 ${keys.length} 项设置搬进 ${esc(userCfg.settings.path)}`);
})();

connect();
