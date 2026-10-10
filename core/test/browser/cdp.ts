// 浏览器测试用的极简驱动:直接说 Chrome DevTools 协议(Node 自带的 WebSocket),不装 Playwright / Puppeteer,保持零依赖。
// 找 Chrome:环境变量 STARS_CHROME(或 CHROME_PATH)> 常见安装位置 > PATH 里的 google-chrome / chromium / msedge……;找不到就返回 null,测试跳过。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

export const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

export function findChrome(): string | null {
  const given = process.env.STARS_CHROME ?? process.env.CHROME_PATH;
  if (given) return existsSync(given) ? given : null;
  const env = process.env, fixed = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : process.platform === 'win32'
      ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).flatMap((d) => [join(d!, 'Google/Chrome/Application/chrome.exe'), join(d!, 'Microsoft/Edge/Application/msedge.exe')])
      : env.PLAYWRIGHT_BROWSERS_PATH ? [join(env.PLAYWRIGHT_BROWSERS_PATH, 'chromium')] : [];
  for (const p of fixed) if (existsSync(p)) return p;
  const names = process.platform === 'win32' ? ['chrome.exe', 'msedge.exe'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  for (const d of (env.PATH ?? '').split(delimiter)) for (const n of names) if (d && existsSync(join(d, n))) return join(d, n);
  return null;
}

