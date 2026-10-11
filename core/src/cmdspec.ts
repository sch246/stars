// 一张命令表:每条命令的名字、用法、说明、认哪些选项、读还是写、参数怎么补全,只写在这里。
// CLI 的帮助(stars help)、选项检查、内核命令的用法提示、Node 脚本(stars.exec / stars.cmd)、查看器里同名的命令
// (控制台、命令面板、补全、页面桥的授权)都从它来。浏览器和 Node 共用(不依赖 Node)。
// 内核命令(where: 'kernel')只有一份实现:core/src/commands.ts。查看器里的写命令转给服务端(/api/cmd)执行,
// 自己只加界面上的那部分(确认框、提示、用选中的东西补参数、页面「提议」级的检查);读命令在查看器里对它手上那份宇宙算。

/** 选项:和 node:util 的 parseArgs 同一种写法 */
export const CMD_OPTIONS = {
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
  script: { type: 'string' },
  params: { type: 'string' },
  base: { type: 'string' },
  code: { type: 'string' },
  expr: { type: 'string' },
  from: { type: 'string' },
  n: { type: 'string', short: 'n' },
  'no-agent': { type: 'boolean' },
  reverse: { type: 'boolean' },
  top: { type: 'boolean' },
  'node-only': { type: 'boolean' },
  force: { type: 'boolean' },
  name: { type: 'string' },
  rel: { type: 'string' },
  'read-only': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;
export type CmdOption = keyof typeof CMD_OPTIONS;
/** 哪条命令都认的(全局选项) */
export const CMD_GLOBALS: readonly CmdOption[] = ['file', 'author', 'json', 'draft', 'help'];

/** 位置参数怎么补全:节点、边类型、节点类型、两种类型、视图、保存的查询、脚本节点、项目里的文件,或者给定的几个值 */
export type ArgKind = 'node' | 'edgeType' | 'nodeType' | 'type' | 'view' | 'query' | 'script' | 'file' | readonly string[];

export interface CmdSpec {
  name: string;
  /** 帮助里的分组 */
  group: '写入' | '读取' | '视图与规则' | '脚本' | '同步与服务' | '遥控';
  /** kernel = 内核命令(CLI、Node 脚本、查看器都能用);cli = 只在命令行里 */
  where: 'kernel' | 'cli';
  /** read / write = 读写宇宙(页面桥按它授权);local = 只给你自己用(开服务、跑脚本……) */
  effect: 'read' | 'write' | 'local';
  usage: string;
  title: string;
  /** 帮助里多写的几行 */
  more?: readonly string[];
  /** 除了全局选项,还认哪些 */
  opts?: readonly CmdOption[];
  args?: readonly ArgKind[];
}

const CMD_NODE_OPTS = ['type', 'summary', 'ref', 'attr', 'label'] as const;
const CMD_EDGE: readonly ArgKind[] = ['node', 'edgeType', 'node'];

export const CMD_LIST: readonly CmdSpec[] = [
  // ---- 写入 ----
  { name: 'init', group: '写入', where: 'cli', effect: 'local', usage: 'init', title: '用创世文件新建 universe.stars' },
  { name: 'add', group: '写入', where: 'kernel', effect: 'write', usage: 'add <id> [label] [-t 类型] [-s 摘要] [--ref 文件] [-a k=v …] [--proposed]',
    title: '新建节点(--proposed:先只是提议,确认了才算)', opts: [...CMD_NODE_OPTS, 'proposed'] },
  { name: 'set', group: '写入', where: 'kernel', effect: 'write', usage: 'set <id> [-l 标签] [-t 类型] [-s 摘要] [--ref 文件] [-a k=v …] [--unset k …]',
    title: '修改节点', opts: [...CMD_NODE_OPTS, 'unset'], args: ['node'] },
  { name: 'rm', group: '写入', where: 'kernel', effect: 'write', usage: 'rm <id…> [--node-only]',
    title: '删除节点(连带它的边;几个一起删 = 一步撤回)', more: ['文件 / 文件夹连文件一起挪进回收站(.git/stars-trash/ 或 .stars-trash/),undo 搬回来;--node-only 只删节点'],
    opts: ['node-only'], args: ['node'] },
  { name: 'link', group: '写入', where: 'kernel', effect: 'write', usage: 'link <from> <type> <to> [--proposed] [-a k=v …]', title: '建边', opts: ['proposed', 'attr'], args: CMD_EDGE },
  { name: 'unlink', group: '写入', where: 'kernel', effect: 'write', usage: 'unlink <from> <type> <to>', title: '删边', args: CMD_EDGE },
  { name: 'relink', group: '写入', where: 'kernel', effect: 'write', usage: 'relink <from> <type> <to> [--type 新类型] [--reverse]',
    title: '改一条边:换类型和 / 或反向(属性跟着走,一步撤回)', opts: ['type', 'reverse'], args: CMD_EDGE },
  { name: 'mv', group: '写入', where: 'kernel', effect: 'write', usage: 'mv <id…> <容器> [--from 原容器] · mv <id…> --top',
    title: '移动进另一个容器(文件 / 文件夹在磁盘上真的搬,id 跟着改;--top 移到顶层)', opts: ['from', 'top', 'rel'], args: ['node'] },
  { name: 'cp', group: '写入', where: 'kernel', effect: 'write', usage: 'cp <id…> <容器> [--from 原容器]',
    title: '复制进另一个容器(连同里面的东西;文件在磁盘上复制一份)', opts: ['from', 'rel'], args: ['node'] },
  { name: 'ln', group: '写入', where: 'kernel', effect: 'write', usage: 'ln <id…> <容器> [--from 原容器]',
    title: '引用:也放进这个容器(只加一条容器关系,什么都不搬)', opts: ['from', 'rel'], args: ['node'] },
  { name: 'group', group: '写入', where: 'kernel', effect: 'write', usage: 'group [id…] [--name 名字] [--from 上一层] [-t 类型]',
    title: '把同一层的几个打包进一个新域(在文件夹里 = 新文件夹,文件真的搬进去)', more: ['不给 id = 在 --from 里新建一个空域'],
    opts: ['name', 'label', 'type', 'from', 'rel'], args: ['node'] },
  { name: 'ungroup', group: '写入', where: 'kernel', effect: 'write', usage: 'ungroup <域> [--force] [--from 上一层]',
    title: '解散:里面的放回上一层', more: ['重名、磁盘上有图里没有的文件就不做;会丢说明 / 关系时要 --force'], opts: ['force', 'from', 'rel'], args: ['node'] },
  { name: 'accept', group: '写入', where: 'kernel', effect: 'write', usage: 'accept <from> <type> <to> · accept <id>', title: '确认一条 proposed 边;只给 id 就是确认 proposed 节点', args: CMD_EDGE },
  { name: 'stamp', group: '写入', where: 'kernel', effect: 'write', usage: 'stamp <id…> · stamp --all',
    title: '说明仍然有效:记下节点指向的文件现在的版本(写 summary 时会自动记)', more: ['--all 给所有有说明、还没记过版本的节点记上(已经过期的不动)'], opts: ['all'], args: ['node'] },
  { name: 'scan', group: '写入', where: 'kernel', effect: 'write', usage: 'scan [dir] [--under 根节点id]', title: '把目录铺成 dir / file 节点 + contains 边', opts: ['under'], args: ['file'] },
  { name: 'undo', group: '写入', where: 'kernel', effect: 'write', usage: 'undo', title: '撤销最近一次写入' },
  { name: 'draft', group: '写入', where: 'kernel', effect: 'write', usage: 'draft [show | apply | drop [序号…]]',
    title: '草稿:批量改动先不落进宇宙,看过再整批应用(一次提交,一步撤回)或丢弃',
    more: ['写命令带 --draft 就进草稿:stars --draft link a dependsOn b、stars run --draft fix.js、stars scan --draft', '读命令带 --draft 看"应用之后"的样子;查看器里会画出来(新增 / 修改 / 删除)'],
    args: [['show', 'apply', 'drop']] },
  { name: 'imports', group: '写入', where: 'kernel', effect: 'write', usage: 'imports [on|off] [--under 挂载根]',
    title: '代码文件之间的 import 写成 dependsOn 边(via=import;扫描、实时同步跟着更新;手画的不动);不给参数 = 看现在的状态', opts: ['under'], args: [['on', 'off']] },

  // ---- 读取 ----
  { name: 'ls', group: '读取', where: 'kernel', effect: 'read', usage: 'ls [-t 类型] [-w k=v …] [--orphans] [-q 文本] [--edges]', title: '列节点', opts: ['type', 'where', 'orphans', 'q', 'edges'] },
  { name: 'show', group: '读取', where: 'kernel', effect: 'read', usage: 'show <id>', title: '节点详情及其所有边', args: ['node'] },
  { name: 'nb', group: '读取', where: 'kernel', effect: 'read', usage: 'nb <id> [--depth N] [--dir out|in|both] [-t 边类型]', title: '邻域', opts: ['depth', 'dir', 'type'], args: ['node'] },
  { name: 'path', group: '读取', where: 'kernel', effect: 'read', usage: 'path <a> <b> [-t 边类型]', title: '最短路径', opts: ['type'], args: ['node', 'node'] },
  { name: 'lint', group: '读取', where: 'kernel', effect: 'read', usage: 'lint', title: '体检(有 error 时退出码为 1)' },
  { name: 'stale', group: '读取', where: 'kernel', effect: 'read', usage: 'stale [--diff]', title: '说明写于文件改动之前的节点(--diff 带上之后改了什么)', opts: ['diff'] },
  { name: 'query', group: '读取', where: 'kernel', effect: 'read', usage: "query <查询名 | '表达式'>",
    title: '跑一个保存的查询,或直接给一条表达式(和视图规则同一套:属性、degree、信号、fn.名字……)',
    more: ["路径条件:from('auth','dependsOn') 从 auth 顺着边走得到 · to(x, 类型) 走得到 x · near(x, 2) 两步之内",
      "out('dependsOn') / into('dependsOn', x) 边的条数 · query('名字') 在另一个查询里 · stale 说明过期了"], args: ['query'] },
  { name: 'queries', group: '读取', where: 'kernel', effect: 'read', usage: 'queries', title: '列出保存的查询和各自的匹配数' },
  { name: 'log', group: '读取', where: 'kernel', effect: 'read', usage: 'log [-n 20]', title: '操作日志', opts: ['n'] },
  { name: 'types', group: '读取', where: 'kernel', effect: 'read', usage: 'types', title: '节点类型、边类型:用量与样式' },

  // ---- 视图与规则 ----
  { name: 'query-set', group: '视图与规则', where: 'kernel', effect: 'write', usage: "query-set <名字> --expr '<表达式>' [-l 显示名] [-s 说明] [-a color=#rrggbb]",
    title: '保存一个查询(= 动态区域,成员随宇宙变化)', opts: ['expr', 'label', 'summary', 'attr'], args: ['query'] },
  { name: 'views', group: '视图与规则', where: 'kernel', effect: 'read', usage: 'views', title: '列出视图(内置 + 宇宙里 kind=view 的节点)' },
  { name: 'view', group: '视图与规则', where: 'kernel', effect: 'read', usage: 'view <名字> [--depth N] [--max-nodes N] [--expand id,id] [--json] [--spec]',
    title: '计算一个视图并输出场景摘要', more: ['--depth 展开层数 · --max-nodes 节点预算 · --expand 强制展开 · --json 完整场景 · --spec 只看规格'],
    opts: ['depth', 'max-nodes', 'expand', 'spec'], args: ['view'] },
  { name: 'view-set', group: '视图与规则', where: 'kernel', effect: 'write', usage: "view-set <名字> --spec '<JSON>' | --from <文件> | --script <文件.js> [--base 视图] [--params '<JSON>'] [-l 显示名]",
    title: '新建 / 覆盖一个视图(规格会先校验)', more: ['--base 从另一个视图起步 · --script 用视图脚本当模板(.js / .ts;文件不在就写一份骨架)· --params 参数'],
    opts: ['spec', 'from', 'script', 'base', 'params', 'label'], args: ['view'] },
  { name: 'fn-set', group: '视图与规则', where: 'kernel', effect: 'write', usage: "fn-set <名字> --code '(x, y) => …' | --from <文件> [-l 显示名]",
    title: '新建 / 覆盖一个函数节点,视图表达式里用 fn.<名字>(…) 调', opts: ['code', 'from', 'label'] },
  { name: 'rule-set', group: '视图与规则', where: 'kernel', effect: 'write', usage: "rule-set <名字> --expr '<表达式>' [-s 提示] [-a level=warn|error|info] [-l 显示名]",
    title: '自定义体检规则(存成节点 ~rule/<名字>):命中表达式的节点在 lint / 查看器里各报一条',
    more: ['例:--expr "type == \'file\' && !summary" -s 文件没有说明'], opts: ['expr', 'summary', 'attr', 'label'] },
  { name: 'rules', group: '视图与规则', where: 'kernel', effect: 'read', usage: 'rules', title: '列出自定义规则和各自命中的数目' },
  { name: 'type-set', group: '视图与规则', where: 'kernel', effect: 'write',
    usage: 'type-set <类型> [-a color=#rrggbb] [-a shape=dot|star|nebula|ringed|pulsar] [-a scale=1.5] [--unset 键 …] [-l 名字] [-s 说明]',
    title: '改类型的样式(写到类型节点 ~<类型>,不在就建;没专门规定它的视图里立刻生效)',
    more: ['边类型:-a color=… -a width=2 -a arrow=true|false -a mode=line|faint|hidden'], opts: ['attr', 'unset', 'label', 'summary'], args: ['type'] },

  // ---- 脚本 ----
  { name: 'script-set', group: '脚本', where: 'kernel', effect: 'write',
    usage: "script-set <名字> --code '<JS>' | --from <文件> | --ref <脚本文件> [-a on=change,file:src/**,stale,start] [-a every=10m] [-s 说明] [--unset 键 …]",
    title: '新建 / 修改脚本节点 ~script/<名字>(代码存进节点,或指向文件;触发写在属性里)',
    more: ['-a draft=true 写进草稿 · -a enabled=false 停用 · -a timeout=2m'], opts: ['code', 'from', 'ref', 'attr', 'summary', 'unset', 'label'], args: ['script'] },
  { name: 'scripts', group: '脚本', where: 'kernel', effect: 'read', usage: 'scripts', title: '列出脚本节点:触发、最近一次运行' },
  { name: 'run', group: '脚本', where: 'cli', effect: 'local', usage: 'run <脚本.js|.ts | ~script/名字> [参数…]',
    title: '在 Node 里跑一个脚本;内核命令直接读写宇宙,select / view 这类转给打开着的查看器',
    more: ['脚本可以 export default async (stars, args) => {…},也可以直接写顶层代码(全局有 stars、args)',
      "脚本里调命令:stars.exec('link a dependsOn b')、stars.cmd.link('a', 'dependsOn', 'b', { proposed: true })、stars.graph()、stars.on('change', f)",
      '脚本名之后的参数原样交给脚本;写入的作者默认是 script:<路径>(--author 可改);~script/<名字> 手动跑一个脚本节点'], opts: ['port'] },
  { name: 'agent', group: '脚本', where: 'cli', effect: 'local', usage: 'agent [--watch]', title: '不开查看器,只在后台按触发跑脚本节点(serve 本身也会跑)',
    opts: ['watch', 'mount', 'debounce', 'poll'] },

  // ---- 同步与服务 ----
  { name: 'serve', group: '同步与服务', where: 'cli', effect: 'local', usage: 'serve [--port 4321] [--host 127.0.0.1] [--watch] [--allow-host 域名 …] [--no-agent]',
    title: '启动实时查看器', more: ['--watch 同时实时同步文件系统 · --allow-host 反向代理用(也可用 STARS_ALLOW_HOSTS)· --no-agent 不按触发跑脚本节点'],
    opts: ['port', 'host', 'watch', 'allow-host', 'mount', 'debounce', 'poll', 'no-agent'] },
  { name: 'watch', group: '同步与服务', where: 'cli', effect: 'local', usage: 'watch [--mount repo] [--debounce 80] [--poll 120]',
    title: '监听文件系统,把文件 / 目录的新增、删除、改名实时同步进宇宙(Ctrl-C 退出)', opts: ['mount', 'debounce', 'poll'] },
  { name: 'export', group: '同步与服务', where: 'cli', effect: 'local', usage: 'export <out.html>', title: '导出成一个自包含的 HTML(含查看器与当前宇宙),拷到任何机器双击就能看(只读)' },
  { name: 'merge', group: '同步与服务', where: 'cli', effect: 'local', usage: 'merge <base> <ours> <theirs>', title: '按事实三方合并宇宙文件(git 合并驱动;结果写入 <ours>,有冲突退出码 1)' },
  { name: 'mcp', group: '同步与服务', where: 'cli', effect: 'local', usage: 'mcp [--draft] [--read-only] [--author 名字]',
    title: 'MCP 服务(标准输入输出):把内核命令一条一个暴露成工具,给 Claude Code 这类 AI 客户端用',
    more: ['--draft 写入一律进草稿(你看过再应用)· --read-only 只给读命令 · 写入的作者默认 mcp:<客户端名>',
      '例:claude mcp add stars -- node <core>/src/cli.ts mcp -f <项目>/universe.stars'], opts: ['read-only'] },
  { name: 'install-merge', group: '同步与服务', where: 'cli', effect: 'local', usage: 'install-merge', title: '在当前 git 仓库里启用上面的合并驱动(写 .git/config 和 .gitattributes)' },

  // ---- 遥控 ----
  { name: 'ui', group: '遥控', where: 'cli', effect: 'local', usage: 'ui <命令…> [--port N] [--json]',
    title: '把一行命令发给打开着的查看器页面执行,打印它的输出(查看器里的每个操作都是一条命令,见控制台的 help)',
    more: ['例:stars ui select core/src/view.ts、stars ui "panel timeline"、stars ui param heatLevel 0.05',
      '不带参数时从标准输入逐行读(# 开头的行忽略);--json 每条命令打印一行 {ok, out, data};命令里有 -选项 时整行加引号或写在 -- 之后'], opts: ['port'] },
  { name: 'help', group: '遥控', where: 'cli', effect: 'local', usage: 'help [命令]', title: '列出全部命令;help <命令> 看一条的用法' },
];

export const CMD_TABLE = new Map(CMD_LIST.map((c) => [c.name, c]));
export const KERNEL_NAMES = new Set(CMD_LIST.filter((c) => c.where === 'kernel').map((c) => c.name));

/** 终端里的显示宽度(中文、全角符号算两格) */
export function cmdWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1;
  return w;
}

