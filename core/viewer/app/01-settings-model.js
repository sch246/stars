// ---------- 颜色工具 ----------
const hex2rgb = (h) => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ---------- 设置(⚙,LLF 文件):默认值 core/settings.llf,你的修改 ~/.config/stars/settings.llf ----------
// 默认文件带类型标签,本身就是设置表单的 schema:结构与默认值来自它,控件来自标签(!bool、!range(…)、!choice(…)),
// 每项上方紧挨的注释第一行是名字、其余是提示。个人文件只记改过的项(结构相同),在别处改了会实时推过来。
// 静态导出没有服务端:个人文件存在浏览器里。都是"倍率"或直接的物理量;默认值就是调好的手感。
// 热量:模拟始终保持一点温度(和拖动时一样),所以布局一直是"活的"—— 会慢慢公转、对变化立刻有反应,但温度低,不会抖。
const CFG = (() => { try { return JSON.parse(document.getElementById('stars-config').textContent); } catch { return null; } })()
  || { defaults: { settings: '--LLF-END\n', keys: '--LLF-END\n' }, user: null, header: {} };
/** 标签 → 控件。认不出的标签退回文本框(原文照样保留、照样写回) */
function widgetOf(tag) {
  let e = null;
  try { e = tag ? llfParseTagExpr(tag) : null; } catch { /* 写错的表达式 = 不认识的标签 */ }
  const n = (x, d) => (x === undefined || x === '' || !Number.isFinite(Number(x)) ? d : Number(x));
  if (!e) return { kind: 'text' };
  if (e.name === 'bool') return { kind: 'bool' };
  if (e.name === 'range') return { kind: 'range', min: n(e.args[0], 0), max: n(e.args[1], 1), step: n(e.args[2], 0.01), zero: e.args[3] };
  if (e.name === 'number' || e.name === 'int') return { kind: 'number', min: n(e.args[0], -Infinity), max: n(e.args[1], Infinity), step: e.name === 'int' ? 1 : n(e.args[2], 'any') };
  if (e.name === 'choice') return { kind: 'choice', choices: e.args.map((x) => x.split('=')[0]), names: e.args.map((x) => x.split('=').slice(1).join('=') || x) };
  if (e.name === 'color') return { kind: 'color' };
  return { kind: 'text', tag };
}
/** 文件里的字符串 → 运行时的值(开关用 1/0,和原来的代码一致);不合法返回 undefined */
function parseSetting(w, s) {
  if (typeof s !== 'string') return undefined;
  if (w.kind === 'bool') return /^(true|on|yes|1|开)$/i.test(s) ? 1 : /^(false|off|no|0|关)$/i.test(s) ? 0 : undefined;
  if (w.kind === 'range' || w.kind === 'number') { const x = Number(s); return s.trim() === '' || !Number.isFinite(x) ? undefined : Math.min(w.max, Math.max(w.min, x)); }
  if (w.kind === 'choice') return w.choices.includes(s) ? s : undefined;
  return s;
}
const decimals = (step) => (typeof step === 'number' && step < 1 ? String(step).split('.')[1]?.length ?? 0 : 0);
function formatSetting(w, v) {
  if (w.kind === 'bool') return v ? 'true' : 'false';
  if (w.kind === 'range' || w.kind === 'number') return String(+Number(v).toFixed(Math.max(decimals(w.step), 0)));
  return String(v);
}
const labelOf = (node) => (node.comments || [])[0] || node.key;
const hintOf = (node) => (node.comments || []).slice(1).join(' ');
/** 默认文件 → 分组与各项的定义。PHYS 保留原来的形状(def/label/hint/toggle/choices/min/max/step),其余代码不用改 */
const SET = (() => {
  const doc = llfParseDoc(CFG.defaults.settings, { tags: true });
  const groups = [], items = {};
  for (const g of doc.root.entries || []) {
    if (g.kind !== 'map') continue;
    const group = { id: g.key, label: labelOf(g), fold: g.tag === 'folded', keys: [] };
    for (const e of g.entries) {
      if (e.kind !== 'str') continue;
      const w = widgetOf(e.tag);
      items[e.key] = { key: e.key, path: [g.key, e.key], label: labelOf(e), hint: hintOf(e), w, def: parseSetting(w, e.value) ?? e.value };
      group.keys.push(e.key);
    }
    groups.push(group);
  }
  return { groups, items };
})();
const PHYS = Object.fromEntries(Object.values(SET.items).map((it) => [it.key, {
  def: it.def, label: it.label, hint: it.hint, toggle: it.w.kind === 'bool', choices: it.w.choices, names: it.w.names,
  min: it.w.min, max: it.w.max, step: it.w.step, zero: it.w.zero, kind: it.w.kind,
}]));

