// ---- 写宇宙:和 CLI 同名同参数(作者记为 viewer;页面写的记为 page:<路径>;都能 undo)----
// 「提议」级的页面(见 core/src/bridge.ts):新增的节点和边都落成 status=proposed,等你在审阅里确认;
// 改、删只能动它自己提的、还没被确认的;不能确认、不能撤销、不能动 status。
const kvs = (list) => Object.fromEntries((list || []).map((it) => { const i = it.indexOf('='); if (i <= 0) throw new Error(`属性应写成 key=value,得到 "${it}"`); return [it.slice(0, i), it.slice(i + 1)]; }));
const NODE_FLAGS = { t: 'type', s: 'summary', l: 'label', a: 'attr', ref: 'ref', unset: 'unset' };
function nodeAttrs(o) { const at = kvs(o.attr); if (o.type !== undefined) at.type = o.type; if (o.summary !== undefined) at.summary = o.summary; if (o.ref !== undefined) at.file = o.ref; return at; }
const proposing = (c) => !!c && c.src === 'page' && c.level === 'propose';
const pagePending = new Map();   // 页面刚提的(日志还没推回来):键 → { author, n }
function ownProposal(c, k, what) {
  const p = (data.proposals || {})[k], q = pagePending.get(k);
  if (p ? p.author === c.author : q && q.author === c.author && q.n > lastN) return;
  throw new Error(`「提议」级的页面只能改、删自己提的还没被确认的东西,${what} 不是`);
}
const noProposing = (c, what) => { if (proposing(c)) throw new Error(`「提议」级的页面不能${what}(这要你来)`); };
async function commitOp(op, done, c, pendingKey) {
  const r = await api('/api/op', { op, author: (c && c.author) || 'viewer' });
  if (pendingKey) pagePending.set(pendingKey, { author: c.author, n: r.n });
  await waitApplied(r.n);
  if (!$('review').hidden) rvMsg(`${done}(操作 #${r.n},可撤销)`);
  return { out: `${done}   #${r.n}`, data: { n: r.n } };
}
const edgeArgs = [nodeArg('from'), { name: '类型', values: () => [...new Set(data.edges.map((e) => e.type))] }, nodeArg('to')];
defCmd('add', {
  group: '宇宙', effect: 'write', title: '新建节点(--proposed 提议:等确认)', usage: 'add <id> [label] [-t 类型] [-s 摘要] [--ref 文件] [-a k=v …] [--proposed]', flags: NODE_FLAGS, multi: ['attr', 'unset'], bools: ['proposed'], more: true,
  run: (a, o, c) => {
    need(a, 1, CMDS.get('add'));
    const attrs = nodeAttrs(o), prop = o.proposed || proposing(c);
    if (prop) attrs.status = 'proposed';
    return commitOp({ op: 'addNode', id: a[0], label: a[1] ?? o.label ?? a[0], attrs }, `+ ${a[0]}${prop ? '  (proposed)' : ''}`, c, prop && c.src === 'page' ? nodeProposalKey(a[0]) : null);
  },
});
defCmd('set', {
  group: '宇宙', effect: 'write', title: '修改节点', usage: 'set <id> [-l 标签] [-t 类型] [-s 摘要] [-a k=v …] [--unset k …]', flags: NODE_FLAGS, multi: ['attr', 'unset'], args: [nodeArg()], more: true,
  run: (a, o, c) => {
    need(a, 1, CMDS.get('set'));
    const set = nodeAttrs(o);
    if (proposing(c)) {
      ownProposal(c, nodeProposalKey(a[0]), `节点 ${a[0]}`);
      if ('status' in set || (o.unset || []).includes('status')) throw new Error('「提议」级的页面不能改 status(确认要你来)');
    }
    return commitOp({ op: 'setNode', id: a[0], label: o.label, set, unset: o.unset }, `~ ${a[0]}`, c);
  },
});
defCmd('rm', {
  group: '宇宙', effect: 'write', title: '删除节点(连带它的边)', usage: 'rm <id>', args: [nodeArg()], more: true,
  run: (a, o, c) => {
    need(a, 1, CMDS.get('rm'));
    if (proposing(c)) ownProposal(c, nodeProposalKey(a[0]), `节点 ${a[0]}`);
    else if (c.src !== 'page' && !confirm(`删除节点 ${a[0]} 和它的所有边?(之后可以 undo)`)) return;   // 页面已经被你授权「写」,不弹框(照样能 undo)
    return commitOp({ op: 'removeNode', id: a[0] }, `- ${a[0]}`, c);
  },
});
defCmd('link', {
  group: '宇宙', effect: 'write', title: '建边', usage: 'link <from> <type> <to> [--proposed] [-a k=v …]', flags: { a: 'attr' }, multi: ['attr'], bools: ['proposed'], args: edgeArgs, more: true,
  run: (a, o, c) => {
    need(a, 3, CMDS.get('link'));
    const attrs = kvs(o.attr), prop = o.proposed || proposing(c);
    if (prop) attrs.status = 'proposed';
    return commitOp({ op: 'addEdge', from: a[0], type: a[1], to: a[2], attrs }, `+ ${a[0]} -${a[1]}-> ${a[2]}${prop ? '  (proposed)' : ''}`, c, prop && c.src === 'page' ? `${a[0]}|${a[1]}|${a[2]}` : null);
  },
});
defCmd('unlink', {
  group: '宇宙', effect: 'write', title: '删边', usage: 'unlink <from> <type> <to>', args: edgeArgs, more: true,
  run: (a, o, c) => {
    need(a, 3, CMDS.get('unlink'));
    if (proposing(c)) ownProposal(c, `${a[0]}|${a[1]}|${a[2]}`, `边 ${a[0]} -${a[1]}-> ${a[2]}`);
    return commitOp({ op: 'removeEdge', from: a[0], type: a[1], to: a[2] }, `- ${a[0]} -${a[1]}-> ${a[2]}`, c);
  },
});
defCmd('accept', {
  group: '宇宙', effect: 'write', title: '确认一条 proposed 边;只给 id 就是确认 proposed 节点', usage: 'accept <from> <type> <to> · accept <id>', args: edgeArgs, more: true,
  run: (a, o, c) => {
    noProposing(c, '确认提议');
    if (a.length === 1) return commitOp({ op: 'setNode', id: a[0], unset: ['status'] }, `✓ ${a[0]}`, c);
    need(a, 3, CMDS.get('accept'));
    return commitOp({ op: 'setEdge', from: a[0], type: a[1], to: a[2], unset: ['status'] }, `✓ ${a[0]} -${a[1]}-> ${a[2]}`, c);
  },
});
defCmd('draft', {
  group: '审阅', effect: 'write', title: '草稿(批量改动的预览):看 / 在图上预览 / 整批应用(一次提交,一步撤回)/ 丢弃', usage: 'draft [show|preview|exit|apply|drop [序号…]]',
  args: [{ name: '动作', values: () => ['show', 'preview', 'exit', 'apply', 'drop'] }],
  palette: () => (draft.length ? [{ line: 'draft preview', title: `预览草稿(${draft.length} 条)` }, { line: 'draft apply', title: '整批应用草稿' }, { line: 'draft drop', title: '丢弃草稿' }] : []),
  run: async ([act = 'show', ...rest], o, c) => {
    if (act === 'preview') { if (!draft.length) return '草稿是空的'; enterDraft(); return; }
    if (act === 'exit') return exitDraft() ? undefined : false;
    if (act === 'show') {
      if (!draft.length) return { out: '草稿是空的(stars --draft <写命令>、stars run --draft 脚本 写进草稿)', data: { entries: [] } };
      const m = draftPreview(liveU || uni, draft), bad = new Map(m.failed.map((f) => [f.i, f.error]));
      return { out: [`草稿:${draft.length} 条,应用之后 +${m.added.size} 节点 ~${m.changed.size} −${m.removed.size} · 边 +${m.addedEdges} −${m.removedEdges}`, ...draft.map((e, i) => `  ${String(i + 1).padStart(3)}  ${draftSummary(e.op)}${bad.has(i) ? '   ✗ ' + bad.get(i) : ''}`)].join('\n'), data: { entries: draft, failed: m.failed } };
    }
    noProposing(c, '应用或丢弃草稿');
    if (act === 'apply') {
      if (!draft.length) return '草稿是空的';
      const r = await api('/api/draft', { action: 'apply', author: (c && c.author) || 'viewer' });
      await waitApplied(r.n);
      exitDraft();
      if (c.src !== 'page') toast(`已应用草稿:${r.count} 条改动作为一次提交 #${r.n}(undo 一步撤回)`);
      return { out: `已应用草稿 ${r.count} 条   #${r.n}`, data: r };
    }
    if (act === 'drop') {
      if (!draft.length) return '草稿是空的';
      const idx = rest.map(Number);
      if (idx.some((i) => !Number.isInteger(i) || i < 1 || i > draft.length)) throw new Error(`序号应在 1..${draft.length} 之间`);
      if (!idx.length && c.src !== 'page' && !confirm(`丢弃整个草稿(${draft.length} 条改动)?丢了就没了(草稿不进操作日志)`)) return;
      const r = await api('/api/draft', { action: 'drop', indices: idx.length ? idx : undefined, author: (c && c.author) || 'viewer' });
      return { out: `已丢弃 ${r.dropped} 条`, data: r };
    }
    throw new Error('用法:' + CMDS.get('draft').usage);
  },
});
defCmd('query-set', {
  group: '宇宙', effect: 'write', title: '保存一个查询(= 动态区域,成员随宇宙变化)', usage: "query-set <名字> --expr '<表达式>' [-l 显示名] [-s 说明] [-a color=#rrggbb]", flags: { expr: 'expr', l: 'label', s: 'summary', a: 'attr' }, multi: ['attr'], more: true,
  run: (a, o, c) => {
    need(a, 1, CMDS.get('query-set'));
    const name = a[0], expr = String(o.expr ?? a.slice(1).join(' ')).trim();
    if (!/^[\p{L}\p{N}_.-]+$/u.test(name)) throw new Error('查询名只能含字母、数字、_ . -');
    if (!expr) throw new Error('需要 --expr');
    const count = needCompiled().matches(expr).length;   // 写错了在这里就抛出
    const id = QUERY_PREFIX + name, had = uni.nodes.has(id), set = { ...kvs(o.attr), expr };
    if (o.summary !== undefined) set.summary = o.summary;
    if (proposing(c)) throw new Error('「提议」级的页面不能保存查询');
    return commitOp(had ? { op: 'setNode', id, label: o.label, set } : { op: 'addNode', id, label: o.label ?? name, attrs: { kind: 'query', ...set } }, `${had ? '~' : '+'} 查询 ${name}(现在匹配 ${count} 个)`, c);
  },
});
defCmd('script-set', {
  group: '宇宙', effect: 'write', title: '新建 / 修改脚本节点 ~script/<名字>(代码在节点里,或指向文件;触发写在属性里)',
  usage: "script-set <名字> --code '<JS>' | --ref <脚本文件> [-a on=change,file:src/**,stale,start] [-a every=10m] [-a draft=true] [-a enabled=false] [-s 说明] [--unset 键 …]",
  flags: { code: 'code', ref: 'ref', a: 'attr', s: 'summary', l: 'label', unset: 'unset' }, multi: ['attr', 'unset'], more: true,
  run: (a, o, c) => {
    need(a, 1, CMDS.get('script-set'));
    noProposing(c, '写脚本节点');
    const name = a[0];
    if (!/^[\p{L}\p{N}_.-]+$/u.test(name)) throw new Error('脚本名只能含字母、数字、_ . -');
    const set = kvs(o.attr);
    if (o.code !== undefined) set.code = o.code;
    if (o.ref !== undefined) set.file = o.ref;
    if (o.summary !== undefined) set.summary = o.summary;
    const id = SCRIPT_PREFIX + name, had = needUni().nodes.get(id);
    const merged = { ...(had ? had.attrs : {}), ...set };
    for (const k of o.unset || []) delete merged[k];
    const problems = checkScriptAttrs(merged);
    if (problems.length) throw new Error(problems.join(';'));
    const unset = (o.unset || []).filter((k) => had && k in had.attrs);
    return commitOp(had ? { op: 'setNode', id, label: o.label, set, unset } : { op: 'addNode', id, label: o.label ?? name, attrs: { kind: 'script', ...set } }, `${had ? '~' : '+'} 脚本 ${name}`, c);
  },
});
defCmd('script-run', {
  group: '宇宙', effect: 'write', title: '在服务端跑一个脚本节点(和触发的一样:子进程,有记录),跑完显示输出', usage: 'script-run <名字> [参数…]',
  args: [{ name: '脚本', values: () => listScripts(needUni()).map((d) => d.name) }], more: true,
  run: async (a, o, c) => {
    need(a, 1, CMDS.get('script-run'));
    noProposing(c, '跑脚本');
    if (c && c.src === 'page') throw new Error('页面不能跑脚本节点(它在服务端以你的权限运行)');
    const rec = await runScript(a[0], a.slice(1));
    const head = `${rec.status === 'ok' ? '✓' : rec.status === 'timeout' ? '⏱ 超时' : '✗'} ${a[0]}  ${rec.ms} ms${rec.ops ? ` · 写了 ${rec.ops} 处` : ''}${rec.draft ? ` · 草稿 +${rec.draft}` : ''}`;
    return { out: [head, (rec.out || '').trim()].filter(Boolean).join('\n'), data: rec };
  },
});
defCmd('rule-set', {
  group: '宇宙', effect: 'write', title: '自定义体检规则(存成节点 ~rule/<名字>):命中表达式的节点各报一条', usage: "rule-set <名字> --expr '<表达式>' [-s 提示] [-a level=warn|error|info]",
  flags: { expr: 'expr', s: 'summary', a: 'attr', l: 'label' }, multi: ['attr'], more: true,
  run: (a, o, c) => {
    need(a, 1, CMDS.get('rule-set'));
    noProposing(c, '定体检规则');
    const name = a[0], expr = String(o.expr ?? a.slice(1).join(' ')).trim();
    if (!/^[\p{L}\p{N}_.-]+$/u.test(name)) throw new Error('规则名只能含字母、数字、_ . -');
    if (!expr) throw new Error("需要 --expr '<表达式>'(命中的节点算有问题)");
    const count = needCompiled().matches(expr).length;   // 写错了在这里就抛出
    const set = { ...kvs(o.attr), expr };
    if (set.level !== undefined && !['error', 'warn', 'info'].includes(set.level)) throw new Error('level 只能是 error / warn / info');
    if (o.summary !== undefined) set.message = o.summary;
    const id = '~rule/' + name, had = uni.nodes.has(id);
    return commitOp(had ? { op: 'setNode', id, label: o.label, set } : { op: 'addNode', id, label: o.label ?? name, attrs: { kind: 'rule', ...set } }, `${had ? '~' : '+'} 规则 ${name}(现在命中 ${count} 个,体检结果稍后推过来)`, c);
  },
});
defCmd('type-set', {
  group: '宇宙', effect: 'write', title: '改类型的样子(写到类型节点 ~<类型>,不在就建;没专门规定它的视图里立刻生效)',
  usage: 'type-set <类型> [-a color=#rrggbb] [-a shape=dot|star|nebula|ringed|pulsar] [-a scale=1.5] · 边类型 [-a width=2] [-a arrow=true|false] [-a mode=line|faint|hidden] [--unset 键 …] [-l 名字] [-s 说明]',
  flags: { a: 'attr', unset: 'unset', l: 'label', s: 'summary' }, multi: ['attr', 'unset'], more: true,
  args: [{ name: '类型', values: () => [...new Set([...data.nodes.map((n) => n.attrs.type).filter(Boolean), ...data.edges.map((e) => e.type)])] }],
  run: (a, o, c) => {
    need(a, 1, CMDS.get('type-set'));
    noProposing(c, '改类型的样子');
    const set = kvs(o.attr);
    let kind;
    if (set.kind !== undefined) { if (set.kind !== 'nodeType' && set.kind !== 'edgeType') throw new Error('kind 只能是 nodeType / edgeType'); kind = set.kind; delete set.kind; }
    if (!Object.keys(set).length && !(o.unset || []).length && o.label === undefined && o.summary === undefined) throw new Error('要改什么?比如 type-set module -a color=#bd00ff -a shape=ringed');
    const op = styleOp(needUni(), a[0], set, o.unset || [], kind);
    if (op.op === 'addNode') { if (o.label !== undefined) op.label = o.label; if (o.summary !== undefined) op.attrs = { ...op.attrs, summary: o.summary }; }
    if (op.op === 'setNode') { if (o.label !== undefined) op.label = o.label; if (o.summary !== undefined) op.set = { ...op.set, summary: o.summary }; }
    const k = op.op === 'addNode' ? op.attrs.kind : styleKindOf(uni, a[0]);
    return commitOp(op, `${op.op === 'addNode' ? '+' : '~'} ${k === 'edgeType' ? '边' : '节点'}类型 ${a[0]}  ${Object.entries(set).map(([x, y]) => `${x}=${y}`).join(' ')}${(o.unset || []).length ? ' −' + o.unset.join(',') : ''}`, c);
  },
});
defCmd('stamp', {
  group: '宇宙', effect: 'write', title: '说明仍然有效:记下节点指向的文件现在的版本(写说明时会自动记)', usage: 'stamp <id> … · stamp --all(有说明、还没记过版本的全部记上)', bools: ['all'], args: [nodeArg()], more: true,
  run: async (a, o, c) => {
    noProposing(c, '确认说明仍然有效');
    const ids = o.all ? data.nodes.filter((n) => n.attrs.summary && !n.attrs.seen && fileOf(n) && n.attrs.missing !== 'true').map((n) => n.id) : a;
    if (!ids.length) { if (o.all) return '没有要记的'; throw new Error('用法:' + CMDS.get('stamp').usage); }
    const r = await stampNodes(ids, (c && c.author) || 'viewer');
    return { out: [...r.stamped.map((id) => `✓ ${id}`), ...r.skipped.map((id) => `跳过 ${id}(不存在、没指向文件,或文件不在)`)].join('\n'), data: r };
  },
});
defCmd('undo', {
  group: '宇宙', effect: 'write', title: '撤销最近一次写入',
  run: async (a, o, c) => {
    noProposing(c, '撤销');
    const r = await api('/api/undo', {}); await waitApplied(r.n); if (!$('review').hidden) rvMsg(`已撤销(操作 #${r.n})`);
    return { out: `已撤销   #${r.n}`, data: { n: r.n } };
  },
});

