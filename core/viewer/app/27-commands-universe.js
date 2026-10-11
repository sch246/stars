// ---- 内核命令:用法、说明、选项、读还是写,都在命令表里(core/src/cmdspec.ts),和 CLI 同名同参数 ----
// 写命令交给服务端执行(/api/cmd,和 CLI、Node 脚本是同一份实现;作者记为 viewer,页面写的记为 page:<路径>;都能 undo),
// 这里只加界面上的部分:确认框、提示、用选中的东西补参数。读命令在浏览器里对手上这份宇宙算(回放、预览草稿时就是画面上那份)。
// 「提议」级的页面(见 core/src/bridge.ts):新增的节点和边都落成 status=proposed,等你在审阅里确认;
// 改、删只能动它自己提的、还没被确认的;不能确认、不能撤销、不能动 status。
const kvs = (list) => Object.fromEntries((list || []).map((it) => { const i = it.indexOf('='); if (i <= 0) throw new Error(`属性应写成 key=value,得到 "${it}"`); return [it.slice(0, i), it.slice(i + 1)]; }));
const proposing = (c) => !!c && c.src === 'page' && c.level === 'propose';
const pagePending = new Map();   // 页面刚提的(日志还没推回来):键 → { author, n }
function ownProposal(c, k, what) {
  const p = (data.proposals || {})[k], q = pagePending.get(k);
  if (p ? p.author === c.author : q && q.author === c.author && q.n > lastN) return;
  throw new Error(`「提议」级的页面只能改、删自己提的还没被确认的东西,${what} 不是`);
}
const noProposing = (c, what) => { if (proposing(c)) throw new Error(`「提议」级的页面不能${what}(这要你来)`); };
/** 界面上直接改宇宙(拖、连线、类型面板……):一个操作交给服务端;命令走下面的 kernelCmd */
async function commitOp(op, done, c, pendingKey) {
  const r = await api('/api/op', { op, author: (c && c.author) || 'viewer' });
  if (pendingKey) pagePending.set(pendingKey, { author: c.author, n: r.n });
  await waitApplied(r.n);
  if (!$('review').hidden) rvMsg(`${done}(操作 #${r.n},可撤销)`);
  return { out: `${done}   #${r.n}`, data: { n: r.n } };
}
/** 选项还原成命令行的写法(位置参数放在 -- 之后:以 - 开头的 id 也不会被当成选项) */
const optTokens = (o) => Object.entries(o || {}).flatMap(([k, v]) => (v === true ? ['--' + k] : Array.isArray(v) ? v.flatMap((x) => ['--' + k, String(x)]) : v === undefined || v === false || v === null ? [] : ['--' + k, String(v)]));
/** 一条内核命令交给服务端执行;等日志推回来再算完成(脚本、页面写完马上读就能看到自己写的) */
async function kernelCmd(name, a, o, c) {
  if (window.__STARS_STATIC__ || replay) throw new Error('静态导出 / 回放里不能改宇宙');
  const r = await api('/api/cmd', { name, args: [...optTokens(o), '--', ...a], author: (c && c.author) || 'viewer' });
  await waitApplied(r.n);
  if (!$('review').hidden && r.out) rvMsg(`${esc(r.out.split('\n')[0])}(可撤销)`);
  return { out: r.out, data: r.data, n: r.n };
}
const ARG_KINDS = {
  node: ['id', (p) => nodeIds(p)],
  edgeType: ['类型', () => [...new Set(data.edges.map((e) => e.type))]],
  nodeType: ['类型', () => [...new Set(data.nodes.map((n) => n.attrs.type).filter(Boolean))]],
  type: ['类型', () => [...new Set([...data.nodes.map((n) => n.attrs.type).filter(Boolean), ...data.edges.map((e) => e.type)])]],
  view: ['视图', () => viewNames],
  query: ['查询', () => (compiled ? compiled.queryResults().map((r) => r.name) : [])],
  script: ['脚本', () => (uni ? listScripts(uni).map((d) => d.name) : [])],
  file: ['路径', (p) => projectFiles(p, /./)],
};
/** 按命令表定义一条内核命令;ext 里给 run(界面上的部分 + kernelCmd 或在本地算)和别的(palette 之类) */
function kdef(name, ext) {
  const k = CMD_TABLE.get(name);
  if (!k || k.where !== 'kernel') throw new Error('命令表里没有内核命令 ' + name);
  defCmd(name, {
    group: k.group, effect: k.effect, title: k.title, usage: k.usage, kernel: true, more: !!(k.args || k.opts),
    args: (k.args || []).map((a) => (Array.isArray(a) ? { name: '…', values: () => a } : { name: ARG_KINDS[a][0], values: ARG_KINDS[a][1] })),
    run: (a, o, c) => kernelCmd(name, a, o, c),
    ...ext,
  });
}
const undoLink = '<span data-cmd="undo" style="cursor:pointer;text-decoration:underline">撤销</span>';

