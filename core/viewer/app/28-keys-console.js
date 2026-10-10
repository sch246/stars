// ---------- 键位(KEYMAP / keyMap 由 core/keys.llf + 个人 keys.llf 合成,见「快捷键」一节)----------
const KEY_LABEL = { escape: 'Esc', enter: '⏎', backspace: '⌫', delete: 'Del', tab: 'Tab', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', space: '空格', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
const keyLabel = (k) => k.split('+').map((p) => KEY_LABEL[p] || (p.length === 1 ? p.toUpperCase() : p)).join(' ');
const keysOf = (line) => [...keyMap].filter(([, l]) => l === line || l.split(' ')[0] === line).map(([k]) => keyLabel(k));
function keyName(ev) {
  let k = ev.key; if (!k || k === 'Unidentified' || k === 'Dead' || ['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
  if (k === ' ') k = 'space';
  const single = k.length === 1;
  return (ev.ctrlKey || ev.metaKey ? 'ctrl+' : '') + (ev.altKey ? 'alt+' : '') + (ev.shiftKey && !single ? 'shift+' : '') + k.toLowerCase();
}
function onKey(ev) {
  if (ev.isComposing || ev.defaultPrevented) return;
  const name = keyName(ev); if (!name) return;
  const ae = document.activeElement;
  const typing = ae && (['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName) || ae.isContentEditable);
  if (typing && name !== 'escape' && name !== 'ctrl+k') return;   // 打字时只认 Esc 和 Ctrl K
  const line = keyMap.get(name); if (!line) return;
  if (exec(line, 'key') !== false) ev.preventDefault();
}

// ---------- 控制台(`)----------
const conOutEl = $('con-out'), conIn = $('con-in'), conSug = $('con-sug');
let conHist = [];
try { conHist = JSON.parse(localStorage.getItem('stars.cmdHistory') || '[]'); } catch { /* 隐私模式 */ }
let histAt = conHist.length, histDraft = '';
function conLog(text, cls) {
  const atEnd = conOutEl.scrollHeight - conOutEl.scrollTop - conOutEl.clientHeight < 40;
  const d = document.createElement('div'); d.className = cls || ''; d.textContent = text;
  conOutEl.appendChild(d);
  while (conOutEl.childNodes.length > 600) conOutEl.firstChild.remove();
  if (atEnd) conOutEl.scrollTop = conOutEl.scrollHeight;
}
function layoutConsole() {   // 时间线开着时,控制台叠在它上面
  const tl = $('timeline');
  $('console').style.bottom = (34 + (tl.hidden ? 0 : tl.offsetHeight + 8)) + 'px';
}
function toggleConsole(on) {
  $('console').hidden = !on;
  if (!on) { if (document.activeElement === conIn) conIn.blur(); return; }
  layoutConsole(); conOutEl.scrollTop = conOutEl.scrollHeight;
  if (!conOutEl.childNodes.length) conLog('控制台:每个操作都能敲成命令,写法和 CLI 一样。help 看全部,Tab 补全,↑↓ 翻历史。点按钮、按快捷键时这里会灰显出等价的命令。', 'dim');
  conIn.focus();   // 按 ` 打开时那次按键已被 preventDefault,不会被输进框里
  conHint();
}
/** Tab 补全的候选:第一个词补命令名,之后按命令声明的参数补 */
function completions(text) {
  const toks = tokenize(text), open = !text.trim() || /\s$/.test(text);
  if (toks.length === 0 || (toks.length === 1 && !open)) { const p = toks[0] || ''; return { cur: p, list: [...CMDS.keys()].filter((n) => n.startsWith(p)).sort() }; }
  const spec = CMDS.get(toks[0]); if (!spec || !spec.args) return { cur: '', list: [] };
  const rest = toks.slice(1), cur = open ? '' : rest.pop();
  const pos = rest.filter((t) => !/^--?[A-Za-z]/.test(t)).length;
  const def = spec.args[pos]; if (!def || !def.values) return { cur, list: [] };
  return { cur, list: def.values(cur, rest).filter((v) => v.startsWith(cur)).slice(0, 200) };
}
function conHint(list) {
  const toks = tokenize(conIn.value), spec = CMDS.get(toks[0]);
  let html = '';
  if (list && list.length > 1) html = list.slice(0, 40).map((v) => `<span class="s" data-sug="${esc(v)}">${esc(v)}</span>`).join('') + (list.length > 40 ? `<span class="u">… 还有 ${list.length - 40} 个</span>` : '');
  else if (spec) html = `<span class="u">${esc(spec.usage || spec.name)} — ${esc(spec.title)}</span>`;
  else if (toks.length === 1) html = [...CMDS.keys()].filter((n) => n.startsWith(toks[0])).slice(0, 30).map((n) => `<span class="s" data-sug="${esc(n)}">${esc(n)}</span>`).join('');
  conSug.innerHTML = html;
}
function conComplete(pick) {
  const v = conIn.value.slice(0, conIn.selectionStart), after = conIn.value.slice(conIn.selectionStart);
  const { cur, list } = completions(v);
  const apply = (word, done) => { const head = v.slice(0, v.length - cur.length) + quoteArg(word) + (done ? ' ' : ''); conIn.value = head + after; conIn.selectionStart = conIn.selectionEnd = head.length; };
  if (pick !== undefined) { apply(pick, true); conHint(); return; }
  if (!list.length) return;
  if (list.length === 1) { apply(list[0], true); conHint(); return; }
  let pre = list[0]; for (const w of list) while (!w.startsWith(pre)) pre = pre.slice(0, -1);
  if (pre.length > cur.length) apply(pre, false);
  conHint(list);
}
conIn.addEventListener('keydown', (ev) => {
  ev.stopPropagation();   // 控制台里的按键不触发全局快捷键
  if (ev.isComposing) return;
  if (ev.key === 'Enter') {
    const line = conIn.value.trim(); conIn.value = ''; conSug.innerHTML = '';
    if (!line) return;
    if (conHist[conHist.length - 1] !== line) { conHist.push(line); if (conHist.length > 300) conHist = conHist.slice(-300); try { localStorage.setItem('stars.cmdHistory', JSON.stringify(conHist)); } catch { /* 隐私模式 */ } }
    histAt = conHist.length; histDraft = '';
    exec(line, 'console');
  } else if (ev.key === 'Tab') { ev.preventDefault(); conComplete(); }
  else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
    ev.preventDefault();
    if (histAt === conHist.length) histDraft = conIn.value;
    histAt = Math.max(0, Math.min(conHist.length, histAt + (ev.key === 'ArrowUp' ? -1 : 1)));
    conIn.value = histAt === conHist.length ? histDraft : conHist[histAt]; conHint();
  } else if (ev.key === 'Escape') { ev.preventDefault(); if (conSug.querySelector('.s')) conHint(); else toggleConsole(false); }
  else if (ev.key === '`' && !conIn.value) { ev.preventDefault(); toggleConsole(false); }
  else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); togglePalette(true); }
  else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'l') { ev.preventDefault(); conOutEl.innerHTML = ''; }
});
conIn.addEventListener('input', () => conHint());
conSug.addEventListener('click', (ev) => { const s = ev.target.closest('[data-sug]'); if (s) { conComplete(s.dataset.sug); conIn.focus(); } });

// ---------- 命令面板(Ctrl K)----------
let palItems = [], palAt = 0;
function paletteEntries() {
  const out = [];
  for (const c of CMDS.values()) {
    if (c.name === 'palette') continue;
    if (c.palette) for (const e of c.palette()) out.push({ ...e, group: c.group });
    else out.push({ line: c.name + (c.more || c.args ? ' ' : ''), title: c.title, group: c.group, more: !!(c.more || c.args) });
  }
  for (const e of out) { const ks = [...keyMap].filter(([, l]) => l === e.line.trim()).map(([k]) => keyLabel(k)); e.keys = ks.join(' / '); }
  return out;
}
function palScore(e, q) {
  if (!q) return 1;
  const line = e.line.toLowerCase(), title = e.title.toLowerCase();
  let score = 0;
  for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    const li = line.indexOf(w), ti = title.indexOf(w);
    let sc = 0;
    if (li >= 0) sc = 100 - li + (li === 0 ? 40 : 0);
    if (ti >= 0) sc = Math.max(sc, 90 - ti + (ti + w.length === title.length ? 40 : 0));   // 标题以它结尾 = 就是"这个东西"本身(「开 / 关 时间线」)
    if (!sc && e.group.includes(w)) sc = 30;
    if (!sc) { let j = 0; for (const ch of line + ' ' + title) if (ch === w[j]) j++; if (j < w.length) return 0; sc = 10; }   // 子序列也算(tlnx → timeline next)
    score += sc;
  }
  return score;
}
function renderPalette() {
  const q = $('pal-in').value.trim();
  palItems = paletteEntries().map((e) => [e, palScore(e, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 80).map(([e]) => e);
  palAt = Math.min(palAt, Math.max(0, palItems.length - 1));
  $('pal-list').innerHTML = palItems.map((e, i) => `<div class="pal-row ${i === palAt ? 'on' : ''}" data-i="${i}"><span class="l"><code>${esc(e.line.trim())}${e.more ? ' …' : ''}</code><span class="t">${esc(e.title)}</span></span>${e.keys ? `<kbd>${esc(e.keys)}</kbd>` : '<span></span>'}</div>`).join('')
    || '<div class="tag" style="padding:6px 8px">没有匹配的命令</div>';
  const on = $('pal-list').querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function togglePalette(on) {
  $('palette').hidden = !on;
  if (!on) { if (document.activeElement === $('pal-in')) $('pal-in').blur(); return; }
  $('pal-in').value = ''; palAt = 0; renderPalette(); $('pal-in').focus();
}
function runPalette(i) {
  const e = palItems[i]; if (!e) return;
  togglePalette(false);
  if (e.more) { toggleConsole(true); conIn.value = e.line; setTimeout(() => { conIn.focus(); conIn.selectionStart = conIn.selectionEnd = conIn.value.length; conHint(); }, 0); return; }   // 还要参数:放进控制台接着敲
  exec(e.line, 'palette');
}
$('pal-in').addEventListener('input', () => { palAt = 0; renderPalette(); });
$('pal-in').addEventListener('keydown', (ev) => {
  ev.stopPropagation();
  if (ev.isComposing) return;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); palAt = Math.max(0, Math.min(palItems.length - 1, palAt + (ev.key === 'ArrowDown' ? 1 : -1))); renderPalette(); }
  else if (ev.key === 'Enter') { ev.preventDefault(); runPalette(palAt); }
  else if (ev.key === 'Escape' || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k')) { ev.preventDefault(); togglePalette(false); }
});
$('pal-list').addEventListener('mousemove', (ev) => { const r = ev.target.closest('[data-i]'); if (r && +r.dataset.i !== palAt) { palAt = +r.dataset.i; for (const el of $('pal-list').children) el.classList.toggle('on', el === r); } });
$('pal-list').addEventListener('click', (ev) => { const r = ev.target.closest('[data-i]'); if (r) runPalette(+r.dataset.i); });
$('palette').addEventListener('click', (ev) => { if (ev.target === $('palette')) togglePalette(false); });
