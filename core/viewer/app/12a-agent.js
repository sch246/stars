// ---------- 脚本节点(L4,见 core/src/agent.ts):~script/<名字>,▶ 手动跑或按触发在服务端跑(子进程);每次运行都有记录 ----------
// 侧栏:选中 ~script/<名字>(日志页的「脚本」一栏里点名字)= 代码、触发、最近几次运行;指向文件的脚本,下半就是那个文件。
// 和查看器里的 run tools/x.js(浏览器沙箱里跑、按页面授权)不同:脚本节点在服务端的 Node 里跑,和 stars run 一样不分级。
const scriptRunning = new Set();     // 正在跑的脚本(服务端推 run 事件)
const scriptRuns = new Map();        // 名字 → 最近的运行记录(侧栏打开时向服务端要,之后跟着事件更新)
let runOpen = null;                  // 展开着输出的那条运行

const isScriptNode = (n) => !!n && n.id.startsWith(SCRIPT_PREFIX) && n.attrs.kind === 'script';
const scriptNameOf = (id) => id.slice(SCRIPT_PREFIX.length);
const statusDot = (st) => `<span class="sc-dot sc-${esc(st || 'none')}" title="${esc(st || '还没跑过')}"></span>`;

/** 服务端推来的运行开始 / 结束 */
function onRun(m) {
  if (m.phase === 'start') scriptRunning.add(m.script); else scriptRunning.delete(m.script);
  if (m.phase === 'end' && m.record) {
    const list = scriptRuns.get(m.script);
    if (list && !list.some((r) => r.id === m.record.id)) { list.push(m.record); if (list.length > 20) list.shift(); }
    const r = m.record;
    if (m.trigger !== 'manual') {   // 手动跑的在侧栏 / 控制台里看结果;触发跑的提醒一下
      const what = r.status === 'ok' ? (r.ops || r.draft ? `写了 ${r.ops} 处${r.draft ? ` · 草稿 +${r.draft}` : ''}` : '完成') : r.status === 'timeout' ? '超时' : '出错';
      toast(`脚本 <b>${esc(m.script)}</b>(${esc(m.trigger)} 触发):${what}`, r.status !== 'ok', 3500);
    }
  }
  if (!selected || selected === SCRIPT_PREFIX + m.script) renderSide();
}

async function loadRuns(name) {
  if (window.__STARS_STATIC__) return;
  try {
    const r = await api('/api/runs?script=' + encodeURIComponent(name) + '&limit=12');
    scriptRuns.set(name, r.runs);
    for (const x of r.running) scriptRunning.add(x);
    if (selected === SCRIPT_PREFIX + name) renderSide();
  } catch { /* 服务端旧版本 */ }
}

/** ▶:在服务端跑,等它跑完(输出进控制台) */
async function runScript(name, args = []) {
  scriptRunning.add(name);
  renderSide();
  try {
    const r = await api('/api/run', { name, args });
    const rec = r.record;
    const list = scriptRuns.get(name) || [];
    if (!list.some((x) => x.id === rec.id)) list.push(rec);
    scriptRuns.set(name, list);
    runOpen = rec.id;
    return rec;
  } finally { scriptRunning.delete(name); renderSide(); }
}

function runRow(r) {
  const open = runOpen === r.id;
  return `<div class="row sc-run" data-runid="${esc(r.id)}">${statusDot(r.status)}<span>${esc(ago(Date.parse(r.t)))}</span><span class="tag">${esc(r.trigger)}</span>`
    + `<span class="tag">${r.ms} ms</span>${r.ops ? `<span>写了 ${r.ops} 处</span>` : ''}${r.draft ? `<span style="color:#ffb347">草稿 +${r.draft}</span>` : ''}`
    + `${r.out && r.out.trim() ? `<span class="mini">${open ? '收起' : '输出'}</span>` : ''}</div>`
    + (open && r.out ? `<pre class="sc-out">${esc(r.out.trim())}</pre>` : '');
}

