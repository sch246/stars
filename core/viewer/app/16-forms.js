// ---- 表单:LLF 文件里的类型标签就是 schema(和设置面板同一套控件);JSON / TOML 按值的类型挑控件,每一项都能删、每个对象 / 列表都能加。
// 三种格式都解析成同一种树(kind / key / entries / items / value / comments),改动都按路径只动那一段(注释、缩进、键序不变),
// 写回同一份缓冲,停手 0.6 秒自动保存 ----
const exprStr = (e) => e.name + (e.types.length ? `<${e.types.map(exprStr).join(',')}>` : '') + (e.args.length ? `(${e.args.join(',')})` : '');
const defaultFor = (w) => (w.kind === 'bool' ? 'false' : w.kind === 'range' ? String(w.min) : w.kind === 'choice' ? w.choices[0] || '' : w.kind === 'color' ? '#ffffff' : '');
const FORM_TYPE_NAMES = { string: '文本', number: '数字', integer: '整数', float: '小数', bool: '开关', null: '空', datetime: '日期时间', object: '对象', table: '表', array: '列表' };
const today = () => new Date().toISOString().slice(0, 10);
const FORM_FORMATS = {
  llf: {
    name: 'LLF', parse: (t) => llfParseDoc(t, CFG_OPTS).root, nullText: '_(空)',
    set: (t, p, v) => llfSetString(t, p, v, CFG_OPTS), del: (t, p) => llfDelete(t, p, CFG_OPTS),
    add: (t, p, key, _type, elem) => llfSetString(t, [...p, key ?? llfFind(llfParseDoc(t, CFG_OPTS), p).items.length], defaultFor(widgetOf(elem || null)), CFG_OPTS),
    label: labelOf, hint: hintOf, typeName: (n, tag) => (tag ? '!' + tag : '字符串'),
    /** 只有 !list<T> / !map<T> 能增删项,T 是每一项的标签 */
    coll(node) {
      let te = null;
      try { te = node.tag ? llfParseTagExpr(node.tag) : null; } catch { /* 不认识的写法 */ }
      return te && (te.name === 'list' || te.name === 'map') ? { elem: te.types[0] ? exprStr(te.types[0]) : null } : null;
    },
  },
  json: {
    name: 'JSON', parse: jsoncParse, nullText: 'null', set: jsoncSet, del: jsoncDelete,
    add: (t, p, key, type) => jsoncInsert(t, p, key, { number: '0', bool: 'false', null: 'null', object: '{}', array: '[]' }[type] ?? '""'),
    label: (n) => n.key, hint: (n) => (n.comments || []).join(' '), typeName: (n) => FORM_TYPE_NAMES[n.type] || n.type,
    coll: () => ({ types: ['string', 'number', 'bool', 'null', 'object', 'array'] }),
  },
  toml: {
    name: 'TOML', parse: tomlParse, nullText: '', set: tomlSet, del: tomlDelete,
    add: (t, p, key, type) => tomlInsert(t, p, key, { integer: '0', float: '0.0', bool: 'false', datetime: today(), table: '{}', array: '[]' }[type] ?? '""'),
    label: (n) => n.key, hint: (n) => (n.comments || []).join(' '), typeName: (n) => FORM_TYPE_NAMES[n.type] || n.type,
    coll: (n) => (n.def === 'aotList' ? { aot: true } : { types: ['string', 'integer', 'float', 'bool', 'datetime', 'table', 'array'] }),
  },
};
function mountForm(body) {
  if (!fp.full && fp.info.editable) { body.innerHTML = '<div id="fp-media">载入全文…</div>'; loadFull().then(() => { if (fp && fp.handler === 'form' && fp.full) renderFileBody(); }); return; }
  const F = FORM_FORMATS[fp.form = formFormatOf(fp.path)];
  let root;
  try { root = F.parse(fp.text); }
  catch (e) { body.innerHTML = `<div id="fp-media">这还不是合法的 ${F.name}:${esc(e.message)}<br><span class="btn" data-cmd="open ${esc(quoteArg(fp.id))} --with text">到原文里改</span></div>`; return; }
  const ro = !fp.full || !fp.info.editable;
  const rows = root.kind === 'map' || root.kind === 'list' ? formNode(F, root, [], null, ro, false) : formNode(F, { ...root, key: '(整个文件)' }, [], null, ro, false);
  body.innerHTML = `<div id="fp-form" class="${ro ? 'ro' : ''}">${rows || '<span class="tag">(空)</span>'}</div>`;
}
function formNode(F, node, path, elemTag, ro, removable) {
  const P = esc(JSON.stringify(path)), del = removable && !ro ? `<span class="mini no fm-del" data-path="${P}" title="删掉这一项">✗</span>` : '';
  const named = node.key !== undefined, label = named ? F.label(node) : `#${path[path.length - 1] ?? ''}`, hint = named || node.comments ? F.hint(node) : '';
  if (node.kind === 'map' || node.kind === 'list') {
    const coll = F.coll(node), childTag = coll && coll.elem;
    const kids = node.kind === 'map' ? node.entries : node.items;
    const rows = kids.map((k, i) => formNode(F, k, [...path, node.kind === 'map' ? k.key : i], childTag, ro, !!coll)).join('');
    // 加一项:分组的「+」在标题行上(和 ✗ 挨着,嵌套很深时不会在底部堆成一串);整个文件的在最后。旁边选新的一项是什么类型,默认跟上一项一样
    let add = '';
    if (coll && !ro) {
      const what = node.kind === 'map' ? '加一项(会问键名)' : '加一项';
      if (coll.types) {
        const last = kids[kids.length - 1], def = last && coll.types.includes(last.type) ? last.type : 'string';
        add += `<select class="fm-addtype" title="新的一项是什么类型">${coll.types.map((t) => `<option value="${t}"${t === def ? ' selected' : ''}>${FORM_TYPE_NAMES[t] || t}</option>`).join('')}</select>`;
      }
      add += `<span class="${path.length ? 'mini ok' : 'btn'} fm-add" data-path="${P}" data-kind="${node.kind}" data-elem="${esc(childTag || '')}" title="${what}">${path.length ? '+' : '+ ' + what}</span>`;
    }
    if (!path.length) return rows + (add ? `<div class="fm-rootadd">${add}</div>` : '');
    const tagNote = node.tag ? `<code class="fm-tag">!${esc(node.tag)}</code>` : '';
    return `<div class="sg" data-sg="${P}"><div class="sg-h"><span title="${esc(hint)}">${esc(label)}</span>${tagNote}<span class="fm-hctl">${add}${del}</span></div><div class="sg-b fm-sub">${rows || '<span class="tag">(空)</span>'}</div></div>`;
  }
  const tag = node.tag || elemTag, w = widgetOf(tag), val = node.kind === 'null' ? null : node.value, dis = ro ? ' disabled' : '';
  const lab = `<label title="${esc(hint || F.typeName(node, tag))}">${esc(label)}</label>`;
  const v = parseSetting(w, val ?? '');
  let ctl;
  if (w.kind === 'bool') ctl = `<div class="st-tog fm-tog ${v ? 'on' : ''}" data-path="${P}" data-on="${v ? 1 : 0}"><span class="sw"></span></div>`;
  else if (w.kind === 'range') { const x = v ?? w.min; ctl = `<input type="range" data-path="${P}" data-tag="${esc(tag)}" min="${w.min}" max="${w.max}" step="${w.step}" value="${x}"${dis}><output>${esc(w.zero !== undefined && x === w.min ? w.zero : Number(x).toFixed(decimals(w.step)))}</output>`; }
  else if (w.kind === 'choice') ctl = `<span class="seg">${w.choices.map((c, i) => `<span class="${val === c ? 'on' : ''}" data-path="${P}" data-v="${esc(c)}">${esc(w.names[i])}</span>`).join('')}</span>`;
  else if (w.kind === 'color') ctl = `<input type="color" data-path="${P}" value="${esc(/^#[0-9a-f]{6}$/i.test(val || '') ? val : '#000000')}"${dis}><code>${esc(val ?? '')}</code>`;
  else if (node.block) ctl = `<textarea class="st-in fm-text" data-path="${P}" rows="${Math.min(8, (val || '').split('\n').length + 1)}" spellcheck="false"${dis}>${esc(val ?? '')}</textarea>`;
  else ctl = `<input class="st-in fm-text" data-path="${P}" value="${esc(val ?? '')}" placeholder="${val === null ? F.nullText : ''}" spellcheck="false"${w.kind === 'number' ? ` type="number" min="${w.min}" max="${w.max}" step="${w.step}"` : ''}${dis}>`;
  return `<div class="fm-row fm-${w.kind}">${lab}<span class="fm-ctl">${ctl}</span>${del}</div>`;
}
let formSaveTimer = null;
function formEdit(fn, rerender) {
  if (!fp || !fp.full || !fp.info.editable) return;
  try { fp.text = fn(fp.text); } catch (e) { fpBar('改不了:' + esc(e.message)); return; }
  markDirty();
  clearTimeout(formSaveTimer); formSaveTimer = setTimeout(() => { if (fpDirty()) saveFile(false); }, 600);
  if (rerender) refreshBody();
}
const pathOf = (el) => JSON.parse(el.dataset.path);
$('fp-body').addEventListener('click', (ev) => {
  if (!$('fp-form')) return;
  const t = ev.target;
  const F = FORM_FORMATS[fp.form];
  const tog = t.closest('.fm-tog'); if (tog) { formEdit((s) => F.set(s, pathOf(tog), tog.dataset.on === '1' ? 'false' : 'true'), true); return; }
  const seg = t.closest('.seg [data-v][data-path]'); if (seg) { formEdit((s) => F.set(s, pathOf(seg), seg.dataset.v), true); return; }
  const del = t.closest('.fm-del'); if (del) { formEdit((s) => F.del(s, pathOf(del)), true); return; }
  const add = t.closest('.fm-add');
  if (add) {
    const path = pathOf(add), sel = add.parentElement.querySelector(':scope > .fm-addtype');
    let key;
    if (add.dataset.kind === 'map') { key = prompt('新的键名'); if (!key) return; }
    formEdit((s) => F.add(s, path, key, sel ? sel.value : null, add.dataset.elem || null), true);
    return;
  }
  const h = t.closest('#fp-form .sg-h'); if (h && !t.closest('.fm-hctl')) h.parentElement.classList.toggle('fold');
});
$('fp-body').addEventListener('input', (ev) => {
  const t = ev.target; if (!t.closest('#fp-form') || t.type !== 'range') return;
  const w = widgetOf(t.dataset.tag);
  t.nextElementSibling.textContent = w.zero !== undefined && Number(t.value) === w.min ? w.zero : Number(t.value).toFixed(decimals(w.step));
});
$('fp-body').addEventListener('change', (ev) => {
  const t = ev.target; if (!t.closest('#fp-form') || !t.dataset.path) return;
  const v = t.type === 'range' ? formatSetting(widgetOf(t.dataset.tag), Number(t.value)) : t.value;
  formEdit((s) => FORM_FORMATS[fp.form].set(s, pathOf(t), v), t.type === 'color');
});

