#!/usr/bin/env node
// stars —— 人和 AI 共用的命令行入口。
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { CLI_OPTIONS, KERNEL_COMMANDS, runKernel } from './commands.ts';
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
  stamp <id> ...                     说明仍然有效:记下节点指向的文件现在的版本(写 summary 时会自动记)
                                     [--all 给所有有说明、还没记过版本的节点记上(已经过期的不动)]
  scan [dir]                         把目录铺成 dir/file 节点 + contains 边   [--under 根节点id]
  undo                               撤销最近一次操作
  draft [show | apply | drop [序号…]]  草稿:批量改动先不落进宇宙,看过再整批应用(一次提交,一步撤回)或丢弃
                                     写命令带 --draft 就进草稿:stars --draft link a dependsOn b、stars run --draft fix.js、stars scan --draft
                                     读命令带 --draft 看"应用之后"的样子;查看器里会画出来(新增 / 修改 / 删除)

读取
  ls                                 列节点     [-t 类型] [-w k=v ...] [--orphans] [-q 文本] [--edges]
  show <id>                          节点详情及其所有边
  nb <id>                            邻域       [--depth N] [--dir out|in|both] [-t 边类型]
  path <a> <b>                       最短路径
  lint                               体检(有 error 时退出码为 1)
  stale                              说明写于文件改动之前的节点   [--diff 带上之后改了什么]
  query <查询名 | '表达式'>          跑一个保存的查询,或直接给一条表达式(和视图规则同一套:属性、degree、信号、fn.名字……)
                                     路径条件:from('auth','dependsOn') 从 auth 顺着边走得到 · to(x, 类型) 走得到 x · near(x, 2) 两步之内
                                     out('dependsOn') / into('dependsOn', x) 边的条数 · query('名字') 在另一个查询里 · stale 说明过期了
  query-set <名字>                   保存一个查询(= 动态区域,成员随宇宙变化)   --expr '<表达式>' [-l 显示名] [-s 说明] [-a color=#rrggbb]
  queries                            列出保存的查询和各自的匹配数
  log                                操作日志   [-n 20]
  views                              列出视图(内置 + 宇宙里 kind=view 的节点)
  view <name>                        计算一个视图并输出场景摘要   [--depth N 展开层数] [--max-nodes N 节点预算] [--expand id,id 强制展开] [--json 完整场景]
  view-set <name>                    新建/覆盖一个视图(规格会先校验)   --spec '<JSON>' 或 --from <文件>   [--label 显示名]
  fn-set <name>                      新建/覆盖一个函数节点,供视图表达式里 fn.<name>(...) 调用   --code '<函数表达式>' 或 --from <文件>
  rule-set <名字>                    自定义体检规则(存成节点 ~rule/<名字>):命中表达式的节点在 lint / 查看器里各报一条
                                     --expr '<表达式>' [-s 提示] [-a level=warn|error|info]   例:--expr "type == 'file' && !summary" -s 文件没有说明
  rules                              列出自定义规则和各自命中的数目
  types                              节点类型、边类型:用量与样式
  type-set <类型>                    改类型的样式(写到类型节点 ~<类型>,不在就建;没专门规定它的视图里立刻生效)
                                     节点类型 -a color=#rrggbb -a shape=dot|star|nebula|ringed|pulsar -a scale=1.5
                                     边类型 -a color=… -a width=2 -a arrow=true|false -a mode=line|faint|hidden   [--unset 键 …] [-l 名字] [-s 说明]
  merge <base> <ours> <theirs>       按事实三方合并宇宙文件(git 合并驱动;结果写入 <ours>,有冲突退出码 1)
  install-merge                      在当前 git 仓库里启用上面的合并驱动(写 .git/config 和 .gitattributes)
  watch                              监听文件系统,把文件/目录的新增、删除、重命名实时同步进宇宙(Ctrl-C 退出)  [--mount repo] [--debounce 80] [--poll 120]
  export <out.html>                  导出成一个自包含的 HTML(含查看器与当前宇宙),拷到任何机器双击就能看(只读)
  serve                              启动实时查看器  [--port 4321] [--host 127.0.0.1] [--allow-host 域名 ...(反向代理用,也可用 STARS_ALLOW_HOSTS)] [--watch(同时实时同步文件系统)]
                                     [--no-agent(不按触发跑脚本节点,只能手动跑)]

脚本节点与 agent 循环(L4:代码存在宇宙里,手动跑或按触发跑,每次运行都有记录)
  script-set <名字>                  新建 / 修改脚本节点 ~script/<名字>   --code '<JS>' | --from <文件(代码存进节点)> | --ref <脚本文件(节点指向它)>
                                     [-a on=change,file:src/**,stale,start] [-a every=10m] [-a draft=true(写进草稿)] [-a enabled=false] [-a timeout=2m] [-s 说明]
  scripts                            列出脚本节点:触发、最近一次运行
  run ~script/<名字> [参数…]         手动跑一个脚本节点(脚本里 stars.trigger 是这次为什么跑)
  agent                              不开查看器,只在后台按触发跑脚本节点(serve 本身也会跑)   [--watch 同时同步文件系统]

遥控(查看器里的每个操作都是一条命令,见控制台的 help)
  ui <命令…>                         把一行命令发给打开着的查看器页面执行,打印它的输出   [--port N 指定服务] [--json 每条命令打印一行 {ok, out, data}]
                                     例:stars ui select core/src/view.ts、stars ui "panel timeline"、stars ui param heatLevel 0.05
                                     不带参数时从标准输入逐行读(# 开头的行忽略),可以当脚本用;命令里有 -选项 时整行加引号或写在 -- 之后

脚本(JS 里调命令:stars.exec('link a dependsOn b')、stars.cmd.link('a', 'dependsOn', 'b', { proposed: true })、stars.graph()、stars.on('change', f))
  run <脚本.js|.ts> [参数…]          在 Node 里跑一个脚本;内核命令直接读写宇宙,select / view 这类转给打开着的查看器
                                     脚本可以 export default async (stars, args) => {…},也可以直接写顶层代码(全局有 stars、args)
                                     脚本名之后的参数原样交给脚本;写入的作者默认是 script:<路径>(--author 可改)

全局选项
  -f, --file <路径>     宇宙文件(默认 $STARS_FILE 或 ./universe.stars)
  --draft               写进草稿(<宇宙文件>.draft),不落进宇宙;读命令看"应用了草稿之后"的样子(见 draft)
      --author <名字>   写入者(默认 $STARS_AUTHOR 或 human);AI 请用自己的名字
      --json            以 JSON 输出(读取类命令)
`;

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
  if (!cmd || o.help || cmd === 'help') {
    console.log(HELP);
    return;
  }
  if (KERNEL_COMMANDS.has(cmd)) {   // add / link / ls / show …:见 commands.ts(脚本里的 stars.exec 也走它)
    const r = runKernel(cmd, args, o, { store, author: ctx.author, root: root() });
    if (o.json && r.data !== undefined) console.log(JSON.stringify(r.data, null, 2));
    else if (r.out) console.log(r.out);
    if (r.exitCode) process.exitCode = r.exitCode;
    if (o.draft && cmd !== 'draft') draftNote();
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
