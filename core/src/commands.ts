// 内核命令:读写宇宙文件、不需要查看器的那一批(add / link / ls / show / nb …)。
// CLI(stars <命令>)和 Node 脚本(stars run x.js 里的 stars.exec / stars.cmd)都走这里:返回 { out, data },
// out 给人看,data 给程序(--json 打印的就是它)。选项的写法与 CLI 相同,定义在 CLI_OPTIONS。
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { type ParseArgsConfig } from 'node:util';
import { loadSignals } from './activity.ts';
import { checkExpr, compileFn } from './expr.ts';
import { RULE_PREFIX, lint, listRules } from './lint.ts';
import { StarsError, type Attrs, type Universe } from './model.ts';
import { type Op } from './ops.ts';
import { filterNodes, neighborhood, shortestPath, type Dir } from './query.ts';
import { listFiles, planScan, selfRel, statMeta } from './scan.ts';
import { planStamp, seenDiff, seenPath, seenState, stampOnSummary } from './stale.ts';
import { applyDraft, readDraft, Store, updateDraft } from './store.ts';
import { draftPreview, draftSummary } from './draft.ts';
import { styleKindOf, styleOp, styleTypes, type StyleKind, type StyleTypeInfo } from './styles.ts';
import { BUILTIN_VIEWS, QUERY_PREFIX, compileView, evaluateView, listQueries, listViews, validateSpec } from './view.ts';

