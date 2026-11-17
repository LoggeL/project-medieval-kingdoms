(function () {
"use strict";
const bEl = document.getElementById("bauData"), fEl = document.getElementById("figData");
if (!bEl || !fEl) return;
const B = JSON.parse(bEl.textContent), F = JSON.parse(fEl.textContent);
const reduceMo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = id => document.getElementById(id);
const TEAMS = [["blau", "Team Blau"], ["rot", "Team Rot"], ["gruen", "Team Grün"]];
const ROT = ["Norden oben", "Osten oben", "Süden oben", "Westen oben"];

// ---------------------------------------------------------------- world (tiles; x to the lower right, y to the lower left at r = 0)
const W = 12, H = 12;
// buildings: centre of the footprint in tiles, world orientation o (0..3); sprite view = (o - r) mod 4 (concept 09, section 4)
const BUILD = [
  { key: "turm", x: 1, y: 1, o: 0 }, { key: "turm", x: 8, y: 1, o: 0 },
  { key: "mauer", x: 2.5, y: 1.5, o: 0 }, { key: "mauer", x: 3.5, y: 1.5, o: 0 }, { key: "mauer", x: 4.5, y: 1.5, o: 0 },
  { key: "mauer", x: 5.5, y: 1.5, o: 0 }, { key: "mauer", x: 6.5, y: 1.5, o: 0 },
  { key: "treppe", x: 3.5, y: 3, o: 0 },
  { key: "kaserne", x: 9, y: 4.5, o: 0 },
  { key: "lager", x: 1.5, y: 5.5, o: 0, id: "lager" },
  { key: "haus", x: 5, y: 6, o: 0 }, { key: "haus", x: 6, y: 9, o: 1 },
  { key: "holzfaeller", x: 1, y: 10, o: 2, id: "hof" },
  { key: "steinbruch", x: 9.5, y: 9.5, o: 3, variant: 2 },
  { key: "baum", x: 2.5, y: 11.5, o: 0 }, { key: "baum", x: 4.5, y: 10.7, o: 1, variant: 1 }, { key: "tanne", x: 3.4, y: 11.6, o: 0 },
  { key: "tanne", x: 0.5, y: 8.2, o: 0 }, { key: "baum", x: 11.4, y: 1.6, o: 2 }, { key: "tanne", x: 11.5, y: 6.6, o: 0 },
  { key: "baum", x: 11.3, y: 11.4, o: 3, variant: 1 }, { key: "tanne", x: 7.6, y: 11.5, o: 0 },
];
const ROAD = [[1, 7], [1, 8], [2, 7], [2, 8], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [3, 4], [3, 5], [3, 6]];

// rotations: S turns a local offset like sprite view +1 does; the camera turn is its inverse (concept table r = 1: u = H - y, v = x)
const S = (p, k) => { let [x, y] = p; for (let i = 0; i < ((k % 4) + 4) % 4; i++) [x, y] = [y, -x]; return [x, y]; };
function toView(x, y, r) {
  switch (r) { case 1: return [H - y, x]; case 2: return [W - x, H - y]; case 3: return [y, W - x]; default: return [x, y]; }
}
const vecView = (dx, dy, r) => S([dx, dy], -r);
const st = { style: B.order[0], r: 0, team: 0, run: !reduceMo, unit: "turm", variant: 0 };
const X0 = H * 32, Y0 = 150, LW = (W + H) * 32, LH = Y0 + (W + H) * 16 + 24;

// ---------------------------------------------------------------- data per style
function unitOf(k, key) { return B.styles[k].units.find(u => u.key === key); }
const img = {};          // img[style] = {b: {team: canvas}, f: {...}, fig: {...}, xfig: {...}}
function paletteSwap(im, pairs) {
  const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
  const g = c.getContext("2d"); g.drawImage(im, 0, 0);
  if (!pairs) return c;
  const id = g.getImageData(0, 0, c.width, c.height), p = id.data, map = new Map();
  pairs.forEach(q => map.set((q[0] << 16) | (q[1] << 8) | q[2], q.slice(3)));
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    const to = map.get((p[i] << 16) | (p[i + 1] << 8) | p[i + 2]);
    if (to) { p[i] = to[0]; p[i + 1] = to[1]; p[i + 2] = to[2]; }
  }
  g.putImageData(id, 0, 0); return c;
}
function load(src) { return new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
async function loadStyle(k) {
  if (img[k]) return img[k];
  const bs = B.styles[k], fs = F.styles[k];
  const [b, f, fig, xfig] = await Promise.all([load(bs.src), load(bs.fsrc), load(fs.src), load(fs.xsrc)]);
  const swaps = (tbl, im) => { const o = { blau: im }; if (im) Object.keys(tbl || {}).forEach(t => { o[t] = paletteSwap(im, tbl[t]); }); return o; };
  img[k] = { b: swaps(bs.swap, b), f: swaps(bs.swap, f), fig: swaps(fs.swap, fig), xfig: swaps(fs.swap, xfig), ok: !!(b && fig) };
  return img[k];
}
const pick = (o) => o[TEAMS[st.team][0]] || o.blau;

// ---------------------------------------------------------------- posts on walls and towers
const POSTS = [];
BUILD.forEach((b, bi) => {
  const u = unitOf(B.order[0], b.key);
  (u.posts || []).forEach(p => {
    const [ox, oy] = S([p[0], -p[1]], b.o);   // model y points the other way than tile y
    POSTS.push({ b: bi, x: b.x + ox, y: b.y + oy, h: p[2], tower: b.key === "turm" });
  });
});
// automatic distribution: wall walk first (nearest to the stairs), then the towers
const ORDERP = POSTS.map((p, i) => i).sort((a, b) => (POSTS[a].tower - POSTS[b].tower) || (Math.abs(POSTS[a].x - 3.5) - Math.abs(POSTS[b].x - 3.5)));

// ---------------------------------------------------------------- figures
const figs = [];
function addFig(unit, x, y, face, extra) { const f = Object.assign({ unit, x, y, fx: face[0], fy: face[1], walk: false, frame: 0, post: -1 }, extra || {}); figs.push(f); return f; }
addFig("speer", 8.6, 6.35, [0, 1]); addFig("speer", 9.5, 6.35, [0, 1]);
addFig("schwert", 7.4, 6.7, [-1, 0]); addFig("ritter", 10.6, 6.9, [-1, 1]); addFig("landsknecht", 6.4, 5.0, [1, 1]);
const cutter = addFig("holzfaeller", 1.4, 8.7, [0, 1], { role: "cutter", state: "toTree", t: 0, path: null });
const carrier = addFig("tageloehner", 0.8, 8.65, [0, -1], { role: "carrier", state: "wait", t: 0, path: null });
function stationed() { return figs.filter(f => f.post >= 0); }
function postArcher() {
  const used = new Set(stationed().map(f => f.post));
  const free = ORDERP.find(i => !used.has(i));
  if (free === undefined) return false;
  const p = POSTS[free], n = stationed().length;
  addFig(n % 2 ? "armbrust" : "bogen", p.x, p.y, [0, -1], { post: free, h: p.h });
  return true;
}
function unpostArcher() {
  const s = stationed(); if (!s.length) return false;
  let last = s[0];
  s.forEach(f => { if (ORDERP.indexOf(f.post) > ORDERP.indexOf(last.post)) last = f; });
  figs.splice(figs.indexOf(last), 1); return true;
}
for (let i = 0; i < 4; i++) postArcher();

// ---------------------------------------------------------------- economy sketch (not the game simulation)
const eco = { yard: 2, store: 1, full: 0, msg: "" };
const TREE = [2.45, 10.85], YARD = [1.35, 8.75], PICK = [0.85, 8.75], GATE = [1.5, 7.25], DROP = [1.5, 6.55];
function route(f, pts, next) { f.path = pts.map(p => p.slice()); f.next = next; f.walk = true; }
function stepFig(f, dt) {
  if (!f.path || !f.path.length) return true;
  const [tx, ty] = f.path[0], dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy), sp = 1.15 * dt;
  if (d > 1e-6) { f.fx = dx; f.fy = dy; }
  if (d <= sp) { f.x = tx; f.y = ty; f.path.shift(); } else { f.x += dx / d * sp; f.y += dy / d * sp; }
  if (!f.path.length) { f.walk = false; f.path = null; return true; }
  return false;
}
function tickEco(dt) {
  // woodcutter: walk to the forest edge, chop, carry the trunk to his yard
  const c = cutter;
  if (c.state === "toTree") { if (!c.path) route(c, [[2.45, 8.75], TREE]); if (stepFig(c, dt)) { c.state = "chop"; c.t = 2.4; c.fx = 0.2; c.fy = 1; } }
  else if (c.state === "chop") { c.t -= dt; if (c.t <= 0) { c.state = "home"; c.unit = "traeger"; route(c, [[2.45, 8.75], YARD]); } }
  else if (c.state === "home") { if (stepFig(c, dt)) { if (eco.yard < 4) { eco.yard++; c.unit = "holzfaeller"; c.state = "toTree"; } else { c.state = "waitYard"; } } }
  else if (c.state === "waitYard") { if (eco.yard < 4) { eco.yard++; c.unit = "holzfaeller"; c.state = "toTree"; } }
  // carrier: take one trunk from the yard into the storage yard, wait while it is full
  const k = carrier;
  if (k.state === "wait") { if (eco.yard > 0 && eco.store < 4) { eco.yard--; k.unit = "traeger"; k.state = "toStore"; route(k, [GATE, DROP]); } }
  else if (k.state === "toStore") { if (stepFig(k, dt)) { eco.store = Math.min(4, eco.store + 1); k.unit = "tageloehner"; k.state = "back"; route(k, [GATE, PICK]); } }
  else if (k.state === "back") { if (stepFig(k, dt)) { k.state = "wait"; k.fx = 0; k.fy = -1; } }
  if (eco.store >= 4) { eco.full += dt; if (eco.full > 12) { eco.store = 0; eco.full = 0; eco.msg = "Der Vorrat wurde verbaut, das Lager ist wieder leer."; } }
  else eco.full = 0;
}

// ---------------------------------------------------------------- drawing
const cv = $("bauCanvas"), g = cv.getContext("2d");
cv.width = LW; cv.height = LH;
function diamond(ctx, cx, cy, fill) {
  ctx.fillStyle = fill;
  for (let y = 0; y < 32; y++) { const half = (y < 16 ? y + 1 : 32 - y) * 2; ctx.fillRect(cx - half, cy - 16 + y, half * 2, 1); }
}
function mix(hex, k, t) {
  const a = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16)), b = [1, 3, 5].map(i => parseInt(k.substr(i, 2), 16));
  return "rgb(" + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",") + ")";
}
const scr = (u, v, h) => [X0 + (u - v) * 32, Y0 + (u + v) * 16 - (h || 0) * 16];
function figSprite(k, unit) {
  const fs = F.styles[k];
  let i = fs.units.findIndex(u => u.key === unit);
  if (i >= 0) return [pick(img[k].fig), i];
  i = (fs.xunits || []).findIndex(u => u.key === unit);
  return i >= 0 ? [pick(img[k].xfig), i] : [null, 0];
}
function octant(dx, dy, r) {
  const [du, dv] = vecView(dx, dy, r), sx = (du - dv) * 32, sy = (du + dv) * 16;
  const a = Math.atan2(sy, sx) / (Math.PI / 4);
  return ((2 - Math.round(a)) % 8 + 8) % 8;
}
function drawFig(ctx, k, f) {
  const fs = F.styles[k], [im, ui] = figSprite(k, f.unit); if (!im) return;
  const [u, v] = toView(f.x, f.y, st.r), [X, Y] = scr(u, v, f.h || 0);
  const c = fs.cell, fr = f.walk ? 1 + (f.frame % (fs.frames - 1)) : 0, d = octant(f.fx, f.fy, st.r);
  if (!fs.shadow) { ctx.fillStyle = "rgba(20,30,10,0.28)"; ctx.fillRect(Math.round(X) - 6, Math.round(Y) - 1, 12, 3); }
  ctx.drawImage(im, fr * c, (ui * 8 + d) * c, c, c, Math.round(X - fs.anchor[0]), Math.round(Y - fs.anchor[1]), c, c);
}
function variantOf(b) {
  if (b.id === "lager") return eco.store;
  if (b.id === "hof") return eco.yard === 0 ? 0 : eco.yard <= 2 ? 1 : 2;
  return b.variant || 0;
}
function drawBuilding(ctx, k, b, front) {
  const u = unitOf(k, b.key), I = front ? pick(img[k].f) : pick(img[k].b); if (!u || !I) return;
  const view = ((b.o - st.r) % 4 + 4) % 4, f = Math.min(variantOf(b), u.frames - 1);
  const [uu, vv] = toView(b.x, b.y, st.r), [X, Y] = scr(uu, vv, 0);
  const oy = front ? u.fat : u.at; if (oy === undefined) return;
  ctx.drawImage(I, f * u.w, oy + view * u.h, u.w, u.h, Math.round(X - u.ax), Math.round(Y - u.ay), u.w, u.h);
}
function footprintView(b) {
  const u = unitOf(st.style, b.key);
  let [w, h] = u.fp; if ((b.o + st.r) % 2) [w, h] = [h, w];
  const [cu, cv_] = toView(b.x, b.y, st.r);
  return [cu - w / 2, cu + w / 2, cv_ - h / 2, cv_ + h / 2];
}
function order(items) {
  // topological order for boxes on the ground: A before B if A lies completely behind B in u or v
  const n = items.length, before = items.map(() => []), indeg = new Array(n).fill(0), e = 1e-3;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const A = items[i].box, Bx = items[j].box;
    if (A[1] <= Bx[0] + e || A[3] <= Bx[2] + e) { before[i].push(j); indeg[j]++; }
    else if (Bx[1] <= A[0] + e || Bx[3] <= A[2] + e) { before[j].push(i); indeg[i]++; }
    else if (items[i].f && !items[j].f) { before[j].push(i); indeg[i]++; }   // figure inside a yard: after the building
    else if (items[j].f && !items[i].f) { before[i].push(j); indeg[j]++; }
  }
  const out = [], ready = [];
  const depth = i => (items[i].box[0] + items[i].box[1] + items[i].box[2] + items[i].box[3]) / 2;
  for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
  const done = new Array(n).fill(false);
  while (out.length < n) {
    if (!ready.length) { let m = -1; for (let i = 0; i < n; i++) if (!done[i] && (m < 0 || depth(i) < depth(m))) m = i; ready.push(m); indeg[m] = 0; }
    ready.sort((a, b) => depth(b) - depth(a));
    const i = ready.pop(); if (done[i]) continue; done[i] = true; out.push(items[i]);
    before[i].forEach(j => { if (--indeg[j] === 0 && !done[j]) ready.push(j); });
  }
  return out;
}
function draw() {
  const k = st.style; if (!img[k] || !img[k].ok) return;
  const ground = F.styles[k].ground;
  g.fillStyle = ground[1]; g.fillRect(0, 0, LW, LH);
  cv.parentElement.style.background = ground[1];
  const road = new Set(ROAD.map(p => p.join(",")));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [u, v] = toView(x + 0.5, y + 0.5, st.r), [X, Y] = scr(u, v, 0);
    const base = road.has(x + "," + y) ? mix(ground[0], "#6b4f2e", 0.42) : ((x + y) & 1 ? ground[1] : ground[0]);
    diamond(g, X, Y, base);
  }
  // drawables: buildings (with the figures on their posts and the front parapet), figures on the ground
  const items = BUILD.map((b, bi) => ({ box: footprintView(b), b, bi }));
  figs.forEach(f => {
    if (f.post >= 0) return;
    const [u, v] = toView(f.x, f.y, st.r);
    items.push({ box: [u - 0.15, u + 0.15, v - 0.15, v + 0.15], f });
  });
  const posted = new Map();
  stationed().forEach(f => { const bi = POSTS[f.post].b; (posted.get(bi) || posted.set(bi, []).get(bi)).push(f); });
  order(items).forEach(it => {
    if (it.f) { drawFig(g, k, it.f); return; }
    drawBuilding(g, k, it.b, false);
    const on = posted.get(it.bi);
    if (on) {
      on.sort((a, b) => { const A = toView(a.x, a.y, st.r), Bv = toView(b.x, b.y, st.r); return (A[0] + A[1]) - (Bv[0] + Bv[1]); });
      on.forEach(f => drawFig(g, k, f));
      drawBuilding(g, k, it.b, true);
    }
  });
}
function status() {
  const n = stationed().length;
  const s = "Lager " + eco.store + " von 4 · Hof des Holzfällers " + eco.yard + (eco.yard === 1 ? " Stamm · " : " Stämme · ") + n + (n === 1 ? " Schütze" : " Schützen") + " auf " + POSTS.length + " Posten";
  const full = eco.store >= 4 ? " · Lager voll, der Träger wartet" : "";
  const txt = (eco.msg ? eco.msg + " " : "") + s + full;
  const el = $("bauStatus"); if (el.textContent !== txt) el.textContent = txt;
  $("bauPost").disabled = n >= POSTS.length;
  $("bauUnpost").disabled = n === 0;
  $("bauEmpty").disabled = eco.store === 0;
}

