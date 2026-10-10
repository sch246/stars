// ---------- 个人设置 / 快捷键的写回:按路径改(llfSetString / llfDelete),只动那一段,注释和排版不变 ----------
// 每次改动记成一个操作;连续的改动合并成一次保存。别处同时改过(409 / 实时推来新版本)就以最新的为底,把还没存上的操作重放上去。
const CFG_OPTS = { tags: true };
function llfDeleteClean(text, path) {
  let t = llfDelete(text, path, CFG_OPTS);
  for (let n = path.length - 1; n > 0; n--) {   // 删空了的上层字典也删掉,个人文件保持只有改过的项
    const node = llfFind(llfParseDoc(t, CFG_OPTS), path.slice(0, n));
    if (!node || node.kind !== 'map' || node.entries.length) break;
    t = llfDelete(t, path.slice(0, n), CFG_OPTS);
  }
  return t;
}
/** op:{ path, value }(value 是字符串;null 写成 _;undefined = 删掉这一项),或 { raw }(原文页整段替换) */
function applyCfgOp(text, op) {
  if (op.raw !== undefined) return op.raw;
  return op.value === undefined ? llfDeleteClean(text, op.path) : llfSetString(text, op.path, op.value, CFG_OPTS);
}
function cfgEdit(name, op) {
  const u = userCfg[name];
  u.text = applyCfgOp(u.text, op);
  u.ops.push(op);
  clearTimeout(u.timer); u.timer = setTimeout(() => cfgSave(name), 250);
}
async function cfgSave(name, retry = 0) {
  const u = userCfg[name];
  if (!u.ops.length) return;
  if (!CFG_LIVE) { try { localStorage.setItem('stars.cfg.' + name, u.text); } catch { /* 隐私模式 */ } u.ops = []; return; }
  const ops = u.ops; u.ops = []; u.inflight = ops;
  try {
    const r = await api('/api/config', { name, content: u.text, mtime: u.exists ? u.mtime : null });
    u.mtime = r.mtime; u.exists = true; u.inflight = [];
  } catch (e) {
    u.ops = [...ops, ...u.ops]; u.inflight = [];
    if (/改过/.test(e.message) && retry < 3) {   // 别处改过:取磁盘上的最新版,把我的操作重放上去再存
      try { const cur = await api('/api/config?name=' + name); adoptCfg(name, cur); } catch { /* 下面再试 */ }
      return cfgSave(name, retry + 1);
    }
    toast(`保存${{ settings: '设置', keys: '快捷键', grants: '页面授权' }[name] || name}失败:${esc(e.message)}`, true);
  }
}
/** 采用一个新版本(实时推来的,或冲突后重新读的):还没存上的操作重放上去,再按新内容生效 */
function adoptCfg(name, m) {
  const u = userCfg[name]; if (!u) return;
  const base = m.content ?? (CFG.header[name] || '--LLF-END\n');
  u.mtime = m.mtime; u.exists = m.content != null;
  let t = base;
  for (const op of [...u.inflight, ...u.ops]) { try { t = applyCfgOp(t, op); } catch { /* 新版本里结构变了,这个操作作废 */ } }
  if (t === u.text) return;
  u.text = t;
  cfgApply(name);
}
/** 按个人文件的当前内容生效 */
function cfgApply(name) {
  if (name === 'settings') {
    const r = userSettings(userCfg.settings.text);
    userCfg.settings.warnings = r.warnings; userCfg.settings.error = r.error;
    if (!r.error) {
      const changed = Object.values(SET.items).filter((it) => (r.out[it.key] ?? it.def) !== P[it.key]).map((it) => it.key);
      for (const k of changed) P[k] = r.out[k] ?? PHYS[k].def;
      afterParams(changed);
    }
  } else if (name === 'keys') rebuildKeys();
  else if (name === 'grants') grantsChanged();
  if (!$('physics').hidden) renderPhysics(true);
}
/** 程序里设一个参数(param 命令、面板、B 键……):生效并写回个人文件(等于默认值就从文件里删掉) */
function setParam(k, v) {
  const it = SET.items[k];
  P[k] = v;
  cfgEdit('settings', { path: it.path, value: v === it.def ? undefined : formatSetting(it.w, v) });
  afterParams([k]);
}
/** 参数变了之后要做的事(面板、命令、实时推来的新版本共用) */
function afterParams(keys) {
  if (!keys.length) return;
  applyPhys();
  if (keys.some((k) => k === 'volMin' || k === 'volMax' || k === 'volRadius' || k === 'volMap' || k === 'volPool' || k === 'fit')) recompute(); // 体积/展开形态改的是几何本身,要重新编译并重建空间
  if (keys.includes('follow')) scheduleFollow(selected); // 开:从当前镜头平滑锁到选中;关:就地解冻,不跳
  if (keys.includes('bg')) bgMode = Math.max(0, BG_MODES.indexOf(P.bg));
  if (keys.includes('bounds')) showBounds = !!P.bounds;
  if (keys.includes('pageBridge')) grantsChanged();
  if (!$('physics').hidden && !(document.activeElement && document.activeElement.dataset && keys.includes(document.activeElement.dataset.k))) renderPhysics(true); // 正在拖的滑条不重绘
}