function scriptPanel(n) {
  const name = scriptNameOf(n.id), def = scriptDef(uni, name), live = !window.__STARS_STATIC__;
  if (!scriptRuns.has(name)) { scriptRuns.set(name, []); loadRuns(name); }
  const runs = (scriptRuns.get(name) || []).slice().reverse();
  const running = scriptRunning.has(name);
  const a = n.attrs;
  return `<h3>⚙ ${esc(n.label || name)}</h3>
    <div class="sub">脚本节点 · ${esc(n.id)} · ${esc(def ? describeTriggers(def) : '')}</div>
    ${a.summary ? `<p>${esc(a.summary)}</p>` : ''}
    <div class="btns" style="margin:6px 0">${live ? `<span class="btn pri" data-scact="run" data-name="${esc(name)}">${running ? '运行中…' : '▶ 运行'}</span>` : ''}
      ${live ? `<span class="btn" data-scact="toggle" data-name="${esc(name)}" title="停用:触发不再跑它(手动照样能跑)">${def && !def.enabled ? '启用触发' : '停用触发'}</span>` : ''}
      ${live ? `<span class="btn" data-scact="draft" data-name="${esc(name)}" title="写进草稿:跑完在图上预览,再整批应用或丢弃">${def && def.draft ? '直接写入' : '改成写进草稿'}</span>` : ''}</div>
    ${def && def.problems.length ? `<div class="sec">${def.problems.map((p) => `<div class="row sev-error">${esc(p)}</div>`).join('')}</div>` : ''}
    <div class="sec"><div class="t">触发</div>
      <div class="sc-l"><span class="k">on</span><input class="sc-in" data-scattr="on" value="${esc(a.on || '')}" placeholder="change, file:src/**, stale, start(空 = 只能手动)"${live ? '' : ' disabled'}></div>
      <div class="sc-l"><span class="k">every</span><input class="sc-in" data-scattr="every" value="${esc(a.every || '')}" placeholder="10m(定时;空 = 不定时)"${live ? '' : ' disabled'}></div>
      <div class="sc-hint">回车保存。change = 宇宙变了(不算它自己写的)· file:&lt;通配&gt; = 文件变了(要开着监听)· stale = 说明新过期了 · start = 服务启动时</div></div>
    ${a.file ? `<div class="sec"><div class="t">代码</div><div class="row"><span class="tag">文件</span><span class="link" data-id="${esc(a.file)}">${esc(a.file)}</span></div><div class="sc-hint">下面就是这个文件,改了保存即可;下次运行用新的。</div></div>`
      : `<div class="sec"><div class="t">代码 <span class="sc-hint">export default async (stars, args) =&gt; {…},或者直接写顶层代码;stars.trigger 是这次为什么跑</span></div>
      <textarea class="sc-code" spellcheck="false" data-name="${esc(name)}"${live ? '' : ' readonly'}>${esc(a.code || '')}</textarea>
      ${live ? `<div class="btns"><span class="btn" data-scact="save" data-name="${esc(name)}">保存代码</span><span class="sc-hint">Ctrl/⌘ + Enter 保存并运行</span></div>` : ''}</div>`}
    <div class="sec"><div class="t">最近运行 ${runs.length ? '' : '<span class="tag">还没跑过</span>'}</div>${runs.map(runRow).join('')}</div>`;
}

/** 日志页(没选中东西时)的「脚本」一栏 */
function scriptsSection() {
  const defs = listScripts(uni);
  if (!defs.length) return '';
  const live = !window.__STARS_STATIC__;
  return `<div class="sec"><div class="t">脚本</div>${defs.map((d) => {
    const rn = raw.get(RUN_PREFIX + d.name), st = scriptRunning.has(d.name) ? 'running' : rn && rn.attrs.status;
    return `<div class="row">${statusDot(st)}<span class="link" data-id="${esc(d.id)}">${esc(d.label)}</span><span class="tag">${esc(describeTriggers(d))}</span>`
      + (live ? `<span class="mini" data-scact="run" data-name="${esc(d.name)}" title="运行">${scriptRunning.has(d.name) ? '…' : '▶'}</span>` : '') + '</div>';
  }).join('')}</div>`;
}

