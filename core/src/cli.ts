#!/usr/bin/env node
// stars —— 人和 AI 共用的命令行入口。
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { CLI_OPTIONS, KERNEL_COMMANDS, runKernel } from './commands.ts';
import { CMD_TABLE, CMD_GLOBALS, cmdHelp } from './cmdspec.ts';
import { viewModulesFor, viewSources } from './viewload.ts';
import { parse, serialize } from './format.ts';
import { mergeUniverses } from './merge.ts';
import { StarsError } from './model.ts';
import { exportHtml } from './exporter.ts';
import { FsWatcher } from './watch.ts';
import { startServer } from './serve.ts';
import { Project } from './project.ts';
import { runScriptNode } from './agent.ts';
import { SCRIPT_PREFIX, scriptDef, type TriggerInfo } from './scriptnode.ts';
import { runNodeScript, sendUi } from './script.ts';
import { DraftStore, readDraft, Store } from './store.ts';


// stars [全局选项] run <脚本> [脚本的参数…]:脚本名之后的一律交给脚本,不当成 stars 的选项
const argv = process.argv.slice(2);
const takesValue = new Set(Object.entries(CLI_OPTIONS).flatMap(([k, d]) => (d.type === 'string' ? ['--' + k, ...('short' in d ? ['-' + d.short] : [])] : [])));
let runAt = -1, scriptAt = -1;
for (let i = 0; i < argv.length; i++) {
  const t = argv[i]!;
  if (t === '--') break;
  if (t.startsWith('-')) { if (takesValue.has(t)) i++; continue; }
  if (t === 'run') runAt = i;
  break;
}
// run 和脚本名之间也可以写 stars 的选项(stars run --draft fix.js)
if (runAt >= 0) for (let i = runAt + 1; i < argv.length; i++) { const t = argv[i]!; if (t.startsWith('-') && t !== '-') { if (takesValue.has(t)) i++; continue; } scriptAt = i; break; }
const cut = runAt < 0 ? argv.length : scriptAt < 0 ? argv.length : scriptAt + 1;
const { values: o, positionals: pos } = parseArgs({ allowPositionals: true, options: CLI_OPTIONS, args: argv.slice(0, cut) });
const scriptArgs = runAt >= 0 ? argv.slice(cut) : [];

const file = resolve(o.file ?? process.env.STARS_FILE ?? 'universe.stars');
// --draft:写进草稿(<宇宙文件>.draft)而不是宇宙;读命令看到的是"应用了草稿之后"的样子
const store = o.draft ? new DraftStore(file) : new Store(file);
const draftNote = () => { const k = readDraft(file).length; if (k) console.error(`(草稿里现在 ${k} 条改动 · stars draft 查看 · stars draft apply 整批应用 · 查看器里可以预览)`); };
const ctx = { author: o.author ?? process.env.STARS_AUTHOR ?? 'human' };
const [cmd, ...args] = pos;

function need(n: number, usage: string): void {
  if (args.length < n) throw new StarsError(`用法: stars ${usage}`);
}
const root = () => process.env.STARS_ROOT ?? dirname(file);