// ---------- 快捷键:默认 core/keys.llf + 个人 ~/.config/stars/keys.llf(同名覆盖,_ = 取消) ----------
const MOD_ORDER = ['ctrl', 'alt', 'shift'];
/** 键名规范化:小写,修饰键按 ctrl / alt / shift 排好(Ctrl+K、k+ctrl 都算 ctrl+k) */
function normKey(k) {
  const parts = String(k).split('+').filter((x, i, a) => x !== '' || i === a.length - 1).map((x) => (x.length === 1 ? x : x.toLowerCase()));
  if (parts.length === 1) return parts[0].length === 1 ? parts[0].toLowerCase() : parts[0];
  const key = parts.pop(), mods = MOD_ORDER.filter((m) => parts.includes(m) || (m === 'ctrl' && (parts.includes('cmd') || parts.includes('meta'))));
  return [...mods, key.length === 1 ? key.toLowerCase() : key].join('+');
}
function bindingsOf(text) {   // 文件里 bindings 下的键 → 命令(null = 取消)
  const out = new Map();
  let doc; try { doc = llfParseDoc(text, CFG_OPTS); } catch { return out; }
  const b = llfFind(doc, ['bindings']);
  for (const e of (b && b.kind === 'map' ? b.entries : [])) out.set(normKey(e.key), e.kind === 'null' ? null : e.kind === 'str' ? e.value.trim() : undefined);
  return out;
}
// 双击:节点的种类 → 命令(keys.llf 的 dblclick;$id / $path / $dir 换成被双击的那个)
const DBL_TYPES = { container: '容器', file: '文件', image: '图片', markdown: 'Markdown', html: 'HTML', form: 'LLF 配置', universe: '宇宙文件', node: '其它节点' };
function dblOf(text) {
  const out = new Map();
  let doc; try { doc = llfParseDoc(text, CFG_OPTS); } catch { return out; }
  const b = llfFind(doc, ['dblclick']);
  for (const e of (b && b.kind === 'map' ? b.entries : [])) out.set(e.key, e.kind === 'null' ? null : e.kind === 'str' ? e.value.trim() : undefined);
  return out;
}
const DEF_DBL = new Map([...dblOf(CFG.defaults.keys)].filter(([, c]) => c));
let DBL = new Map();
const DEF_KEYS = [...bindingsOf(CFG.defaults.keys)].filter(([, c]) => c);
const DEF_KEY = new Map(DEF_KEYS);
let KEYMAP = [], keyMap = new Map();
function rebuildKeys() {
  const user = bindingsOf(userCfg.keys.text);
  const out = [];
  for (const [k, c] of DEF_KEYS) { const v = user.has(k) ? user.get(k) : c; if (v) out.push([k, v]); }
  for (const [k, v] of user) if (v && !DEF_KEY.has(k)) out.push([k, v]);
  KEYMAP = out; keyMap = new Map(out);
  DBL = new Map(DEF_DBL);
  for (const [t, v] of dblOf(userCfg.keys.text)) { if (v) DBL.set(t, v); else if (v === null) DBL.delete(t); }
}
rebuildKeys();
/** 设某类节点的双击命令;undefined = 恢复默认 */
function setDbl(type, cmd) {
  const value = cmd === undefined || cmd === DEF_DBL.get(type) ? undefined : cmd;
  cfgEdit('keys', { path: ['dblclick', type], value });
  rebuildKeys();
  if (!$('physics').hidden) renderPhysics(true);
}
/** 双击某个节点要执行的命令行 */
function dblLine(id) {
  const n = raw.get(id); if (!n) return null;
  const sn = isSpaces() ? compiled.node(id) : sim.get(id), path = fileOf(n);
  const type = sn && sn.container ? 'container' : path ? fileTypeOf(path) : 'node';
  const tpl = DBL.get(type) ?? (path ? DBL.get('file') : undefined);
  if (!tpl) return null;
  const dir = path && path.includes('/') ? path.replace(/\/[^/]*$/, '') : '.';
  return tpl.replace(/\$(id|path|dir)\b/g, (_, k) => quoteArg(k === 'id' ? id : k === 'path' ? path || id : dir));
}
/** 绑定 / 取消 / 恢复默认一个键:cmd 是命令行;null = 取消;undefined = 恢复默认 */
function setBinding(key, cmd) {
  key = normKey(key);
  const def = DEF_KEY.get(key);
  const value = cmd === undefined || (cmd !== null && cmd === def) ? undefined : cmd === null ? (def ? null : undefined) : cmd;
  cfgEdit('keys', { path: ['bindings', key], value });
  rebuildKeys();
  if (!$('physics').hidden) renderPhysics(true);
}

