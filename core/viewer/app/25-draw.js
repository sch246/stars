// ---------- 绘制 ----------
function resize() { const dpr = devicePixelRatio || 1; canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; }
addEventListener('resize', resize); resize();

// 星空:屏幕空间,三层视差
const stars = Array.from({ length: 520 }, (_, i) => {
  const r = Math.random(); // 伪随机但固定
  return { x: Math.random(), y: Math.random(), s: 0.3 + Math.pow(Math.random(), 3) * 1.6, layer: i % 3, ph: Math.random() * TAU, hue: Math.random() };
});

const matches = (id) => !filt || matchSet.has(id);

// 发光用预渲染的精灵图(每种颜色一张),而不是每帧、每个节点 createRadialGradient —— 快一个数量级
const spriteCache = new Map();
function sprite(c) {
  const key = c[0] + ',' + c[1] + ',' + c[2];
  let sp = spriteCache.get(key);
  if (!sp) {
    sp = document.createElement('canvas'); sp.width = sp.height = 64;
    const g = sp.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(c, 1)); gr.addColorStop(0.3, rgba(c, 0.4)); gr.addColorStop(0.7, rgba(c, 0.08)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    spriteCache.set(key, sp);
  }
  return sp;
}
function glow(x, y, rad, c, a) {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * a;
  ctx.drawImage(sprite(c), x - rad, y - rad, rad * 2, rad * 2);
  ctx.globalAlpha = prev;
}

// 背景:0 = 星点 + 远方星系,1 = 只有星点,2 = 无(只有暗色底)。和文件夹边界一样是一项设置(display.bg / display.bounds)
const BG_MODES = ['galaxy', 'dots', 'none'];
let bgMode = Math.max(0, BG_MODES.indexOf(P.bg));
function setBg(m) { setParam('bg', BG_MODES[((m % 3) + 3) % 3]); }

// 文件夹的边界(虚线圆)与半透明底:视图层开关(视图规则 space.boundary=false 也关)。关掉后交互与文字保留,边界和底色全透明。
let showBounds = !!P.bounds;
const boundsOn = () => showBounds && (((draftSpec ?? specs[currentView] ?? {}).space || {}).boundary !== false);
function setBounds(on) { setParam('bounds', on ? 1 : 0); }

function drawBackdrop(now) {
  const W = innerWidth, H = innerHeight;
  if (look !== 'galaxy') { ctx.fillStyle = '#07070d'; ctx.fillRect(0, 0, W, H); return; }
  const g = ctx.createRadialGradient(W * 0.5, H * 0.46, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.85);
  g.addColorStop(0, '#0d0b22'); g.addColorStop(0.5, '#05050f'); g.addColorStop(1, '#01010605');
  ctx.fillStyle = '#010106'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (bgMode === 2) return; // 背景关闭:只留暗色渐变
  // 银河光带:一条斜向的柔光
  ctx.save(); ctx.translate(W * 0.5 + transform.x * 0.04, H * 0.5 + transform.y * 0.04); ctx.rotate(-0.45);
  const band = ctx.createLinearGradient(0, -H * 0.35, 0, H * 0.35);
  band.addColorStop(0, 'rgba(90,70,200,0)'); band.addColorStop(0.5, 'rgba(110,90,230,0.07)'); band.addColorStop(1, 'rgba(60,120,220,0)');
  ctx.fillStyle = band; ctx.fillRect(-W, -H * 0.35, W * 2, H * 0.7); ctx.restore();
  ctx.globalCompositeOperation = 'lighter';
  const sb = new Map();
  for (const s of stars) {
    const par = 0.015 + s.layer * 0.03;
    const x = (((s.x * W + transform.x * par) % W) + W) % W, y = (((s.y * H + transform.y * par) % H) + H) % H;
    const tw = Math.round((0.6 + 0.4 * Math.sin(now / 700 + s.ph)) * 4) / 4;
    const kind = s.hue > 0.8 ? 0 : s.hue < 0.2 ? 1 : 2, sz = s.s * (0.7 + s.layer * 0.25);
    const key = kind * 8 + Math.round(tw * 4);
    let bk = sb.get(key);
    if (!bk) { bk = { kind, tw, pts: [] }; sb.set(key, bk); }
    bk.pts.push(x, y, sz);
  }
  const STAR_RGB = [[255, 214, 170, 0.55], [170, 200, 255, 0.6], [235, 235, 255, 0.5]];
  for (const { kind, tw, pts } of sb.values()) {
    const [r, g, bl, al] = STAR_RGB[kind];
    ctx.fillStyle = `rgba(${r},${g},${bl},${al * tw})`;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 3) ctx.rect(pts[i] - pts[i + 2], pts[i + 1] - pts[i + 2], pts[i + 2] * 2, pts[i + 2] * 2);
    ctx.fill();
  }
  if (bgMode === 0) drawFarGalaxies(now);
  ctx.globalCompositeOperation = 'source-over';
}