// ---------------------------------------------------------------- views gallery
const unitBox = $("bauUnits"), varBox = $("bauVars"), views = $("bauViews");
B.styles[B.order[0]].units.forEach(u => {
  const b = document.createElement("button"); b.className = "btn"; b.type = "button"; b.textContent = u.name; b.dataset.k = u.key;
  b.addEventListener("click", () => { st.unit = u.key; st.variant = u.frames - 1; gallery(); });
  unitBox.append(b);
});
const vcv = [];
for (let i = 0; i < 4; i++) {
  const f = document.createElement("figure"), c = document.createElement("canvas"), cap = document.createElement("figcaption");
  c.setAttribute("role", "img"); cap.textContent = "Ansicht " + (i + 1) + " · " + (i * 90) + "°";
  f.append(c, cap); views.append(f); vcv.push(c);
}
function gallery() {
  const k = st.style, u = unitOf(k, st.unit); if (!u || !img[k]) return;
  unitBox.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === st.unit)));
  varBox.textContent = "";
  if (u.frames > 1) u.variants.forEach((name, i) => {
    const b = document.createElement("button"); b.className = "btn"; b.type = "button"; b.textContent = name;
    b.setAttribute("aria-pressed", String(i === st.variant));
    b.addEventListener("click", () => { st.variant = i; gallery(); });
    varBox.append(b);
  });
  const ground = F.styles[k].ground, I = pick(img[k].b), f = Math.min(st.variant, u.frames - 1);
  vcv.forEach((c, view) => {
    c.width = u.w; c.height = u.h;
    const x = c.getContext("2d");
    x.fillStyle = ground[1]; x.fillRect(0, 0, u.w, u.h);
    // footprint tiles under the building
    let [w, h] = u.fp; if (view % 2) [w, h] = [h, w];
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
      const tu = i + 0.5 - w / 2, tv = j + 0.5 - h / 2;
      diamond(x, u.ax + (tu - tv) * 32, u.ay + (tu + tv) * 16, (i + j) & 1 ? ground[1] : ground[0]);
    }
    x.drawImage(I, f * u.w, u.at + view * u.h, u.w, u.h, 0, 0, u.w, u.h);
    c.setAttribute("aria-label", u.name + (u.frames > 1 ? ", " + u.variants[f] : "") + ", Ansicht " + (view + 1) + " von 4");
  });
}