// ---- 读宇宙(在浏览器里算,不用等服务端)。输出给人看;data 给页面和遥控用 ----
const descNode = (id) => { const n = uni.nodes.get(id); return n ? `${n.id}${n.attrs.type ? ` [${n.attrs.type}]` : ''}  ${n.label}${n.attrs.status === 'proposed' ? '  (proposed)' : ''}` : `${id}  (不存在)`; };
const needUni = () => { if (!uni) throw new Error('宇宙还没载入'); return uni; };
defCmd('show', {
  group: '查询', effect: 'read', title: '节点详情及其所有边', usage: 'show <id>', args: [nodeArg()], more: true,
  run: (a) => {
    need(a, 1, CMDS.get('show'));
    const id = a[0], u = needUni(), n = u.nodes.get(id); if (!n) throw new Error(`节点不存在:${id}`);
    const lines = [descNode(id)], out = [], inn = [];
    for (const e of u.edges.values()) { if (e.from === id) out.push(e); if (e.to === id) inn.push(e); }
    for (const [k, v] of Object.entries(n.attrs)) if (k !== 'type') lines.push(`  ${k}: ${v}`);
    for (const e of out) lines.push(`  → -${e.type}-> ${e.to}${e.attrs.status ? ` (${e.attrs.status})` : ''}`);
    for (const e of inn) lines.push(`  ← ${e.from} -${e.type}->`);
    return { out: lines.join('\n'), data: { node: n, out, in: inn } };
  },
});
defCmd('nb', {
  group: '查询', effect: 'read', title: '邻域', usage: 'nb <id> [--depth N] [--dir out|in|both] [-t 边类型]', flags: { depth: 'depth', dir: 'dir', t: 'type' }, args: [nodeArg()], more: true,
  run: (a, o) => {
    need(a, 1, CMDS.get('nb'));
    const id = a[0], u = needUni(); if (!u.nodes.has(id)) throw new Error(`节点不存在:${id}`);
    const nb = neighborhood(u, id, { depth: Number(o.depth ?? 1), dir: o.dir ?? 'both', type: o.type });
    const list = [...nb.dist].sort((x, y) => x[1] - y[1]);
    return { out: list.map(([nid, d]) => '  '.repeat(d) + descNode(nid)).join('\n'), data: list.map(([nid, d]) => ({ id: nid, depth: d })) };
  },
});
defCmd('path', {
  group: '查询', effect: 'read', title: '最短路径', usage: 'path <a> <b> [-t 边类型]', flags: { t: 'type' }, args: [nodeArg('a'), nodeArg('b')], more: true,
  run: (a, o) => {
    need(a, 2, CMDS.get('path'));
    const p = shortestPath(needUni(), a[0], a[1], { type: o.type });
    if (p === null) return { out: '不可达', data: null };
    return { out: [a[0], ...p.map((st) => `${st.forward ? `-${st.edge.type}->` : `<-${st.edge.type}-`} ${st.to}`)].join(' '),
      data: { from: a[0], steps: p.map((st) => ({ type: st.edge.type, forward: st.forward, to: st.to })) } };
  },
});
defCmd('ls', {
  group: '查询', effect: 'read', title: '列节点', usage: 'ls [-t 类型] [-q 文本] [-w k=v …] [--orphans]', flags: { t: 'type', q: 'q', w: 'where' }, multi: ['where'], bools: ['orphans'],
  run: (a, o) => {
    const u = needUni(), ns = filterNodes(u, { type: o.type, where: kvs(o.where), orphans: o.orphans, text: o.q ?? (a.join(' ') || undefined) });
    return { out: (ns.slice(0, 300).map((n) => descNode(n.id)).join('\n') || '(空)') + (ns.length > 300 ? `\n… 共 ${ns.length} 个,只列前 300` : ''), data: ns };
  },
});
defCmd('log', {
  group: '查询', effect: 'read', title: '操作日志', usage: 'log [-n 20]', flags: { n: 'n' },
  run: (a, o) => { const l = data.log.slice(-Number(o.n ?? 20)); return { out: l.map((e) => `#${e.n} ${e.author.padEnd(8)} ${summ(e)}`).join('\n') || '(无记录)', data: l }; },
});
defCmd('lint', {
  group: '查询', effect: 'read', title: '体检结果', run: () => ({ out: data.issues.map((i) => `${i.severity.padEnd(5)} ${i.rule.padEnd(20)} ${i.message}`).join('\n') || '✓ 没有问题', data: data.issues }),
});
defCmd('stale', {
  group: '查询', effect: 'read', title: '说明写于文件改动之前的节点(--diff 带上之后的改动)', usage: 'stale [--diff]', bools: ['diff'],
  run: async (a, o) => {
    const list = data.issues.filter((i) => i.rule === 'stale').map((i) => { const n = raw.get(i.nodes[0]); return { id: i.nodes[0], file: n ? fileOf(n) : null, seen: n && n.attrs.seen }; });
    if (o.diff) for (const x of list) x.diff = await api('/api/seen-diff?id=' + encodeURIComponent(x.id)).catch((e) => ({ error: e.message }));
    const out = list.map((x) => `${x.id}  ${x.file || ''}${x.diff ? '\n' + (x.diff.error ? '    ' + x.diff.error : !x.diff.old ? '    (旧版本不在 git 里,看不到改动)' : x.diff.diff.replace(/^/gm, '    ').trimEnd()) : ''}`).join('\n');
    return { out: out || '✓ 没有过期的说明', data: list };
  },
});
const needCompiled = () => { if (!compiled) throw new Error('视图还没算好'); return compiled; };
defCmd('query', {
  group: '查询', effect: 'read', title: '跑一个保存的查询,或直接给一条表达式(和视图规则同一套;from / to / near / out / into / query 是路径条件)', usage: "query <查询名 | 表达式>", more: true,
  args: [{ name: '查询', values: () => (compiled ? compiled.queryResults().map((r) => r.name) : []) }],
  run: (a) => {
    if (!a.length) throw new Error('用法:' + CMDS.get('query').usage);
    const c = needCompiled(), arg = a.join(' '), saved = c.queryResults().find((r) => r.name === arg);
    if (saved && saved.error) throw new Error(saved.error);
    const ids = saved ? saved.members : c.matches(arg);
    return { out: ids.length ? ids.slice(0, 300).map(descNode).join('\n') + `\n(共 ${ids.length} 个${ids.length > 300 ? ',只列前 300' : ''})` : '(没有匹配的)', data: ids };
  },
});
defCmd('queries', {
  group: '查询', effect: 'read', title: '列出保存的查询和各自的匹配数',
  run: () => {
    const res = needCompiled().queryResults();
    return { out: res.map((r) => `${r.name.padEnd(16)} ${r.error ? '错误:' + r.error : String(r.members.length).padStart(5) + ' 个'}   ${r.expr}`).join('\n') || "(还没有保存的查询;过滤框里写 = 表达式,再点「存为查询」)", data: res.map((r) => ({ name: r.name, label: r.label, expr: r.expr, count: r.members.length, error: r.error })) };
  },
});
defCmd('scripts', {
  group: '查询', effect: 'read', title: '列出脚本节点:触发、最近一次运行',
  run: () => {
    const defs = listScripts(needUni());
    return {
      out: defs.map((d) => { const r = raw.get(RUN_PREFIX + d.name); return `${d.name.padEnd(16)} ${describeTriggers(d)}${d.file ? `  [${d.file}]` : ''}${r ? `   上次 ${r.attrs.status} ${ago(Date.parse(r.attrs.t))}` : '   还没跑过'}${d.problems.length ? '\n  ✗ ' + d.problems.join(';') : ''}`; }).join('\n')
        || "(还没有脚本节点;script-set 名字 --code 'export default async (stars) => { … }' -a on=change)",
      data: defs.map((d) => ({ name: d.name, triggers: describeTriggers(d), file: d.file, problems: d.problems })),
    };
  },
});
defCmd('rules', {
  group: '查询', effect: 'read', title: '列出自定义体检规则和各自命中的数目',
  run: () => {
    const c = needCompiled();
    const rows = data.nodes.filter((n) => n.id.startsWith('~rule/') && n.attrs.kind === 'rule' && n.attrs.expr).map((n) => {
      let count; try { count = c.matches(n.attrs.expr).length; } catch (e) { count = '错误:' + e.message; }
      return { name: n.id.slice(6), expr: n.attrs.expr, level: n.attrs.level || 'warn', message: n.attrs.message || n.attrs.summary || n.label, count };
    });
    return { out: rows.map((r) => `${r.name.padEnd(16)} ${String(r.count).padStart(5)}  ${r.level.padEnd(5)} ${r.message}   ${r.expr}`).join('\n') || '(还没有自定义规则;rule-set <名字> --expr "<表达式>" -s 提示)', data: rows };
  },
});
defCmd('types', {
  group: '查询', effect: 'read', title: '节点类型、边类型:用量与样式(✎ 在「类型」面板里改)',
  run: () => {
    const t = styleTypes(needUni());
    const fmt = (x) => `  ${x.name.padEnd(14)} ${String(x.count).padStart(6)}  ${Object.entries(x.style).map(([k, v]) => `${k}=${v}`).join(' ') || '(默认样式)'}${x.label !== x.name ? '  ' + x.label : ''}${x.declared ? '' : '   (还没有类型节点)'}`;
    return { out: ['节点类型', ...t.nodes.map(fmt), '边类型', ...t.edges.map(fmt)].join('\n'), data: t };
  },
});
defCmd('views', { group: '查询', effect: 'read', title: '列出视图', run: () => ({ out: viewNames.map((v, i) => `${i + 1}. ${v}${v === currentView ? '   ← 当前' : ''}`).join('\n'), data: { current: currentView, names: viewNames } }) });

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
