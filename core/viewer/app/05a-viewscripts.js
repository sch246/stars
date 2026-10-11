// ---------- 视图脚本:规格(连同 base 链)里的 script 先加载成模块,再同步编译(见 core/src/viewscript.ts) ----------
// 加载地址 /preview/<预览 token>/<项目>/~v<版本>/<路径>:版本由服务端按整串依赖(入口 + 它 import 的)的大小和修改时间算(/api/viewdeps),
// 依赖里哪个文件改了版本就变,整串换个地址重新加载(浏览器按地址缓存模块)。改了文件:监听器报来的变化、侧栏里保存、view-reload 命令。
// 还在加载时不重算(先留着上一次的画面);加载失败的模块是一个 Error,编译时退回规则并在顶上提示。
// 命令 view-script / view-reload 在「命令」一节(26-commands.js)。
const viewMods = new Map();      // 路径 → 模块 | Error
const viewDeps = new Map();      // 入口路径 → { files, missing, version }
const viewLoading = new Map();   // 路径 → Promise

// 静态导出:源码在页面里(__STARS_VIEWSRC__),每个文件做成一个 blob 模块,相对 import 换成依赖的 blob 地址(先依赖后自己)
const staticUrls = new Map();
function staticModuleUrl(path, stack = []) {
  if (staticUrls.has(path)) return staticUrls.get(path);
  if (stack.includes(path)) throw new Error('静态导出里不支持循环 import: ' + [...stack, path].join(' → '));
  const src = (window.__STARS_VIEWSRC__ || {})[path];
  if (src == null) throw new Error('导出的页面里没有 ' + path);
  const code = rewriteImports(src, (spec) => { const dep = resolveImport(path, spec); return dep === null ? null : staticModuleUrl(dep, [...stack, path]); });
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  staticUrls.set(path, url);
  return url;
}
const viewErr = new Map();       // 路径 → 重新加载失败的原因(这时还用着上一次加载成功的模块)
/** keepOld:重新加载(文件改了)时失败了就留着上一次的模块,只在顶上提示 —— 改到一半保存不会让画面塌掉 */
function loadViewScript(path, keepOld = false) {
  if (viewLoading.has(path)) return viewLoading.get(path);
  const p = (async () => {
    try {
      let ns;
      if (window.__STARS_STATIC__) ns = await import(staticModuleUrl(path));
      else {
        const d = await api('/api/viewdeps?path=' + encodeURIComponent(path));
        viewDeps.set(path, d);
        if (d.missing.includes(path)) throw new Error('文件不存在: ' + path);
        ns = await import(`/preview/${pvToken}/${(project && project.id) || '_'}/~v${d.version}/` + path.split('/').map(encodeURIComponent).join('/'));
      }
      viewMods.set(path, viewModuleOf(ns)); viewErr.delete(path);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e)), old = viewMods.get(path);
      if (keepOld && old && !(old instanceof Error)) viewErr.set(path, err.message); else viewMods.set(path, err);
    } finally { viewLoading.delete(path); }
  })();
  viewLoading.set(path, p);
  return p;
}
/** 这份规格用到的脚本都加载好了吗;没有就开始加载,加载完重算 */
function viewScriptsReady(spec) {
  let R;
  try { R = resolveView(uni, spec, viewMods, currentView); } catch { return true; }   // base 写错:让编译去报
  if (!R.missing.length) return true;
  const fresh = R.missing.filter((p) => !viewLoading.has(p));
  if (fresh.length) Promise.all(R.missing.map(loadViewScript)).then(() => recompute());
  return false;
}
/** 这些文件(项目里的路径)变了:用到它们的脚本整串重新加载(加载完重算;失败了留着上一次的) */
function viewFilesChanged(paths) {
  const set = new Set(paths), hit = [];
  for (const [entry, d] of viewDeps) if (set.has(entry) || d.files.some((f) => set.has(f))) hit.push(entry);
  if (!hit.length) return false;
  reloadViewScripts(hit);
  return true;
}
function reloadViewScripts(paths) {
  return Promise.all(paths.map((p) => loadViewScript(p, true))).then(() => recompute());
}
/** 顶上提示用:重新加载失败、还在用上一次的 */
const viewReloadNotes = () => [...viewErr].map(([p, m]) => `视图脚本 ${p} 加载失败(先用着上一次的): ${m}`);
const viewScriptFiles = () => [...new Set([...viewDeps.values()].flatMap((d) => d.files))];

/** 一个文件节点像不像视图脚本(.js / .mjs / .ts / .mts) */
const scriptFileOf = (id) => { const n = raw.get(id); const f = n && (n.attrs.file || (n.attrs.type === 'file' ? id : '')); return f && VIEW_SCRIPT_FILE.test(f) ? f : null; };
/** 用一个视图脚本新建视图(拖到视图列表上 / view-script):先加载看看它导出了什么,不像视图脚本就不建 */
async function viewFromScript(path, name) {
  if (window.__STARS_STATIC__ || replay) { toast('静态导出 / 回放里不能新建视图', true); return; }
  viewMods.delete(path); viewDeps.delete(path);
  await loadViewScript(path);
  const m = viewMods.get(path);
  if (m instanceof Error) { toast(`${esc(path)} 加载不了:${esc(m.message)}`, true, 8000); return; }
  if (!['spec', 'select', 'size', 'color', 'shape', 'label', 'edge', 'forces', 'looks'].some((k) => m[k] !== undefined)) {
    toast(`${esc(path)} 不像视图脚本(没有导出 spec / select / size / color …)`, true, 6000); return;
  }
  let base = name || path.split('/').pop().replace(VIEW_SCRIPT_FILE, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'script';
  let id = base; for (let i = 2; specs[id] && !(name && i === 2); i++) id = `${base}-${i}`;
  const spec = { script: path }, key = '~view/' + id, compact = JSON.stringify(spec);
  const op = uni.nodes.has(key) ? { op: 'setNode', id: key, set: { spec: compact } } : { op: 'addNode', id: key, label: id, attrs: { kind: 'view', spec: compact } };
  did(`view-script ${quoteArg(id)} --file ${quoteArg(path)}`);
  const r = await api('/api/op', { op, author: 'viewer' });
  await waitApplied(r.n);
  setView(id);
  toast(`新建视图「${esc(id)}」,模板是 ${esc(path)} · <span data-cmd="undo" style="cursor:pointer;text-decoration:underline">撤销</span>`);
  return id;
}
