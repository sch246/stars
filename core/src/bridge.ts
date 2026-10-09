// 页面桥:侧栏预览里的页面(开了脚本的 HTML)通过 window.stars 调星罗的命令 —— 写一个观察并改动图谱的 agent 页面就靠它。
//   · 页面拿不到 token:唯一的出口是 postMessage 给查看器,查看器照常走命令表执行(和控制台、快捷键、遥控同一个入口),
//     执行前按这个页面的授权级别检查
//   · 级别是累加的:读 ⊂ 界面 ⊂ 提议 ⊂ 写。每个命令声明自己的作用(effect);没声明的(个人设置、保存文件、开项目……)不给页面用
//   · 「提议」级可以用写命令,但新增的节点和边都落成 status=proposed,等你在审阅里确认;改和删只能动自己还没被确认的提议
//   · 授权按「项目目录 + 页面路径」记在 ~/.config/stars/grants.llf,不在项目里 —— 克隆来的仓库不能给自己开权限
// 浏览器与 Node 共用(服务端往 /preview 返回的 HTML 里注入同一段脚本);静态导出会拼进同一个作用域:顶层名字都以 bridge 开头。

export const BRIDGE_LEVELS = ['off', 'read', 'ui', 'propose', 'write'] as const;
export type BridgeLevel = (typeof BRIDGE_LEVELS)[number];
export type BridgeEffect = 'read' | 'ui' | 'write' | 'never';

export const bridgeIsLevel = (s: unknown): s is BridgeLevel => (BRIDGE_LEVELS as readonly unknown[]).includes(s);

/** 这个级别的页面能不能执行这种作用的命令(write 在「提议」级也放行,由执行的地方把写入改成提议) */
export function bridgeAllows(effect: BridgeEffect | undefined, level: BridgeLevel): boolean {
  const lv = BRIDGE_LEVELS.indexOf(level);
  if (effect === 'read') return lv >= 1;
  if (effect === 'ui') return lv >= 2;
  if (effect === 'write') return lv >= 3;
  return false;
}

/** 这次挂载的暗号:页面发来的消息必须带着它,查看器只认当前挂着的那一个 */
export const bridgeNonceOk = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{16,64}$/.test(s);

/** 注入页面的脚本:定义 window.stars。放在 <head> 最前面,比页面自己的脚本先跑 */
export function bridgeShim(nonce: string): string {
  if (!bridgeNonceOk(nonce)) throw new Error('bad nonce');
  return `<script>(function () {
  var N = "${nonce}", P = window.parent;
  if (!P || P === window || window.stars) return;
  var seq = 0, wait = new Map(), subs = new Map();
  function send(m) { m.stars = N; P.postMessage(m, '*'); }
  function call(kind, m) { return new Promise(function (ok, no) { var id = ++seq; m = m || {}; m.id = id; m.kind = kind; wait.set(id, [ok, no]); send(m); }); }
  addEventListener('message', function (e) {
    var m = e.data;
    if (e.source !== P || !m || m.stars !== N) return;
    if (m.re !== undefined) { var w = wait.get(m.re); if (!w) return; wait.delete(m.re); if (m.ok) w[0](m.value); else w[1](new Error(m.error)); return; }
    var fs = subs.get(m.event); if (fs) fs.forEach(function (f) { try { f(m.value); } catch (err) { console.error(err); } });
  });
  window.stars = Object.freeze({
    /** 执行一条命令(写法同控制台),得到 { out, data } */
    exec: function (line) { return call('exec', { line: String(line) }); },
    /** 整个宇宙的快照:{ nodes, edges, proposals } */
    graph: function () { return call('graph'); },
    /** 这个页面:{ path, project, level, selected, view } */
    info: function () { return call('info'); },
    /** 订阅:change(宇宙变了)、select(选中变了)、level(授权变了);返回取消订阅的函数 */
    on: function (ev, f) {
      ev = String(ev);
      if (!subs.has(ev)) { subs.set(ev, new Set()); send({ kind: 'sub', event: ev }); }
      subs.get(ev).add(f);
      return function () { subs.get(ev).delete(f); };
    },
    /** 按页面存的小数据(沙箱里没有 localStorage):存在查看器那边的浏览器里,按项目目录 + 页面路径分开 */
    store: Object.freeze({
      get: function (k) { return call('store', { op: 'get', key: String(k) }); },
      set: function (k, v) { return call('store', { op: 'set', key: String(k), value: v }); },
      del: function (k) { return call('store', { op: 'del', key: String(k) }); },
      keys: function () { return call('store', { op: 'keys' }); },
    }),
  });
})();</script>`;
}

/** 把几个标签插进 HTML 的开头:<head> 之后;没有就 <html> 之后;再没有就 <!doctype> 之后;都没有就放最前面 */
export function bridgeInject(html: string, tags: string): string {
  const at = (re: RegExp) => { const m = re.exec(html); return m ? m.index + m[0].length : -1; };
  let i = at(/<head(\s[^>]*)?>/i);
  if (i < 0) i = at(/<html(\s[^>]*)?>/i);
  if (i < 0) i = at(/^\s*<!doctype[^>]*>/i);
  if (i < 0) i = 0;
  return html.slice(0, i) + tags + html.slice(i);
}
