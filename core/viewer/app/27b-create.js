// ---------- 新建、打包、解散(键盘:空格 = 新建节点,Tab = 新建域 / 把选中的打包成域,Shift+Tab = 解散;右键菜单里也有)----------
// 新建放在指针那里:指针在就地展开的文件夹里 = 放进它,否则 = 当前空间;平铺视图里指针在某个展开容器的疆界里 = 放进它。
// 弹出的小框:名字(新建节点还有类型,记住上次的)。回车确定,Shift+回车 = 建完接着建下一个,Esc / 点别处 = 取消。
// 类型写 file / dir = 在磁盘上新建空文件 / 文件夹。新节点就出现在指针的位置(spawnAt)。id 由名字来:空白换成 -,重名加 -2。
// 域:在文件夹里(文件视角)就是文件夹,在概念里就是一个概念域(core/src/arrange.ts 的 group / ungroup)。
let creator = null;   // { el, cx, cy, target, local, mode: 'node' | 'domain' | 'group', items }
const NEW_TYPE_KEY = 'stars.newType';
const lastNewType = () => { try { return localStorage.getItem(NEW_TYPE_KEY) ?? 'concept'; } catch { return 'concept'; } };

/** 双击的位置 → 放进哪个容器、在那个空间里的坐标 */
function creatorPlace(cx, cy, domainId) {
  const r = canvas.getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
  if (!compiled) return { target: null, local: null };
  if (!isSpaces()) return { target: regionAt(px, py), local: { key: '*', x: (px - transform.x) / transform.k, y: (py - transform.y) / transform.k } };
  const target = domainId !== undefined ? domainId : curSpaceId;
  if (target === curSpaceId) return { target, local: { key: keyOf(target), x: (px - transform.x) / transform.k, y: (py - transform.y) / transform.k } };
  const off = screenOffset(target), n = holderOf(target).byId.get(target);
  if (!off || !n) return { target, local: null };
  const s = off.s * scOf(n, getSpace(target));
  return { target, local: { key: keyOf(target), x: (px - transform.x - off.x) / s, y: (py - transform.y - off.y) / s } };
}
function closeCreator() { if (creator) { creator.el.remove(); creator = null; } }
/** 新建的域会是什么:在文件夹里(文件视角)= 文件夹,否则 = 概念域 */
const domainIsFolder = (target, items = []) => target != null && isFsDir(target) && (!items.length || items.some((x) => isFsNode(x)));
function creatorHint(mode, target, items) {
  const where = `「${esc(lblOf(target))}」`;
  if (mode === 'group') return `把选中的 ${items.length} 个打包成${domainIsFolder(target, items) ? '一个新文件夹' : '一个域'}(放在${where}里)· 回车确定 · Esc 取消`;
  if (mode === 'domain') return `在${where}里新建${domainIsFolder(target) ? '文件夹' : '域'} · 回车确定 · Esc 取消`;
  return `放进${where} · 回车新建 · Shift+回车接着建 · Esc 取消 · 类型 file / dir = 在磁盘上新建`;
}
/** cx, cy:client 坐标;domainId:指针所在的就地展开的容器(不给 = 当前空间);mode:node 新建节点 · domain 新建域 · group 把 items 打包成域(target 给定) */
function openCreator(cx, cy, domainId, { name = '', type, mode = 'node', items = [], target } = {}) {
  if (window.__STARS_STATIC__ || replay) { toast('静态导出 / 回放里不能新建', true); return; }
  closeCreator(); closeMenu(); closeLinkPicker();
  const place = mode === 'group' ? { target, local: null } : creatorPlace(cx, cy, domainId);
  const el = document.createElement('div');
  el.id = 'creator'; el.className = 'panel';
  const types = [...new Set([...styleTypes(uni).nodes.map((t) => t.name), 'concept', 'note', 'file', 'dir'])];
  el.innerHTML = `<div class="cr-row"><input class="cr-name" placeholder="${mode === 'node' ? '名字' : '域的名字'}" spellcheck="false">${mode === 'node' ? '<input class="cr-type" list="cr-types" placeholder="类型" spellcheck="false">' : ''}</div>`
    + (mode === 'node' ? `<datalist id="cr-types">${types.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>` : '')
    + `<div class="cr-hint">${creatorHint(mode, place.target, items)}</div>`;
  document.body.appendChild(el);
  creator = { el, cx, cy, ...place, mode, items };
  const nameIn = el.querySelector('.cr-name'), typeIn = el.querySelector('.cr-type');
  nameIn.value = name || (mode === 'node' ? '' : domainIsFolder(place.target, items) ? '新文件夹' : '新域');
  if (mode !== 'node') nameIn.select();
  if (typeIn) typeIn.value = type ?? lastNewType();
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(6, Math.min(cx - 14, innerWidth - r.width - 8)) + 'px';
  el.style.top = Math.max(6, Math.min(cy + 14, innerHeight - r.height - 8)) + 'px';
  el.addEventListener('mousedown', (ev) => ev.stopPropagation());
  el.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.isComposing) return;
    if (ev.key === 'Escape') { ev.preventDefault(); closeCreator(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); createFromBox(ev.shiftKey); }
  });
  nameIn.focus();
  if (mode !== 'node') nameIn.select();
}
addEventListener('mousedown', (ev) => { if (creator && !creator.el.contains(ev.target)) closeCreator(); }, true);
overlayDrawers.push((now) => {   // 新节点会出现的位置
  if (!creator) return;
  const r = canvas.getBoundingClientRect(), x = creator.cx - r.left, y = creator.cy - r.top;
  ctx.strokeStyle = `rgba(158,240,192,${0.6 + 0.3 * Math.sin(now / 200)})`; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
});