// ---- 宇宙文件(.stars):概况;是别处的 universe.stars 就可以作为项目打开 ----
function mountUniverse(body) {
  if (!fp.full) {
    if (fp.info.editable) { body.innerHTML = '<div id="fp-media">载入全文…</div>'; loadFull().then(() => { if (fp && fp.handler === 'universe' && fp.full) renderFileBody(); }); }
    else body.innerHTML = '<div id="fp-media">文件太大,只能在「原文」里看开头</div>';
    return;
  }
  let u;
  try { u = parse(fp.text); }
  catch (e) { body.innerHTML = `<div id="fp-media">解析失败:${esc(e.message)}<br><span class="btn" data-cmd="open ${esc(quoteArg(fp.id))} --with text">看原文</span></div>`; return; }
  const count = (xs, f) => { const m = new Map(); for (const x of xs) { const k = f(x) || '(无)'; m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
  const chips = (rows) => rows.map(([k, n]) => `<span class="chip on">${esc(k)} ${n}</span>`).join(' ');
  const nodes = [...u.nodes.values()].filter((n) => !n.id.startsWith('~')), edges = [...u.edges.values()];
  const dir = fp.info.abs.replace(/[\\/][^\\/]*$/, '');
  const isUni = /(^|\/)universe\.stars$/.test(fp.path), here = project && dir === project.dir;
  body.innerHTML = `<div id="fp-uni"><div class="row"><span class="tag">节点</span><b>${nodes.length}</b></div><div style="display:flex;flex-wrap:wrap;gap:5px;margin:4px 0 10px">${chips(count(nodes, (n) => n.attrs.type))}</div>`
    + `<div class="row"><span class="tag">边</span><b>${edges.length}</b></div><div style="display:flex;flex-wrap:wrap;gap:5px;margin:4px 0 10px">${chips(count(edges, (e) => e.type))}</div>`
    + (isUni ? (here ? '<div class="tag">这就是当前项目的宇宙</div>' : `<span class="btn pri" data-cmd="project ${esc(quoteArg(dir))}">作为项目打开 ↗</span>`) : '')
    + '</div>';
}
