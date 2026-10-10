// 内核命令:读写宇宙文件、不需要查看器的那一批(add / link / ls / show / nb …)。
// CLI(stars <命令>)和 Node 脚本(stars run x.js 里的 stars.exec / stars.cmd)都走这里:返回 { out, data },
// out 给人看,data 给程序(--json 打印的就是它)。选项的写法与 CLI 相同,定义在 CLI_OPTIONS。
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { type ParseArgsConfig } from 'node:util';
import { loadSignals } from './activity.ts';
import { compileFn } from './expr.ts';
import { lint } from './lint.ts';
import { StarsError, type Attrs, type Universe } from './model.ts';
import { type Op } from './ops.ts';
import { filterNodes, neighborhood, shortestPath, type Dir } from './query.ts';
import { listFiles, planScan, selfRel, statMeta } from './scan.ts';
import { type Store } from './store.ts';
import { BUILTIN_VIEWS, evaluateView, listViews, validateSpec } from './view.ts';

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

export const KERNEL_COMMANDS = new Set(['add', 'set', 'rm', 'link', 'unlink', 'accept', 'scan', 'undo', 'ls', 'show', 'nb', 'path', 'lint', 'log', 'views', 'view', 'view-set', 'fn-set']);

function kv(list: string[] | undefined): Attrs {
  const attrs: Attrs = {};
  for (const item of list ?? []) {
    const eq = item.indexOf('=');
    if (eq <= 0) throw new StarsError(`属性应写成 key=value,得到 "${item}"`);
    attrs[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return attrs;
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
  const wrote = (op: Op, out: string): CmdOut => ({ out, data: { n: store.commit(op, c).entry.n } });
  switch (cmd) {
    case 'add': {
      need(1, 'add <id> [label]');
      const attrs = nodeAttrs();
      if (o.proposed) attrs.status = 'proposed';
      return wrote({ op: 'addNode', id: args[0]!, label: args[1] ?? o.label ?? args[0]!, attrs }, `+ ${args[0]}${o.proposed ? '  (proposed)' : ''}`);
    }
    case 'set':
      need(1, 'set <id> [-l 标签] [-a k=v] [--unset k]');
      return wrote({ op: 'setNode', id: args[0]!, label: o.label, set: nodeAttrs(), unset: o.unset }, `~ ${args[0]}`);
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
      const signals = /"signal"|touched|fileChanged/.test(JSON.stringify(spec)) ? loadSignals(store.readLog(), u0, ctx.root) : undefined;
      const scene = evaluateView(u0, spec, {
        signals: signals ? { touched: signals.touched, fileChanged: signals.fileChanged } : undefined,
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
    default:
      throw new StarsError(`不是内核命令: ${cmd}`);
  }
}
