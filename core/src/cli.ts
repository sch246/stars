#!/usr/bin/env node
// stars —— 人和 AI 共用的命令行入口。
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { lint } from './lint.ts';
import { StarsError, getEdge, type Attrs, type Universe } from './model.ts';
import { filterNodes, neighborhood, shortestPath, type Dir } from './query.ts';
import { listFiles, planScan, statMeta } from './scan.ts';
import { loadSignals } from './activity.ts';
import { BUILTIN_VIEWS, evaluateView, listViews, validateSpec } from './view.ts';
import { startServer } from './serve.ts';
import { Store } from './store.ts';

const HELP = `stars —— 关系编辑器(内核 CLI)

用法: stars [全局选项] <命令> ...

写入
  init                               用创世文件新建 universe.stars
  add <id> [label]                   新建节点   [-t 类型] [-s 摘要] [--ref 文件路径] [-a k=v ...]
  set <id>                           修改节点   [-l 标签] [-a k=v ...] [--unset k ...]
  rm <id>                            删除节点(连带其所有边)
  link <from> <type> <to>            建边       [--proposed] [-a k=v ...]
  unlink <from> <type> <to>          删边
  accept <from> <type> <to>          确认一条 proposed 边
  scan [dir]                         把目录铺成 dir/file 节点 + contains 边   [--under 根节点id]
  undo                               撤销最近一次操作

读取
  ls                                 列节点     [-t 类型] [-w k=v ...] [--orphans] [-q 文本] [--edges]
  show <id>                          节点详情及其所有边
  nb <id>                            邻域       [--depth N] [--dir out|in|both] [-t 边类型]
  path <a> <b>                       最短路径
  lint                               体检(有 error 时退出码为 1)
  log                                操作日志   [-n 20]
  views                              列出视图(内置 + 宇宙里 kind=view 的节点)
  view <name>                        计算一个视图并输出场景摘要   [--depth N 展开层数] [--expand id,id 强制展开] [--json 完整场景]
  view-set <name>                    新建/覆盖一个视图(规格会先校验)   --spec '<JSON>' 或 --from <文件>   [--label 显示名]
  serve                              启动实时查看器  [--port 4321] [--host 127.0.0.1]

全局选项
  -f, --file <路径>     宇宙文件(默认 $STARS_FILE 或 ./universe.stars)
      --author <名字>   写入者(默认 $STARS_AUTHOR 或 human);AI 请用自己的名字
      --json            以 JSON 输出(读取类命令)
`;

const { values: o, positionals: pos } = parseArgs({
  allowPositionals: true,
  options: {
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
    expand: { type: 'string' },
    dir: { type: 'string' },
    under: { type: 'string' },
    port: { type: 'string' },
    host: { type: 'string' },
    spec: { type: 'string' },
    from: { type: 'string' },
    n: { type: 'string', short: 'n' },
    help: { type: 'boolean', short: 'h' },
  },
});

const file = resolve(o.file ?? process.env.STARS_FILE ?? 'universe.stars');
const store = new Store(file);
const ctx = { author: o.author ?? process.env.STARS_AUTHOR ?? 'human' };
const [cmd, ...args] = pos;