const idFromName = (name) => { const base = name.trim().replace(/\s+/g, '-').replace(/"/g, '').replace(/^[#~]+/, '') || 'node'; let id = base; for (let i = 2; raw.has(id); i++) id = `${base}-${i}`; return id; };
async function createFromBox(keepOpen) {
  const C = creator; if (!C) return;
  const name = C.el.querySelector('.cr-name').value.trim(), typeIn = C.el.querySelector('.cr-type'), type = typeIn ? typeIn.value.trim().replace(/\s+/g, '-') : '';
  if (!name) { closeCreator(); return; }
  if (C.mode !== 'node') { closeCreator(); groupInto(C.items, C.target, name, C.local).catch((e) => toast(esc(e.message), true)); return; }
  try { localStorage.setItem(NEW_TYPE_KEY, type); } catch { /* 隐私模式 */ }
  closeCreator();
  try { await createNode(name, type, C.target, C.local); }
  catch (e) { toast(esc(e.message), true); return; }
  if (keepOpen) {   // 接着建:框挪到下面一点(新节点也跟着往下排),放进同一个容器
    openCreator(C.cx, C.cy + 34, isSpaces() && C.target !== curSpaceId ? C.target ?? undefined : undefined, { type });
    if (creator && !C.local) { creator.target = C.target; creator.local = null; }
  }
}
/** 新建:普通节点一次提交(节点 + 放进容器的边 + 新类型的登记);file / dir 走 /api/upload 在磁盘上建 */
async function createNode(name, type, target, local) {
  const rel = compiled ? compiled.relation : 'contains';
  if (type === 'file' || type === 'dir') {
    if (!fsMount()) throw new Error('这个宇宙没有对应的文件夹(没有扫描过的根目录),建不了文件');
    const dir = target != null && isFsDir(target) ? target : null, container = dir ? null : target;
    const dirPath = dir == null || dir === fsMount() ? '' : raw.get(dir).attrs.file;
    const guess = arrangeFreePath(dirPath, arrangeCleanName(name), type === 'dir', (p) => raw.has(p));
    if (local) spawnAt.set(guess, local);
    did(`# 在「${lblOf(dir ?? fsMount())}」里新建${type === 'dir' ? '文件夹' : '文件'} ${guess}`);
    const r = await api('/api/upload', { dir, container, files: [{ name, b64: '', dir: type === 'dir' }], rel, author: 'viewer' });
    await waitApplied(r.n);
    setSelection(r.created, r.created[0]);
    toast(`新建${type === 'dir' ? '文件夹' : '文件'} ${esc(r.created[0])} · <span data-cmd="undo" style="cursor:pointer;text-decoration:underline">撤销</span>`);
    return r.created[0];
  }
  const id = idFromName(name), ops = [];
  if (type && !uni.nodes.has('~' + type)) ops.push(styleOp(uni, type, {}, [], 'nodeType'));
  ops.push({ op: 'addNode', id, label: name, attrs: type ? { type } : {} });
  if (target != null) ops.push({ op: 'addEdge', from: target, type: rel, to: id, attrs: {} });
  if (local) spawnAt.set(id, local);
  did(`add ${quoteArg(id)}${name !== id ? ' ' + quoteArg(name) : ''}${type ? ' -t ' + quoteArg(type) : ''}`);
  if (target != null) did(`link ${quoteArg(target)} ${quoteArg(rel)} ${quoteArg(id)}`);
  await commitOp(ops.length === 1 ? ops[0] : { op: 'batch', ops }, `+ ${id}`, null);
  setSelection([id], id);
  return id;
}

// ---- 改名:侧栏里点标题,或 F2 ----
function startRename(id) {
  const h = $('side-info').querySelector('.nd-title');
  if (!h || selected !== id) return false;
  const n = raw.get(id); if (!n) return false;
  const inp = document.createElement('input');
  inp.className = 'nd-rename nd-editing'; inp.value = n.label; inp.spellcheck = false;
  h.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    inp.classList.remove('nd-editing');   // 不再挡着侧栏重画(保存之后要画出新的)
    const v = inp.value.trim();
    if (save && v && v !== n.label) exec(`set ${quoteArg(id)} -l ${quoteArg(v)}`, 'ui');
    else renderSide();
  };
  inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.isComposing) return; if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } if (ev.key === 'Escape') { ev.preventDefault(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
  return true;
}

defCmd('new', {
  group: '宇宙', effect: 'write', title: '新建节点(空格):不带参数 = 在指针处(或画面中间)弹出新建框;带名字 = 直接建,--in 放进容器(默认当前空间)',
  usage: 'new [名字] [-t 类型] [--in 容器]', flags: { t: 'type', type: 'type', in: 'in' }, args: [{ name: '名字' }],
  run: async (a, o) => {
    if (o.in && !raw.has(o.in)) throw new Error(`节点不存在:${o.in}`);
    if (!a.length) {
      const p = pointerPlace();
      if (o.in !== undefined) openCreatorIn(o.in, p.cx, p.cy); else openCreator(p.cx, p.cy, p.domainId, { type: o.type });
      return;
    }
    const target = o.in !== undefined ? o.in : isSpaces() ? curSpaceId : null;
    const id = await createNode(a.join(' '), o.type ?? lastNewType(), target, null);
    return { data: { id } };
  },
});
defCmd('rename', {
  group: '宇宙', effect: 'write', title: '改名(改的是标签;id 和文件名不变):不带新名字 = 在侧栏里改(F2)', usage: 'rename [id] [新名字]', args: [nodeArg()],
  run: ([id, ...rest]) => {
    id = id || selected; if (!id || !raw.has(id)) return false;
    if (rest.length) return CMDS.get('set').run([id], { label: rest.join(' ') }, { src: 'ui', author: 'viewer' });
    if (id !== selected) select(id, true);
    return startRename(id) ? undefined : false;
  },
});
menuProviders.push((id, ids) => {
  if (window.__STARS_STATIC__ || replay) return [];
  if (!id) {   // 空地:在这里新建(指针在就地展开的文件夹里 = 放进它)
    const r = canvas.getBoundingClientRect(), h = hitAt(menuAt[0] - r.left, menuAt[1] - r.top), dom = h && h.domain ? h.n.id : undefined;
    return [{ label: '新建节点…', key: firstKey('new'), run: () => openCreator(menuAt[0], menuAt[1], dom) },
      { label: '新建域…', key: firstKey('group'), title: '在文件夹里就是新建文件夹', run: () => openCreator(menuAt[0], menuAt[1], dom, { mode: 'domain' }) }];
  }
  const sn = isSpaces() ? compiled.node(id) : sim.get(id), out = [{ label: '改名', key: 'F2', cmd: 'rename ' + quoteArg(id) }];
  if (ids.length) out.push({ label: ids.length > 1 ? `把这 ${ids.length} 个打包成域…` : '打包成域…', key: firstKey('group'), cmd: 'group' });
  if (sn && (sn.container || isFsDir(id))) out.push({ label: '解散', key: firstKey('ungroup'), title: '里面的东西放回上一层,再删掉这个域', cmd: 'ungroup ' + quoteArg(id) });
  if (sn && (sn.container || !raw.get(id)?.attrs.file)) {
    const at = () => { const p = screenNodes().find((q) => q.id === id), r = canvas.getBoundingClientRect(); return p ? [p.sx + r.left + 30, p.sy + r.top + 30] : menuAt; };
    out.push({ label: '在里面新建…', run: () => openCreatorIn(id, ...at()) }, { label: '在里面新建域…', run: () => openCreatorIn(id, ...at(), 'domain') });
  }
  return out;
});
/** 放进指定容器(不管指针在哪):右键菜单的「在里面新建…」 */
function openCreatorIn(id, cx, cy, mode = 'node') {
  openCreator(cx, cy, undefined, { mode });
  if (!creator) return;
  creator.target = id; creator.local = null;
  creator.el.querySelector('.cr-hint').innerHTML = creatorHint(mode, id, []);
  if (mode !== 'node') { const nameIn = creator.el.querySelector('.cr-name'); nameIn.value = domainIsFolder(id) ? '新文件夹' : '新域'; nameIn.select(); }
}
/** 指针在哪(client 坐标)、在哪个就地展开的容器里;指针不在画布上 = 画面中间 */
function pointerPlace() {
  const r = canvas.getBoundingClientRect();
  if (!pointerXY) return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, domainId: undefined };
  const [x, y] = pointerXY, h = hitAt(x, y);
  return { cx: x + r.left, cy: y + r.top, domainId: h && h.domain ? h.n.id : undefined };
}