// 个人文件:{ text, mtime }。live = 有服务端(写回 ~/.config/stars);静态导出存在浏览器里
const CFG_LIVE = !!CFG.user && !window.__STARS_STATIC__;
const userCfg = {};
for (const name of ['settings', 'keys', 'grants']) {
  let text = CFG_LIVE ? CFG.user[name] && CFG.user[name].content : null;
  if (!CFG_LIVE) { try { text = localStorage.getItem('stars.cfg.' + name); } catch { /* 隐私模式 */ } }
  userCfg[name] = { text: text ?? (CFG.header[name] || '--LLF-END\n'), mtime: CFG_LIVE && CFG.user[name] ? CFG.user[name].mtime : null, exists: text != null,
    path: CFG_LIVE && CFG.user[name] ? CFG.user[name].path : '(浏览器里)', ops: [], inflight: [], timer: null, warnings: [], error: null };
}
/** 个人设置里的值(不合法的忽略,记一条警告) */
function userSettings(text) {
  const out = {}, warnings = [];
  let doc;
  try { doc = llfParseDoc(text, { tags: true }); } catch (e) { return { out, warnings, error: e.message }; }
  for (const g of doc.root.entries || []) {
    for (const e of (g.kind === 'map' ? g.entries : [g])) {
      if (e.key === 'compact' && g.kind === 'map' && g.key === 'volume') {   // 旧版的一个开关:拆成 fit + volRadius
        const one = parseSetting({ kind: 'bool' }, e.kind === 'null' ? undefined : e.value);
        if (one !== undefined) { out.fit = one ? '压入' : '铺开'; out.volRadius = one; }
        continue;
      }
      const it = SET.items[e.key];
      if (!it || it.path[0] !== g.key) { warnings.push(`不认识的设置:${g.kind === 'map' ? g.key + '.' : ''}${e.key}`); continue; }
      const v = parseSetting(it.w, e.kind === 'null' ? undefined : e.value);
      if (v === undefined) warnings.push(`${it.label}(${e.key})的值不合法:${JSON.stringify(e.value ?? null)},用默认值`); else out[e.key] = v;
    }
  }
  return { out, warnings, error: null };
}
const P = Object.fromEntries(Object.values(SET.items).map((it) => [it.key, it.def]));
{
  const u = userSettings(userCfg.settings.text);
  Object.assign(P, u.out); userCfg.settings.warnings = u.warnings; userCfg.settings.error = u.error;
}
const heatOn = () => P.heat > 0;
const heatLevel = () => (heatOn() ? P.heatLevel : 0);
// 自定义的力(域之间互推、公转)也按温度缩放(以平时的热量为 1),这样平衡点与温度无关:
// 刚切换视图时温度高,一两秒内就到位,而不是冷下来以后再花几十秒慢慢胀开。封顶 8 倍,免得起步太猛。
const heatScale = (alpha) => Math.min(8, alpha / Math.max(P.heatLevel, 0.02));
// 疆域张力(见 tension):就地展开的空间超出自然疆域 E0 后受到的软墙力。E0 = 展开时的疆域。
// 同一套力在拖动/不拖动时**完全一样**,没有随鼠标开合的死区 —— 力和"收缩程度"同步增长
// (over² 起步,到 over = E0×收缩余量 封顶为线性),所以松手时力是连续的:不会"先缩、然后突然能拉",也不会弹一下。
const shrinkCap = (e0) => e0 * (1 + Math.max(0, P.shrink));                                     // 成员最多伸到这里(也是动态缩放的安全上限)
const shrinkLevel = (over, e0) => Math.min(1, Math.max(0, over) / Math.max(1, e0 * P.shrink));  // 0..1:收缩到了多少
