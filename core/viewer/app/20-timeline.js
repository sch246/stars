// ---------- 图例:视图用到"新旧"时说明颜色的含义 ----------
function renderLegend() {
  const spec = draftSpec || specs[currentView] || {};
  const rc = (spec.color || []).find((c) => c.by === 'recency');
  const el = $('legend');
  if (!rc) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<div>颜色 = 多久之前动过</div><div class="bar" style="background:linear-gradient(90deg,${rc.from || '#2f3b6e'},${rc.to || '#ffcf70'})"></div>`
    + `<div class="lab"><span>很久以前</span><span>半衰期 ${rc.halfLifeDays || 14} 天</span><span>刚刚</span></div>`;
}

// ---------- 时间线:宇宙文件的 git 提交图(分叉、合并都画出来),点击回放 ----------
// 长历史:先载入最近的一批,"更早 …"再往前翻;复杂历史:连线沿着自己的泳道走,只在分出/汇入时拐弯,
// 泳道用完就回收,不会出现横跨整张图的斜线。
const laneColor = (i) => ['#7aa7ff', '#ffb347', '#7be0a0', '#d98cff', '#ff7a90', '#5fd4e8'][i % 6];
let playTimer = null, histLimit = 300, histScope = 'auto';   // auto:宇宙文件有历史就看它,没有就看所在文件夹的
async function loadHistory() {
  try { hist = await api('/api/history?limit=' + histLimit + '&scope=' + histScope); } catch (e) { $('tl-info').textContent = '读取历史失败:' + e.message; return false; }
  $('tl-more').hidden = !hist.more;
  $('tl-scope').textContent = hist.scope === 'repo' ? '📁 文件夹的历史' : '✦ 宇宙文件的历史';
  return true;
}
async function tlScope() {   // 宇宙文件的历史 ↔ 所在文件夹的历史
  stopPlay(); if (replay) exitReplay();
  histScope = hist && hist.scope === 'repo' ? 'file' : 'repo'; histLimit = 300;
  if (!(await loadHistory())) return;
  renderTimeline();
  const w = $('tl-wrap'); w.scrollLeft = w.scrollWidth;
}
async function toggleTimeline(on) {
  $('timeline').hidden = !on; $('btn-time').classList.toggle('on', on);
  if (!on) { stopPlay(); if (replay) exitReplay(); return; }
  if (!(await loadHistory())) return;
  renderTimeline();
  const w = $('tl-wrap'); w.scrollLeft = w.scrollWidth;
}
async function tlMore() {     // 再往前多载一倍
  const w = $('tl-wrap'), fromRight = w.scrollWidth - w.scrollLeft;
  histLimit *= 2;
  if (!(await loadHistory())) return;
  renderTimeline();
  w.scrollLeft = w.scrollWidth - fromRight; // 视野停在原来看的地方
}

/** 泳道布局:从新到旧扫一遍。lanes[j] = 这条泳道正在等的父提交;每条边记下它走的泳道。 */
function laneLayout(cs) {
  const lanes = [], lane = new Map(), edges = [];
  const free = () => { const j = lanes.indexOf(null); return j < 0 ? lanes.length : j; };
  for (const c of cs) {
    let i = lanes.indexOf(c.hash);
    if (i < 0) i = free();                                   // 一个分支的尖端:找一条空泳道
    lane.set(c.hash, i);
    for (let j = 0; j < lanes.length; j++) if (j !== i && lanes[j] === c.hash) lanes[j] = null; // 别的泳道在这里汇入
    const [p0, ...rest] = c.parents;
    lanes[i] = p0 ?? null;
    if (p0) edges.push({ c: c.hash, p: p0, l: i });
    for (const p of rest) {                                  // 合并:其余父提交各占(或沿用)一条泳道
      let j = lanes.indexOf(p);
      if (j < 0) { j = free(); lanes[j] = p; }
      edges.push({ c: c.hash, p, l: j });
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
  }
  let n = 1;
  for (const v of lane.values()) n = Math.max(n, v + 1);
  for (const e of edges) n = Math.max(n, e.l + 1);
  return { lane, edges, n };
}

function renderTimeline() {
  const svg = $('tl-svg');
  if (!hist) return;
  const cs = hist.commits;
  if (!cs.length) {
    svg.innerHTML = ''; svg.setAttribute('width', 0); svg.setAttribute('height', 0);
    $('tl-info').textContent = hist.scope === 'repo' ? '这个文件夹还没有 git 提交' : '宇宙文件还没有提交过 —— 点「宇宙文件的历史」切到文件夹的 git 历史看看';
    return;
  }
  const { lane, edges, n: nLanes } = laneLayout(cs);
  const dx = 24, pad = 26, lh = 17, top = 30, N = cs.length + (hist.dirty ? 1 : 0);
  const X = (i) => pad + (N - 1 - i - (hist.dirty ? 1 : 0)) * dx;  // 新的在右
  const Y = (l) => top + l * lh;
  const idx = new Map(cs.map((c, i) => [c.hash, i]));
  const W = pad * 2 + N * dx + 70, H = top + nLanes * lh + 6;   // 右边留出最新提交的分支名
  let out = '';
  // 日期刻度:从旧到新,换天时标一下(太挤就跳过)
  let lastDay = '', lastX = -1e9, lastYear = '';
  for (let i = cs.length - 1; i >= 0; i--) {
    const d = new Date(cs[i].time), day = d.toDateString(), x = X(i);
    if (day === lastDay || x - lastX < 64) continue;
    const y = String(d.getFullYear()), label = (y !== lastYear ? y + '-' : '') + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    out += `<line x1="${x}" y1="14" x2="${x}" y2="${H}" stroke="#ffffff10"/><text x="${x + 3}" y="11" style="fill:#6a6a88">${label}</text>`;
    lastDay = day; lastX = x; lastYear = y;
  }
  // 连线:出发时(合并的其余父)拐进自己的泳道 → 沿泳道走 → 到父提交前拐进它的泳道
  for (const e of edges) {
    const ic = idx.get(e.c), ip = idx.get(e.p);
    const xc = X(ic), yc = Y(lane.get(e.c)), yL = Y(e.l), col = laneColor(e.l);
    if (ip === undefined) { // 父提交在更早的批次里:画到左边缘,虚线表示"还有"
      out += `<path d="M${xc} ${yc}${yL !== yc ? ` C${xc - dx * 0.5} ${yc},${xc - dx * 0.5} ${yL},${xc - dx} ${yL}` : ''} L${pad - 14} ${yL}" stroke="${col}" stroke-width="1.6" fill="none" stroke-dasharray="3 3" opacity=".6"/>`;
      continue;
    }
    const xp = X(ip), yp = Y(lane.get(e.p));
    let d;
    if (yc === yL && yL === yp) d = `M${xc} ${yc} L${xp} ${yp}`;
    else if (xc - xp < dx * 1.7) d = `M${xc} ${yc} C${(xc + xp) / 2} ${yc},${(xc + xp) / 2} ${yp},${xp} ${yp}`;
    else {
      d = `M${xc} ${yc}`;
      if (yL !== yc) d += ` C${xc - dx * 0.5} ${yc},${xc - dx * 0.5} ${yL},${xc - dx} ${yL}`;
      d += ` L${yL !== yp ? xp + dx : xp} ${yL}`;
      if (yL !== yp) d += ` C${xp + dx * 0.5} ${yL},${xp + dx * 0.5} ${yp},${xp} ${yp}`;
    }
    out += `<path d="${d}" stroke="${col}" stroke-width="1.6" fill="none" opacity=".85"/>`;
  }
  const headPos = hist.head && idx.has(hist.head) ? { x: X(idx.get(hist.head)), y: Y(lane.get(hist.head)) } : null;
  if (hist.dirty && headPos) {
    const wx = pad + (N - 1) * dx;
    out += `<line x1="${headPos.x}" y1="${headPos.y}" x2="${wx}" y2="${headPos.y}" stroke="#888" stroke-dasharray="3 3"/>`
      + `<g class="c" data-work="1"><circle cx="${wx}" cy="${headPos.y}" r="5" fill="none" stroke="#bbb" stroke-dasharray="2 2"/><title>工作区(未提交的修改)</title></g>`;
  }
  for (const c of cs) {
    const x = X(idx.get(c.hash)), y = Y(lane.get(c.hash)), col = laneColor(lane.get(c.hash));
    const cur = replay && replay.hash === c.hash, merge = c.parents.length > 1;
    out += `<g class="c" data-h="${c.hash}"><circle cx="${x}" cy="${y}" r="${cur ? 6.5 : 4.5}" fill="${merge ? '#0b0b14' : col}" stroke="${cur ? '#fff' : col}" stroke-width="${merge || cur ? 2 : 1}"/>`
      + `<title>${esc(c.subject)}\n${esc(c.author)} · ${new Date(c.time).toLocaleString()}\n${c.hash.slice(0, 7)}${merge ? ' · 合并' : ''}${c.refs.length ? '\n' + esc(c.refs.join(', ')) : ''}</title></g>`;
    if (c.refs.length) {
      const r = c.refs[0] + (c.refs.length > 1 ? ` +${c.refs.length - 1}` : '');
      out += `<text x="${x + 7}" y="${y - 6}" style="fill:${col}">${esc(r)}</text>`;
    }
  }
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  svg.innerHTML = out;
  $('tl-info').textContent = replay ? `${replay.commit.subject} · ${replay.commit.author} · ${new Date(replay.commit.time).toLocaleString()}`
    : `${cs.length}${hist.more ? '+' : ''} 个提交 · ${nLanes} 条泳道 · 点击任一提交回放那一刻的宇宙`;
}
$('tl-svg').addEventListener('click', (ev) => {
  const g = ev.target.closest('.c'); if (!g) return;
  if (g.dataset.work) exitReplay(); else openCommit(g.dataset.h);
});

async function openCommit(hash) {
  const commit = hist.commits.find((c) => c.hash === hash);
  if (!commit) return;
  if (draftOn) exitDraft();   // 回放和草稿预览不同时开
  let st;
  $('tl-info').textContent = '载入中…';
  try { st = await api('/api/state?commit=' + hash + '&scope=' + hist.scope); } catch (e) { $('tl-info').textContent = '读取失败:' + e.message; return; }
  if (!hist || !hist.commits.some((c) => c.hash === hash)) return; // 等待期间切换了范围
  replay = { hash, commit, added: new Set(st.diff.addedNodes), changed: new Set(st.diff.changedNodes), removed: st.diff.removedNodes.length };
  applyData({ ...(liveSnap || data), nodes: st.nodes, edges: st.edges, issues: [], signals: {} }, false);
  const t = performance.now();
  for (const id of replay.added) { const n = sim.get(id); if (n) n.born = t; }
  renderTimeline(); renderReplayBar();
}
function exitReplay() {
  stopPlay(); replay = null;
  if (staleLive) { staleLive = false; resync(); } else if (liveSnap) applyData(liveSnap);
  renderTimeline(); renderReplayBar();
}
function renderReplayBar() {
  const el = $('replaybar');
  if (!replay) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<b>回放</b><span>${replay.commit.hash.slice(0, 7)} · ${esc(replay.commit.author)}</span>`
    + `<span style="color:#7be0a0">+${replay.added.size}</span><span style="color:#ffb347">~${replay.changed.size}</span><span style="color:#ff7a90">−${replay.removed}</span>`
    + `<span class="btn" id="rb-now">回到现在 (Esc)</span>`;
  $('rb-now').addEventListener('click', () => exec('timeline now', 'ui'));
}
// 沿"第一父节点"的主线前进/后退;不在主线上时往后退到父、往前进到任一子
function stepCommit(dir) {
  if (!hist || !hist.commits.length) return;
  const byHash = new Map(hist.commits.map((c) => [c.hash, c]));
  const cur = replay ? byHash.get(replay.hash) : null;
  if (!cur) { if (dir < 0) openCommit(hist.head && byHash.has(hist.head) ? hist.head : hist.commits[0].hash); return; }
  if (dir < 0) { if (cur.parents[0] && byHash.has(cur.parents[0])) openCommit(cur.parents[0]); return; }
  const mainline = new Set(); for (let c = byHash.get(hist.head); c; c = byHash.get(c.parents[0])) mainline.add(c.hash);
  const kids = hist.commits.filter((c) => c.parents[0] === cur.hash).sort((a, b) => (mainline.has(b.hash) - mainline.has(a.hash)) || a.time - b.time);
  if (kids[0]) openCommit(kids[0].hash); else if (!mainline.has(cur.hash) || cur.hash === hist.head) stopPlay();
}
function stopPlay() { clearInterval(playTimer); playTimer = null; $('tl-play').textContent = '▶'; }
function tlPlay() {
  if (!hist || !hist.commits.length) return false;
  if (playTimer) { stopPlay(); return; }
  $('tl-play').textContent = '⏸';
  if (!replay) { const oldest = hist.commits.filter((c) => !c.parents.length).sort((a, b) => a.time - b.time)[0] || hist.commits[hist.commits.length - 1]; openCommit(oldest.hash); }
  playTimer = setInterval(() => stepCommit(1), 1300);
}
function tlFirst() { if (!hist) return false; const o = hist.commits.filter((c) => !c.parents.length).sort((a, b) => a.time - b.time)[0]; if (o) openCommit(o.hash); }

function toggleExpand(id) {
  const n = sim.get(id);
  if (!n || !n.container) return;
  manual.set(id, !n.expanded);
  savePlace();
  recompute(false);
}
// 双击不在这里处理:统一走 handleTap() 的"原地双击"(作用在第一次点击的目标上),镜头移动也不会点空。