function run(): void {
  if (!cmd || cmd === 'help') { console.log(cmdHelp(args[0])); return; }
  if (o.help) { console.log(cmdHelp(CMD_TABLE.has(cmd) ? cmd : undefined)); return; }
  // 选项按命令表查:这条命令不认的报出来(以前悄悄忽略)
  const spec = CMD_TABLE.get(cmd);
  if (spec) {
    const ok = new Set<string>([...CMD_GLOBALS, ...(spec.opts ?? [])]);
    const bad = Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] !== undefined && !ok.has(k));
    if (bad.length) throw new StarsError(`${cmd} 不认识选项 ${bad.map((k) => '--' + k).join(' ')}(用法:stars ${spec.usage})`);
  }
  if (KERNEL_COMMANDS.has(cmd)) {   // add / link / ls / show …:见 commands.ts(脚本里的 stars.exec 也走它)
    const go = (modules?: Awaited<ReturnType<typeof viewModulesFor>>) => {
      const r = runKernel(cmd, args, o, { store, author: ctx.author, root: root(), modules });
      if (o.json && r.data !== undefined) console.log(JSON.stringify(r.data, null, 2));
      else if (r.out) console.log(r.out);
      if (r.exitCode) process.exitCode = r.exitCode;
      if (o.draft && cmd !== 'draft') draftNote();
    };
    if (cmd !== 'view' || !args[0]) { go(); return; }
    viewModulesFor(store.load(), args[0], root()).then(go)   // 视图脚本要先异步 import 进来
      .catch((err: Error) => { console.error(err instanceof StarsError ? `错误: ${err.message}` : err); process.exitCode = err instanceof StarsError ? 2 : 1; });
    return;
  }
  switch (cmd) {
    case 'init': {
      const genesis = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'genesis.stars'), 'utf8');
      store.create(genesis);
      console.log(`已创建 ${file}`);
      return;
    }
    case 'run': {
      need(1, 'run <脚本.js|.ts | ~script/名字> [参数…]');
      // 脚本节点:~script/<名字>,或者没有这个文件、但有同名的脚本节点
      const target = args[0]!;
      const node = target.startsWith(SCRIPT_PREFIX) ? target.slice(SCRIPT_PREFIX.length)
        : !existsSync(resolve(target)) && store.exists() && scriptDef(new Store(file).peek(), target) ? target : null;
      if (node !== null) {
        let trigger: TriggerInfo | undefined;
        try { trigger = process.env.STARS_TRIGGER ? JSON.parse(process.env.STARS_TRIGGER) as TriggerInfo : undefined; } catch { /* 坏的就当手动 */ }
        runScriptNode(node, { store, file, root: root(), port: o.port ? Number(o.port) : undefined, args: scriptArgs, author: o.author ?? process.env.STARS_AUTHOR, trigger, runId: process.env.STARS_RUN_ID })
          .then((rec) => { if (rec.status !== 'ok') process.exitCode = 1; if (o.draft || rec.draft) draftNote(); })
          .catch((err: Error) => { console.error(err instanceof StarsError ? `错误: ${err.message}` : err); process.exitCode = err instanceof StarsError ? 2 : 1; });
        return;
      }
      const author = o.author ?? process.env.STARS_AUTHOR ?? 'script:' + relative(root(), resolve(args[0]!)).replace(/\\/g, '/');
      runNodeScript(args[0]!, { store, author, root: root(), file, port: o.port ? Number(o.port) : undefined, args: scriptArgs })
        .then(() => { if (o.draft) draftNote(); })
        .catch((err: Error) => { console.error(err instanceof StarsError ? `错误: ${err.message}` : err); process.exitCode = err instanceof StarsError ? 2 : 1; });
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
      const base = process.env.STARS_ROOT ?? dirname(file);
      viewSources(store.load(), base).then((src) => {   // 视图脚本的源码一起打进去
        const html = exportHtml(store, base, src);
        writeFileSync(resolve(args[0]!), html);
        const n = Object.keys(src).length;
        console.log(`已导出 ${resolve(args[0]!)}(${(html.length / 1024).toFixed(0)} KB,自包含,只读${n ? `;带上 ${n} 个视图脚本文件` : ''})`);
      }).catch((err: Error) => { console.error(err instanceof StarsError ? `错误: ${err.message}` : err); process.exitCode = err instanceof StarsError ? 2 : 1; });
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
    case 'agent': {   // 不开查看器,只在后台按触发跑脚本节点(L4);--watch 同时同步文件系统(file:… 触发要它)
      const baseDir = root();
      const p = new Project(store instanceof DraftStore ? new Store(file) : store, baseDir);
      if (o.watch) p.startWatch(o.mount ?? 'repo', console.log, watchOptions());
      const loop = p.startAgent(console.log);
      const auto = loop.scripts().filter((d) => d.enabled && (d.on.length || d.every));
      console.log(`agent 循环:${loop.scripts().length} 个脚本节点,${auto.length} 个有触发${o.watch ? '' : '(没开 --watch:file 触发只认宇宙里文件节点的变化)'} · Ctrl-C 退出`);
      process.on('SIGINT', () => { p.close(); process.exit(0); });
      return;
    }
    case 'serve': {
      const extra = [...(o['allow-host'] ?? []), ...(process.env.STARS_ALLOW_HOSTS?.split(',') ?? [])].map((h) => h.trim()).filter(Boolean);
      const baseDir = process.env.STARS_ROOT ?? dirname(file);
      const server = startServer(store, Number(o.port ?? 4321), baseDir, o.host ?? '127.0.0.1', console.log, extra, {
        watch: !!o.watch, mountId: o.mount ?? 'repo',
        debounceMs: o.debounce ? Number(o.debounce) : undefined, pollSec: o.poll ? Number(o.poll) : undefined,
        agent: !o['no-agent'],
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
  for (const line of lines) {
    const { delivered, result, url } = await sendUi(line, { file, port: o.port ? Number(o.port) : undefined, from: ctx.author });
    if (!delivered) throw new StarsError(`没有打开着的查看器页面(在浏览器里打开 ${url})`);
    if (!result) { console.log(o.json ? JSON.stringify({ ok: null, delivered }) : `已发给 ${delivered} 个页面(没等到回报)`); continue; }
    if (o.json) console.log(JSON.stringify({ ok: result.ok !== false, out: result.out ?? '', data: result.data ?? null, ...(result.error ? { error: result.error } : {}) }));   // 一行一个结果(多条命令就是 NDJSON)
    else if (result.out) console.log(result.out);
    if (result.ok === false) { console.error(`错误: ${result.error ?? '执行失败'}${lines.length > 1 ? `(${line})` : ''}`); process.exitCode = 1; }
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
