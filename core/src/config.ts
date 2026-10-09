// 个人配置(~/.config/stars,遵守 XDG_CONFIG_HOME):设置与快捷键是 LLF 文件,查看器把它们显示成表单。
//   · 默认值在 core/settings.llf、core/keys.llf(带类型标签,本身就是表单的 schema);个人文件只记改过的项
//   · 写入带"读到时的修改时间",别处改过就拒绝(409),由查看器合并后重试
//   · 正在运行的服务登记在 servers/<端口>.json(含 token,仅本人可读),`stars ui` 靠它找到服务、把命令发给打开着的页面
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { llfParse } from './llf.ts';
import { StarsError } from './model.ts';
import { FileConflict } from './files.ts';

const here = dirname(fileURLToPath(import.meta.url));

export const configDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'stars');

/** 查看器能读写的个人配置 */
export const CONFIG_NAMES = ['settings', 'keys'] as const;
export type ConfigName = (typeof CONFIG_NAMES)[number];
export const isConfigName = (n: unknown): n is ConfigName => CONFIG_NAMES.includes(n as ConfigName);

export const userConfigFile = (name: ConfigName) => join(configDir(), `${name}.llf`);
export const defaultConfigText = (name: ConfigName) => readFileSync(resolve(here, '..', `${name}.llf`), 'utf8');

/** 个人文件第一次创建时的开头(空注释行是分隔:说明不属于第一个条目,删条目时不会被带走) */
export const USER_HEADER: Record<ConfigName, string> = {
  settings: '# 星罗的个人设置:只记你改过的项,结构与默认设置(core/settings.llf)相同。\n# 直接改这个文件也行,保存后打开着的查看器立即生效。\n#\n--LLF-END\n',
  keys: '# 星罗的个人快捷键:同名的键覆盖默认(core/keys.llf),写成 _ 表示取消这个键。\n# 直接改这个文件也行,保存后打开着的查看器立即生效。\n#\nbindings {}\n--LLF-END\n',
};

export interface UserConfig { name: ConfigName; content: string | null; mtime: number | null; path: string }

export function readUserConfig(name: ConfigName): UserConfig {
  const path = userConfigFile(name);
  try {
    const st = statSync(path);
    return { name, content: readFileSync(path, 'utf8'), mtime: st.mtimeMs, path };
  } catch {
    return { name, content: null, mtime: null, path };
  }
}

/** baseMtime:读到时的修改时间;null = 不检查(文件还不存在,或调用方决定覆盖) */
export function writeUserConfig(name: ConfigName, content: string, baseMtime: number | null): { mtime: number } {
  try { llfParse(content, { tags: true }); } catch (err) { throw new StarsError(`不是合法的 LLF:${(err as Error).message}`); }
  const path = userConfigFile(name);
  if (baseMtime !== null && existsSync(path) && Math.abs(statSync(path).mtimeMs - baseMtime) > 1) throw new FileConflict(statSync(path).mtimeMs);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return { mtime: statSync(path).mtimeMs };
}

// ---------- 正在运行的服务 ----------

export interface ServerInfo { port: number; host: string; token: string; pid: number; file: string; dir: string; started: number }

const serversDir = () => join(configDir(), 'servers');

export function registerServer(info: ServerInfo): void {
  try {
    mkdirSync(serversDir(), { recursive: true });
    const f = join(serversDir(), `${info.port}.json`);
    writeFileSync(f, JSON.stringify(info, null, 2), { mode: 0o600 });
    chmodSync(f, 0o600);
  } catch { /* 只读的家目录:遥控用不了,服务照常 */ }
}

export function unregisterServer(port: number, pid = process.pid): void {
  const f = join(serversDir(), `${port}.json`);
  try { if ((JSON.parse(readFileSync(f, 'utf8')) as ServerInfo).pid === pid) unlinkSync(f); } catch { /* 已经没了 */ }
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

/** 还活着的服务(顺手清掉进程已经不在的登记) */
export function listServers(): ServerInfo[] {
  let names: string[] = [];
  try { names = readdirSync(serversDir()).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out: ServerInfo[] = [];
  for (const n of names) {
    const f = join(serversDir(), n);
    try {
      const info = JSON.parse(readFileSync(f, 'utf8')) as ServerInfo;
      if (alive(info.pid)) out.push(info); else unlinkSync(f);
    } catch { /* 坏文件,跳过 */ }
  }
  return out.sort((a, b) => b.started - a.started);
}

/** 选一个服务:指定端口 > 主项目就是这个宇宙文件的 > 只有一个时就是它 */
export function pickServer(file: string | null, port?: number): ServerInfo {
  const all = listServers();
  if (port !== undefined) {
    const s = all.find((x) => x.port === port);
    if (!s) throw new StarsError(`端口 ${port} 上没有正在运行的星罗服务`);
    return s;
  }
  if (!all.length) throw new StarsError('没有正在运行的星罗服务(先 stars serve)');
  const mine = file ? all.filter((x) => resolve(x.file) === resolve(file)) : [];
  if (mine.length) return mine[0]!;
  if (all.length === 1) return all[0]!;
  throw new StarsError(`有多个服务在运行,用 --port 指定:${all.map((x) => `${x.port}(${x.dir})`).join('、')}`);
}

/** 内嵌进查看器页面的配置(<script type="application/json">):默认值 + 个人文件(静态导出不带个人文件,用浏览器里存的) */
export function pageConfig(live: boolean): string {
  const user = live ? Object.fromEntries(CONFIG_NAMES.map((n) => [n, readUserConfig(n)])) : null;
  const obj = { defaults: Object.fromEntries(CONFIG_NAMES.map((n) => [n, defaultConfigText(n)])), user, header: USER_HEADER };
  return JSON.stringify(obj).replace(/</g, '\\u003c');   // 不让 </script> 之类提前结束标签
}
