// ---------- 项目:一个文件夹一个宇宙;同一个服务里可以同时打开多个,随时切换 ----------
/** 快照里带来的项目信息。返回 false 表示这不是想看的项目(服务重启过,正在按记住的目录重新打开它) */
function onProject(p) {
  if (projectId && p.id !== projectId) {
    const dir = knownDirs()[projectId];
    if (dir && !reopenTried.has(projectId)) {
      reopenTried.add(projectId);
      api('/api/open', { dir }).then((info) => { projectId = info.primary ? null : info.id; setHash(); connect(); })
        .catch(() => { projectId = null; setHash(); connect(); });
      return false;
    }
    projectId = p.primary ? null : p.id; setHash();
  }
  project = p;
  if (!window.__STARS_STATIC__) rememberDir(p.id, p.dir);
  $('proj-name').textContent = p.name;
  $('proj-dir').textContent = p.dir;
  $('proj').title = `${p.file}\n切换文件夹 / 项目(P)`;
  document.title = `星罗 · ${p.name}`;
  return true;
}
/** 切到另一个项目:丢掉和上一个宇宙有关的一切状态,重新连接事件流(服务端会先发一份完整快照) */
function switchProject(info) {
  rememberDir(info.id, info.dir);
  toggleProjects(false);
  if (project && info.id === project.id) return;
  if (fp) releaseFile();   // 有修改会先自动保存
  for (const s of [...scripts.values()]) stopScript(s, '切换了项目');
  stopPlay(); replay = null; liveSnap = null; staleLive = false; hist = null; histLimit = 300; histScope = 'auto'; renderReplayBar();
  $('timeline').hidden = true; $('btn-time').classList.remove('on');
  draftSpec = null; editorDirty = false; toggleEditor(false);
  selected = null; hovered = null; hiddenTypes.clear(); manual.clear(); auto.clear(); activeTags.clear();
  curSpaceId = null; expandedSet.clear(); fade = null; spaces.clear(); spaceVer++; zoomFocusId = null;
  sim.clear(); known = new Set(); fresh = true; lastN = 0; compiled = null; uni = null;
  links = []; drawNodes = []; regions = []; labelNodes = [];
  simulation.nodes([]); simulation.force('link').links([]);
  data = { nodes: [], edges: [], issues: [], log: [] };
  projectId = info.primary ? null : info.id; project = null; setHash();
  $('status').textContent = `正在打开 ${info.name}…`;
  connect();
}

let lsCur = null, openList = [];
const pjMsg = (t, bad) => { $('pj-msg').textContent = t; $('pj-msg').classList.toggle('bad', !!bad); };
const baseName = (d) => d.split(/[\\/]/).filter(Boolean).pop() || d;
const parentDir = (d) => { const p = d.replace(/[\\/]+[^\\/]+[\\/]*$/, ''); return !p ? '/' : /^[A-Za-z]:$/.test(p) ? p + '\\' : p; };
async function toggleProjects(on) {
  if (window.__STARS_STATIC__) return;
  $('projects').hidden = !on;
  if (!on) return;
  if (!$('editor').hidden) toggleEditor(false);
  if (!$('review').hidden) toggleReview(false);
  togglePhysics(false);
  layoutPanels();
  await renderProjects();
  ls(lsCur ? lsCur.dir : project ? parentDir(project.dir) : '');
}
async function renderProjects() {
  let r;
  try { r = await api('/api/projects'); } catch (e) { pjMsg(e.message, true); return; }
  openList = r.open;
  $('pj-open').innerHTML = r.open.map((p) => `<div class="pj-row ${project && p.id === project.id ? 'cur' : ''}" data-pid="${p.id}"><b>${esc(p.name)}</b><span class="d">${esc(p.dir)}</span>`
    + `${p.watching ? '<span class="git" style="color:#7be0a0" title="实时同步中">●</span>' : ''}`
    + `${p.primary ? '' : `<span class="mini no" data-close="${p.id}" title="关闭这个项目(不删除任何文件;以后还能从「最近」里再打开)">✕</span>`}</div>`).join('');
  $('pj-recent-wrap').hidden = !r.recent.length;
  $('pj-recent').innerHTML = r.recent.map((d) => `<div class="pj-row" data-dir="${esc(d.dir)}" data-has="${d.hasUniverse ? 1 : ''}"><b>${d.hasUniverse ? '<span class="mark">★</span> ' : ''}${esc(d.name)}</b><span class="d">${esc(d.dir)}</span></div>`).join('');
}
async function ls(dir) {
  let r;
  try { r = await api('/api/ls?dir=' + encodeURIComponent(dir || '')); } catch (e) { pjMsg(e.message, true); return; }
  lsCur = r;
  $('pj-path').value = r.dir;
  $('pj-up').style.opacity = r.parent ? 1 : 0.3;
  $('pj-list').innerHTML = r.entries.map((e) => `<div class="pj-row" data-ls="${esc(e.path)}" title="${e.hasUniverse ? '有宇宙 · ' : ''}点击进入">`
    + `<b>${e.hasUniverse ? '<span class="mark">★</span> ' : ''}${esc(e.name)}</b><span class="d"></span>${e.isGit ? '<span class="git">git</span>' : ''}`
    + `${e.hasUniverse ? `<span class="mini ok" data-go="${esc(e.path)}">打开</span>` : ''}</div>`).join('') || '<div class="tag" style="padding:6px">(没有子文件夹)</div>';
  const isOpen = openList.find((p) => p.dir === r.dir);
  $('pj-here').textContent = isOpen ? `切换到 ${baseName(r.dir)}` : r.hasUniverse ? `打开 ${baseName(r.dir)} 的宇宙` : `在 ${baseName(r.dir)} 建立宇宙(扫描文件)`;
  pjMsg(r.hasUniverse ? '' : '这里还没有 universe.stars;建立时会扫描文件夹(遵守 .gitignore),写入 universe.stars');
}
async function openDir(dir, create = false) {
  pjMsg(create ? '正在扫描并建立宇宙…' : '正在打开…');
  try { switchProject(await api('/api/open', { dir, create })); pjMsg(''); } catch (e) { pjMsg(e.message, true); }
}
/** 关掉一个打开着的项目;正看着它就回到主项目 */
async function closeProject(id) {
  const p = openList.find((x) => x.id === id);
  await api('/api/close', { id });
  if (project && project.id === id) switchProject(openList.find((x) => x.primary));
  if (!$('projects').hidden) await renderProjects();
  return p ? `已关闭 ${p.name}` : '已关闭';
}
$('projects').addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-close],[data-go],[data-pid],[data-dir],[data-ls]'); if (!t) return;
  if (t.dataset.close) closeProject(t.dataset.close).then(pjMsg, (e) => pjMsg(e.message, true));
  else if (t.dataset.go) openDir(t.dataset.go);
  else if (t.dataset.pid) switchProject(openList.find((p) => p.id === t.dataset.pid));
  else if (t.dataset.dir) { if (t.dataset.has) openDir(t.dataset.dir); else ls(t.dataset.dir); }
  else if (t.dataset.ls) ls(t.dataset.ls);
});
$('pj-up').addEventListener('click', () => { if (lsCur && lsCur.parent) ls(lsCur.parent); });
$('pj-path').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ls($('pj-path').value.trim()); });
$('pj-here').addEventListener('click', () => { if (lsCur) openDir(lsCur.dir, !lsCur.hasUniverse); });