const CMD_GLOBAL_HELP = [
  ['-f, --file <路径>', '宇宙文件(默认 $STARS_FILE 或 ./universe.stars)'],
  ['--draft', '写进草稿(<宇宙文件>.draft),不落进宇宙;读命令看"应用了草稿之后"的样子(见 draft)'],
  ['--author <名字>', '写入者(默认 $STARS_AUTHOR 或 human);AI 请用自己的名字'],
  ['--json', '以 JSON 输出(读取类命令)'],
];

/** stars help 的全文;给 name 就是一条命令的用法 */
export function cmdHelp(name?: string): string {
  if (name) {
    const c = CMD_TABLE.get(name);
    if (!c) return `没有这个命令:${name}(stars help 看全部)`;
    const opts = (c.opts ?? []).map((k) => `--${k}${'short' in CMD_OPTIONS[k] ? ` / -${(CMD_OPTIONS[k] as { short: string }).short}` : ''}`);
    return [`stars ${c.usage}`, `  ${c.title}`, ...(c.more ?? []).map((m) => `  ${m}`), ...(opts.length ? [`  选项:${opts.join('  ')}`] : [])].join('\n');
  }
  const COL = 36, lines = ['stars —— 关系编辑器(内核 CLI)', '', '用法: stars [全局选项] <命令> ...    stars help <命令> 看一条命令的选项'];
  const pad = (s: string) => s + ' '.repeat(Math.max(1, COL - cmdWidth(s)));
  for (const g of ['写入', '读取', '视图与规则', '脚本', '同步与服务', '遥控'] as const) {
    lines.push('', g);
    for (const c of CMD_LIST.filter((x) => x.group === g)) {
      const u = `  ${c.usage}`;
      if (cmdWidth(u) < COL) lines.push(pad(u) + c.title); else lines.push(u, ' '.repeat(COL) + c.title);
      for (const m of c.more ?? []) lines.push(' '.repeat(COL) + m);
    }
  }
  lines.push('', '全局选项');
  for (const [k, v] of CMD_GLOBAL_HELP) lines.push(pad(`  ${k}`) + v);
  return lines.join('\n');
}