kdef('add', {
  run: async (a, o, c) => {
    need(a, 1, CMDS.get('add'));
    const prop = o.proposed || proposing(c);
    const r = await kernelCmd('add', a, prop ? { ...o, proposed: true } : o, c);
    if (prop && c.src === 'page') pagePending.set(nodeProposalKey(a[0]), { author: c.author, n: r.n });
    return r;
  },
});
kdef('set', {
  run: (a, o, c) => {
    need(a, 1, CMDS.get('set'));
    if (proposing(c)) {
      ownProposal(c, nodeProposalKey(a[0]), `节点 ${a[0]}`);
      if ('status' in kvs(o.attr) || (o.unset || []).includes('status')) throw new Error('「提议」级的页面不能改 status(确认要你来)');
    }
    return kernelCmd('set', a, o, c);
  },
});
kdef('rm', {
  run: async (a, o, c) => {
    need(a, 1, CMDS.get('rm'));
    const ids = [...new Set(a)];
    for (const id of ids) if (!raw.has(id)) throw new Error(`节点不存在:${id}`);
    const files = o['node-only'] ? [] : ids.filter((id) => isFsNode(id));
    if (proposing(c)) for (const id of ids) ownProposal(c, nodeProposalKey(id), `节点 ${id}`);
    const what = ids.length === 1 ? raw.get(ids[0])?.label || ids[0] : `${ids.length} 个节点`;
    const r = await kernelCmd('rm', ids, o, c);
    // 不先问:删了能撤销(文件在回收站里),提示条上就带着「撤销」
    if (c.src !== 'page') toast(`${files.length ? esc(r.out.split('\n')[0]) : '已删除 ' + esc(what)} · ${undoLink}`, false, ids.length > 1 || files.length ? 6000 : 4000);
    return r;
  },
});
defCmd('delete', {
  group: '写入', effect: 'write', title: '删除选中的:选中了一条边就删这条边,否则删选中的节点(连带它们的边)',
  run: (a, o, c) => {
    if (selEdge && !selEdge.lifted) return CMDS.get('unlink').run([selEdge.from, selEdge.type, selEdge.to], {}, c);
    if (!selection.size) return false;
    return CMDS.get('rm').run([...selection], {}, c);
  },
});
kdef('link', {
  run: async (a, o, c) => {
    need(a, 3, CMDS.get('link'));
    const prop = o.proposed || proposing(c);
    const r = await kernelCmd('link', a, prop ? { ...o, proposed: true } : o, c);
    if (prop && c.src === 'page') pagePending.set(`${a[0]}|${a[1]}|${a[2]}`, { author: c.author, n: r.n });
    return r;
  },
});
kdef('unlink', {
  run: (a, o, c) => {
    need(a, 3, CMDS.get('unlink'));
    if (proposing(c)) ownProposal(c, `${a[0]}|${a[1]}|${a[2]}`, `边 ${a[0]} -${a[1]}-> ${a[2]}`);
    return kernelCmd('unlink', a, o, c);
  },
});
// mv / cp / ln:只给容器 = 选中的;移动时每个节点从它在当前视图里所在的那个容器移出(界面上的整理,见 08c-arrange.js;底下和 CLI 一样是 arrange.ts)
for (const [cmd, mode] of [['mv', 'move'], ['cp', 'copy'], ['ln', 'ref']]) kdef(cmd, {
  title: CMD_TABLE.get(cmd).title + ';只给容器 = 选中的',
  run: async (a, o, c) => {
    noProposing(c, '整理节点');
    let ids = o.top ? a : a.slice(0, -1);
    const target = o.top ? null : a[a.length - 1];
    if (!ids.length && selection.size) ids = [...selection];
    if (!ids.length) throw new Error('用法:' + CMDS.get(cmd).usage);
    for (const id of [...ids, ...(target ? [target] : [])]) if (!raw.has(id)) throw new Error(`节点不存在:${id}`);
    const r = await arrangeNow(mode, ids, target, { from: o.from === '-' ? null : o.from, author: (c && c.author) || 'viewer' });
    return { out: r.n ? `${r.summary}   #${r.n}` : '没有要改的', data: r };
  },
});
kdef('relink', { run: (a, o, c) => { need(a, 3, CMDS.get('relink')); noProposing(c, '改已有的边'); return kernelCmd('relink', a, o, c); } });
kdef('accept', { run: (a, o, c) => { noProposing(c, '确认提议'); return kernelCmd('accept', a, o, c); } });
kdef('draft', {
  group: '写入', usage: 'draft [show | preview | exit | apply | drop [序号…]]', args: [{ name: '动作', values: () => ['show', 'preview', 'exit', 'apply', 'drop'] }],
  palette: () => (draft.length ? [{ line: 'draft preview', title: `预览草稿(${draft.length} 条)` }, { line: 'draft apply', title: '整批应用草稿' }, { line: 'draft drop', title: '丢弃草稿' }] : []),
  run: async ([act = 'show', ...rest], o, c) => {
    if (act === 'preview') { if (!draft.length) return '草稿是空的'; enterDraft(); return; }
    if (act === 'exit') return exitDraft() ? undefined : false;
    if (act === 'show') {   // 本地算:推过来的草稿叠在实时宇宙上
      if (!draft.length) return { out: '草稿是空的(stars --draft <写命令>、stars run --draft 脚本 写进草稿;这里的写命令带 --draft 也行)', data: { entries: [] } };
      const m = draftPreview(liveU || uni, draft), bad = new Map(m.failed.map((f) => [f.i, f.error]));
      return { out: [`草稿:${draft.length} 条,应用之后 +${m.added.size} 节点 ~${m.changed.size} −${m.removed.size} · 边 +${m.addedEdges} −${m.removedEdges}`, ...draft.map((e, i) => `  ${String(i + 1).padStart(3)}  ${draftSummary(e.op)}${bad.has(i) ? '   ✗ ' + bad.get(i) : ''}`)].join('\n'), data: { entries: draft, failed: m.failed } };
    }
    noProposing(c, '应用或丢弃草稿');
    if (act !== 'apply' && act !== 'drop') throw new Error('用法:' + CMDS.get('draft').usage);
    if (!draft.length) return '草稿是空的';
    if (act === 'drop' && !rest.length && c.src !== 'page' && !(await ask(`丢弃整个草稿(${draft.length} 条改动)?\n丢了就没了:草稿不进操作日志,撤销不回来。`, { ok: '丢弃', danger: true }))) return '没有丢弃';
    const r = await kernelCmd('draft', [act, ...rest], o, c);
    if (act === 'apply') { exitDraft(); if (c.src !== 'page') toast(esc(r.out)); }
    return r;
  },
});
for (const name of ['query-set', 'script-set', 'rule-set', 'type-set', 'view-set', 'fn-set', 'scan']) {
  const what = { 'query-set': '保存查询', 'script-set': '写脚本节点', 'rule-set': '定体检规则', 'type-set': '改类型的样子', 'view-set': '改视图', 'fn-set': '写函数节点', scan: '扫描目录' }[name];
  kdef(name, { run: (a, o, c) => { need(a, name === 'scan' ? 0 : 1, CMDS.get(name)); noProposing(c, what); return kernelCmd(name, a, o, c); } });
}
defCmd('script-run', {
  group: '脚本', effect: 'write', title: '在服务端跑一个脚本节点(和触发的一样:子进程,有记录),跑完显示输出', usage: 'script-run <名字> [参数…]',
  args: [{ name: '脚本', values: () => listScripts(needUni()).map((d) => d.name) }], more: true,
  run: async (a, o, c) => {
    need(a, 1, CMDS.get('script-run'));
    noProposing(c, '跑脚本');
    if (c && c.src === 'page') throw new Error('页面不能跑脚本节点(它在服务端以你的权限运行)');
    const rec = await runScriptNode(a[0], a.slice(1));
    const head = `${rec.status === 'ok' ? '✓' : rec.status === 'timeout' ? '⏱ 超时' : '✗'} ${a[0]}  ${rec.ms} ms${rec.ops ? ` · 写了 ${rec.ops} 处` : ''}${rec.draft ? ` · 草稿 +${rec.draft}` : ''}`;
    return { out: [head, (rec.out || '').trim()].filter(Boolean).join('\n'), data: rec };
  },
});
kdef('stamp', {
  run: async (a, o, c) => {
    noProposing(c, '确认说明仍然有效');
    if (!a.length && !o.all) throw new Error('用法:' + CMDS.get('stamp').usage);
    const r = await kernelCmd('stamp', a, o, c);
    stampedLocally(r.data && r.data.stamped);
    return r;
  },
});
kdef('undo', {
  run: async (a, o, c) => {
    noProposing(c, '撤销');
    const r = await kernelCmd('undo', [], o, c);
    if (['key', 'ui', 'mouse'].includes(c.src)) { toast(esc(r.out)); return { data: r.data }; }   // 按键 / 点按钮:提示一下就好,不拉出控制台
    return r;
  },
});
kdef('imports', {
  run: (a, o, c) => {
    const mount = fsMount();
    if (a[0] !== 'on' && a[0] !== 'off') {   // 只是看看:本地算
      const on = !!mount && (raw.get(mount) || { attrs: {} }).attrs.imports === 'true', n = data.edges.filter((e) => e.type === 'dependsOn' && e.attrs.via === 'import').length;
      return { out: `import 边:${on ? '开' : '关'}(${n} 条)`, data: { on, edges: n } };
    }
    noProposing(c, '开关 import 边');
    if (!mount) throw new Error('这个宇宙没有对应的文件夹(没有扫描过的根目录)');
    return kernelCmd('imports', a, o.under === undefined && mount && mount !== 'repo' ? { ...o, under: mount } : o, c);
  },
});

