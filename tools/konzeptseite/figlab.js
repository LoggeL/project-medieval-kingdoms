(function () {
"use strict";
const dataEl = document.getElementById("figData");
if (!dataEl) return;
const D = JSON.parse(dataEl.textContent);
const reduceMo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DIRS = ["vorne", "vorne rechts", "rechts", "hinten rechts", "hinten", "hinten links", "links", "vorne links"];
const TW = 64, TH = 32;
const st = { style: D.order[0], dir: 1, walk: !reduceMo, tour: !reduceMo, team: 0, real: false, unit: "speer", frame: 0 };

// ---- load atlases; team variants by exact palette swap (sheet.json team_swap: [r,g,b -> r,g,b])
const TEAMS = [["blau", "Team Blau"], ["rot", "Team Rot"], ["gruen", "Team Grün"]];
const atlas = {};
function paletteSwap(img, pairs) {
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, c.width, c.height), p = id.data, map = new Map();
  pairs.forEach(q => map.set((q[0] << 16) | (q[1] << 8) | q[2], q.slice(3)));
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    const to = map.get((p[i] << 16) | (p[i + 1] << 8) | p[i + 2]);
    if (to) { p[i] = to[0]; p[i + 1] = to[1]; p[i + 2] = to[2]; }
  }
  g.putImageData(id, 0, 0); return c;
}
let pending = D.order.length;
D.order.forEach(k => {
  const im = new Image();
  im.onload = () => {
    const sw = D.styles[k].swap || {};
    atlas[k] = { blau: im };
    Object.keys(sw).forEach(t => { atlas[k][t] = paletteSwap(im, sw[t]); });
    if (--pending === 0) start();
  };
  im.onerror = () => {
    delete D.styles[k].src;
    if (--pending === 0) start();
  };
  im.src = D.styles[k].src;
});
const stepsImg = document.getElementById("figSteps");
if (stepsImg && D.steps) stepsImg.src = D.steps;

// ---- UI
const $ = id => document.getElementById(id);
const tabs = $("figTabs"), desc = $("figDesc"), cv = $("figCanvas"), g = cv.getContext("2d");
D.order.forEach(k => {
  const b = document.createElement("button"); b.className = "btn"; b.type = "button"; b.textContent = D.styles[k].label;
  b.dataset.k = k; b.setAttribute("aria-pressed", String(k === st.style));
  b.addEventListener("click", () => { st.style = k; sync(); });
  tabs.append(b);
});
const unitBox = $("figUnits");
D.styles[D.order[0]].units.forEach(u => {
  const b = document.createElement("button"); b.className = "btn"; b.type = "button"; b.textContent = u.name;
  b.dataset.k = u.key; b.setAttribute("aria-pressed", String(u.key === st.unit));
  b.addEventListener("click", () => { st.unit = u.key; sync(); });
  unitBox.append(b);
});
const cmpHost = $("figCompare"), cmp = {};
D.order.forEach(k => {
  const f = document.createElement("figure"), c = document.createElement("canvas"), cap = document.createElement("figcaption");
  c.width = 80; c.height = 84; c.dataset.k = k;
  c.setAttribute("role", "img");
  cap.textContent = D.styles[k].label + " · " + D.styles[k].height + "\u00a0px";
  f.append(c, cap); cmpHost.append(f); cmp[k] = c.getContext("2d");
});
const toggle = (id, key, after) => $(id).addEventListener("click", () => { st[key] = !st[key]; after && after(); sync(); });
toggle("figWalk", "walk", ensureLoop); toggle("figTour", "tour", ensureLoop); toggle("figReal", "real");
$("figTeam").addEventListener("click", () => { st.team = (st.team + 1) % TEAMS.length; sync(); });
$("figL").addEventListener("click", () => { st.tour = false; st.dir = (st.dir + 1) % 8; sync(); });
$("figR").addEventListener("click", () => { st.tour = false; st.dir = (st.dir + 7) % 8; sync(); });

function sync() {
  tabs.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === st.style)));
  unitBox.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === st.unit)));
  $("figWalk").setAttribute("aria-pressed", String(st.walk));
  $("figTour").setAttribute("aria-pressed", String(st.tour));
  $("figTeam").textContent = TEAMS[st.team][1];
  $("figReal").setAttribute("aria-pressed", String(st.real));
  const s = D.styles[st.style];
  desc.innerHTML = "<b>" + s.label + "</b> · " + s.height + "\u00a0px · " + s.desc;
  const dirEl = $("figDir");
  dirEl.setAttribute("aria-live", st.tour ? "off" : "polite");
  dirEl.textContent = "Blick nach " + DIRS[st.dir];
  labels(); fit(); draw();
}
function labels() {
  const s = D.styles[st.style], team = TEAMS[st.team][1], dir = DIRS[st.dir];
  cv.setAttribute("aria-label", "Acht Testfiguren im Stil " + s.label + ", " + team + ", Blick nach " + dir +
    (atlas[st.style] ? "" : ". Das Bild dieses Stils konnte nicht geladen werden."));
  const uname = (s.units.find(u => u.key === st.unit) || {}).name || st.unit;
  cmpHost.querySelectorAll("canvas").forEach(c => {
    const ss = D.styles[c.dataset.k];
    c.setAttribute("aria-label", uname + " im Stil " + ss.label + ", " + ss.height + " Pixel hoch");
  });
}