// ---- 侧栏里就地改:说明、属性(类型也是属性);点标题改名 ----
/** 把 el 换成一个输入框;回车(多行的 Ctrl+回车)/ 点别处 = 保存,Esc = 不改 */
function inlineEdit(el, value, { multi = false, placeholder = '', save }) {
  const inp = document.createElement(multi ? 'textarea' : 'input');
  inp.className = 'nd-edit nd-editing'; inp.value = value; inp.placeholder = placeholder; inp.spellcheck = false;
  if (multi) inp.rows = Math.min(12, Math.max(3, value.split('\n').length + 1));
  el.replaceWith(inp); inp.focus(); if (!multi) inp.select();
  let done = false;
  const finish = (ok) => { if (done) return; done = true; inp.classList.remove('nd-editing'); const v = inp.value; if (ok && v !== value) save(v); else renderSide(); };
  inp.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.isComposing) return;
    if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    else if (ev.key === 'Enter' && (!multi || ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); finish(true); }
  });
  inp.addEventListener('blur', () => finish(true));
  return inp;
}
$('side-info').addEventListener('click', (ev) => {
  const id = selected, n = id && raw.get(id);
  if (!n || selection.size > 1 || selEdge || window.__STARS_STATIC__ || replay) return;
  const t = ev.target, q = quoteArg(id);
  if (t.closest('.nd-title')) { startRename(id); return; }
  const sum = t.closest('.nd-sum');
  if (sum) { inlineEdit(sum, n.attrs.summary || '', { multi: true, placeholder: '说明(Ctrl+回车保存,Esc 不改)', save: (v) => exec(v.trim() ? `set ${q} -s ${quoteArg(v.trim())}` : `set ${q} --unset summary`, 'ui') }); return; }
  const v = t.closest('.nd-v');
  if (v) {
    const k = v.closest('[data-k]').dataset.k;
    inlineEdit(v, n.attrs[k] ?? '', { save: (x) => exec(x.trim() ? `set ${q} -a ${quoteArg(`${k}=${x.trim()}`)}` : `set ${q} --unset ${quoteArg(k)}`, 'ui') });
    return;
  }
  const un = t.closest('[data-nunset]');
  if (un) { ev.stopPropagation(); exec(`set ${q} --unset ${quoteArg(un.dataset.nunset)}`, 'ui'); return; }
  if (t.closest('[data-nadd]')) {
    inlineEdit(t.closest('[data-nadd]'), '', { placeholder: 'key=value,回车保存', save: (x) => { const s = x.trim(); if (!s) { renderSide(); return; } if (!/^[^=\s]+=/.test(s)) { toast('写成 key=value', true); renderSide(); return; } exec(`set ${q} -a ${quoteArg(s)}`, 'ui'); } });
    return;
  }
  if (t.closest('[data-ndlink]')) armLink([id]);
});

