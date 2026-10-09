#!/usr/bin/env node
// stars —— 人和 AI 共用的命令行入口。
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse, serialize } from './format.ts';
import { lint } from './lint.ts';
import { mergeUniverses } from './merge.ts';
import { StarsError, getEdge, type Attrs, type Universe } from './model.ts';
import { filterNodes, neighborhood, shortestPath, type Dir } from './query.ts';
import { listFiles, planScan, selfRel, statMeta } from './scan.ts';
import { execFileSync } from 'node:child_process';
import { loadSignals } from './activity.ts';
import { compileFn } from './expr.ts';
import { BUILTIN_VIEWS, evaluateView, listViews, validateSpec } from './view.ts';
import { exportHtml } from './exporter.ts';
import { FsWatcher } from './watch.ts';
import { startServer } from './serve.ts';
import { pickServer } from './config.ts';
import { Store } from './store.ts';

const HELP = `stars —— 关系编辑器(内核 CLI)

用法: stars [全局选项] <命令> ...

写入
  init                               用创世文件新建 universe.stars
  add <id> [label]                   新建节点   [-t 类型] [-s 摘要] [--ref 文件路径] [-a k=v ...] [--proposed]
  set <id>                           修改节点   [-l 标签] [-a k=v ...] [--unset k ...]
  rm <id>                            删除节点(连带其所有边)
  link <from> <type> <to>            建边       [--proposed] [-a k=v ...]
  unlink <from> <type> <to>          删边
  accept <from> <type> <to>          确认一条 proposed 边(只给 <id> 就是确认 proposed 节点)
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
  view <name>                        计算一个视图并输出场景摘要   [--depth N 展开层数] [--max-nodes N 节点预算] [--expand id,id 强制展开] [--json 完整场景]
  view-set <name>                    新建/覆盖一个视图(规格会先校验)   --spec '<JSON>' 或 --from <文件>   [--label 显示名]
  fn-set <name>                      新建/覆盖一个函数节点,供视图表达式里 fn.<name>(...) 调用   --code '<函数表达式>' 或 --from <文件>
  merge <base> <ours> <theirs>       按事实三方合并宇宙文件(git 合并驱动;结果写入 <ours>,有冲突退出码 1)
  install-merge                      在当前 git 仓库里启用上面的合并驱动(写 .git/config 和 .gitattributes)
  watch                              监听文件系统,把文件/目录的新增、删除、重命名实时同步进宇宙(Ctrl-C 退出)  [--mount repo] [--debounce 80] [--poll 120]
  export <out.html>                  导出成一个自包含的 HTML(含查看器与当前宇宙),拷到任何机器双击就能看(只读)
  serve                              启动实时查看器  [--port 4321] [--host 127.0.0.1] [--allow-host 域名 ...(反向代理用,也可用 STARS_ALLOW_HOSTS)] [--watch(同时实时同步文件系统)]

遥控(查看器里的每个操作都是一条命令,见控制台的 help)
  ui <命令…>                         把一行命令发给打开着的查看器页面执行,打印它的输出   [--port N 指定服务]
                                     例:stars ui select core/src/view.ts、stars ui "panel timeline"、stars ui param heatLevel 0.05
                                     不带参数时从标准输入逐行读(# 开头的行忽略),可以当脚本用;命令里有 -选项 时整行加引号或写在 -- 之后

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
      const attrs = nodeAttrs();
      if (o.proposed) attrs.status = 'proposed';
      store.commit({ op: 'addNode', id: args[0]!, label: args[1] ?? o.label ?? args[0]!, attrs }, ctx);
      console.log(`+ ${args[0]}${o.proposed ? '  (proposed)' : ''}`);
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
      if (args.length === 1) {   // 确认一个 proposed 节点
        store.commit({ op: 'setNode', id: args[0]!, unset: ['status'] }, ctx);
        console.log(`✓ ${args[0]}`);
        return;
      }
      need(3, 'accept <from> <type> <to>');
      store.commit({ op: 'setEdge', from: args[0]!, type: args[1]!, to: args[2]!, unset: ['status'] }, ctx);
      console.log(`✓ ${args[0]} -${args[1]}-> ${args[2]}`);
      return;
    }
    case 'scan': {
      const dir = resolve(args[0] ?? '.');
      const rootId = o.under ?? 'repo';
      const op = planScan(store.load(), listFiles(dir, selfRel(dir, store.file)), rootId, basename(dir), statMeta(dir));
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
      const signals = /"signal"|touched|fileChanged/.test(JSON.stringify(spec))
        ? loadSignals(store.readLog(), u0, process.env.STARS_ROOT ?? dirname(file))
        : undefined;
      const scene = evaluateView(u0, spec, {
        signals: signals ? { touched: signals.touched, fileChanged: signals.fileChanged } : undefined,
        depth: o.depth !== undefined ? Number(o.depth) : undefined,
        maxNodes: o['max-nodes'] !== undefined ? Number(o['max-nodes']) : undefined,
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
      const problems = validateSpec(spec, store.load());
      if (problems.length > 0) throw new StarsError(`规格有问题:\n  - ${problems.join('\n  - ')}`);
      const id = `~view/${args[0]}`;
      const compact = JSON.stringify(spec);
      const u = store.load();
      if (u.nodes.has(id)) store.commit({ op: 'setNode', id, label: o.label, set: { spec: compact } }, ctx);
      else store.commit({ op: 'addNode', id, label: o.label ?? args[0]!, attrs: { kind: 'view', spec: compact } }, ctx);
      console.log(`${u.nodes.has(id) ? '~' : '+'} 视图 ${args[0]}${BUILTIN_VIEWS[args[0]!] ? '(覆盖同名内置视图)' : ''}`);
      return;
    }
    case 'fn-set': {
      need(1, "fn-set <name> --code '(x, y) => ...' | --from <文件>");
      const code = (o.from !== undefined ? readFileSync(resolve(o.from), 'utf8') : o.code)?.trim();
      if (!code) throw new StarsError('需要 --code 或 --from');
      if (!/^[\w-]+$/.test(args[0]!)) throw new StarsError('函数名只能含字母、数字、_ 和 -');
      try { compileFn(code, { now: Date.now(), fns: {} }); } catch (err) { throw new StarsError((err as Error).message); }
      const id = `~fn/${args[0]}`, u = store.load();
      if (u.nodes.has(id)) store.commit({ op: 'setNode', id, label: o.label, set: { code } }, ctx);
      else store.commit({ op: 'addNode', id, label: o.label ?? args[0]!, attrs: { kind: 'function', code } }, ctx);
      console.log(`${u.nodes.has(id) ? '~' : '+'} 函数 fn.${args[0]}`);
      return;
    }
    case 'merge': {
      need(3, 'merge <base> <ours> <theirs>');
      const load = (f: string) => parse(existsSync(f) ? readFileSync(f, 'utf8') : '');
      const { universe, conflicts } = mergeUniverses(load(args[0]!), load(args[1]!), load(args[2]!));
      writeFileSync(args[1]!, serialize(universe));
      for (const c of conflicts) console.error(`合并冲突: ${c}`);
      if (conflicts.length > 0) process.exitCode = 1;
      return;
    }
    case 'install-merge': {
      const cli = fileURLToPath(import.meta.url);
      const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
      const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
      git('config', 'merge.stars.name', '星罗宇宙文件:按事实三方合并');
      git('config', 'merge.stars.driver', `node ${JSON.stringify(cli)} merge %O %A %B`);
      // 宇宙文件按事实合并;操作日志只追加,两边各自追加的行取并集即可(否则每次合并都会在日志上冲突)
      const attrs = resolve(root, '.gitattributes');
      const lines = existsSync(attrs) ? readFileSync(attrs, 'utf8').split('\n').map((l) => l.trim()) : [];
      const want = ['*.stars merge=stars', '*.stars.log merge=union'].filter((l) => !lines.includes(l));
      if (want.length) appendFileSync(attrs, (lines.length && lines[lines.length - 1] !== '' ? '\n' : '') + want.join('\n') + '\n');
      console.log(`已启用:merge.stars.driver 写入 ${root}/.git/config(本机配置)${want.length ? `;.gitattributes 新增 ${want.join('、')}(请提交)` : ''}`);
      return;
    }
    case 'export': {
      need(1, 'export <out.html>');
      const html = exportHtml(store, process.env.STARS_ROOT ?? dirname(file));
      writeFileSync(resolve(args[0]!), html);
      console.log(`已导出 ${resolve(args[0]!)}(${(html.length / 1024).toFixed(0)} KB,自包含,只读)`);
      return;
    }
    case 'watch': {
      const w = new FsWatcher(watchOptions());
      const r = w.start();
      console.log(`监听 ${process.env.STARS_ROOT ?? dirname(file)} → ${file}(挂载根 ${o.mount ?? 'repo'})。启动对账 ${r.ms.toFixed(0)}ms: ${describeSync(r)}。Ctrl-C 退出。`);
      process.on('SIGINT', () => { w.stop(); process.exit(0); });
      return;
    }
    case 'ui': {
      remoteUi().catch((err: Error) => { console.error(`错误: ${err.message}`); process.exitCode = 2; });
      return;
    }
    case 'serve': {
      const extra = [...(o['allow-host'] ?? []), ...(process.env.STARS_ALLOW_HOSTS?.split(',') ?? [])].map((h) => h.trim()).filter(Boolean);
      const baseDir = process.env.STARS_ROOT ?? dirname(file);
      const server = startServer(store, Number(o.port ?? 4321), baseDir, o.host ?? '127.0.0.1', console.log, extra, {
        watch: !!o.watch, mountId: o.mount ?? 'repo',
        debounceMs: o.debounce ? Number(o.debounce) : undefined, pollSec: o.poll ? Number(o.poll) : undefined,
      });
      process.on('SIGINT', () => { server.close(); process.exit(0); });
      return;
    }
    default:
      throw new StarsError(`未知命令 "${cmd}"(stars help 查看用法)`);
  }
}

/** stars ui:找到正在运行的服务(~/.config/stars/servers),把命令推给看着这个宇宙的页面,等第一个页面回报结果 */
async function remoteUi(): Promise<void> {
  const quote = (a: string) => (/^[^\s"'\\]+$/.test(a) ? a : JSON.stringify(a));
  let lines: string[];
  if (args.length) lines = [args.length === 1 ? args[0]! : args.map(quote).join(' ')];
  else if (!process.stdin.isTTY) lines = readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  else throw new StarsError('用法: stars ui <命令…>(或从标准输入逐行给命令)');
  const srv = pickServer(file, o.port ? Number(o.port) : undefined);
  const host = srv.host === '0.0.0.0' || srv.host === '::' ? '127.0.0.1' : srv.host.includes(':') ? `[${srv.host}]` : srv.host;
  for (const line of lines) {
    const res = await fetch(`http://${host}:${srv.port}/api/ui`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stars-token': srv.token },
      body: JSON.stringify({ line, file, from: ctx.author }),
    });
    const r = await res.json() as { error?: string; delivered?: number; result?: { ok?: boolean; out?: string; error?: string } | null };
    if (!res.ok) throw new StarsError(r.error ?? `服务返回 ${res.status}`);
    if (!r.delivered) throw new StarsError(`没有打开着的查看器页面(在浏览器里打开 http://${host}:${srv.port})`);
    if (!r.result) { console.log(`已发给 ${r.delivered} 个页面(没等到回报)`); continue; }
    if (r.result.out) console.log(r.result.out);
    if (r.result.ok === false) { console.error(`错误: ${r.result.error ?? '执行失败'}${lines.length > 1 ? `(${line})` : ''}`); process.exitCode = 1; }
  }
}

function watchOptions() {
  return {
    root: process.env.STARS_ROOT ?? dirname(file), mountId: o.mount ?? 'repo', store, log: console.log,
    debounceMs: o.debounce ? Number(o.debounce) : undefined, pollSec: o.poll ? Number(o.poll) : undefined,
  };
}
function describeSync(r: { stats: { added: number; removed: number; renamed: number; missing: number; revived: number } }): string {
  const s = r.stats, parts = [s.added && `+${s.added}`, s.removed && `-${s.removed}`, s.renamed && `↔${s.renamed} 改名`, s.missing && `${s.missing} 缺失`, s.revived && `${s.revived} 恢复`].filter(Boolean);
  return parts.length ? parts.join(' ') : '没有变化';
}

function summarize(op: import('./ops.ts').Op): string {
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