// 收起的容器 = 一个小星系:粒子是它里面的东西(颜色、大小取自内容),缓缓旋转
/** 旋臂上第 i 颗(共 len 颗)粒子:相对容器中心的位置(容器所在空间的坐标)与粒子大小 */
function armPoint(n, i, len, now) {
  const t = (i + 1) / len, arm = i % 3, rad = n.r * (1.15 + 2.9 * t);
  const ang = arm * 2.0944 + t * 5.5 + now * 0.00028 / Math.sqrt(t + 0.25) + n.phase;
  const px = Math.cos(ang) * rad, py = Math.sin(ang) * rad * 0.62, ct = Math.cos(n.tilt), st = Math.sin(n.tilt);
  const kr = n.kidRgb[Math.floor(i * n.kidRgb.length / len)][1];
  return [ct * px - st * py, st * px + ct * py, Math.max(0.7, Math.min(2.2, kr * 0.34))];
}
function pushParticle(col, a, x, y, size) {
  const key = col[0] + ',' + col[1] + ',' + col[2] + '|' + a;
  let bk = particles.get(key);
  if (!bk) { bk = { col, a, pts: [] }; particles.set(key, bk); }
  bk.pts.push(x, y, size);
}
function drawGalaxyArms(n, now, a) {
  const sr = n.r * curK;
  if (sr < 4.5) return; // 屏幕上太小,画粒子也看不清
  const len = sr > 12 ? n.kidRgb.length : Math.min(n.kidRgb.length, sr > 8 ? 24 : 12), aq = Math.round(a * 4) / 4;
  for (let i = 0; i < len; i++) {
    const [dx, dy, pr] = armPoint(n, i, len, now);
    pushParticle(n.kidRgb[Math.floor(i * n.kidRgb.length / len)][0], aq, n.x + dx, n.y + dy, pr);
  }
}
const particles = new Map();
function flushParticles() {
  for (const { col, a, pts } of particles.values()) {
    ctx.fillStyle = rgba(col, 0.9 * a);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 3) { const sz = pts[i + 2] * 0.8; ctx.moveTo(pts[i] + sz, pts[i + 1]); ctx.arc(pts[i], pts[i + 1], sz, 0, TAU); } // 一种颜色一条路径:仍然只填充一次
    ctx.fill();
  }
  particles.clear();
}

// 背景里的远方星系:纯装饰,程序化生成(固定种子),不可交互
const farGalaxies = Array.from({ length: 9 }, (_, i) => {
  const h = (i + 1) * 2654435761 % 4294967296 / 4294967296;
  return { x: (h * 7.31) % 1, y: (h * 13.17 + i * 0.11) % 1, size: 16 + (h * 97) % 26, squash: 0.35 + (h * 31) % 0.45, rot: (h * 29) % 3.14,
    layer: 1 + (i % 2), tint: [[170, 200, 255], [255, 205, 165], [205, 170, 255]][i % 3], n: 56 };
});
function drawFarGalaxies(now) {
  const W = innerWidth, H = innerHeight, kk = 1 + Math.max(-0.4, Math.min(3, transform.k - 1)) * 0.08;
  for (const g of farGalaxies) {
    const par = 0.02 + g.layer * 0.03;
    const gx = (((g.x * W + transform.x * par) % W) + W) % W, gy = (((g.y * H + transform.y * par) % H) + H) % H;
    const sz = g.size * kk;
    glow(gx, gy, sz * 1.1, g.tint, 0.16); glow(gx, gy, sz * 0.28, [255, 255, 255], 0.35);
    const ct = Math.cos(g.rot), st = Math.sin(g.rot);
    ctx.fillStyle = rgba(g.tint, 0.42);
    ctx.beginPath();
    for (let i = 0; i < g.n; i++) {
      const t = (i + 1) / g.n, arm = i % 2;
      const rad = sz * (0.2 + 0.8 * t);
      const ang = arm * Math.PI + t * 6 + now * 0.00006 / Math.sqrt(t + 0.3);
      const px = Math.cos(ang) * rad, py = Math.sin(ang) * rad * g.squash, q = 0.55 + (1 - t) * 0.5;
      ctx.rect(gx + ct * px - st * py - q, gy + st * px + ct * py - q, q * 2, q * 2);
    }
    ctx.fill();
  }
}