// ---- 打包成域(Tab)/ 解散(Shift+Tab)----
const fsPathOf = (id) => (id === fsMount() ? '' : raw.get(id)?.attrs.file || '');
const pathBase = (p) => p.replace(/\/$/, '').split('/').pop();
/** 节点在它所在空间里的坐标(空间模式:{ key: 空间, x, y };平铺:key = '*') */
function spacePos(id) {
  if (!isSpaces()) { const n = sim.get(id); return n && n.x !== undefined ? { key: '*', x: n.x, y: n.y } : null; }
  const sp = holderOf(id), n = sp.byId.get(id);
  return n ? { key: sp.key, x: n.x, y: n.y } : null;
}
/** 展开一个容器(打包之后:里面的东西照样看得见) */
function expandNow(id) {
  if (isSpaces()) { if (expandedSet.has(id)) return; if (compiled.node(id)?.container) toggleExpandSpace(id); else pendingExpand.add(id); }   // 视图还没编译出它:编译时再展开
  else { manual.set(id, true); recompute(false); savePlace(); }
}
/** 把 items(同一层的)打包进一个新域,放在 target 里;items 空 = 新建一个空域。在文件夹里 = 新文件夹,文件真的搬进去 */
async function groupInto(items, target, name, local) {
  if (window.__STARS_STATIC__ || replay) throw new Error('静态导出 / 回放里不能改宇宙');
  const rel = compiled ? compiled.relation : 'contains', folder = domainIsFolder(target, items), clean = arrangeCleanName(name);
  // 先猜新域的 id(服务端用同样的规则),好让它和里面的东西出生在原来的位置
  let cid;
  if (folder) cid = arrangeFreePath(fsPathOf(target), clean, true, (p) => raw.has(p));
  else { cid = clean; for (let i = 2; raw.has(cid); i++) cid = `${clean}-${i}`; }
  const pos = items.map((id) => [id, spacePos(id)]).filter(([, p]) => p);
  if (pos.length) {
    const cx = pos.reduce((s, [, p]) => s + p.x, 0) / pos.length, cy = pos.reduce((s, [, p]) => s + p.y, 0) / pos.length;
    spawnAt.set(cid, { key: pos[0][1].key, x: cx, y: cy });
    for (const [id, p] of pos) {
      const nid = isFsNode(id) ? cid + pathBase(id) + (isFsDir(id) ? '/' : '') : id;
      spawnAt.set(nid, isSpaces() ? { key: keyOf(cid), x: p.x - cx, y: p.y - cy } : p);
    }
  } else if (local) spawnAt.set(cid, local);
  did(items.length ? `group ${items.length > 8 ? items.slice(0, 8).map(quoteArg).join(' ') + ' …' : items.map(quoteArg).join(' ')} --name ${quoteArg(name)}` : `group --name ${quoteArg(name)}${target != null ? ' --in ' + quoteArg(target) : ''}`);
  if (items.length) pendingExpand.add(cid);   // 猜对了的话,第一次编译出它就展开(里面的东西不会先缩进去再弹出来)
  const r = await api('/api/arrange', { mode: 'group', ids: items, target, name, rel, author: 'viewer' });
  if (!r.n) { pendingExpand.delete(cid); toast('没有要改的'); return r; }
  await waitApplied(r.n);
  const nid = r.result[0];
  if (nid !== cid) pendingExpand.delete(cid);
  if (items.length) expandNow(nid);
  setSelection([nid], nid);
  toast(`${esc(r.summary)} · <span data-cmd="undo" style="cursor:pointer;text-decoration:underline">撤销</span>`, false, 4500);
  return r;
}
/** 解散一个域:里面的放回上一层。有冲突就弹窗:做不了的(重名、磁盘上图里没有的文件)直接中断;只是会丢东西的问一句 */
async function ungroupNow(id, force = false) {
  if (window.__STARS_STATIC__ || replay) throw new Error('静态导出 / 回放里不能改宇宙');
  const label = raw.get(id)?.label || id, rel = compiled ? compiled.relation : 'contains';
  const parent = isFsNode(id) ? (() => { const pp = fsPathOf(id).replace(/[^/]+\/$/, ''); return pp === '' ? fsMount() : pp; })() : compiled.parentOf(id) ?? null;
  // 里面的东西出生在它们现在的位置(换算到上一层的空间里)
  if (isSpaces()) {
    const hs = holderOf(id), cn = hs.byId.get(id);
    if (cn && expandedSet.has(id)) {
      const sp = getSpace(id), cs = scOf(cn, sp);
      for (const k of sp.nodes) {
        const nid = isFsNode(k.id) && parent != null ? fsPathOf(parent) + pathBase(k.id) + (isFsDir(k.id) ? '/' : '') : k.id;
        spawnAt.set(nid, { key: hs.key, x: cn.x + k.x * cs, y: cn.y + k.y * cs });
      }
    }
  }
  if (!force) did(`ungroup ${quoteArg(id)}`);
  const r = await api('/api/arrange', { mode: 'ungroup', ids: [id], target: parent, force, rel, author: 'viewer' });
  const cf = r.conflicts;
  if (cf && (cf.hard.length || cf.soft.length)) {
    const lines = [...cf.hard.map((x) => '✗ ' + x), ...cf.soft.map((x) => '! ' + x)].join('\n');
    if (cf.hard.length) { alert(`解散不了「${label}」:\n\n${lines}`); return r; }
    if (!confirm(`解散「${label}」会丢东西:\n\n${lines}\n\n仍然解散?(之后可以撤销)`)) return r;
    return ungroupNow(id, true);
  }
  if (!r.n) return r;
  await waitApplied(r.n);
  setSelection(r.result);
  toast(`${esc(r.summary)} · <span data-cmd="undo" style="cursor:pointer;text-decoration:underline">撤销</span>`, false, 4500);
  return r;
}
defCmd('group', {
  group: '宇宙', effect: 'write', title: '新建域 / 打包(Tab):选中了东西 = 把它们(同一层的)打包成一个域,在文件夹里就是新文件夹、文件真的搬进去;没选 = 在指针处新建一个空域;给 --name 就不弹框',
  usage: 'group [id…] [--name 名字] [--in 上一层]', flags: { name: 'name', in: 'in' }, args: [nodeArg()],
  run: (a, o, c) => {
    if (window.__STARS_STATIC__ || replay || !compiled) return false;
    noProposing(c, '打包');
    for (const id of a) if (!raw.has(id)) throw new Error(`节点不存在:${id}`);
    if (o.in !== undefined && !raw.has(o.in)) throw new Error(`节点不存在:${o.in}`);
    const picked = (a.length ? a : [...selection]).filter((id) => raw.has(id) && !id.startsWith('~'));
    const items = picked.filter((id) => !picked.some((x) => x !== id && compiled.ancestors(id).includes(x)));   // 选中里互相包含的只要外层
    if (!items.length) {   // 新建一个空域
      if (o.name) return groupInto([], o.in ?? (isSpaces() ? curSpaceId : null), o.name, null).then((r) => ({ data: r }));
      const p = pointerPlace();
      if (o.in !== undefined) openCreatorIn(o.in, p.cx, p.cy, 'domain'); else openCreator(p.cx, p.cy, p.domainId, { mode: 'domain' });
      return;
    }
    const layers = new Set(items.map((id) => compiled.parentOf(id) ?? null));
    if (o.in === undefined && layers.size > 1) throw new Error('选中的不在同一层,打包不了(打包只能打包同一层的几个)');
    const target = o.in !== undefined ? o.in : [...layers][0];
    if (o.name) return groupInto(items, target, o.name, null).then((r) => ({ data: r }));
    const pos = screenNodes().filter((p) => items.includes(p.id)), r = canvas.getBoundingClientRect();
    const cx = pos.length ? pos.reduce((s, p) => s + p.sx, 0) / pos.length + r.left : pointerPlace().cx;
    const cy = pos.length ? Math.max(...pos.map((p) => p.sy)) + r.top + 16 : pointerPlace().cy;
    openCreator(cx, cy, undefined, { mode: 'group', items, target });
  },
});
defCmd('ungroup', {
  group: '宇宙', effect: 'write', title: '解散(Shift+Tab):域里的东西放回上一层,再删掉这个域;重名、磁盘上有图里没有的文件就不做,会丢说明 / 关系时先问(--force 不问)',
  usage: 'ungroup [域] [--force]', bools: ['force'], args: [nodeArg()],
  run: async (a, o, c) => {
    if (window.__STARS_STATIC__ || replay || !compiled) return false;
    noProposing(c, '解散');
    const id = a[0] || selected;
    if (!id || !raw.has(id)) return false;
    if (!compiled.children(id).length && !isFsDir(id)) { if (a[0]) throw new Error(`「${raw.get(id).label}」里面没有东西,不是域`); return false; }
    const r = await ungroupNow(id, !!o.force);
    return r && r.n ? { data: r } : undefined;
  },
});