/** CLI 的全部选项(全局选项 + 各命令的选项);脚本里的 stars.exec 也按它解析 */
export const CLI_OPTIONS = {
  file: { type: 'string', short: 'f' },
  author: { type: 'string' },
  json: { type: 'boolean' },
  type: { type: 'string', short: 't' },
  summary: { type: 'string', short: 's' },
  label: { type: 'string', short: 'l' },
  ref: { type: 'string' },
  attr: { type: 'string', short: 'a', multiple: true },
  unset: { type: 'string', multiple: true },
  where: { type: 'string', short: 'w', multiple: true },
  proposed: { type: 'boolean' },
  all: { type: 'boolean' },
  diff: { type: 'boolean' },
  draft: { type: 'boolean' },
  orphans: { type: 'boolean' },
  edges: { type: 'boolean' },
  q: { type: 'string', short: 'q' },
  depth: { type: 'string' },
  'max-nodes': { type: 'string' },
  expand: { type: 'string' },
  dir: { type: 'string' },
  under: { type: 'string' },
  port: { type: 'string' },
  watch: { type: 'boolean' },
  mount: { type: 'string' },
  debounce: { type: 'string' },
  poll: { type: 'string' },
  host: { type: 'string' },
  'allow-host': { type: 'string', multiple: true },
  spec: { type: 'string' },
  code: { type: 'string' },
  expr: { type: 'string' },
  from: { type: 'string' },
  n: { type: 'string', short: 'n' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies ParseArgsConfig['options'];

export type CliOpts = {
  [K in keyof typeof CLI_OPTIONS]?: (typeof CLI_OPTIONS)[K] extends { multiple: true } ? string[]
    : (typeof CLI_OPTIONS)[K]['type'] extends 'boolean' ? boolean : string
};

export interface KernelCtx { store: Store; author: string; /** 项目根目录(体检查文件、扫描、信号) */ root: string }
export interface CmdOut { out: string; data?: unknown; exitCode?: number }

export const KERNEL_COMMANDS = new Set(['add', 'set', 'rm', 'link', 'unlink', 'accept', 'stamp', 'scan', 'undo', 'ls', 'show', 'nb', 'path', 'lint', 'stale', 'log', 'views', 'view', 'view-set', 'fn-set', 'query', 'query-set', 'queries', 'draft', 'types', 'type-set', 'rule-set', 'rules']);

function kv(list: string[] | undefined): Attrs {
  const attrs: Attrs = {};
  for (const item of list ?? []) {
    const eq = item.indexOf('=');
    if (eq <= 0) throw new StarsError(`属性应写成 key=value,得到 "${item}"`);
    attrs[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return attrs;
}

/** 视图规则、查询里用到了哪些信号就去取哪些(git 历史、文件哈希都不便宜)。text = 规格 JSON / 表达式拼起来 */
function signalsFor(text: string, store: Store, root: string, u: Universe): Record<string, Record<string, number>> | undefined {
  const out: Record<string, Record<string, number>> = {};
  if (/"signal"|\btouched\b|\bfileChanged\b/.test(text)) {
    const sg = loadSignals(store.readLog(), u, root);
    out.touched = sg.touched; out.fileChanged = sg.fileChanged;
  }
  if (/\bstale\b/.test(text)) {
    out.stale = {};
    for (const n of u.nodes.values()) if (n.attrs.seen && seenState(root, n.attrs) === 'stale') out.stale[n.id] = 1;
  }
  return Object.keys(out).length ? out : undefined;
}
/** 查询用的编译结果:空规格(contains 当层级,所有边都算度数),所有保存的查询的表达式都算进"用到的信号" */
function queryView(store: Store, root: string, u: Universe, expr = '') {
  const text = [expr, ...listQueries(u).map((q) => q.expr)].join('\n');
  return compileView(u, {}, { signals: signalsFor(text, store, root, u) });
}

export function describeNode(u: Universe, id: string): string {
  const n = u.nodes.get(id);
  if (!n) return `${id}  (不存在)`;
  const t = n.attrs.type ? ` [${n.attrs.type}]` : '';
  return `${n.id}${t}  ${n.label}`;
}

export function summarize(op: Op): string {
  switch (op.op) {
    case 'addNode': return `+node ${op.id}`;
    case 'removeNode': return `-node ${op.id}`;
    case 'setNode': return `~node ${op.id}`;
    case 'addEdge': return `+edge ${op.from} -${op.type}-> ${op.to}`;
    case 'removeEdge': return `-edge ${op.from} -${op.type}-> ${op.to}`;
    case 'setEdge': return `~edge ${op.from} -${op.type}-> ${op.to}`;
    case 'renameNodes': return `↔ 改名 ×${op.pairs.length}`;
    case 'batch': return `batch ×${op.ops.length}`;
  }
}

/** 执行一条内核命令。出错抛 StarsError(用法、节点不存在……) */
export function runKernel(cmd: string, args: string[], o: CliOpts, ctx: KernelCtx): CmdOut {
  const { store } = ctx, c = { author: ctx.author };
  const need = (n: number, usage: string) => { if (args.length < n) throw new StarsError(`用法: stars ${usage}`); };
  const nodeAttrs = () => {
    const attrs = kv(o.attr);
    if (o.type !== undefined) attrs.type = o.type;
    if (o.summary !== undefined) attrs.summary = o.summary;
    if (o.ref !== undefined) attrs.file = o.ref;
    return attrs;
  };
  const wrote = (op: Op, out: string): CmdOut => {
    const e = store.commit(op, c).entry;
    return e.draft ? { out: `${out}   (草稿 #${e.draft})`, data: { draft: e.draft } } : { out, data: { n: e.n } };
  };
  /** 写了 summary 的节点顺手记下文件版本(见 stale.ts) */
  const described = (op: Op): Op => stampOnSummary(store.peek(), op, ctx.root);
  switch (cmd) {
    case 'add': {
      need(1, 'add <id> [label]');
      const attrs = nodeAttrs();
      if (o.proposed) attrs.status = 'proposed';
      return wrote(described({ op: 'addNode', id: args[0]!, label: args[1] ?? o.label ?? args[0]!, attrs }), `+ ${args[0]}${o.proposed ? '  (proposed)' : ''}`);
    }
    case 'set':
      need(1, 'set <id> [-l 标签] [-a k=v] [--unset k]');
      return wrote(described({ op: 'setNode', id: args[0]!, label: o.label, set: nodeAttrs(), unset: o.unset }), `~ ${args[0]}`);
    case 'rm':
      need(1, 'rm <id>');
      return wrote({ op: 'removeNode', id: args[0]! }, `- ${args[0]}`);
    case 'link': {
      need(3, 'link <from> <type> <to>');
      const attrs = kv(o.attr);
      if (o.proposed) attrs.status = 'proposed';
      return wrote({ op: 'addEdge', from: args[0]!, type: args[1]!, to: args[2]!, attrs }, `+ ${args[0]} -${args[1]}-> ${args[2]}${o.proposed ? '  (proposed)' : ''}`);
    }
    case 'unlink':
      need(3, 'unlink <from> <type> <to>');
      return wrote({ op: 'removeEdge', from: args[0]!, type: args[1]!, to: args[2]! }, `- ${args[0]} -${args[1]}-> ${args[2]}`);
    case 'accept':
      if (args.length === 1) return wrote({ op: 'setNode', id: args[0]!, unset: ['status'] }, `✓ ${args[0]}`);   // 确认一个 proposed 节点
      need(3, 'accept <from> <type> <to>');
      return wrote({ op: 'setEdge', from: args[0]!, type: args[1]!, to: args[2]!, unset: ['status'] }, `✓ ${args[0]} -${args[1]}-> ${args[2]}`);
    case 'stamp': {   // 确认说明仍然有效:记下文件现在的版本
      const u = store.peek();
      const ids = o.all ? [...u.nodes.values()].filter((n) => seenState(ctx.root, n.attrs) === 'untracked').map((n) => n.id) : args;
      if (!o.all) need(1, 'stamp <id> ... | --all');
      const p = planStamp(u, ids, ctx.root);
      const n = p.op ? store.commit(p.op, c).entry.n : undefined;
      const lines = [...p.stamped.map((id) => `✓ ${id}`), ...p.skipped.map((id) => `跳过 ${id}(不存在、没指向文件,或文件不在)`)];
      return { out: lines.join('\n') || '没有要记的', data: { n, stamped: p.stamped, skipped: p.skipped }, exitCode: p.skipped.length && !p.stamped.length ? 1 : 0 };
    }
    case 'scan': {
      const dir = resolve(args[0] ?? '.');
      const rootId = o.under ?? 'repo';
      const op = planScan(store.load(), listFiles(dir, selfRel(dir, store.file)), rootId, basename(dir), statMeta(dir));
      if (op.op === 'batch' && op.ops.length === 0) return { out: '没有新内容', data: { added: 0 } };
      const n = store.commit(op, c).entry.n;
      const added = op.op === 'batch' ? op.ops.length : 0;
      return { out: `已扫描 ${dir}:新增 ${added} 项操作`, data: { n, added } };
    }
    case 'undo': {
      const e = store.undo(c);
      if (e.draft) return { out: `已从草稿里去掉第 ${e.draft} 条(${draftSummary(e.op)})`, data: { draft: e.draft } };
      return { out: `已撤销 #${e.undoOf}`, data: { n: e.n, undoOf: e.undoOf } };
    }
    case 'ls': {
      const u = store.load();
      const nodes = filterNodes(u, { type: o.type, where: kv(o.where), orphans: o.orphans, text: o.q });
      let out = nodes.map((n) => describeNode(u, n.id)).join('\n') || '(空)';
      if (o.edges) out += [...u.edges.values()].map((e) => `\n${e.from} -${e.type}-> ${e.to}`).join('');
      return { out, data: nodes };
    }
    case 'show': {
      need(1, 'show <id>');
      const u = store.load();
      const n = u.nodes.get(args[0]!);
      if (!n) throw new StarsError(`节点不存在: ${args[0]}`);
      const out = [...u.edges.values()].filter((e) => e.from === n.id);
      const inn = [...u.edges.values()].filter((e) => e.to === n.id);
      const lines = [describeNode(u, n.id)];
      for (const [k, v] of Object.entries(n.attrs)) if (k !== 'type') lines.push(`  ${k}: ${v}`);
      for (const e of out) lines.push(`  → -${e.type}-> ${e.to}${e.attrs.status ? ` (${e.attrs.status})` : ''}`);
      for (const e of inn) lines.push(`  ← ${e.from} -${e.type}->`);
      return { out: lines.join('\n'), data: { node: n, out, in: inn } };
    }
    case 'nb': {
      need(1, 'nb <id> [--depth N] [--dir out|in|both]');
      const u = store.load();
      if (!u.nodes.has(args[0]!)) throw new StarsError(`节点不存在: ${args[0]}`);
      const nb = neighborhood(u, args[0]!, { depth: Number(o.depth ?? 1), dir: (o.dir as Dir) ?? 'both', type: o.type });
      return {
        out: [...nb.dist].sort((a, b) => a[1] - b[1]).map(([id, d]) => `${'  '.repeat(d)}${describeNode(u, id)}`).join('\n'),
        data: { nodes: Object.fromEntries(nb.dist), edges: nb.edges },
      };
    }
    case 'path': {
      need(2, 'path <a> <b>');
      const p = shortestPath(store.load(), args[0]!, args[1]!, { type: o.type });
      return { out: p === null ? '不可达' : [args[0], ...p.map((s) => `${s.forward ? `-${s.edge.type}->` : `<-${s.edge.type}-`} ${s.to}`)].join(' '), data: p };
    }
    case 'lint': {
      const issues = lint(store.load(), { baseDir: ctx.root });
      return {
        out: issues.map((i) => `${i.severity.padEnd(5)} ${i.rule.padEnd(20)} ${i.message}`).join('\n') || '✓ 没有问题',
        data: issues, exitCode: issues.some((i) => i.severity === 'error') ? 1 : 0,
      };
    }
    case 'stale': {   // 说明写于文件改动之前的节点;--diff 带上写说明之后的改动
      const u = store.load();
      const list = [...u.nodes.values()].filter((n) => n.attrs.seen && seenState(ctx.root, n.attrs) === 'stale').map((n) => ({
        id: n.id, file: seenPath(n.attrs)!, seen: n.attrs.seen!, summary: n.attrs.summary,
        ...(o.diff ? { diff: seenDiff(ctx.root, n.attrs) ?? undefined } : {}),
      }));
      const out = list.map((x) => `${x.id}  ${x.file}${x.diff ? '\n' + (x.diff.old ? x.diff.diff.replace(/^/gm, '    ').trimEnd() : '    (旧版本不在 git 里,看不到改动)') : ''}`).join('\n');
      return { out: out || '✓ 没有过期的说明', data: list };
    }
    case 'log': {
      const log = store.readLog().slice(-Number(o.n ?? 20));
      return { out: log.map((e) => `#${e.n} ${e.t.slice(11, 19)} ${e.author.padEnd(8)} ${e.undoOf ? `undo #${e.undoOf}` : summarize(e.op)}`).join('\n') || '(无记录)', data: log };
    }
    case 'views': {
      const { specs, errors } = listViews(store.load());
      return {
        out: Object.keys(specs).map((n) => `${n}  (${specs[n]!.look ?? 'galaxy'})`).join('\n') + Object.values(errors).map((e) => `\n错误: ${e}`).join(''),
        data: { views: Object.keys(specs), errors },
      };
    }
    case 'view': {
      need(1, 'view <name>');
      const { specs } = listViews(store.load());
      const spec = specs[args[0]!];
      if (!spec) throw new StarsError(`没有视图 "${args[0]}"(stars views 查看列表)`);
      if (o.spec !== undefined && o.json === undefined) return { out: JSON.stringify(spec, null, 2), data: spec };
      const u0 = store.load();
      const scene = evaluateView(u0, spec, {
        signals: signalsFor(JSON.stringify(spec) + listQueries(u0).map((q) => q.expr).join('\n'), store, ctx.root, u0),
        depth: o.depth !== undefined ? Number(o.depth) : undefined,
        maxNodes: o['max-nodes'] !== undefined ? Number(o['max-nodes']) : undefined,
        expanded: o.expand?.split(',').filter(Boolean),
      });
      const top = [...scene.nodes].sort((a, b) => b.r - a.r).slice(0, 8);
      const modes = scene.edges.reduce<Record<string, number>>((m, e) => ((m[e.mode] = (m[e.mode] ?? 0) + 1), m), {});
      const lifted = scene.edges.filter((e) => e.lifted);
      const folded = scene.nodes.filter((n) => n.container && !n.expanded);
      return {
        out: [`${args[0]}: ${scene.nodes.length} 节点 · ${scene.edges.length} 边 ${JSON.stringify(modes)}`,
          `  收起的容器 ${folded.length} 个;提升(汇总)的边 ${lifted.length} 条`,
          ...top.map((n) => `  ${n.r.toFixed(1).padStart(5)}  ${n.shape.padEnd(6)} ${n.color}  ${n.id}${n.container ? (n.expanded ? '  [展开]' : `  [收起 ×${n.descendants}]`) : ''}${n.value !== undefined ? `  (值 ${n.value})` : ''}`),
          ...lifted.slice(0, 6).map((e) => `  ↑ ${e.from} -${e.type}-> ${e.to}  ×${e.count}`)].join('\n'),
        data: scene,
      };
    }
    case 'view-set': {
      need(1, "view-set <name> --spec '<JSON>' | --from <文件>");
      const text = o.from !== undefined ? readFileSync(resolve(o.from), 'utf8') : o.spec;
      if (text === undefined) throw new StarsError('需要 --spec 或 --from');
      let spec: unknown;
      try { spec = JSON.parse(text); } catch (err) { throw new StarsError(`规格不是合法 JSON: ${(err as Error).message}`); }
      const problems = validateSpec(spec, store.load());
      if (problems.length > 0) throw new StarsError(`规格有问题:\n  - ${problems.join('\n  - ')}`);
      const id = `~view/${args[0]}`, compact = JSON.stringify(spec), u = store.load(), had = u.nodes.has(id);
      const n = store.commit(had ? { op: 'setNode', id, label: o.label, set: { spec: compact } } : { op: 'addNode', id, label: o.label ?? args[0]!, attrs: { kind: 'view', spec: compact } }, c).entry.n;
      return { out: `${had ? '~' : '+'} 视图 ${args[0]}${BUILTIN_VIEWS[args[0]!] ? '(覆盖同名内置视图)' : ''}`, data: { n } };
    }
    case 'fn-set': {
      need(1, "fn-set <name> --code '(x, y) => ...' | --from <文件>");
      const code = (o.from !== undefined ? readFileSync(resolve(o.from), 'utf8') : o.code)?.trim();
      if (!code) throw new StarsError('需要 --code 或 --from');
      if (!/^[\w-]+$/.test(args[0]!)) throw new StarsError('函数名只能含字母、数字、_ 和 -');
      try { compileFn(code, { now: Date.now(), fns: {} }); } catch (err) { throw new StarsError((err as Error).message); }
      const id = `~fn/${args[0]}`, u = store.load(), had = u.nodes.has(id);
      const n = store.commit(had ? { op: 'setNode', id, label: o.label, set: { code } } : { op: 'addNode', id, label: o.label ?? args[0]!, attrs: { kind: 'function', code } }, c).entry.n;
      return { out: `${had ? '~' : '+'} 函数 fn.${args[0]}`, data: { n } };
    }
    case 'rule-set': {   // 自定义体检规则 = 一个节点 ~rule/<名字>:命中表达式的节点各报一条
      need(1, "rule-set <名字> --expr '<表达式>' [-s 提示] [-a level=warn|error|info]");
      const name = args[0]!;
      if (!/^[\p{L}\p{N}_.-]+$/u.test(name)) throw new StarsError('规则名只能含字母、数字、_ . -');
      if (o.expr === undefined || !o.expr.trim()) throw new StarsError("需要 --expr '<表达式>'(命中的节点算有问题),比如 --expr \"type == 'file' && !summary\"");
      const err = checkExpr(o.expr);
      if (err) throw new StarsError(`表达式写错了: ${err}`);
      const u = store.peek();
      let count: number;
      try { count = compileView(u, {}).matches(o.expr).length; } catch (e) { throw new StarsError(`表达式写错了: ${(e as Error).message}`); }
      const set: Attrs = { ...kv(o.attr), expr: o.expr };
      if (set.level !== undefined && !['error', 'warn', 'info'].includes(set.level)) throw new StarsError('level 只能是 error / warn / info');
      if (o.summary !== undefined) set.message = o.summary;
      const id = RULE_PREFIX + name, had = u.nodes.has(id);
      return wrote(had ? { op: 'setNode', id, label: o.label, set } : { op: 'addNode', id, label: o.label ?? name, attrs: { kind: 'rule', ...set } },
        `${had ? '~' : '+'} 规则 ${name}(现在命中 ${count} 个;stars lint 里报出来)`);
    }
    case 'rules': {
      const u = store.peek(), c = compileView(u, {});
      const rows = listRules(u).map((r) => { let n: number | string; try { n = c.matches(r.expr).length; } catch (e) { n = `错误:${(e as Error).message}`; } return { ...r, count: n }; });
      return {
        out: rows.map((r) => `${r.name.padEnd(16)} ${String(r.count).padStart(5)}  ${r.level.padEnd(5)} ${r.message}   ${r.expr}`).join('\n')
          || "(还没有自定义规则;stars rule-set 没说明的文件 --expr \"type == 'file' && !summary\" -s 文件没有说明)",
        data: rows,
      };
    }
    case 'types': {   // 节点类型、边类型:用量与样式
      const t = styleTypes(store.peek());
      const fmt = (x: StyleTypeInfo) => `  ${x.name.padEnd(14)} ${String(x.count).padStart(6)}  ${Object.entries(x.style).map(([k, v]) => `${k}=${v}`).join(' ') || '(默认样式)'}`
        + `${x.label !== x.name ? `  ${x.label}` : ''}${x.declared ? '' : '   (还没有类型节点)'}`;
      return {
        out: ['节点类型', ...t.nodes.map(fmt), '边类型', ...t.edges.map(fmt),
          'stars type-set <类型> -a color=#rrggbb -a shape=ringed -a scale=1.5 改节点类型 · -a width=2 -a arrow=false -a mode=faint 改边类型(没专门规定它的视图里立刻生效)'].join('\n'),
        data: t,
      };
    }
    case 'type-set': {   // 改类型的样式:写到类型节点 ~<类型> 上(不在就建)
      need(1, 'type-set <类型> [-a color=#rrggbb] [-a shape=dot|star|nebula|ringed|pulsar] [-a scale=1.5] [-a width=2] [-a arrow=true|false] [-a mode=line|faint|hidden] [--unset 键 …] [-l 名字] [-s 说明]');
      const set = kv(o.attr), u = store.peek();
      let kind: StyleKind | undefined;
      if (set.kind !== undefined) {
        if (set.kind !== 'nodeType' && set.kind !== 'edgeType') throw new StarsError('kind 只能是 nodeType / edgeType');
        kind = set.kind; delete set.kind;
      }
      if (!Object.keys(set).length && !o.unset?.length && o.label === undefined && o.summary === undefined) throw new StarsError('要改什么?比如 stars type-set module -a color=#bd00ff -a shape=ringed');
      const op = styleOp(u, args[0]!, set, o.unset ?? [], kind);
      if (op.op === 'addNode') { if (o.label !== undefined) op.label = o.label; if (o.summary !== undefined) op.attrs = { ...op.attrs, summary: o.summary }; }
      if (op.op === 'setNode') { if (o.label !== undefined) op.label = o.label; if (o.summary !== undefined) op.set = { ...op.set, summary: o.summary }; }
      const k = op.op === 'addNode' ? op.attrs?.kind : styleKindOf(u, args[0]!);
      return wrote(op, `${op.op === 'addNode' ? '+' : '~'} ${k === 'edgeType' ? '边' : '节点'}类型 ${args[0]}  ${Object.entries(set).map(([a, b]) => `${a}=${b}`).join(' ')}${o.unset?.length ? ` −${o.unset.join(',')}` : ''}`);
    }
    case 'draft': {   // 草稿(批量改动的预览):看 / 整批应用 / 丢弃
      const sub = args[0] ?? 'show';
      if (sub === 'apply') {
        const r = applyDraft(store, c);
        return { out: `已应用草稿:${r.count} 条改动作为一次提交 #${r.n}(stars undo 一步撤回)`, data: r };
      }
      if (sub === 'drop') {
        return updateDraft(store.file, (entries) => {
          if (!entries.length) return { entries, result: { out: '草稿是空的', data: { dropped: 0 } } };
          if (args.length === 1) return { entries: [], result: { out: `已丢弃整个草稿(${entries.length} 条)`, data: { dropped: entries.length } } };
          const idx = new Set(args.slice(1).map((x) => Number(x)));
          for (const i of idx) if (!Number.isInteger(i) || i < 1 || i > entries.length) throw new StarsError(`没有第 ${[...args.slice(1)].find((x) => Number(x) === i) ?? i} 条(草稿共 ${entries.length} 条)`);
          return { entries: entries.filter((_, i) => !idx.has(i + 1)), result: { out: `已丢弃 ${idx.size} 条,草稿还剩 ${entries.length - idx.size} 条`, data: { dropped: idx.size } } };
        });
      }
      if (sub !== 'show') throw new StarsError('用法: stars draft [show | apply | drop [序号…]]');
      const entries = readDraft(store.file);
      if (!entries.length) return { out: '草稿是空的(写命令带上 --draft 就进草稿,比如 stars --draft link a dependsOn b、stars run --draft fix.js)', data: { entries: [] } };
      const p = draftPreview(new Store(store.file).load(), entries);
      const bad = new Map(p.failed.map((f) => [f.i, f.error]));
      const authors = [...new Set(entries.map((e) => e.author))];
      const lines = [`草稿:${entries.length} 条改动(${authors.join('、')}),应用之后 +${p.added.size} 节点 ~${p.changed.size} −${p.removed.size} · +${p.addedEdges} 边 −${p.removedEdges}`,
        ...entries.map((e, i) => `  ${String(i + 1).padStart(3)}  ${draftSummary(e.op)}${bad.has(i) ? `   ✗ 现在做不了:${bad.get(i)}` : ''}`),
        `stars draft apply 整批应用(之后 stars undo 一步撤回) · stars draft drop [序号…] 丢弃`];
      return {
        out: lines.join('\n'),
        data: { entries, added: [...p.added], changed: [...p.changed], removed: [...p.removed], addedEdges: p.addedEdges, removedEdges: p.removedEdges, failed: p.failed },
      };
    }
    case 'query': {   // 跑一个保存的查询,或者直接给一条表达式
      need(1, "query <查询名 | '表达式'>");
      const u = store.load(), arg = args.join(' '), saved = u.nodes.get(QUERY_PREFIX + arg);
      const expr = saved?.attrs.kind === 'query' && saved.attrs.expr !== undefined ? saved.attrs.expr : arg;
      const bad = checkExpr(expr);
      if (bad) throw new StarsError(`表达式写错了: ${bad}`);
      let ids: string[];
      try { ids = queryView(store, ctx.root, u, expr).matches(expr); } catch (err) { throw new StarsError((err as Error).message); }
      return { out: ids.length ? `${ids.slice(0, 300).map((id) => describeNode(u, id)).join('\n')}\n(共 ${ids.length} 个${ids.length > 300 ? ',只列前 300' : ''})` : '(没有匹配的)', data: ids };
    }
    case 'query-set': {
      need(1, "query-set <名字> --expr '<表达式>' [-l 显示名] [-s 说明] [-a color=#rrggbb]");
      const name = args[0]!, expr = (o.expr ?? args.slice(1).join(' ')).trim();
      if (!/^[\p{L}\p{N}_.-]+$/u.test(name)) throw new StarsError('查询名只能含字母、数字、_ . -');
      if (!expr) throw new StarsError('需要 --expr');
      const bad = checkExpr(expr);
      if (bad) throw new StarsError(`表达式写错了: ${bad}`);
      const u = store.load();
      let count: number;
      try { count = queryView(store, ctx.root, u, expr).matches(expr).length; } catch (err) { throw new StarsError((err as Error).message); }
      const id = QUERY_PREFIX + name, had = u.nodes.has(id);
      const set: Attrs = { ...kv(o.attr), expr };
      if (o.summary !== undefined) set.summary = o.summary;
      const n = store.commit(had ? { op: 'setNode', id, label: o.label, set } : { op: 'addNode', id, label: o.label ?? name, attrs: { kind: 'query', ...set } }, c).entry.n;
      return { out: `${had ? '~' : '+'} 查询 ${name}(现在匹配 ${count} 个)`, data: { n, count } };
    }
    case 'queries': {
      const u = store.load(), res = queryView(store, ctx.root, u).queryResults();
      return {
        out: res.map((q) => `${q.name.padEnd(16)} ${q.error ? `错误: ${q.error}` : `${String(q.members.length).padStart(5)} 个`}   ${q.expr}`).join('\n') || "(还没有保存的查询;stars query-set <名字> --expr '<表达式>')",
        data: res.map((q) => ({ name: q.name, label: q.label, expr: q.expr, count: q.members.length, error: q.error })),
      };
    }
    default:
      throw new StarsError(`不是内核命令: ${cmd}`);
  }
}
