// 服务的核心:打开着的项目、推给订阅者的事件、个人配置在别处被改了的通知。和怎么通信无关:
// HTTP(serve.ts:/api/* + SSE)是一种接法;进程内直接调是另一种(api.ts 的 localApi + 这里的 subscribe),
// 测试、以后的 VS Code 宿主(插件后台就是 Node,面板里的查看器用 postMessage 接过来)都用它。
import { existsSync, mkdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { configDir, isConfigName, readUserConfig } from './config.ts';
import { StarsError } from './model.ts';
import { apply } from './ops.ts';
import { viewerDir } from './page.ts';
import { expandHome, Project, projectId, rememberRecent, type Subscriber } from './project.ts';
import { listFiles, planScan, statMeta } from './scan.ts';
import { Store } from './store.ts';

const genesisFile = resolve(viewerDir, '..', 'genesis.stars');

export interface HubOptions {
  /** 每个打开的项目都实时同步文件系统(serve --watch) */
  watch?: boolean;
  mountId?: string;
  debounceMs?: number;
  pollSec?: number;
  /** 按触发跑脚本节点(默认开;false = 只能手动跑) */
  agent?: boolean;
}

export interface Hub {
  projects: Map<string, Project>;
  /** 启动时的主项目 */
  main: Project;
  mountId: string;
  /** 打开(create:没有宇宙就建一个,init + scan)一个目录里的宇宙 */
  openProject(dir: string, create?: boolean): Project;
  /** 具名事件推给所有订阅者(或指定项目的);返回推给了几个 */
  broadcast(event: string, obj: unknown, only?: Project[]): number;
  /** 遥控(stars ui)等待页面回报的结果 */
  pendingUi: Map<string, (r: unknown) => void>;
  /** 订阅一个项目(不给 = 主项目):先收到一份快照('message',type: snapshot),之后是增量和具名事件;返回退订 */
  subscribe(sub: Subscriber, projectId?: string): () => void;
  close(): void;
}

export function createHub(store: Store, baseDir: string, log: (message: string) => void = console.log, options: HubOptions = {}): Hub {
  const genesis = readFileSync(genesisFile, 'utf8');
  const projects = new Map<string, Project>();
  const main = new Project(store, baseDir);
  main.primary = true;
  projects.set(main.id, main);
  const mountId = options.mountId ?? 'repo';
  if (options.watch) main.startWatch(mountId, log, options);
  if (options.agent !== false) main.startAgent(log);

  const openProject = (dir: string, create = false): Project => {
    const abs = resolve(expandHome(dir));
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new StarsError(`不是目录: ${abs}`);
    const file = join(abs, 'universe.stars');
    const id = projectId(file);
    const existing = projects.get(id);
    if (existing) return existing;
    if (!existsSync(file)) {
      if (!create) throw new StarsError('这个目录里还没有 universe.stars(可以选择"在这里建立宇宙")');
      const st = new Store(file);
      st.create(genesis);
      const u = st.load();
      apply(u, planScan(u, listFiles(abs, 'universe.stars'), mountId, basename(abs), statMeta(abs)));
      st.save(u);
      log(`在 ${abs} 建立了宇宙(扫描 ${u.nodes.size} 个节点)`);
    }
    const p = new Project(new Store(file), abs);
    projects.set(p.id, p);
    if (options.watch) p.startWatch(mountId, log, options);
    if (options.agent !== false) p.startAgent(log);
    rememberRecent(abs);
    return p;
  };
  rememberRecent(baseDir);

  const broadcast = (event: string, obj: unknown, only?: Project[]): number => {
    let n = 0;
    for (const p of only ?? projects.values()) for (const c of p.clients) { c.push(event, obj); n++; }
    return n;
  };

  // 个人配置(设置、快捷键)在别处被改了(编辑器、另一个标签页、stars ui):推给所有订阅者,它们立即生效
  let cfgWatcher: FSWatcher | null = null;
  const cfgTimers = new Map<string, NodeJS.Timeout>();
  try {
    mkdirSync(configDir(), { recursive: true });
    cfgWatcher = watch(configDir(), (_ev, name) => {
      const n = String(name ?? '').replace(/\.llf$/, '');
      if (!isConfigName(n)) return;
      clearTimeout(cfgTimers.get(n));
      cfgTimers.set(n, setTimeout(() => broadcast('config', readUserConfig(n)), 60));
    });
  } catch { /* 只读的家目录:设置只能存在浏览器里 */ }

  const subscribe = (sub: Subscriber, id?: string): (() => void) => {
    const proj = (id !== undefined ? projects.get(id) : undefined) ?? main;
    sub.push('message', JSON.parse(proj.snapshotLine()));
    proj.clients.add(sub);
    return () => { proj.clients.delete(sub); };
  };

  return {
    projects, main, mountId, openProject, broadcast, pendingUi: new Map(), subscribe,
    close: () => { cfgWatcher?.close(); for (const t of cfgTimers.values()) clearTimeout(t); for (const p of projects.values()) p.close(); },
  };
}