// ---------------------------------------------------------------- UI
const tabs = $("bauTabs");
B.order.forEach(k => {
  const b = document.createElement("button"); b.className = "btn"; b.type = "button"; b.textContent = F.styles[k].label; b.dataset.k = k;
  b.addEventListener("click", async () => { st.style = k; await loadStyle(k); sync(); });
  tabs.append(b);
});
function rotate(d) { st.r = (st.r + d + 4) % 4; sync(); }
$("bauL").addEventListener("click", () => rotate(1));
$("bauR").addEventListener("click", () => rotate(3));
$("bauRun").addEventListener("click", () => { st.run = !st.run; sync(); ensureLoop(); });
$("bauPost").addEventListener("click", () => { postArcher(); sync(); });
$("bauUnpost").addEventListener("click", () => { unpostArcher(); sync(); });
$("bauEmpty").addEventListener("click", () => { eco.store = 0; eco.full = 0; eco.msg = ""; sync(); });
$("bauTeam").addEventListener("click", () => { st.team = (st.team + 1) % TEAMS.length; sync(); });
function fit() {
  const w = cv.parentElement.clientWidth || LW;
  const z = w < LW ? w / LW : Math.max(1, Math.floor(w / LW));
  cv.style.width = LW * z + "px"; cv.style.height = LH * z + "px";
}
if (window.ResizeObserver) new ResizeObserver(fit).observe(cv.parentElement);
function sync() {
  tabs.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.k === st.style)));
  $("bauRun").setAttribute("aria-pressed", String(st.run));
  $("bauRun").textContent = st.run ? "Arbeit läuft" : "Arbeit ruht";
  $("bauTeam").textContent = TEAMS[st.team][1];
  $("bauDir").textContent = "Blick: " + ROT[st.r];
  cv.setAttribute("aria-label", "Kleine Siedlung im Stil " + F.styles[st.style].label + ", " + ROT[st.r] + ", " + TEAMS[st.team][1] + ". " + $("bauStatus").textContent);
  status(); fit(); draw(); gallery();
}

// ---------------------------------------------------------------- loop
let last = 0, acc = 0, running = false;
function loop(ts) {
  if (!st.run) { running = false; return; }
  const dt = Math.min(0.25, (ts - last) / 1000); last = ts;
  tickEco(dt);
  acc += dt;
  while (acc >= 0.12) { acc -= 0.12; figs.forEach(f => { if (f.walk) f.frame++; }); }
  if (eco.msg && eco.store > 0) eco.msg = "";
  status(); draw();
  requestAnimationFrame(loop);
}
function ensureLoop() {
  if (running || !st.run || !img[st.style]) return;
  running = true;
  requestAnimationFrame(ts => { last = ts; requestAnimationFrame(loop); });
}
loadStyle(st.style).then(() => { sync(); ensureLoop(); });
})();