// ---- 读宇宙(在浏览器里算,不用等服务端)。输出给人看;data 给页面和遥控用 ----
const descNode = (id) => nodeLine(uni, id);
const needUni = () => { if (!uni) throw new Error('宇宙还没载入'); return uni; };
kdef('show', { run: (a) => { need(a, 1, CMDS.get('show')); return readShow(needUni(), a[0]); } });
kdef('nb', { run: (a, o) => { need(a, 1, CMDS.get('nb')); return readNb(needUni(), a[0], o); } });
kdef('path', { run: (a, o) => { need(a, 2, CMDS.get('path')); return readPath(needUni(), a[0], a[1], o); } });
kdef('ls', { run: (a, o) => readLs(needUni(), { type: o.type, where: kvs(o.where), orphans: o.orphans, text: o.q ?? (a.join(' ') || undefined), edges: o.edges }, 300) });
kdef('log', {
  run: (a, o) => { const l = data.log.slice(-Number(o.n ?? 20)); return { out: l.map((e) => `#${e.n} ${e.author.padEnd(8)} ${summ(e)}`).join('\n') || '(无记录)', data: l }; },
});
kdef('lint', {
  run: () => ({ out: data.issues.map((i) => `${i.severity.padEnd(5)} ${i.rule.padEnd(20)} ${i.message}`).join('\n') || '✓ 没有问题', data: data.issues }),
});
kdef('stale', {
  run: async (a, o) => {
    const list = data.issues.filter((i) => i.rule === 'stale').map((i) => { const n = raw.get(i.nodes[0]); return { id: i.nodes[0], file: n ? fileOf(n) : null, seen: n && n.attrs.seen }; });
    if (o.diff) for (const x of list) x.diff = await api('/api/seen-diff?id=' + encodeURIComponent(x.id)).catch((e) => ({ error: e.message }));
    const out = list.map((x) => `${x.id}  ${x.file || ''}${x.diff ? '\n' + (x.diff.error ? '    ' + x.diff.error : !x.diff.old ? '    (旧版本不在 git 里,看不到改动)' : x.diff.diff.replace(/^/gm, '    ').trimEnd()) : ''}`).join('\n');
    return { out: out || '✓ 没有过期的说明', data: list };
  },
});
const needCompiled = () => { if (!compiled) throw new Error('视图还没算好'); return compiled; };
kdef('query', {
  run: (a) => {
    if (!a.length) throw new Error('用法:' + CMDS.get('query').usage);
    const c = needCompiled(), arg = a.join(' '), saved = c.queryResults().find((r) => r.name === arg);
    if (saved && saved.error) throw new Error(saved.error);
    const ids = saved ? saved.members : c.matches(arg);
    return { out: ids.length ? ids.slice(0, 300).map(descNode).join('\n') + `\n(共 ${ids.length} 个${ids.length > 300 ? ',只列前 300' : ''})` : '(没有匹配的)', data: ids };
  },
});
kdef('queries', {
  run: () => {
    const res = needCompiled().queryResults();
    return { out: res.map((r) => `${r.name.padEnd(16)} ${r.error ? '错误:' + r.error : String(r.members.length).padStart(5) + ' 个'}   ${r.expr}`).join('\n') || "(还没有保存的查询;过滤框里写 = 表达式,再点「存为查询」)", data: res.map((r) => ({ name: r.name, label: r.label, expr: r.expr, count: r.members.length, error: r.error })) };
  },
});
kdef('scripts', {
  run: () => {
    const defs = listScripts(needUni());
    return {
      out: defs.map((d) => { const r = raw.get(RUN_PREFIX + d.name); return `${d.name.padEnd(16)} ${describeTriggers(d)}${d.file ? `  [${d.file}]` : ''}${r ? `   上次 ${r.attrs.status} ${ago(Date.parse(r.attrs.t))}` : '   还没跑过'}${d.problems.length ? '\n  ✗ ' + d.problems.join(';') : ''}`; }).join('\n')
        || "(还没有脚本节点;script-set 名字 --code 'export default async (stars) => { … }' -a on=change)",
      data: defs.map((d) => ({ name: d.name, triggers: describeTriggers(d), file: d.file, problems: d.problems })),
    };
  },
});
kdef('rules', {
  run: () => {
    const c = needCompiled();
    const rows = data.nodes.filter((n) => n.id.startsWith('~rule/') && n.attrs.kind === 'rule' && n.attrs.expr).map((n) => {
      let count; try { count = c.matches(n.attrs.expr).length; } catch (e) { count = '错误:' + e.message; }
      return { name: n.id.slice(6), expr: n.attrs.expr, level: n.attrs.level || 'warn', message: n.attrs.message || n.attrs.summary || n.label, count };
    });
    return { out: rows.map((r) => `${r.name.padEnd(16)} ${String(r.count).padStart(5)}  ${r.level.padEnd(5)} ${r.message}   ${r.expr}`).join('\n') || '(还没有自定义规则;rule-set <名字> --expr "<表达式>" -s 提示)', data: rows };
  },
});
kdef('types', { run: () => readTypes(needUni(), '✎ 在「类型」面板里改,或 type-set <类型> -a color=#rrggbb') });
kdef('views', {
  run: () => ({ out: viewNames.map((v, i) => `${i + 1}. ${v}${v === currentView ? '   ← 当前' : ''}`).join('\n'), data: { current: currentView, names: viewNames } }) });

// ---- 控制台自己 ----
defCmd('help', {
  group: '控制台', effect: 'read', title: '列出全部命令;help <命令> 看用法', usage: 'help [命令]', args: [{ name: '命令', values: () => [...CMDS.keys()] }],
  run: ([name]) => {
    if (name) { const c = CMDS.get(name); if (!c) throw new Error(`没有这个命令:${name}`); const ks = keysOf(name); return `${c.usage || c.name}\n  ${c.title}${ks.length ? '\n  快捷键:' + ks.join(' / ') : ''}`; }
    const groups = new Map(); for (const c of CMDS.values()) { if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); }
    return [...groups].map(([g, cs]) => `【${g}】\n` + cs.map((c) => `  ${c.name.padEnd(13)} ${c.title}`).join('\n')).join('\n') + '\n写法和 CLI 一样;Tab 补全,↑↓ 翻历史。';
  },
});
defCmd('clear', { group: '控制台', effect: 'ui', title: '清空控制台', run: () => { $('con-out').innerHTML = ''; } });
defCmd('palette', { group: '控制台', effect: 'ui', title: '命令面板:搜索全部命令', run: () => togglePalette(true) });
