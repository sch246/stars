// 一行命令的切词与拼装:控制台、快捷键、遥控、页面桥、脚本(浏览器里的 run 和 stars run)共用同一套写法,和 CLI 一样。
//   · cmdTokenize:按空白切词;"…" 里可用 \" \\ 转义,'…' 原样
//   · cmdLine:脚本里的结构化调用 → 一行命令。stars.cmd.link('a', 'dependsOn', 'b', { proposed: true }) → link a dependsOn b --proposed
// 浏览器与 Node 共用;静态导出会拼进同一个作用域:顶层名字都以 cmd 开头。

export function cmdTokenize(line: string): string[] {
  const out: string[] = [];
  let cur: string | null = null, q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < line.length) cur += line[++i]!; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur = cur ?? ''; continue; }
    if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } continue; }
    cur = (cur ?? '') + c;
  }
  if (cur !== null) out.push(cur);
  return out;
}

/** 需要时加上双引号(cmdTokenize 能原样切回来) */
export function cmdQuote(s: unknown): string {
  const t = String(s);
  return /^[^\s"'\\]+$/.test(t) ? t : '"' + t.replace(/["\\]/g, '\\$&') + '"';
}

const cmdKebab = (s: string) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const cmdPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 结构化调用 → 一行命令。
 *   · 名字可以写成驼峰:collapseAll → collapse-all
 *   · 最后一个参数是普通对象时当作选项:true → --名字;false / null / undefined → 不写;数组 → 重复写;
 *     对象 → 每一对写成 --名字 k=v(-a / -w 这类);其余 → --名字 值。选项名也可以写驼峰(maxNodes → --max-nodes)
 *   · 位置参数里的 null / undefined 跳过
 */
export function cmdLine(name: string, args: unknown[] = []): string {
  const cmd = cmdKebab(String(name));
  if (!/^[a-z][\w-]*$/.test(cmd)) throw new Error(`不是命令名:${String(name)}`);
  const list = [...args];
  const opts = list.length && cmdPlain(list[list.length - 1]) ? list.pop() as Record<string, unknown> : {};
  const toks = [cmd];
  for (const a of list) if (a !== null && a !== undefined) toks.push(cmdQuote(a));
  for (const [k, v] of Object.entries(opts)) {
    const flag = '--' + cmdKebab(k);
    if (v === true) toks.push(flag);
    else if (v === false || v === null || v === undefined) continue;
    else if (Array.isArray(v)) for (const x of v) toks.push(flag, cmdQuote(x));
    else if (cmdPlain(v)) for (const [ak, av] of Object.entries(v)) toks.push(flag, cmdQuote(`${ak}=${av}`));
    else toks.push(flag, cmdQuote(v));
  }
  return toks.join(' ');
}