/**
 * 按命令表切选项(和 node:util 的 parseArgs 一样:--x v、--x=v、-x v、-xv、布尔、可重复、-- 之后都是位置参数),
 * 再查这条命令认不认这些选项。-0.5 这种负数当位置参数。出错抛普通 Error。
 */
export function cmdParse(name: string, tokens: readonly string[]): { positionals: string[]; values: Record<string, string | boolean | string[]> } {
  const spec = CMD_TABLE.get(name);
  const allowed = new Set<string>([...CMD_GLOBALS, ...(spec?.opts ?? [])]);
  const byShort = new Map<string, CmdOption>();
  for (const [k, d] of Object.entries(CMD_OPTIONS)) if ('short' in d) byShort.set(d.short, k as CmdOption);
  const positionals: string[] = [], values: Record<string, string | boolean | string[]> = {};
  const set = (k: CmdOption, v: string | true, shown: string) => {
    if (!allowed.has(k)) throw new Error(`${name} 不认识选项 ${shown}(用法:${spec ? spec.usage : name})`);
    const d = CMD_OPTIONS[k];
    if (d.type === 'boolean') { if (v !== true) throw new Error(`选项 ${shown} 不带值`); values[k] = true; return; }
    if (v === true) throw new Error(`选项 ${shown} 需要一个值`);
    if ('multiple' in d) ((values[k] ??= []) as string[]).push(v); else values[k] = v;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === '--') { positionals.push(...tokens.slice(i + 1)); break; }
    if (t.startsWith('--') && t.length > 2) {
      const eq = t.indexOf('='), k = (eq < 0 ? t.slice(2) : t.slice(2, eq)) as CmdOption;
      if (!(k in CMD_OPTIONS)) throw new Error(`${name} 不认识选项 --${k}(用法:${spec ? spec.usage : name})`);
      if (eq >= 0) set(k, t.slice(eq + 1), `--${k}`);
      else if (CMD_OPTIONS[k].type === 'boolean') set(k, true, `--${k}`);
      else { const v = tokens[i + 1]; if (v === undefined) throw new Error(`选项 --${k} 需要一个值`); set(k, v, `--${k}`); i++; }
      continue;
    }
    if (t.startsWith('-') && t.length > 1 && !/^-\d/.test(t)) {
      const k = byShort.get(t[1]!);
      if (!k) throw new Error(`${name} 不认识选项 ${t}(用法:${spec ? spec.usage : name})`);
      if (CMD_OPTIONS[k].type === 'boolean') { set(k, true, t); continue; }
      if (t.length > 2) { set(k, t.slice(2), `-${t[1]}`); continue; }
      const v = tokens[i + 1]; if (v === undefined) throw new Error(`选项 ${t} 需要一个值`);
      set(k, v, t); i++;
      continue;
    }
    positionals.push(t);
  }
  return { positionals, values };
}