// ---------- 设置面板(⚙):「设置」「快捷键」两页,每页可在「表单」和「原文」之间切换 ----------
// 表单由默认文件生成:分组 = 顶层字典,控件 = 标签;改过默认值的项名字后有个小点,双击名字恢复。
// 原文页就是你的个人文件(只记改过的项),可以直接改;下面能展开默认值作参考。每个改动都是一条命令,控制台里会回显。
let setTab = 'settings', setRaw = false, recording = false;
try { const v = JSON.parse(localStorage.getItem('stars.setView') || '{}'); if (v.tab === 'keys') setTab = 'keys'; setRaw = !!v.raw; } catch { /* 隐私模式 */ }
const saveSetView = () => { try { localStorage.setItem('stars.setView', JSON.stringify({ tab: setTab, raw: setRaw })); } catch { /* 隐私模式 */ } };
const fmtP = (k, v) => { const d = PHYS[k]; if (d.toggle) return ''; if (d.zero !== undefined && v === d.min) return d.zero; return typeof v === 'number' ? v.toFixed(decimals(d.step)) : String(v); };
const setMod = (k) => P[k] !== PHYS[k].def;
let setFold = {};
try { setFold = JSON.parse(localStorage.getItem('stars.setFold') || '{}'); } catch { /* 隐私模式 */ }
function settingsForm() {
  return SET.groups.map((g) => {
    const fold = setFold[g.id] ?? g.fold;
    const toggles = g.keys.filter((k) => PHYS[k].toggle), rest = g.keys.filter((k) => !PHYS[k].toggle);
    return `<div class="sg ${fold ? 'fold' : ''}" data-sg="${esc(g.id)}"><div class="sg-h"><span class="${g.keys.some(setMod) ? 'mod' : ''}">${esc(g.label)}</span></div><div class="sg-b">`
      + (toggles.length ? '<div class="sg-tg">' + toggles.map((k) => `<div class="st-tog ${P[k] ? 'on' : ''}" data-k="${k}" title="${esc(PHYS[k].hint)}"><span class="sw"></span><b class="${setMod(k) ? 'mod' : ''}">${esc(PHYS[k].label)}</b></div>`).join('') + '</div>' : '')
      + rest.map((k) => {
        const d = PHYS[k], off = (k === 'heatLevel' && !heatOn()) || (/^vol(Map|Pool|Min|Max)$/.test(k) && !P.volRadius);
        const lab = `<label class="${setMod(k) ? 'mod' : ''}" data-reset="${k}" title="${esc(d.hint)}">${esc(d.label)}</label>`;
        if (d.kind === 'choice') return `<div class="ph-row ${off ? 'off' : ''}">${lab}<span class="seg">` + d.choices.map((c, i) => `<span class="${P[k] === c ? 'on' : ''}" data-k="${k}" data-v="${esc(c)}">${esc(d.names[i])}</span>`).join('') + '</span></div>';
        if (d.kind === 'range') return `<div class="ph-row ${off ? 'off' : ''}">${lab}`
          + `<input type="range" data-k="${k}" min="${d.min}" max="${d.max}" step="${d.step}" value="${P[k]}"><output>${esc(fmtP(k, P[k]))}</output></div>`;
        if (d.kind === 'color') return `<div class="ph-row">${lab}<input type="color" data-k="${k}" value="${esc(P[k])}" style="grid-column:2 / span 2;justify-self:end"></div>`;
        if (d.kind === 'number') return `<div class="ph-row">${lab}<input type="number" class="st-in" data-k="${k}" min="${d.min}" max="${d.max}" step="${d.step}" value="${esc(P[k])}" style="grid-column:2 / span 2"></div>`;
        return `<div class="ph-row">${lab}<input class="st-in" data-k="${k}" value="${esc(P[k])}" style="grid-column:2 / span 2"></div>`;   // 不认识的标签:文本框,原文照样写回
      }).join('') + '</div></div>';
  }).join('');
}
function keysForm() {
  const user = bindingsOf(userCfg.keys.text);
  const rows = [...DEF_KEYS.map(([k]) => k), ...[...user.keys()].filter((k) => !DEF_KEY.has(k))];
  const cmdNames = [...CMDS.keys()];
  return `<datalist id="cmd-names">${cmdNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist><div class="kb-list">`
    + rows.map((k) => {
      const def = DEF_KEY.get(k), cur = keyMap.get(k), off = !cur, st = !def ? '新增' : off ? '已取消' : cur !== def ? '已改' : '';
      return `<div class="kb-row ${off ? 'off' : ''} ${st ? 'mod' : ''}" data-key="${esc(k)}"><kbd>${esc(keyLabel(k))}</kbd>`
        + `<input class="kb-cmd" data-key="${esc(k)}" list="cmd-names" value="${esc(cur || '')}" placeholder="${esc(def ? '(已取消)默认:' + def : '命令')}" spellcheck="false">`
        + `<span class="kb-st">${st}</span>`
        + (st && def ? `<span class="mini" data-kb="reset" title="恢复默认:${esc(def)}">↺</span>` : '<span></span>')
        + (off ? '<span></span>' : `<span class="mini no" data-kb="unbind" title="${def ? '取消这个键' : '删掉这个绑定'}">✗</span>`) + '</div>';
    }).join('') + '</div>'
    + `<div class="btns" style="margin-top:6px"><span class="btn" id="kb-add">${recording ? '请按下要绑的键…(Esc 取消)' : '+ 添加快捷键'}</span></div>`
    + '<div class="sg" style="margin-top:10px"><div class="sg-h"><span>双击</span></div><div class="sg-b"><div class="tag" style="font-size:11px;margin-bottom:4px">按节点的种类执行命令:$id = 被双击的节点,$path = 它的文件,$dir = 文件所在目录;清空 = 恢复默认</div>'
    + Object.entries(DBL_TYPES).map(([t, label]) => {
      const def = DEF_DBL.get(t), cur = DBL.get(t), st = cur === def ? '' : cur ? '已改' : '已取消';
      return `<div class="kb-row dbl ${st ? 'mod' : ''}"><kbd title="${t}">${esc(label)}</kbd>`
        + `<input class="kb-cmd" data-dbl="${t}" list="cmd-names" value="${esc(cur || '')}" placeholder="${esc(def ? '默认:' + def : '(按「文件」)')}" spellcheck="false">`
        + `<span class="kb-st">${st}</span>${st && def ? `<span class="mini" data-dblreset="${t}" title="恢复默认:${esc(def)}">↺</span>` : '<span></span>'}<span></span></div>`;
    }).join('') + '</div></div>';
}
function rawView(name) {
  const u = userCfg[name];
  const notes = (u.error ? [`<span class="bad">${esc(u.error)}(这一版没有生效)</span>`] : []).concat((u.warnings || []).map((w) => `<span class="warn">${esc(w)}</span>`));
  return `<textarea id="set-raw" data-name="${name}" spellcheck="false">${esc(u.text)}</textarea>`
    + `<div id="set-raw-msg">${notes.join('') || '<span class="ok">✓ 有效</span>'}</div>`
    + `<details id="set-defaults"><summary>默认值(只读,core/${name}.llf)</summary><pre>${esc(CFG.defaults[name])}</pre></details>`;
}
/** soft:由数据变化触发(而不是切换页面)—— 原文页正在打字时不覆盖输入框 */
function renderPhysics(soft) {
  for (const el of document.querySelectorAll('#set-head [data-tab]')) el.classList.toggle('on', el.dataset.tab === setTab);
  for (const el of document.querySelectorAll('#set-mode [data-raw]')) el.classList.toggle('on', (el.dataset.raw === '1') === setRaw);
  $('set-path').textContent = '\u200e' + userCfg[setTab].path + '\u200e';   // 从左边省略(rtl),LRM 让开头的 / 不跑到末尾
  $('ph-reset').textContent = setTab === 'keys' ? '全部恢复默认键位' : '全部恢复默认';
  const ta = $('set-raw');
  if (soft && setRaw && ta && document.activeElement === ta) return;
  $('ph-body').innerHTML = setRaw ? rawView(setTab) : setTab === 'keys' ? keysForm() : settingsForm();
}
function togglePhysics(on) {
  $('physics').hidden = !on; $('btn-phys').classList.toggle('on', on);
  if (!on) { recording = false; return; }
  if (!$('editor').hidden) toggleEditor(false);
  if (!$('review').hidden) toggleReview(false);
  $('projects').hidden = true;
  layoutPanels(); renderPhysics();
}
$('set-head').addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-tab]'), r = ev.target.closest('[data-raw]');
  if (t) setTab = t.dataset.tab; else if (r) setRaw = r.dataset.raw === '1'; else return;
  recording = false; saveSetView(); renderPhysics();
});
$('ph-reset').addEventListener('click', () => { if (setTab === 'keys') { exec('bind reset', 'ui'); exec('dbl reset', 'ui'); } else exec('param reset', 'ui'); });
$('ph-body').addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'set-raw') { rawInput(t); return; }
  if (t.type !== 'range') return;   // 拖滑条:实时生效,松手时写回并回显成 param 命令
  const k = t.dataset.k; if (!k) return;
  P[k] = Number(t.value); t.nextElementSibling.textContent = fmtP(k, P[k]);
  afterParams([k]);
});
$('ph-body').addEventListener('change', (ev) => {
  const t = ev.target, k = t.dataset && t.dataset.k;
  if (t.classList.contains('kb-cmd') && t.dataset.dbl) { const v = t.value.trim(); exec(v ? `dbl ${t.dataset.dbl} ${v}` : `dbl reset ${t.dataset.dbl}`, 'ui'); return; }
  if (t.classList.contains('kb-cmd')) { const v = t.value.trim(); exec(v ? `bind ${quoteArg(t.dataset.key)} ${v}` : `unbind ${quoteArg(t.dataset.key)}`, 'ui'); return; }
  if (!k) return;
  if (t.type === 'range') { setParam(k, P[k]); did(`param ${k} ${formatSetting(SET.items[k].w, P[k])}`); return; }
  exec(`param ${k} ${quoteArg(t.value)}`, 'ui');
});
$('ph-body').addEventListener('click', (ev) => {
  const h = ev.target.closest('.sg-h');
  if (h) { const g = h.parentElement, id = g.dataset.sg; setFold[id] = !g.classList.contains('fold'); g.classList.toggle('fold', setFold[id]); try { localStorage.setItem('stars.setFold', JSON.stringify(setFold)); } catch { /* 隐私模式 */ } return; }
  const ch = ev.target.closest('[data-v]');
  if (ch) { exec(`param ${ch.dataset.k} ${quoteArg(ch.dataset.v)}`, 'ui'); return; }
  const t = ev.target.closest('.st-tog');
  if (t) { exec(`param ${t.dataset.k} toggle`, 'ui'); return; }
  const dr = ev.target.closest('[data-dblreset]'); if (dr) { exec(`dbl reset ${dr.dataset.dblreset}`, 'ui'); return; }
  const kb = ev.target.closest('[data-kb]');
  if (kb) { const key = kb.closest('[data-key]').dataset.key; exec(kb.dataset.kb === 'reset' ? `bind reset ${quoteArg(key)}` : `unbind ${quoteArg(key)}`, 'ui'); return; }
  if (ev.target.closest('#kb-add')) { recording = !recording; renderPhysics(); }
});
$('ph-body').addEventListener('dblclick', (ev) => {   // 双击名字:这一项恢复默认(开关只有两态,点一下就是,不需要双击恢复)
  const l = ev.target.closest('[data-reset]'); if (!l) return;
  if (setMod(l.dataset.reset)) exec(`param reset ${l.dataset.reset}`, 'ui');
});
// 录键:按「添加快捷键」后,下一次按键就是要绑的键(在捕获阶段截住,不触发它原来的命令)
addEventListener('keydown', (ev) => {
  if (!recording || $('physics').hidden || ev.isComposing) return;
  const name = keyName(ev); if (!name) return;
  ev.preventDefault(); ev.stopPropagation();
  recording = false;
  if (name === 'escape') { renderPhysics(); return; }
  if (!keyMap.has(name)) setBinding(name, 'help');   // 先占个位(help),再在输入框里改成要的命令
  renderPhysics();
  const inp = [...document.querySelectorAll('.kb-cmd')].find((i) => i.dataset.key === name);
  if (inp) { inp.focus(); inp.select(); }
}, true);
// 原文页:停手 400ms 后检查;合法就写回并生效,不合法就只提示(不存半截的文件)
let rawTimer = null;
function rawInput(ta) {
  clearTimeout(rawTimer);
  rawTimer = setTimeout(() => {
    const name = ta.dataset.name, text = ta.value.replace(/\r\n/g, '\n');
    try { llfParseDoc(text, CFG_OPTS); } catch (e) { $('set-raw-msg').innerHTML = `<span class="bad">${esc(e.message)}(还没保存)</span>`; return; }
    if (text === userCfg[name].text) return;
    cfgEdit(name, { raw: text }); cfgApply(name);
    const u = userCfg[name];
    $('set-raw-msg').innerHTML = (u.warnings || []).map((w) => `<span class="warn">${esc(w)}</span>`).join('') || '<span class="ok">✓ 已保存并生效</span>';
  }, 400);
}