// ---- canvas sizing: integer zoom, or 1 CSS px = 1 sprite px for "Echte Größe"
const LW = 7 * 32 + 80, LH = 128, X0 = 40, Y0 = 94;
cv.width = LW; cv.height = LH;
function fit() {
  const w = cv.parentElement.clientWidth || LW;
  // integer zoom where it fits; on narrow screens shrink to the available width instead of scrolling
  const z = w < LW ? w / LW : (st.real ? 1 : Math.floor(w / LW));
  cv.style.width = LW * z + "px"; cv.style.height = LH * z + "px";
  // comparison figures: whole-number zoom only
  cmpHost.querySelectorAll("canvas").forEach(c => {
    const cw = c.parentElement.clientWidth || 80, cz = Math.max(1, Math.floor(cw / 80));
    c.style.width = 80 * cz + "px"; c.style.height = 84 * cz + "px";
  });
}
if (window.ResizeObserver) { const ro = new ResizeObserver(fit); ro.observe(cv.parentElement); ro.observe(cmpHost); }

// ---- drawing
function diamond(ctx, cx, cy, fill, edge) {
  ctx.fillStyle = fill;
  for (let y = 0; y < TH; y++) {
    const half = (y < TH / 2 ? y + 1 : TH - y) * 2;
    ctx.fillRect(cx - half, cy - TH / 2 + y, half * 2, 1);
  }
  if (edge) {
    ctx.fillStyle = edge;
    for (let y = 0; y < TH; y++) {
      const half = (y < TH / 2 ? y + 1 : TH - y) * 2;
      ctx.fillRect(cx - half, cy - TH / 2 + y, 2, 1); ctx.fillRect(cx + half - 2, cy - TH / 2 + y, 2, 1);
    }
  }
}
function sprite(ctx, k, uIdx, x, y) {
  const s = D.styles[k], a = atlas[k]; if (!a) return;
  const cell = s.cell, f = st.walk ? 1 + (st.frame % (s.frames - 1)) : 0;
  const src = a[TEAMS[st.team][0]] || a.blau;
  ctx.drawImage(src, f * cell, (uIdx * 8 + st.dir) * cell, cell, cell, Math.round(x - s.anchor[0]), Math.round(y - s.anchor[1]), cell, cell);
}
function shadow(ctx, x, y) {
  ctx.fillStyle = "rgba(20,30,10,0.28)";
  ctx.fillRect(x - 6, y - 1, 12, 3); ctx.fillRect(x - 8, y, 16, 1);
}
function draw() {
  const s = D.styles[st.style];
  g.clearRect(0, 0, LW, LH);
  g.fillStyle = s.ground[1]; g.fillRect(0, 0, LW, LH);
  cv.parentElement.style.background = s.ground[1];
  // ground: iso lattice, tile centres at (X0 + 32m, Y0 + 16n) with m + n even
  for (let n = -6; n <= 4; n++) for (let m = -4; m <= 13; m++) {
    if ((m + n) & 1) continue;
    const even = (m & 1) === 0;
    diamond(g, X0 + 32 * m, Y0 + 16 * n, even ? s.ground[0] : s.ground[1], null);
  }
  // units zigzag over neighbouring tile centres, back row first
  const pos = s.units.map((u, i) => ({ i, x: X0 + 32 * i, y: Y0 + 16 * (i % 2) }));
  pos.sort((p, q) => p.y - q.y || p.x - q.x);
  pos.forEach(p => { if (!s.shadow) shadow(g, p.x, p.y); sprite(g, st.style, p.i, p.x, p.y); });
  // comparison
  D.order.forEach(k => {
    const c = cmp[k], ss = D.styles[k], ui = ss.units.findIndex(u => u.key === st.unit);
    c.fillStyle = ss.ground[1]; c.fillRect(0, 0, 80, 84);
    diamond(c, 40, 70, ss.ground[0], null);
    if (!ss.shadow) shadow(c, 40, 70);
    sprite(c, k, ui, 40, 70);
  });
}

// ---- loop: runs only while walking or touring
const STEP = 0.12, TOUR = 1.6;
let last = 0, acc = 0, tourAcc = 0, running = false, ready = false;
function loop(ts) {
  if (!st.walk && !st.tour) { running = false; return; }
  const dt = Math.min(0.25, (ts - last) / 1000); last = ts;
  acc += dt; tourAcc += dt;
  let dirty = false;
  if (st.walk) while (acc >= STEP) { acc -= STEP; st.frame++; dirty = true; } else acc = 0;
  if (st.tour) while (tourAcc >= TOUR) { tourAcc -= TOUR; st.dir = (st.dir + 7) % 8; $("figDir").textContent = "Blick nach " + DIRS[st.dir]; labels(); dirty = true; } else tourAcc = 0;
  if (dirty) draw();
  requestAnimationFrame(loop);
}
function ensureLoop() {
  if (!ready || running || (!st.walk && !st.tour)) return;
  running = true; acc = 0; tourAcc = 0;
  requestAnimationFrame(ts => { last = ts; requestAnimationFrame(loop); });
}
function start() {
  ready = true;
  sync(); ensureLoop();
}
})();