function drawArrow(a, b, col, alpha, k) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 1) return;
  const ang = Math.atan2(b.y - a.y, b.x - a.x), sz = 7 / k;
  const tx = b.x - Math.cos(ang) * (b.r * 1.3 + 3), ty = b.y - Math.sin(ang) * (b.r * 1.3 + 3);
  ctx.fillStyle = rgba(col, alpha);
  ctx.beginPath(); ctx.moveTo(tx, ty);
  ctx.lineTo(tx - Math.cos(ang - 0.4) * sz, ty - Math.sin(ang - 0.4) * sz);
  ctx.lineTo(tx - Math.cos(ang + 0.4) * sz, ty - Math.sin(ang + 0.4) * sz);
  ctx.closePath(); ctx.fill();
}

// 悬浮的反馈只是一圈描边:不改变节点的透明度、大小或"点↔完整节点"的呈现,免得鼠标扫过时东西一闪一闪。
function hoverRing(n) {
  if (!n || n.x === undefined) return;
  const gco = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5 / Math.max(curK, 1e-6);
  ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 1.7 + 5 / Math.max(curK, 1e-6), 0, TAU); ctx.stroke();
  ctx.globalCompositeOperation = gco;
}

function drawNode(n, now, a, arms = true) {
  const r = n.r, x = n.x, y = n.y, c = n.rgb;
  switch (n.shape) {
    case 'nebula': {
      const open = n.container && n.expanded;
      const br = 1 + 0.05 * Math.sin(now / 1400 + n.phase);
      const rr = open ? r * 0.6 : r;
      if (r * curK < 6) glow(x, y, rr * 4.2, c, 0.55 * a); // 屏幕上还很小:一层发光就够
      else { glow(x, y, rr * 6.5 * br, c, (open ? 0.18 : 0.32) * a); glow(x, y, rr * 3, c, 0.38 * a); glow(x, y, rr * 1, n.core, 0.7 * a); }
      if (arms && n.kidRgb && n.kidRgb.length) drawGalaxyArms(n, now, a);
      break;
    }
    case 'ringed': {
      glow(x, y, r * 3.4, c, 0.5 * a);
      ctx.strokeStyle = rgba(n.core, 0.75 * a); ctx.lineWidth = Math.max(0.7, r * 0.12);
      ctx.beginPath(); ctx.ellipse(x, y, r * 2.3, r * 0.85, -0.45, 0, TAU); ctx.stroke();
      ctx.fillStyle = rgba(n.core, a); ctx.beginPath(); ctx.arc(x, y, r * 0.75, 0, TAU); ctx.fill();
      break;
    }
    case 'pulsar': {
      const p = 0.5 + 0.5 * Math.sin(now / 520 + n.phase);
      glow(x, y, r * (3.6 + p * 1.6), c, 0.6 * a);
      ctx.strokeStyle = rgba(n.core, (0.35 + 0.3 * p) * a); ctx.lineWidth = Math.max(0.6, r * 0.09);
      const L = Math.min(r * (3.2 + p * 3.2), 90 / curK);
      ctx.beginPath(); ctx.moveTo(x - L, y); ctx.lineTo(x + L, y); ctx.moveTo(x, y - L); ctx.lineTo(x, y + L); ctx.stroke();
      ctx.fillStyle = rgba(n.core, a); ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, TAU); ctx.fill();
      break;
    }
    case 'dot':
      ctx.fillStyle = rgba(c, a); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      break;
    default: { // star
      const tw = 0.85 + 0.15 * Math.sin(now / 600 + n.phase);
      glow(x, y, r * 5 * tw, c, 0.75 * a);
      if (r >= 5) {
        ctx.strokeStyle = rgba(n.core, 0.3 * a); ctx.lineWidth = 0.7;
        const L = Math.min(r * 3.4, 70 / curK); ctx.beginPath(); ctx.moveTo(x - L, y); ctx.lineTo(x + L, y); ctx.moveTo(x, y - L); ctx.lineTo(x, y + L); ctx.stroke();
      }
      ctx.fillStyle = rgba(n.core, a); ctx.beginPath(); ctx.arc(x, y, Math.max(0.9, r * 0.62), 0, TAU); ctx.fill();
    }
  }
}

