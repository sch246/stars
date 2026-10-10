// 浏览器测试的舞台:临时项目(git 仓库 + 几个文件 + 概念)→ 进程内起服务(实时同步)→ 无头 Chrome 打开查看器。
// 查看器里的命令走遥控(/api/ui,和 `stars ui` 同一条路);图里的结果直接读宇宙文件。
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { edgeKey } from '../../src/model.ts';
import { listFiles, planScan, statMeta } from '../../src/scan.ts';
import { startServer } from '../../src/serve.ts';
import { Store } from '../../src/store.ts';
import { type Page, launch, sleep } from './cdp.ts';

export { sleep };
/** id → [x, y] 屏幕坐标;就地展开的容器多一个疆界半径 [x, y, r] */
type Pos = Record<string, [number, number, number?]>;

const genesis = readFileSync(new URL('../../genesis.stars', import.meta.url), 'utf8');
const freePort = () => new Promise<number>((ok) => {
  const s = createServer().listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
});

export interface Stage {
  page: Page;
  dir: string;
  store: Store;
  /** 在页面里执行一条查看器命令;失败就抛出 */
  ui: (line: string) => Promise<{ out: string; data: any }>;
  /** 节点的屏幕坐标(不在画面里的不给) */
  screen: (...ids: string[]) => Promise<Pos>;
  at: (id: string) => Promise<[number, number]>;
  /** 等布局停下来(两次取的位置差不到 3px),返回最后的位置 */
  settle: (ids: string[]) => Promise<Pos>;
  /** 就地展开的容器 cid 里面一块空地(不在节点上、不在里面更小的疆界里);不给 cid = 所有疆界外面的背景 */
  emptySpot: (cid?: string) => Promise<[number, number]>;
  /** 提示条的文字(没显示 = null) */
  toast: () => Promise<string | null>;
  /** 宇宙文件里有没有这个节点 / 这条边 */
  has: (id: string) => boolean;
  edge: (from: string, type: string, to: string) => boolean;
  close: () => Promise<void>;
}

/**
 * 项目里有:docs/readme.md、src/{app,auth,util}.ts(app → auth → util 依赖),
 * 概念 ideas 装着 idea/a、idea/b、idea/c,模块 auth-mod 装着 src/auth.ts。
 * 找不到 Chrome 返回 null(调用的测试自己跳过)。
 */