function kv(list: string[] | undefined): Attrs {
  const attrs: Attrs = {};
  for (const item of list ?? []) {
    const eq = item.indexOf('=');
    if (eq <= 0) throw new StarsError(`属性应写成 key=value,得到 "${item}"`);
    attrs[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return attrs;
}

function need(n: number, usage: string): void {
  if (args.length < n) throw new StarsError(`用法: stars ${usage}`);
}

function nodeAttrs(): Attrs {
  const attrs = kv(o.attr);
  if (o.type !== undefined) attrs.type = o.type;
  if (o.summary !== undefined) attrs.summary = o.summary;
  if (o.ref !== undefined) attrs.file = o.ref;
  return attrs;
}

function say(value: unknown, text: () => string): void {
  console.log(o.json ? JSON.stringify(value, null, 2) : text());
}

function describeNode(u: Universe, id: string): string {
  const n = u.nodes.get(id);
  if (!n) return `${id}  (不存在)`;
  const t = n.attrs.type ? ` [${n.attrs.type}]` : '';
  return `${n.id}${t}  ${n.label}`;
}

function run(): void {
  if (!cmd || o.help || cmd === 'help') {
    console.log(HELP);
    return;
  }
  switch (cmd) {
    case 'init': {
      const genesis = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'genesis.stars'), 'utf8');
      store.create(genesis);
      console.log(`已创建 ${file}`);
      return;
    }
    case 'add': {
      need(1, 'add <id> [label]');
      store.commit({ op: 'addNode', id: args[0]!, label: args[1] ?? o.label ?? args[0]!, attrs: nodeAttrs() }, ctx);
      console.log(`+ ${args[0]}`);
      return;
    }
    case 'set': {
      need(1, 'set <id> [-l 标签] [-a k=v] [--unset k]');
      store.commit({ op: 'setNode', id: args[0]!, label: o.label, set: nodeAttrs(), unset: o.unset }, ctx);
      console.log(`~ ${args[0]}`);
      return;
    }
    case 'rm': {
      need(1, 'rm <id>');
      store.commit({ op: 'removeNode', id: args[0]! }, ctx);
      console.log(`- ${args[0]}`);
      return;
    }
    case 'link': {
      need(3, 'link <from> <type> <to>');
      const attrs = kv(o.attr);
      if (o.proposed) attrs.status = 'proposed';
      store.commit({ op: 'addEdge', from: args[0]!, type: args[1]!, to: args[2]!, attrs }, ctx);
      console.log(`+ ${args[0]} -${args[1]}-> ${args[2]}${o.proposed ? '  (proposed)' : ''}`);
      return;
    }
    case 'unlink': {
      need(3, 'unlink <from> <type> <to>');
      store.commit({ op: 'removeEdge', from: args[0]!, type: args[1]!, to: args[2]! }, ctx);
      console.log(`- ${args[0]} -${args[1]}-> ${args[2]}`);
      return;
    }
    case 'accept': {
      need(3, 'accept <from> <type> <to>');
      store.commit({ op: 'setEdge', from: args[0]!, type: args[1]!, to: args[2]!, unset: ['status'] }, ctx);
      console.log(`✓ ${args[0]} -${args[1]}-> ${args[2]}`);
      return;
    }
    case 'scan': {
      const dir = resolve(args[0] ?? '.');
      const rootId = o.under ?? 'repo';
      const op = planScan(store.load(), listFiles(dir), rootId, basename(dir), statMeta(dir));
      if (op.op === 'batch' && op.ops.length === 0) {
        console.log('没有新内容');
        return;
      }
      store.commit(op, ctx);
      console.log(`已扫描 ${dir}:新增 ${op.op === 'batch' ? op.ops.length : 0} 项操作`);
      return;
    }
    case 'undo': {
      const e = store.undo(ctx);
      console.log(`已撤销 #${e.undoOf}`);
      return;
    }
    case 'ls': {
      const u = store.load();
      const nodes = filterNodes(u, { type: o.type, where: kv(o.where), orphans: o.orphans, text: o.q });
      say(nodes, () => nodes.map((n) => describeNode(u, n.id)).join('\n') || '(空)');
      if (o.edges && !o.json) {
        for (const e of u.edges.values()) console.log(`${e.from} -${e.type}-> ${e.to}`);
      }
      return;
    }
    case 'show': {
      need(1, 'show <id>');
      const u = store.load();
      const n = u.nodes.get(args[0]!);
      if (!n) throw new StarsError(`节点不存在: ${args[0]}`);
      const out = [...u.edges.values()].filter((e) => e.from === n.id);
      const inn = [...u.edges.values()].filter((e) => e.to === n.id);
      say({ node: n, out, in: inn }, () => {
        const lines = [describeNode(u, n.id)];
        for (const [k, v] of Object.entries(n.attrs)) if (k !== 'type') lines.push(`  ${k}: ${v}`);
        for (const e of out) lines.push(`  → -${e.type}-> ${e.to}${e.attrs.status ? ` (${e.attrs.status})` : ''}`);
        for (const e of inn) lines.push(`  ← ${e.from} -${e.type}->`);
        return lines.join('\n');
      });
      return;
    }
    case 'nb': {
      need(1, 'nb <id> [--depth N] [--dir out|in|both]');
      const u = store.load();
      if (!u.nodes.has(args[0]!)) throw new StarsError(`节点不存在: ${args[0]}`);
      const nb = neighborhood(u, args[0]!, { depth: Number(o.depth ?? 1), dir: (o.dir as Dir) ?? 'both', type: o.type });
      say({ nodes: Object.fromEntries(nb.dist), edges: nb.edges }, () =>
        [...nb.dist].sort((a, b) => a[1] - b[1]).map(([id, d]) => `${'  '.repeat(d)}${describeNode(u, id)}`).join('\n'));
      return;
    }
    case 'path': {
      need(2, 'path <a> <b>');
      const u = store.load();
      const p = shortestPath(u, args[0]!, args[1]!, { type: o.type });
      say(p, () => (p === null ? '不可达' : [args[0], ...p.map((s) => `${s.forward ? `-${s.edge.type}->` : `<-${s.edge.type}-`} ${s.to}`)].join(' ')));
      return;
    }
    case 'lint': {
      const u = store.load();
      const issues = lint(u, { baseDir: process.env.STARS_ROOT ?? dirname(file) });
      say(issues, () => issues.map((i) => `${i.severity.padEnd(5)} ${i.rule.padEnd(20)} ${i.message}`).join('\n') || '✓ 没有问题');
      if (issues.some((i) => i.severity === 'error')) process.exitCode = 1;
      return;
    }
    case 'log': {
      const log = store.readLog().slice(-Number(o.n ?? 20));
      say(log, () => log.map((e) => `#${e.n} ${e.t.slice(11, 19)} ${e.author.padEnd(8)} ${e.undoOf ? `undo #${e.undoOf}` : summarize(e.op)}`).join('\n') || '(无记录)');
      return;
    }
    case 'views': {
      const { specs, errors } = listViews(store.load());
      say({ views: Object.keys(specs), errors }, () => Object.keys(specs).map((n) => `${n}  (${specs[n]!.look ?? 'galaxy'})`).join('\n') + Object.values(errors).map((e) => `\n错误: ${e}`).join(''));
      return;
    }
    case 'view': {
      need(1, 'view <name>');
      const { specs } = listViews(store.load());
      const spec = specs[args[0]!];
      if (!spec) throw new StarsError(`没有视图 "${args[0]}"(stars views 查看列表)`);
      if (o.spec !== undefined && o.json === undefined) {
        console.log(JSON.stringify(spec, null, 2));
        return;
      }
      const u0 = store.load();
      const signals = JSON.stringify(spec).includes('"signal"')
        ? loadSignals(store.readLog(), u0, process.env.STARS_ROOT ?? dirname(file))
        : undefined;
      const scene = evaluateView(u0, spec, {
        signals: signals ? { touched: signals.touched, fileChanged: signals.fileChanged } : undefined,
        depth: o.depth !== undefined ? Number(o.depth) : undefined,
        expanded: o.expand?.split(',').filter(Boolean),
      });
      say(scene, () => {
        const top = [...scene.nodes].sort((a, b) => b.r - a.r).slice(0, 8);
        const modes = scene.edges.reduce<Record<string, number>>((m, e) => ((m[e.mode] = (m[e.mode] ?? 0) + 1), m), {});
        const lifted = scene.edges.filter((e) => e.lifted);
        const folded = scene.nodes.filter((n) => n.container && !n.expanded);
        return [`${args[0]}: ${scene.nodes.length} 节点 · ${scene.edges.length} 边 ${JSON.stringify(modes)}`,
          `  收起的容器 ${folded.length} 个;提升(汇总)的边 ${lifted.length} 条`,
          ...top.map((n) => `  ${n.r.toFixed(1).padStart(5)}  ${n.shape.padEnd(6)} ${n.color}  ${n.id}${n.container ? (n.expanded ? '  [展开]' : `  [收起 ×${n.descendants}]`) : ''}${n.value !== undefined ? `  (值 ${n.value})` : ''}`),
          ...lifted.slice(0, 6).map((e) => `  ↑ ${e.from} -${e.type}-> ${e.to}  ×${e.count}`)].join('\n');
      });
      return;
    }
    case 'view-set': {
      need(1, "view-set <name> --spec '<JSON>' | --from <文件>");
      const text = o.from !== undefined ? readFileSync(resolve(o.from), 'utf8') : o.spec;
      if (text === undefined) throw new StarsError('需要 --spec 或 --from');
      let spec: unknown;
      try {
        spec = JSON.parse(text);
      } catch (err) {
        throw new StarsError(`规格不是合法 JSON: ${(err as Error).message}`);
      }
      const problems = validateSpec(spec);
      if (problems.length > 0) throw new StarsError(`规格有问题:\n  - ${problems.join('\n  - ')}`);
      const id = `~view/${args[0]}`;
      const compact = JSON.stringify(spec);
      const u = store.load();
      if (u.nodes.has(id)) store.commit({ op: 'setNode', id, label: o.label, set: { spec: compact } }, ctx);
      else store.commit({ op: 'addNode', id, label: o.label ?? args[0]!, attrs: { kind: 'view', spec: compact } }, ctx);
      console.log(`${u.nodes.has(id) ? '~' : '+'} 视图 ${args[0]}${BUILTIN_VIEWS[args[0]!] ? '(覆盖同名内置视图)' : ''}`);
      return;
    }
    case 'serve': {
      startServer(store, Number(o.port ?? 4321), process.env.STARS_ROOT ?? dirname(file), o.host ?? '127.0.0.1');
      return;
    }
    default:
      throw new StarsError(`未知命令 "${cmd}"(stars help 查看用法)`);
  }
}

function summarize(op: import('./ops.ts').Op): string {
  switch (op.op) {
    case 'addNode': return `+node ${op.id}`;
    case 'removeNode': return `-node ${op.id}`;
    case 'setNode': return `~node ${op.id}`;
    case 'addEdge': return `+edge ${op.from} -${op.type}-> ${op.to}`;
    case 'removeEdge': return `-edge ${op.from} -${op.type}-> ${op.to}`;
    case 'setEdge': return `~edge ${op.from} -${op.type}-> ${op.to}`;
    case 'batch': return `batch ×${op.ops.length}`;
  }
}

try {
  run();
} catch (err) {
  if (err instanceof StarsError) {
    console.error(`错误: ${err.message}`);
    process.exitCode = 2;
  } else {
    throw err;
  }
}