/** tag 视图:在每个团上写 tag 名。第 1 层写在团的上沿;第 2 层团在屏幕上够大时写在团中间。放大到团里面就不写了。 */
function drawTagGroups(k, TX, TY, VW, VH) {
  if (!tagGroups.length) return;
  const big = Math.min(VW, VH);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const g of tagGroups) {
    const R = g.r * k, sx = g.x * k + TX, sy = g.y * k + TY;
    if ((g.depth === 2 && R < 36) || R > big * 0.8) continue;
    if (sx + R < 0 || sx - R > VW || sy + R < 0 || sy - R > VH) continue;
    const name = raw.get(g.id)?.label || g.id, px = g.depth === 1 ? 15 : 11.5;
    ctx.font = `600 ${px / k}px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
    if (g.depth === 2 && ctx.measureText(name).width * k > R * 1.9) continue;
    const on = activeTags.has(g.id), col = hex2rgb(tagColor.get(g.id) || '#c8c8e0');
    const y = g.depth === 1 ? g.y - g.r - 10 / k : g.y;
    ctx.globalAlpha = activeTags.size && !on ? 0.25 : g.depth === 1 ? 0.95 : 0.7;
    ctx.strokeStyle = 'rgba(2,2,10,0.85)'; ctx.lineWidth = 4 / k; ctx.strokeText(name, g.x, y);
    ctx.fillStyle = rgba(on ? [255, 255, 255] : mix(col, [255, 255, 255], 0.45), 1); ctx.fillText(name, g.x, y);
  }
  ctx.globalAlpha = 1;
}

// 悬浮标签用光标气泡,不进入图谱标签的避让重排,所以鼠标移动时别的标签不会跳。
function drawHoverTip() {
  if (!hovered || !pointerXY || !compiled) return;
  const label = hovered.label || hovered.id;
  if (!label) return;
  const dpr = devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.setLineDash([]);
  ctx.font = '12px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
  const pad = 6, h = 17, w = ctx.measureText(label).width;
  let bx = pointerXY[0] + 14, by = pointerXY[1] + 16;
  if (bx + w + pad * 2 > innerWidth) bx = pointerXY[0] - 14 - w - pad * 2;
  if (by + h + pad > innerHeight) by = pointerXY[1] - 16 - h - pad;
  const bw = w + pad * 2, rr = 5;
  ctx.beginPath();
  ctx.moveTo(bx + rr, by); ctx.arcTo(bx + bw, by, bx + bw, by + h + pad, rr);
  ctx.arcTo(bx + bw, by + h + pad, bx, by + h + pad, rr); ctx.arcTo(bx, by + h + pad, bx, by, rr);
  ctx.arcTo(bx, by, bx + bw, by, rr); ctx.closePath();
  ctx.fillStyle = 'rgba(8,10,24,0.92)'; ctx.fill();
  ctx.strokeStyle = 'rgba(122,142,220,0.75)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#e8e8f6'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + pad, by + (h + pad) / 2);
  ctx.restore();
}

function draw(now) {
  now = now || performance.now();
  stepCamera(now);  // 相机唯一权威:跟随时每帧只在这里推进一次,别处只读
  const frameStart = performance.now();
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  drawBackdrop(now);
  if (isSpaces()) {
    drawSpacesFrame(now);
    drawHoverTip();
    perf.frameMs = perf.frameMs * 0.9 + (performance.now() - frameStart) * 0.1;
    requestAnimationFrame(draw);
    return;
  }

  const galaxy = look === 'galaxy';
  ctx.save();
  const k = transform.k;
  const camX = transform.x, camY = transform.y;
  ctx.translate(camX, camY); ctx.scale(k, k);
  curK = k;
  const VW = innerWidth, VH = innerHeight, TX = camX, TY = camY;
  const onScreen = (n, extra) => { const m = n.r * extra * k + 24, sx = n.x * k + TX, sy = n.y * k + TY; return sx > -m && sx < VW + m && sy > -m && sy < VH + m; };

  const focus = selected ? new Set([selected]) : null;
  if (focus) for (const l of links) { if (l.source.id === selected) focus.add(l.target.id); if (l.target.id === selected) focus.add(l.source.id); }
  const tagOK = (n) => !activeTags.size || (n.tags && n.tags.some((t) => activeTags.has(t)));
  const alphaOf = (n) => (filt && !matches(n.id) ? 0.1 : !tagOK(n) ? 0.1 : P.highlight > 0 && focus && !focus.has(n.id) ? 0.2 : 1);

  ctx.globalCompositeOperation = galaxy ? 'lighter' : 'source-over';
  const tR = performance.now();
  // 域:展开的容器与它的后代之间,一片柔和的疆界。凸包较贵,缓存并节流到约每 220ms 重算一次
  for (const reg of regions) {
    if (!boundsOn()) continue; // 关掉文件夹边界:平铺视图的域也不画
    if (!reg.hull || now - reg.hullAt > 220) {
      const mem = reg.members.filter((m) => m.x !== undefined && visible(m));
      if (mem.length < 2) { reg.hull = null; reg.hullAt = now; continue; }
      const per = mem.length > 60 ? 4 : 7, pts = [];
      for (const m of mem) { const rr = m.r * 1.7 + 12; for (let i = 0; i < per; i++) { const t = i * TAU / per; pts.push([m.x + Math.cos(t) * rr, m.y + Math.sin(t) * rr]); } }
      reg.hull = d3.polygonHull(pts); reg.hullAt = now;
    }
    if (!reg.hull) continue;
    const a = Math.min(alphaOf(reg.node), 1), c = reg.node.rgb, hot = reg.id === selected;
    ctx.beginPath(); d3.line().curve(d3.curveCatmullRomClosed.alpha(0.6)).context(ctx)(reg.hull);
    ctx.fillStyle = rgba(c, (hot ? 0.11 : 0.06) * a); ctx.fill();
    ctx.strokeStyle = rgba(c, (hot ? 0.55 : 0.22) * a); ctx.lineWidth = (hot ? 1.6 : 1) / k;
    ctx.setLineDash([6 / k, 5 / k]); ctx.stroke(); ctx.setLineDash([]);
  }
  perf.regionsMs = perf.regionsMs * 0.9 + (performance.now() - tR) * 0.1;
  const tE = performance.now();
  const edgeLabels = [];
  // 边:按(模式,颜色,透明度档,线宽,虚线)合批,一批只描一次边;只有和选中节点相关的才单独画
  const buckets = new Map(), few = links.length < 600;
  for (const l of links) {
    const a = l.source, b = l.target;
    if (a.x === undefined || b.x === undefined || l.mode === 'region') continue;
    const ax = a.x * k + TX, ay = a.y * k + TY, bx = b.x * k + TX, by = b.y * k + TY;
    if (Math.max(ax, bx) < -60 || Math.min(ax, bx) > VW + 60 || Math.min(ay, by) > VH + 60 || Math.max(ay, by) < -60) continue;
    const alpha = Math.min(alphaOf(a), alphaOf(b));
    const hot = focus && (a.id === selected || b.id === selected);
    if (hot) {
      const col = l.proposed ? [255, 210, 74] : hex2rgb(l.color), d = Math.hypot(b.x - a.x, b.y - a.y);
      if (l.mode === 'orbit') {
        ctx.strokeStyle = rgba(col, 0.6 * alpha); ctx.lineWidth = 1.2 / k;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = rgba(mix(col, a.rgb, 0.5), 0.28 * alpha);
        ctx.beginPath(); ctx.arc(a.x, a.y, d, 0, TAU); ctx.stroke();
        continue;
      }
      ctx.strokeStyle = rgba(col, 0.9 * alpha); ctx.lineWidth = (l.width || 1) * 1.8 / k;
      ctx.setLineDash(l.proposed ? [5 / k, 4 / k] : l.lifted ? [2 / k, 4 / k] : []);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      if (l.count > 1 || l.lifted) edgeLabels.push([l, (a.x + b.x) / 2, (a.y + b.y) / 2, alpha]);
      if (l.arrow && d > 1) drawArrow(a, b, col, 0.95 * alpha, k);
      continue;
    }
    const wq = Math.round((l.width || 1) * (l.lifted ? 0.8 + Math.min(Math.log2(l.count + 1), 3) * 0.5 : 1) * 4) / 4;
    const key = `${l.mode}|${l.proposed ? 'p' : l.color}|${Math.round(alpha * 10)}|${wq}|${l.proposed ? 'p' : l.lifted ? 'l' : ''}`;
    let bk = buckets.get(key);
    if (!bk) { bk = { l, alpha, wq, segs: [] }; buckets.set(key, bk); }
    bk.segs.push(l);
    if (few && l.lifted) edgeLabels.push([l, (a.x + b.x) / 2, (a.y + b.y) / 2, alpha]);
  }
  for (const { l, alpha, wq, segs } of buckets.values()) {
    const col = l.proposed ? [255, 210, 74] : hex2rgb(l.color);
    ctx.beginPath();
    if (l.mode === 'orbit') {
      ctx.strokeStyle = rgba(mix(col, segs[0].source.rgb, 0.5), 0.07 * alpha); ctx.lineWidth = 0.7 / k;
      for (const e of segs) { const a = e.source, d = Math.hypot(e.target.x - a.x, e.target.y - a.y); ctx.moveTo(a.x + d, a.y); ctx.arc(a.x, a.y, d, 0, TAU); }
      ctx.stroke();
      continue;
    }
    ctx.strokeStyle = rgba(col, (l.mode === 'faint' ? 0.14 : 0.4) * alpha);
    ctx.lineWidth = wq / k * (galaxy ? 1 : 1.2);
    ctx.setLineDash(l.proposed ? [5 / k, 4 / k] : l.lifted ? [2 / k, 4 / k] : []);
    for (const e of segs) { ctx.moveTo(e.source.x, e.source.y); ctx.lineTo(e.target.x, e.target.y); }
    ctx.stroke(); ctx.setLineDash([]);
    if (few && l.arrow) for (const e of segs) drawArrow(e.source, e.target, col, 0.6 * alpha, k);
  }

  perf.edgesMs = perf.edgesMs * 0.9 + (performance.now() - tE) * 0.1;
  const tN = performance.now();
  // 节点:星云先画,其余在上
  const nodes = drawNodes.filter((n) => n.x !== undefined);
  for (const n of nodes) {
    if (!onScreen(n, 6.5)) continue;
    const isHover = n === hovered;
    if (n.r * k < 2.4 && n.id !== selected) { // 小到看不清发光细节的节点:一个点就够了
      const q = Math.max(1.6 / k, n.r * 0.9);   // 屏幕上至少 1.6px,否则上万个点糊成一片灰
      ctx.fillStyle = rgba(n.dot, 0.9 * alphaOf(n)); ctx.fillRect(n.x - q / 2, n.y - q / 2, q, q);
      if (isHover) hoverRing(n);
      continue;
    }
    drawNode(n, now, alphaOf(n));
    if (isHover) hoverRing(n);
    const age = now - (n.born || -1e9);
    if (age < 1800) { // 新生:扩散环
      const p = age / 1800;
      ctx.strokeStyle = rgba(n.rgb, (1 - p) * 0.9); ctx.lineWidth = 2 / k;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 4 + p * 60, 0, TAU); ctx.stroke();
    }
  }

  flushParticles();
  perf.nodesMs = perf.nodesMs * 0.9 + (performance.now() - tN) * 0.1;
  ctx.globalCompositeOperation = 'source-over';
  // 状态环与标签(只处理视口内的)
  const shown = nodes.filter((n) => onScreen(n, 1.5));
  for (const n of shown) {
    const sev = issueByNode.get(n.id), a = alphaOf(n);
    if (sev === 'error' || sev === 'warn') {
      ctx.strokeStyle = rgba(sev === 'error' ? [255, 90, 90] : [255, 179, 71], 0.9 * a); ctx.lineWidth = 1.4 / k;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 1.5 + 3, 0, TAU); ctx.stroke();
    }
    if (raw.get(n.id)?.attrs.status === 'proposed') {   // 待确认的节点:黄色虚线环(同提议的边)
      ctx.strokeStyle = rgba([255, 210, 74], 0.9 * a); ctx.lineWidth = 1.3 / k; ctx.setLineDash([4 / k, 3 / k]);
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 1.5 + 4.5, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    const ring = diffRing(n.id);
    if (ring) {
      ctx.strokeStyle = ring; ctx.lineWidth = 1.6 / k;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 1.5 + 9, 0, TAU); ctx.stroke();
    }
    if (n.id === selected) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.4 / k;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 1.5 + 6, 0, TAU); ctx.stroke();
    }
  }
  ctx.lineJoin = 'round';
  drawTagGroups(k, TX, TY, VW, VH);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const tiny = k < 0.35;                 // 缩得太小:普通标签读不出来,只留"必须"的,按屏幕上的固定字号画
  const fs = tiny ? 11 / k : 11 / Math.max(k, 0.55);
  ctx.font = `${fs}px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
  // 标签避让:按重要性排序,和已放置的标签重叠就不画(选中/悬停/聚焦邻居/搜索命中优先)。
  // 规划(排序+重叠检测)较贵,节流到约每 160ms 或交互状态变化时才重做,每帧只按最新位置画。
  const must = (n) => n.id === selected || (focus && focus.has(n.id)) || (filt && matches(n.id)); // 悬浮不再重排标签
  const planKey = `${selected}|${query}|${qActive}|${matchSet.size}|${Math.round(k * 20)}|${shown.length}`;
  if (planKey !== labelKey || now - labelAt > 160) {
    labelKey = planKey; labelAt = now;
    const cands = shown.filter((n) => must(n) || (!tiny && (k > 1.7 || n.r >= 6 || shown.length <= 14)))
      .sort((a, b) => (must(b) - must(a)) || (b.r - a.r)).slice(0, 160);
    const placed = [];
    labelNodes = [];
    for (const n of cands) {
      const w = ctx.measureText(n.label).width, y = n.y + n.r * 1.3 + 3, h = fs * 1.25;
      const box = [n.x - w / 2 - 2, y - 1, n.x + w / 2 + 2, y + h];
      if (!must(n) && placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) continue;
      placed.push(box); labelNodes.push(n);
    }
  }
  const tL = performance.now();
  for (const n of labelNodes) {
    if (n.x === undefined || !sim.has(n.id)) continue;
    const y = n.y + n.r * 1.3 + 3;
    ctx.globalAlpha = Math.max(alphaOf(n), 0.45);
    if (labelNodes.length <= 70) { ctx.strokeStyle = 'rgba(2,2,10,0.9)'; ctx.lineWidth = 3 / Math.max(k, 0.55); ctx.strokeText(n.label, n.x, y); } // 标签多时省掉描边,文字渲染很贵
    ctx.fillStyle = '#e8e8f6'; ctx.fillText(n.label, n.x, y);
  }
  perf.labelsMs = perf.labelsMs * 0.9 + (performance.now() - tL) * 0.1;
  if (k > 0.5) {
    ctx.font = `${10 / Math.max(k, 0.55)}px -apple-system, "Segoe UI", sans-serif`;
    for (const [l, mx, my, al] of edgeLabels) {
      ctx.globalAlpha = Math.max(al, 0.3) * 0.85;
      ctx.fillStyle = l.lifted ? '#b9c4ff' : '#9aa';
      ctx.fillText('×' + l.count, mx, my - 5 / k);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  drawHoverTip();
  perf.frameMs = perf.frameMs * 0.9 + (performance.now() - frameStart) * 0.1;
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