/** 侧栏会因为信号、体检、日志推送而重画:正在改的代码 / 触发(和保存的不一样,或者光标在里面)重画后原样放回去 */
function keepEdits(el, render) {
  const saved = [...el.querySelectorAll('.sc-code, .sc-in')].map((x) => ({
    key: x.classList.contains('sc-code') ? 'code' : x.dataset.scattr, v: x.value, def: x.defaultValue,
    focus: document.activeElement === x, s: x.selectionStart, e: x.selectionEnd,
  })).filter((k) => k.focus || k.v !== k.def);
  render();
  for (const k of saved) {
    const x = el.querySelector(k.key === 'code' ? '.sc-code' : `.sc-in[data-scattr="${k.key}"]`);
    if (!x) continue;
    if (k.v !== k.def) x.value = k.v;
    if (k.focus) { x.focus(); try { x.setSelectionRange(k.s, k.e); } catch { /* ignore */ } }
  }
}

function scriptSet(name, set, unset = []) {
  const id = SCRIPT_PREFIX + name, n = uni.nodes.get(id);
  if (!n) return;
  const merged = { ...n.attrs, ...set };
  for (const k of unset) delete merged[k];
  const problems = checkScriptAttrs(merged);
  if (problems.length) { toast(esc(problems.join(';')), true); return; }
  did(`script-set ${quoteArg(name)} ${Object.entries(set).map(([k, v]) => k === 'code' ? '--code …' : `-a ${k}=${quoteArg(v)}`).join(' ')}${unset.map((k) => ` --unset ${k}`).join('')}`);
  return commitOp({ op: 'setNode', id, set, unset: unset.filter((k) => k in n.attrs) }, `~ 脚本 ${name}`, null).catch((e) => toast(esc(e.message), true));
}

$('side-info').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-scact]');
  if (b) {
    const name = b.dataset.name, act = b.dataset.scact;
    ev.stopPropagation();
    if (act === 'run') exec(`script-run ${quoteArg(name)}`, 'mouse');
    else if (act === 'toggle') { const d = scriptDef(uni, name); if (d) scriptSet(name, d.enabled ? { enabled: 'false' } : {}, d.enabled ? [] : ['enabled']); }
    else if (act === 'draft') { const d = scriptDef(uni, name); if (d) scriptSet(name, d.draft ? {} : { draft: 'true' }, d.draft ? ['draft'] : []); }
    else if (act === 'save') { const ta = $('side-info').querySelector('.sc-code'); if (ta) scriptSet(name, { code: ta.value }); }
    return;
  }
  const row = ev.target.closest('.sc-run');
  if (row) { runOpen = runOpen === row.dataset.runid ? null : row.dataset.runid; renderSide(); }
});
$('side-info').addEventListener('keydown', (ev) => {
  const inp = ev.target.closest('.sc-in');
  if (inp && ev.key === 'Enter') {
    const name = scriptNameOf(selected || ''), v = inp.value.trim(), k = inp.dataset.scattr;
    if (selected && selected.startsWith(SCRIPT_PREFIX)) scriptSet(name, v ? { [k]: v } : {}, v ? [] : [k]);
    ev.preventDefault();
  }
  const ta = ev.target.closest('.sc-code');
  if (ta && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    const name = ta.dataset.name;
    Promise.resolve(scriptSet(name, { code: ta.value })).then(() => exec(`script-run ${quoteArg(name)}`, 'mouse'));
  }
  if (ta) ev.stopPropagation();   // 在代码框里打字不触发快捷键
});
