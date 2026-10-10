// ---------- 新建节点:双击空地(或按 N)= 在那里新建 ----------
// 双击当前空间的空地 = 放在当前空间;双击就地展开的文件夹里的空地 = 放进那个文件夹;平铺视图里双击某个展开容器的疆界 = 放进它。
// 弹出的小框:名字 + 类型(记住上次的)。回车新建,Shift+回车 = 建完接着建下一个,Esc / 点别处 = 取消。
// 类型写 file / dir = 在磁盘上新建空文件 / 文件夹(放进指着的文件夹;指着概念时放进项目根,概念也装着它)。
// 新节点就出现在双击的位置(spawnAt)。id 由名字来:空白换成 -,重名加 -2。新的类型顺手登记(~类型 kind=nodeType)。
let creator = null;   // { el, cx, cy, target, local }
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
/** cx, cy:client 坐标;domainId:双击的是哪个就地展开的容器的空地(不给 = 当前空间) */
function openCreator(cx, cy, domainId, { name = '', type } = {}) {
  if (window.__STARS_STATIC__ || replay) { toast('静态导出 / 回放里不能新建', true); return; }
  closeCreator(); closeMenu(); closeLinkPicker();
  const place = creatorPlace(cx, cy, domainId);
  const el = document.createElement('div');
  el.id = 'creator'; el.className = 'panel';
  const types = [...new Set([...styleTypes(uni).nodes.map((t) => t.name), 'concept', 'note', 'file', 'dir'])];
  el.innerHTML = `<div class="cr-row"><input class="cr-name" placeholder="名字" spellcheck="false"><input class="cr-type" list="cr-types" placeholder="类型" spellcheck="false"></div>`
    + `<datalist id="cr-types">${types.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`
    + `<div class="cr-hint">放进「${esc(lblOf(place.target))}」· 回车新建 · Shift+回车接着建 · Esc 取消 · 类型 file / dir = 在磁盘上新建</div>`;
  document.body.appendChild(el);
  creator = { el, cx, cy, ...place };
  const nameIn = el.querySelector('.cr-name'), typeIn = el.querySelector('.cr-type');
  nameIn.value = name; typeIn.value = type ?? lastNewType();
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
  const name = C.el.querySelector('.cr-name').value.trim(), type = C.el.querySelector('.cr-type').value.trim().replace(/\s+/g, '-');
  if (!name) { closeCreator(); return; }
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
  group: '宇宙', effect: 'write', title: '新建节点:不带参数 = 在指针处(或画面中间)弹出新建框(双击空地也是);带名字 = 直接建,--in 放进容器(默认当前空间)',
  usage: 'new [名字] [-t 类型] [--in 容器]', flags: { t: 'type', type: 'type', in: 'in' }, args: [{ name: '名字' }],
  run: async (a, o) => {
    if (o.in && !raw.has(o.in)) throw new Error(`节点不存在:${o.in}`);
    if (!a.length) {
      const r = canvas.getBoundingClientRect(), [x, y] = pointerXY || [innerWidth / 2 - r.left, innerHeight / 2 - r.top];
      openCreator(x + r.left, y + r.top, o.in !== undefined && isSpaces() ? o.in : undefined, { type: o.type });
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
  if (!id) return [{ label: '新建节点…', key: '双击 / N', run: () => openCreator(menuAt[0], menuAt[1]) }];
  const sn = isSpaces() ? compiled.node(id) : sim.get(id);
  const out = [{ label: '改名', key: 'F2', cmd: 'rename ' + quoteArg(id) }];
  if (sn && (sn.container || !raw.get(id)?.attrs.file)) out.push({ label: '在里面新建…', run: () => { const p = screenNodes().find((q) => q.id === id), r = canvas.getBoundingClientRect(); openCreatorIn(id, p ? p.sx + r.left + 30 : menuAt[0], p ? p.sy + r.top + 30 : menuAt[1]); } });
  return out;
});
/** 放进指定容器(不管指针在哪):右键菜单的「在里面新建…」 */
function openCreatorIn(id, cx, cy) {
  openCreator(cx, cy);
  if (!creator) return;
  creator.target = id; creator.local = null;
  creator.el.querySelector('.cr-hint').innerHTML = `放进「${esc(lblOf(id))}」· 回车新建 · Shift+回车接着建 · Esc 取消 · 类型 file / dir = 在磁盘上新建`;
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
