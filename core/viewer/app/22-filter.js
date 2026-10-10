function computeMatches() {
  matchSet = new Set(); matchAnc = new Map(); qErr = '';
  filt = !!((query && exprQuery() !== '') || qActive);   // 只敲了一个 = 还不算过滤
  if (!filt || !compiled) { renderQbar(); return; }
  let ids = null;
  if (qActive) {
    const r = compiled.queryResults().find((x) => x.name === qActive);
    if (!r) { qActive = null; filt = !!query; }
    else if (r.error) { qErr = `查询 ${r.name}:${r.error}`; ids = []; }
    else ids = r.members;
  }
  const ex = exprQuery();
  if (ex !== null) {
    if (ex) {
      let got = [];
      try { got = compiled.matches(ex); } catch (e) { qErr = e.message; }
      ids = ids ? (() => { const s2 = new Set(got); return ids.filter((id) => s2.has(id)); })() : got;
    }
  } else if (query) {
    const t = query.toLowerCase(), got = [];
    for (const n of data.nodes) if (!n.id.startsWith('~') && `${n.id} ${n.label} ${n.attrs.summary || ''}`.toLowerCase().includes(t)) got.push(n.id);
    ids = ids ? (() => { const s2 = new Set(got); return ids.filter((id) => s2.has(id)); })() : got;
  }
  for (const id of ids || []) {
    matchSet.add(id);
    for (let p = compiled.parentOf(id); p; p = compiled.parentOf(p)) matchAnc.set(p, (matchAnc.get(p) || 0) + 1);
  }
  renderQbar();
}
/** 「查询」一行:保存的查询(点一下点亮它的成员,别的调暗);过滤框里是表达式时可以存成查询 */
function renderQbar() {
  const el = $('qbar');
  if (!el) return;
  const res = compiled ? compiled.queryResults() : [];
  const ex = exprQuery();
  if (!res.length && ex === null) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<span class="tag" style="font-size:11px">查询</span>`
    + res.map((r) => `<span class="tagc ${qActive === r.name ? 'on' : ''}" data-q="${esc(r.name)}" data-cmd="region ${esc(quoteArg(r.name))}" title="${esc(r.label + ':' + r.expr + (r.error ? '\n错误:' + r.error : ''))}"><i style="background:${esc(r.color || '#9db4ff')}"></i>${esc(r.label)}<span class="c">${r.error ? '!' : r.members.length}</span></span>`).join('')
    + (ex ? (qErr ? '' : `<span class="tagc" data-qsave="1" title="把过滤框里的表达式存成一个查询(成员随宇宙变化)">＋ 存为查询 <span class="c">${matchSet.size}</span></span>`) : '')
    + (qErr ? `<div class="qerr">${esc(qErr)}</div>` : '');
}
async function saveQueryFromBox() {
  const ex = exprQuery(); if (!ex) return;
  const name = (prompt('查询名(字母、数字、_ . -;同名就覆盖)', qEditing || qActive || '') || '').trim();
  if (!name) return;
  exec(`query-set ${quoteArg(name)} --expr ${quoteArg(ex)}`, 'ui', (r) => {
    if (!r.ok) return;
    $('q').value = ''; query = ''; qEditing = null; qActive = name; computeMatches(); select(null);
  });
}
let qEditing = null;   // 「改条件」:把查询的表达式放进过滤框改,存的时候默认还用这个名字
function setRegion(name) {
  qActive = name && name !== qActive ? name : null;
  computeMatches(); select(null);
}
function neighborsIn(sp, id) {
  const s = new Set([id]);
  for (const l of sp.links) { if (l.source.id === id) s.add(l.target.id); if (l.target.id === id) s.add(l.source.id); }
  return s;
}
/** 高亮选中的豁免集:选中节点 + 它在自己空间里的邻居。全局共用这一份,所以所有空间、所有层级
 *  都按同一个明暗来画 —— 不再只暗"同一层"的内容(见 drawSpace 里的 aOf)。 */
let hlKey = '', hlCache = null;
function hlSet() {
  const key = selected + '|' + spaceVer + '|' + spaces.size;
  if (key === hlKey && hlCache) return hlCache;
  hlKey = key;
  hlCache = new Set([selected]);
  const sp = selected ? holderOf(selected) : null;
  if (sp) for (const l of sp.links) { if (l.source.id === selected) hlCache.add(l.target.id); if (l.target.id === selected) hlCache.add(l.source.id); }
  return hlCache;
}
const mustLabel = (n) => n.id === selected || (filt && matchSet.has(n.id)); // 悬浮不再影响图谱标签布局(改用光标气泡)