type Handler = (params: any, session?: string) => void;
class Cdp {
  #id = 0;
  #wait = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void; method: string }>();
  #on = new Map<string, Set<Handler>>();
  ws: WebSocket;
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id !== undefined) {
        const w = this.#wait.get(m.id); if (!w) return;
        this.#wait.delete(m.id);
        if (m.error) w.fail(new Error(`${w.method}: ${m.error.message}`)); else w.ok(m.result);
      } else for (const h of this.#on.get(m.method) ?? []) h(m.params, m.sessionId);
    };
    ws.onclose = () => { for (const w of this.#wait.values()) w.fail(new Error('Chrome 断开了')); this.#wait.clear(); };
  }
  send(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.#id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, fail) => this.#wait.set(id, { ok, fail, method }));
  }
  on(method: string, h: Handler): void { if (!this.#on.has(method)) this.#on.set(method, new Set()); this.#on.get(method)!.add(h); }
  close(): void { this.ws.close(); }
}

const BUTTON = { left: 1, right: 2, middle: 4 } as const;
type Button = keyof typeof BUTTON;
const MODIFIER: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const KEYS: Record<string, [code: string, vk: number, text?: string]> = {
  Enter: ['Enter', 13, '\r'], Tab: ['Tab', 9], Escape: ['Escape', 27], Delete: ['Delete', 46], Backspace: ['Backspace', 8],
  ' ': ['Space', 32, ' '], F2: ['F2', 113], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
  Control: ['ControlLeft', 17], Shift: ['ShiftLeft', 16], Alt: ['AltLeft', 18], Meta: ['MetaLeft', 91],
};
function keyDef(name: string, shift: boolean): { key: string; code: string; vk: number; text?: string } {
  const k = KEYS[name];
  if (k) return { key: name, code: k[0], vk: k[1], text: k[2] };
  if (/^[a-z]$/i.test(name)) { const up = name.toUpperCase(); return { key: shift ? up : name.toLowerCase(), code: `Key${up}`, vk: up.charCodeAt(0), text: shift ? up : name.toLowerCase() }; }
  if (/^[0-9]$/.test(name)) return { key: name, code: `Digit${name}`, vk: name.charCodeAt(0), text: name };
  throw new Error(`不认识的键 ${name}`);
}

/** 一个标签页:鼠标、键盘、在页面里求值、读 DOM;页面报的错和弹窗都记下来(弹窗一律点「确定」,除非 onDialog 说不) */
export class Page {
  errors: string[] = [];
  dialogs: string[] = [];
  onDialog: (type: string, message: string) => boolean = () => true;
  #mods = 0; #buttons = 0; #x = 0; #y = 0;
  #loaded: (() => void) | null = null;
  cdp: Cdp; session: string;
  constructor(cdp: Cdp, session: string) {
    this.cdp = cdp; this.session = session;
    cdp.on('Page.javascriptDialogOpening', (p, s) => {
      if (s !== session) return;
      this.dialogs.push(`${p.type}: ${p.message}`);
      void this.send('Page.handleJavaScriptDialog', { accept: this.onDialog(p.type, p.message) });
    });
    cdp.on('Runtime.exceptionThrown', (p, s) => { if (s === session) this.errors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text); });
    cdp.on('Runtime.consoleAPICalled', (p, s) => { if (s === session && p.type === 'error') this.errors.push(p.args.map((a: any) => a.value ?? a.description ?? '').join(' ')); });
    cdp.on('Page.loadEventFired', (_p, s) => { if (s === session) this.#loaded?.(); });
  }
  send(method: string, params: object = {}): Promise<any> { return this.cdp.send(method, params, this.session); }
  async init(width: number, height: number): Promise<void> {
    await Promise.all([this.send('Page.enable'), this.send('Runtime.enable')]);
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await this.send('Emulation.setFocusEmulationEnabled', { enabled: true });   // 无头模式下页面也当自己有焦点(键盘事件、剪贴板)
  }
  async goto(url: string): Promise<void> {
    const loaded = new Promise<void>((ok) => { this.#loaded = ok; });
    await this.send('Page.navigate', { url });
    await loaded;
  }
  /** fn 在页面里执行(可以是 async),参数会 JSON 化传进去;返回值 JSON 化传回来 */
  async evaluate<T = unknown>(fn: string | ((...a: any[]) => T | Promise<T>), ...args: unknown[]): Promise<T> {
    const expression = typeof fn === 'string' ? fn : `(${fn})(...${JSON.stringify(args)})`;
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }
  async waitFor(fn: string | ((...a: any[]) => unknown), timeout = 10_000, ...args: unknown[]): Promise<void> {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await this.evaluate(fn, ...args)) return; await sleep(100); }
    throw new Error(`等不到:${String(fn).slice(0, 120)}`);
  }
  /** 元素的文字;不存在或看不见(hidden / display:none)= null */
  text(selector: string): Promise<string | null> {
    return this.evaluate((s: string) => { const e = document.querySelector(s) as HTMLElement | null; return e && !e.hidden && e.getClientRects().length ? e.innerText : null; }, selector);
  }
  count(selector: string): Promise<number> { return this.evaluate((s: string) => document.querySelectorAll(s).length, selector); }
  /** 第一个匹配(文字里还含 text)的元素的中心;没有 = null */
  center(selector: string, text?: string): Promise<[number, number] | null> {
    return this.evaluate((s: string, t: string | null) => {
      const e = [...document.querySelectorAll<HTMLElement>(s)].find((x) => !t || x.innerText.includes(t));
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    }, selector, text ?? null);
  }
  /** 用鼠标点元素的中心(先移过去,悬停才出现的按钮也点得到) */
  async clickOn(selector: string, text?: string): Promise<void> {
    const c = await this.center(selector, text);
    if (!c) throw new Error(`页面里没有 ${selector}${text ? `(含「${text}」)` : ''}`);
    await this.mouse.move(...c, 3); await sleep(80);
    await this.mouse.click(...c);
  }
  async screenshot(path: string): Promise<void> {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(r.data, 'base64'));
  }

  #mouse(type: string, x: number, y: number, button?: Button, clickCount = 0) {
    this.#x = x; this.#y = y;
    const held: Button | 'none' = this.#buttons & 1 ? 'left' : this.#buttons & 2 ? 'right' : this.#buttons & 4 ? 'middle' : 'none';
    return this.send('Input.dispatchMouseEvent', { type, x, y, modifiers: this.#mods, buttons: this.#buttons, button: button ?? held, clickCount });
  }
  mouse = {
    move: async (x: number, y: number, steps = 1) => {
      const fx = this.#x, fy = this.#y;
      for (let i = 1; i <= steps; i++) await this.#mouse('mouseMoved', fx + ((x - fx) * i) / steps, fy + ((y - fy) * i) / steps);
    },
    down: async (button: Button = 'left', clickCount = 1) => { this.#buttons |= BUTTON[button]; await this.#mouse('mousePressed', this.#x, this.#y, button, clickCount); },
    up: async (button: Button = 'left', clickCount = 1) => { this.#buttons &= ~BUTTON[button]; await this.#mouse('mouseReleased', this.#x, this.#y, button, clickCount); },
    click: async (x: number, y: number, button: Button = 'left') => { await this.mouse.move(x, y); await this.mouse.down(button); await this.mouse.up(button); },
    dblclick: async (x: number, y: number) => {
      await this.mouse.move(x, y);
      await this.mouse.down('left', 1); await this.mouse.up('left', 1);
      await this.mouse.down('left', 2); await this.mouse.up('left', 2);
    },
    /** 按住拖到 (x, y);mods 在按下之后、移动之前按住(和人一样),松手之后放开 */
    drag: async (from: [number, number], to: [number, number], { button = 'left' as Button, mods = [] as string[], steps = 12 } = {}) => {
      await this.mouse.move(...from); await this.mouse.down(button);
      for (const m of mods) await this.keyboard.down(m);
      await this.mouse.move(from[0] + 8, from[1] + 8, 3);
      await this.mouse.move(...to, steps); await sleep(150);
      await this.mouse.up(button);
      for (const m of [...mods].reverse()) await this.keyboard.up(m);
    },
  };
  keyboard = {
    down: async (name: string) => {
      if (MODIFIER[name]) this.#mods |= MODIFIER[name]!;
      const d = keyDef(name, !!(this.#mods & 8)), text = this.#mods & ~8 ? undefined : d.text;   // 按着 Ctrl / Alt / Meta 时不出字
      await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: d.key, code: d.code, windowsVirtualKeyCode: d.vk, modifiers: this.#mods, text, unmodifiedText: text, location: MODIFIER[name] ? 1 : 0 });
    },
    up: async (name: string) => {
      if (MODIFIER[name]) this.#mods &= ~MODIFIER[name]!;
      const d = keyDef(name, !!(this.#mods & 8));
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: d.key, code: d.code, windowsVirtualKeyCode: d.vk, modifiers: this.#mods, location: MODIFIER[name] ? 1 : 0 });
    },
    /** 'Enter'、' '、'Control+a'、'Control+Shift+v'、'Shift+Tab' */
    press: async (combo: string) => {
      const keys = combo === ' ' || combo === '+' ? [combo] : combo.split('+');
      for (const k of keys) await this.keyboard.down(k);
      for (const k of [...keys].reverse()) await this.keyboard.up(k);
    },
    /** 输入文字(中文也行;不产生逐键的 keydown) */
    type: async (text: string) => { await this.send('Input.insertText', { text }); },
  };
}

export interface Browser { page: Page; close: () => Promise<void> }

/** 起一个无头 Chrome,开一个标签页;找不到 Chrome 返回 null */
export async function launch({ width = 1400, height = 860, origin }: { width?: number; height?: number; origin?: string } = {}): Promise<Browser | null> {
  const exe = findChrome();
  if (!exe) return null;
  const profile = mkdtempSync(join(tmpdir(), 'stars-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--mute-audio', '--disable-background-networking',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(process.getuid?.() === 0 || process.env.CI ? ['--no-sandbox'] : []), 'about:blank'];   // root 下、CI 机器上(Ubuntu 24.04 限制了用户命名空间)沙箱起不来
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise<string>((ok, fail) => {
    let err = '';
    const t = setTimeout(() => fail(new Error(`Chrome 20 秒没起来:\n${err}`)), 20_000);
    proc.stderr!.on('data', (d) => { err += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) { clearTimeout(t); ok(m[1]!); } });
    proc.on('exit', (code) => { clearTimeout(t); fail(new Error(`Chrome 退出了(${code}):\n${err}`)); });
  });
  const ws = new WebSocket(url);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error('连不上 Chrome')); });
  const cdp = new Cdp(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  if (origin) await cdp.send('Browser.grantPermissions', { origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  const page = new Page(cdp, sessionId);
  await page.init(width, height);
  return {
    page,
    close: async () => {
      try { await Promise.race([cdp.send('Browser.close'), sleep(2000)]); } catch { /* 已经关了 */ }
      cdp.close(); proc.kill();
      await sleep(100);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