export async function openStage(expand: string[] = ['repo', 'ideas', 'docs/', 'src/']): Promise<Stage | null> {
  const dir = mkdtempSync(join(tmpdir(), 'stars-ui-'));
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'stars-ui-cfg-'));   // 设置、最近打开都别碰真实的家目录
  const files: Record<string, string> = {
    'docs/readme.md': '# readme\n', 'src/app.ts': "import { login } from './auth';\nlogin();\n",
    'src/auth.ts': "import { ok } from './util';\nexport const login = ok;\n", 'src/util.ts': 'export const ok = () => true;\n',
  };
  for (const [p, text] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), text); }
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, stdio: 'ignore' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'init');
  const store = new Store(join(dir, 'universe.stars'));
  store.create(genesis);
  store.commit(planScan(store.load(), listFiles(dir, 'universe.stars'), 'repo', 'proj', statMeta(dir)), { author: 'test' });   // repo、文件夹、文件节点
  const node = (id: string, label: string, type: string) => ({ op: 'addNode', id, label, attrs: { type } });
  const link = (from: string, type: string, to: string) => ({ op: 'addEdge', from, type, to });
  store.commit({ op: 'batch', ops: [
    node('ideas', '想法', 'concept'), node('idea/a', '想法A', 'concept'), node('idea/b', '想法B', 'concept'), node('idea/c', '想法C', 'concept'), node('auth-mod', '认证模块', 'module'),
    link('repo', 'contains', 'ideas'), link('repo', 'contains', 'auth-mod'), link('ideas', 'contains', 'idea/a'), link('ideas', 'contains', 'idea/b'), link('ideas', 'contains', 'idea/c'),
    link('auth-mod', 'contains', 'src/auth.ts'), link('src/app.ts', 'dependsOn', 'src/auth.ts'), link('src/auth.ts', 'dependsOn', 'src/util.ts'),
  ] } as never, { author: 'test' });

  const port = await freePort();
  const srv = startServer(store, port, dir, '127.0.0.1', () => {}, [], { watch: true, mountId: 'repo', agent: false });   // 实时同步:磁盘上的变化进图
  const base = `http://127.0.0.1:${port}`;
  const browser = await launch({ origin: base }).catch((e) => { srv.close(); throw e; });
  if (!browser) { srv.close(); rmSync(dir, { recursive: true, force: true }); return null; }
  const { page } = browser;
  const close = async () => { await browser.close(); srv.close(); rmSync(dir, { recursive: true, force: true }); };

  const ui = async (line: string) => {
    const r = await fetch(`${base}/api/ui`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-stars-token': srv.token }, body: JSON.stringify({ line, wait: 8000 }) });
    const j = await r.json() as { delivered: number; result: { ok?: boolean; out?: string; data?: unknown; error?: string } | null };
    if (!j.delivered) throw new Error('没有页面在看');
    if (!j.result) throw new Error(`${line}:页面没回报`);
    if (j.result.ok === false) throw new Error(`${line}:${j.result.error}`);
    return { out: j.result.out ?? '', data: j.result.data ?? null };
  };
  const screen = async (...ids: string[]) => (await ui(['screen', ...ids].join(' '))).data as Pos;
  const at = async (id: string): Promise<[number, number]> => { const p = (await screen(id))[id]; if (!p) throw new Error(`${id} 不在画面里`); return [p[0], p[1]]; };
  const settle = async (ids: string[]) => {
    let prev = await screen(...ids);
    for (let i = 0; i < 14; i++) {
      await sleep(300);
      const cur = await screen(...ids);
      const d = Math.max(0, ...ids.map((id) => (cur[id] && prev[id] ? Math.hypot(cur[id]![0] - prev[id]![0], cur[id]![1] - prev[id]![1]) : 99)));
      prev = cur;
      if (d < 3) break;
    }
    return prev;
  };
  const emptySpot = async (cid?: string): Promise<[number, number]> => {
    await settle(cid ? [cid] : ['repo']);
    const all = Object.entries(await screen()), home = cid ? all.find(([id]) => id === cid)?.[1] : undefined;
    const covers = await page.evaluate<Array<[number, number, number, number]>>(() => [...document.querySelectorAll<HTMLElement>('.panel, #hint, #toast')]   // 浮在画面上的面板
      .filter((e) => !e.hidden && e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect(); return [r.left - 8, r.top - 8, r.right + 8, r.bottom + 8] as [number, number, number, number]; }));
    if (cid && !home?.[2]) throw new Error(`${cid} 不是画面里就地展开的容器`);
    const ok = (x: number, y: number) => all.every(([id, [qx, qy, r]]) => id === cid || (r && home && r >= home[2]!) || Math.hypot(qx - x, qy - y) > (r ? r + 10 : 26))   // 外层的疆界不算
      && (!home || Math.hypot(home[0] - x, home[1] - y) < home[2]! - 12) && covers.every(([l, t, r, b]) => x < l || x > r || y < t || y > b);
    // 由近到远找:容器里从中心往外;背景从画面中间往外
    const [cx, cy] = home ?? [700, 430];
    for (let r = home ? 10 : 0; r < 700; r += 8) for (let a = 0; a < 6.28; a += 0.25) {
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (x > 10 && x < 1390 && y > 10 && y < 850 && ok(x, y)) return [Math.round(x), Math.round(y)];
    }
    throw new Error(cid ? `${cid} 里没有空地` : '画面里没有背景空地');
  };
  const load = () => store.load();

  try {
    await page.goto(`${base}/#view=galaxy`);
    await page.waitFor(() => document.getElementById('status')?.textContent?.includes('节点'), 15_000);
    await sleep(1200);
    await ui('param heat off'); await ui('param follow off');   // 不公转、单选不挪镜头:位置才稳
    await ui('collapse-all');
    for (const id of expand) { await ui(`expand ${id}`); await sleep(500); }
    await ui('select'); await ui('fit');
    await settle(expand.length ? expand : ['repo']);
  } catch (e) { await close(); throw e; }

  return {
    page, dir, store, ui, screen, at, settle, emptySpot, close,
    toast: () => page.text('#toast'),
    has: (id) => load().nodes.has(id),
    edge: (from, type, to) => load().edges.has(edgeKey(from, type, to)),
  };
}

/** 一个场景:拿不到 Chrome 就跳过;失败时把截图留在临时目录里,路径写进错误信息 */
export async function scene(t: { skip: (msg: string) => void; name: string }, body: (s: Stage) => Promise<void>, expand?: string[]): Promise<void> {
  const s = await openStage(expand);
  if (!s) { t.skip('没找到 Chrome / Chromium(设 STARS_CHROME=可执行文件路径)'); return; }
  try {
    await body(s);
    const errors = s.page.errors.filter((e) => !/favicon/.test(e));
    if (errors.length) throw new Error(`页面报错:\n${errors.join('\n')}`);
  } catch (e) {
    const shot = join(tmpdir(), `stars-ui-${t.name.replace(/[^\w一-龥]+/g, '-').slice(0, 40)}-${Date.now()}.png`);
    try { await s.page.screenshot(shot); (e as Error).message += `\n截图:${shot}\n弹窗:${JSON.stringify(s.page.dialogs)}`; } catch { /* 页面已经没了 */ }
    throw e;
  } finally { await s.close(); }
}
