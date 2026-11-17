(function () {
"use strict";
// Alle Bilder der Seite außerhalb der Test-Abschnitte aus den echten Sprites (Stil "Vorgerendert"):
// Titelszene, Epochen, Geländekacheln, Lagerplatz, Turm in vier Ansichten, Einheitenraster, Oberflächen-Skizze.
// Projektion, Drehung, Ansicht und Zeichenreihenfolge wie in bauten.js bzw. docs/concept/09-technik.md.
const bEl = document.getElementById("bauData"), fEl = document.getElementById("figData"), wEl = document.getElementById("weltData");
if (!bEl || !fEl || !wEl) return;
const BD = JSON.parse(bEl.textContent).styles.vorgerendert, FD = JSON.parse(fEl.textContent).styles.vorgerendert;
const WD = JSON.parse(wEl.textContent);
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- sprites
const BU = {}; BD.units.forEach(u => { BU[u.key] = u; });
const FU = {}; FD.units.forEach((u, i) => { FU[u.key] = ["f", i]; }); (FD.xunits || []).forEach((u, i) => { FU[u.key] = ["x", i]; });
const IM = {};
const load = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

const viewOf = (o, r) => (((o - r) % 4) + 4) % 4;
const turn = (x, y, k) => { for (let i = 0; i < ((k % 4) + 4) % 4; i++) [x, y] = [y, -x]; return [x, y]; };
const modelToWorld = (mx, my, o) => turn(mx, -my, o);
const hash = (x, y) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function drawB(ctx, key, view, frame, X, Y, front) {
  const u = BU[key]; if (!u) return;
  const I = front ? IM.bf : IM.b, oy = front ? u.fat : u.at;
  if (!I || oy === undefined) return;
  const f = Math.max(0, Math.min(frame || 0, u.frames - 1));
  ctx.drawImage(I, f * u.w, oy + view * u.h, u.w, u.h, Math.round(X - u.ax), Math.round(Y - u.ay), u.w, u.h);
}
// dir: 0 = S, 1 = SE ... (sheet order); frame 0 stand, 1..8 walk; act: action frames (hacken, abbauen)
function drawF(ctx, key, dir, frame, X, Y, act) {
  const c = FD.cell, ax = FD.anchor[0], ay = FD.anchor[1];
  if (act && IM.act) {
    const i = WD.act.units.indexOf(key);
    if (i >= 0) { ctx.drawImage(IM.act, (frame % WD.act.frames) * c, (i * 8 + dir) * c, c, c, Math.round(X - ax), Math.round(Y - ay), c, c); return; }
    frame = 0;
  }
  const e = FU[key]; if (!e) return;
  const I = e[0] === "f" ? IM.f : IM.x; if (!I) return;
  ctx.drawImage(I, frame * c, (e[1] * 8 + dir) * c, c, c, Math.round(X - ax), Math.round(Y - ay), c, c);
}
function drawT(ctx, key, v, f, X, Y) {
  const t = WD.terrain.keys[key]; if (!t || !IM.t) return;
  const col = (v % t.variants) * t.frames + (f % t.frames);
  ctx.drawImage(IM.t, col * 64, t.row * 32, 64, 32, Math.round(X - 32), Math.round(Y - 16), 64, 32);
}

// ---------------------------------------------------------------- a small world: N × N tiles, view r, screen origin
function World(N, X0, Y0) {
  this.N = N; this.X0 = X0; this.Y0 = Y0; this.r = 0;
}
World.prototype.toView = function (x, y) {
  const N = this.N;
  switch (this.r) { case 1: return [N - y, x]; case 2: return [N - x, N - y]; case 3: return [y, N - x]; default: return [x, y]; }
};
World.prototype.scr = function (x, y, h) { const [u, v] = this.toView(x, y); return [this.X0 + (u - v) * 32, this.Y0 + (u + v) * 16 - (h || 0) * 16]; };
World.prototype.dir = function (dx, dy) {
  // world direction → sprite direction (8 octants, sheet order S, SE, E, NE, N, NW, W, SW)
  const [du, dv] = turn(dx, dy, -this.r), sx = (du - dv) * 32, sy = (du + dv) * 16;
  const a = Math.atan2(sy, sx) / (Math.PI / 4);
  return ((2 - Math.round(a)) % 8 + 8) % 8;
};
World.prototype.box = function (x0, y0, x1, y1) {
  const p = this.toView(x0, y0), q = this.toView(x1, y1);
  return [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])];
};
World.prototype.fpBox = function (b) {
  let [w, h] = BU[b.key].fp; if (b.o % 2) [w, h] = [h, w];
  return this.box(b.x - w / 2, b.y - h / 2, b.x + w / 2, b.y + h / 2);
};
// terrain: fn(x, y) → [key, variant] or null; acker furrows follow the view (variants 0/1 along x, 2/3 along y)
World.prototype.ground = function (ctx, fn, frame, onlyKey, skipKey) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  for (let y = 0; y < this.N; y++) for (let x = 0; x < this.N; x++) {
    const t = fn(x, y); if (!t) continue;
    if (onlyKey && t[0] !== onlyKey) continue;
    if (skipKey && t[0] === skipKey) continue;
    const [X, Y] = this.scr(x + 0.5, y + 0.5);
    if (X < -40 || X > cw + 40 || Y < -24 || Y > ch + 24) continue;
    let v = t[1];
    if (t[0] === "acker" && this.r % 2) v ^= 2;
    drawT(ctx, t[0], v, frame || 0, X, Y);
  }
};
// items: {b: building} or {f: figure}; buildings carry .on (figures drawn between body and front part)
World.prototype.draw = function (ctx, blds, figs) {
  const items = [];
  blds.forEach(b => { if (!b.flat) items.push({ box: b.box || this.fpBox(b), b, over: !!b.over }); });
  figs.forEach(f => {
    if (f.on) return;
    const [u, v] = this.toView(f.x, f.y);
    items.push({ box: [u - 0.15, u + 0.15, v - 0.15, v + 0.15], f });
  });
  for (const it of order(items)) {
    if (it.f) { this.fig(ctx, it.f); continue; }
    const b = it.b, [X, Y] = this.scr(b.x, b.y, 0), view = viewOf(b.o, this.r);
    if (!b.over) drawB(ctx, b.key, view, b.frame, X, Y, false);
    if (b.on && b.on.length) {
      b.on.sort((p, q) => { const A = this.toView(p.x, p.y), B = this.toView(q.x, q.y); return (A[0] + A[1]) - (B[0] + B[1]); });
      b.on.forEach(f => this.fig(ctx, f));
    }
    if (b.over || (b.on && b.on.length)) drawB(ctx, b.key, view, b.frame, X, Y, true);
  }
};
World.prototype.fig = function (ctx, f) {
  const [X, Y] = this.scr(f.x, f.y, f.h || 0);
  drawF(ctx, f.unit, this.dir(f.fx, f.fy), f.act ? f.aframe : f.walk ? 1 + (f.frame % 8) : 0, X, Y, f.act);
};
World.prototype.flat = function (ctx, blds) {
  blds.forEach(b => { if (b.flat) { const [X, Y] = this.scr(b.x, b.y, 0); drawB(ctx, b.key, viewOf(b.o, this.r), b.frame, X, Y, false); } });
};

// topological order for boxes on the ground (as bauten.js): A before B if A lies completely behind B in u or v
function order(items) {
  const n = items.length, before = items.map(() => []), indeg = new Array(n).fill(0), e = 1e-3;
  const edge = (i, j) => { before[i].push(j); indeg[j]++; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const A = items[i].box, B = items[j].box;
    if (A[1] <= B[0] + e || A[3] <= B[2] + e) edge(i, j);
    else if (B[1] <= A[0] + e || B[3] <= A[2] + e) edge(j, i);
    else if (items[i].over && !items[j].over) edge(j, i);       // front part of a yard after what stands in it
    else if (items[j].over && !items[i].over) edge(i, j);
    else if (items[i].f && !items[j].f) edge(j, i);             // figure inside a yard: after the building
    else if (items[j].f && !items[i].f) edge(i, j);
  }
  const out = [], ready = [], done = new Array(n).fill(false);
  const depth = i => (items[i].box[0] + items[i].box[1] + items[i].box[2] + items[i].box[3]) / 2;
  for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
  while (out.length < n) {
    if (!ready.length) { let m = -1; for (let i = 0; i < n; i++) if (!done[i] && (m < 0 || depth(i) < depth(m))) m = i; ready.push(m); indeg[m] = 0; }
    ready.sort((a, b) => depth(b) - depth(a));
    const i = ready.pop(); if (done[i]) continue; done[i] = true; out.push(items[i]);
    before[i].forEach(j => { if (--indeg[j] === 0 && !done[j]) ready.push(j); });
  }
  return out;
}

// integer pixel scale when there is room, otherwise smooth down-scaling to the available width
function fitInt(cv, max) {
  const fit = () => {
    const w = (cv.parentElement.clientWidth || cv.width) - 2, s = Math.min(max || 9, Math.floor(w / cv.width));
    if (s >= 1) { cv.style.width = cv.width * s + "px"; cv.style.height = "auto"; cv.style.imageRendering = "pixelated"; }
    else { cv.style.width = "100%"; cv.style.height = "auto"; cv.style.imageRendering = "auto"; }
  };
  if (window.ResizeObserver) new ResizeObserver(fit).observe(cv.parentElement); else window.addEventListener("resize", fit);
  fit();
}

// ================================================================ HERO SCENE
function hero() {
  const canvas = $("scene"); if (!canvas) return;
  const CW = 1024, CH = 512, N = 32;
  canvas.width = CW; canvas.height = CH;
  const off = document.createElement("canvas"); off.width = CW; off.height = CH;
  const g = off.getContext("2d"), vctx = canvas.getContext("2d");
  const W = new World(N, CW / 2, CH / 2 - N * 16);
  let zoom = 1;

  // ---------- terrain
  const rx = y => 24 + Math.round(1.3 * Math.sin(y / 3.6));
  const ROAD = new Set(["10,15", "10,16", "11,16", "12,16", "13,16", "14,16", "15,16", "15,13", "15,14", "15,15", "15,8", "15,9", "15,10", "15,11",
    "16,11", "17,11", "18,11", "16,8", "16,9", "16,10", "16,16", "17,16", "17,17", "17,18", "17,19", "17,20", "17,21", "17,22", "17,23", "15,7", "15,6", "14,5", "13,4"]);
  const ERZ = new Set(["21,4", "22,5", "21,6", "20,3"]);
  function T(x, y) {
    const k = x + "," + y, h = hash(x, y);
    const v = Math.floor(hash(x + 91, y + 7) * 4);
    const r = rx(y);
    if (x === r || x === r + 1) return ["wasser", 0];
    if (ROAD.has(k)) return ["erde", v];
    if (ERZ.has(k)) return ["erz", v];
    if (x >= 16 && x <= 23 && y >= 2 && y <= 7) return ["fels", v];
    if (x >= r - 2 && x < r && y >= 22 && y <= 28) return ["sumpf", v];
    if (x >= 8 && x <= 11 && y >= 21 && y <= 24) return ["acker", v & 1];
    if (x <= 6 + Math.round(hash(y, 3) * 1.6) && y >= 7 && y <= 27) return ["waldboden", v];
    return [h < 0.22 ? "wiese" : "gras", v];
  }
  // ---------- objects
  const B = [], add = (key, x, y, o, extra) => { const b = Object.assign({ key, x, y, o, frame: 0, on: [] }, extra || {}); B.push(b); return b; };
  // wall: west tower, straight pieces, gate, corner, east tower; stairs inside
  add("turm", 9, 12, 0);
  for (const x of [10, 11, 12, 13, 14, 16, 17, 18, 19]) add("mauer_gerade", x + 0.5, 12.5, 0);
  const gate = add("tor", 15.5, 12.5, 0);
  add("mauer_ecke", 20.5, 12.5, 2);
  add("mauer_gerade", 20.5, 13.5, 1); add("mauer_gerade", 20.5, 14.5, 1);
  add("turm", 21, 16, 0);
  add("treppe", 12.5, 14, 0);
  const wallAt = new Map(); B.forEach(b => { if (b.key.startsWith("mauer") || b.key === "tor") wallAt.set(Math.floor(b.x) + "," + Math.floor(b.y), b); });
  // store: floor (flat), stacks per slot, front fence over everything inside
  const LX = 15.5, LY = 18.5, LO = 2;
  add("lager_boden", LX, LY, LO, { flat: true });
  add("lager_boden", LX, LY, LO, { over: true });
  const SLOTS = [[-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [0, 0]];
  const GOODS = ["eisen", "speer", "schwert", "stein", "holz", "stein", "holz", "bogen"];
  const START = [3, 6, 4, 2, 3, 4, 5, 5];
  const STACK = { holz: "stapel_holz", stein: "stapel_stein", eisen: "stapel_eisen", speer: "stapel_speer", schwert: "stapel_schwert", bogen: "stapel_bogen" };
  const slots = SLOTS.map((m, k) => {
    const [dx, dy] = modelToWorld(m[0], m[1], LO), x = LX + dx, y = LY + dy;
    const b = add(STACK[GOODS[k]], x, y, LO, { box: null });
    return { good: GOODS[k], n: START[k], b, x, y };
  });
  slots.forEach(s => { s.b.box = null; s.b.tile = [s.x - 0.45, s.y - 0.45, s.x + 0.45, s.y + 0.45]; });
  const hut = add("holzfaeller", 9, 15, 3, { frame: 1 });
  const quarry = add("steinbruch", 18.5, 9.5, 0, { frame: 1 });
  add("kaserne", 17, 25.5, 2);
  add("haus", 12, 19, 1); add("haus", 21.5, 20, 3); add("haus", 9.5, 19, 0);
  // trees: forest band in the west, a few elsewhere
  const trees = [];
  const tree = (x, y, kind) => { const t = add(kind, x + 0.5, y + 0.5, Math.floor(hash(x, y + 5) * 4), { frame: Math.floor(hash(x + 3, y) * 2), tree: true, kind, state: "steht", logs: 0 }); trees.push(t); return t; };
  for (let y = 6; y <= 28; y++) for (let x = 0; x <= 7; x++) {
    if (T(x, y)[0] !== "waldboden" || (x === 7 && y >= 13 && y <= 17) || (x === 6 && y === 11)) continue;
    if (hash(x * 7, y * 3) < (x >= 6 ? 0.35 : 0.55)) tree(x, y, hash(x, y * 11) < 0.4 ? "tanne" : "baum");
  }
  for (const [x, y, k] of [[11, 7, "baum"], [12, 5, "tanne"], [9, 8, "baum"], [26, 12, "tanne"], [27, 16, "baum"], [28, 19, "tanne"], [22, 27, "baum"], [13, 27, "tanne"], [23, 9, "baum"], [7, 27, "tanne"]]) tree(x, y, k);
  // the woodcutter's trees (stand just east of the forest edge)
  const cutTrees = [[7, 13], [7, 17], [6, 15]].map(([x, y]) => trees.find(t => Math.floor(t.x) === x && Math.floor(t.y) === y) || tree(x, y, "baum"));
  // rocks on the outcrop (fels sprite: 4 stages); the stone mason works the one at (16, 7)
  [[18, 4, 0], [20, 5, 1], [22, 3, 2], [17, 6, 0]].forEach(([x, y, f]) => add("fels", x + 0.5, y + 0.5, (x + y) % 4, { frame: f }));
  const rock = add("fels", 16.5, 7.5, 1, { frame: 0 });
  add("baum_stumpf", 6.5, 11.5, 1, { frame: 0 }); add("baum_stumpf", 7.5, 19.5, 2, { frame: 1 });

  // ---------- figures
  const figs = [];
  const fig = (unit, x, y, fx, fy, extra) => { const f = Object.assign({ unit, x, y, fx, fy, walk: false, frame: 0, act: false, aframe: 0, path: null, t: 0, state: "idle" }, extra || {}); figs.push(f); return f; };
  const cutter = fig("holzfaeller", 7.6, 15.5, -1, 0, { state: "toTree", tree: 0 });
  const woodman = fig("tageloehner", 10.7, 15.7, 0, 1, { state: "wait" });
  const mason = fig("steinmetz", 18.5, 11.6, -1, 0, { state: "toRock" });
  const stoneman = fig("tageloehner", 17.6, 11.7, 1, 0, { state: "wait" });
  const guard = fig("speer", 10.5, 12.5, 1, 0, { h: 3, state: "patrol", dirx: 1 });
  // tower posts are the four platform corners (±0.65 tiles); the archers look outwards (north, east)
  [[9, 12, -0.65, -0.65, "bogen", 0, -1], [9, 12, 0.65, -0.65, "armbrust", 0, -1], [21, 16, 0.65, -0.65, "bogen", 1, 0], [21, 16, 0.65, 0.65, "armbrust", 1, 0]]
    .forEach(([cx, cy, dx, dy, u, fx, fy]) => fig(u, cx + dx, cy + dy, fx, fy, { h: 5, tower: [cx, cy] }));
  const drill = [fig("speer", 15.6, 22.7, 0, 1), fig("schwert", 16.4, 22.7, 0, 1), fig("ritter", 19.0, 22.4, -1, 0, { state: "drill", path: null })];
  const yard = { wood: 1, stone: 1 };
  let msgT = 0;

  const route = (f, pts) => { f.path = pts.map(p => p.slice()); f.walk = true; };
  const step = (f, dt) => {
    if (!f.path || !f.path.length) return true;
    const [tx, ty] = f.path[0], dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy), sp = 1.15 * dt;
    if (d > 1e-6) { f.fx = dx; f.fy = dy; }
    if (d <= sp) { f.x = tx; f.y = ty; f.path.shift(); } else { f.x += dx / d * sp; f.y += dy / d * sp; }
    if (!f.path.length) { f.walk = false; f.path = null; return true; }
    return false;
  };
  const slotFor = (good, put) => {
    const c = slots.filter(s => s.good === good && (put ? s.n < 8 : s.n > 0));
    c.sort((a, b) => put ? a.n - b.n : b.n - a.n);
    return c[0] || null;
  };
  const total = good => slots.filter(s => s.good === good).reduce((a, s) => a + s.n, 0);
  function tick(dt) {
    // woodcutter: fell the reserved tree, cut it up, carry each log onto his yard
    const c = cutter, tr = cutTrees[c.tree];
    const at = [tr.x + 0.8, tr.y + 0.05];
    if (c.state === "toTree") { if (!c.path) route(c, [[7.55, at[1]], at]); if (step(c, dt)) { c.state = "chop"; c.t = 3; c.act = true; c.fx = -1; c.fy = -0.1; } }
    else if (c.state === "chop") {
      c.t -= dt;
      if (c.t <= 0) {
        c.act = false;
        if (tr.state === "steht") { tr.state = "liegt"; tr.logs = 3; tr.key = "baum_liegt"; tr.frame = 0; }
        tr.logs--;
        if (tr.logs <= 0) { tr.state = "stumpf"; tr.key = "baum_stumpf"; tr.frame = tr.kind === "tanne" ? 1 : 0; }
        else tr.frame = 3 - tr.logs;
        c.unit = "traeger"; c.state = "home"; route(c, [[7.55, at[1]], [7.6, 15.5]]);
      }
    }
    else if (c.state === "home") { if (step(c, dt)) { c.state = "unload"; } }
    else if (c.state === "unload") {
      if (yard.wood < 4) { yard.wood++; c.unit = "holzfaeller"; if (tr.state === "stumpf") { c.tree = (c.tree + 1) % cutTrees.length; regrow(); } c.state = "toTree"; }
    }
    hut.frame = yard.wood === 0 ? 0 : yard.wood <= 2 ? 1 : 2;
    // carrier: from the woodcutter's yard to the store
    const k = woodman;
    if (k.state === "wait") { const s = slotFor("holz", true); if (yard.wood > 0 && s) { yard.wood--; k.unit = "traeger"; k.slot = s; k.state = "go"; route(k, [[10.7, 16.5], [15.5, 16.5], [15.5, 17.3], [(15.5 + s.x) / 2, (17.3 + s.y) / 2]]); } }
    else if (k.state === "go") { if (step(k, dt)) { k.slot.n = Math.min(8, k.slot.n + 1); k.unit = "tageloehner"; k.state = "back"; route(k, [[15.5, 17.3], [15.5, 16.5], [10.7, 16.5], [10.7, 15.7]]); } }
    else if (k.state === "back") { if (step(k, dt)) { k.state = "wait"; k.fx = 0; k.fy = 1; } }
    // stone mason: break a block off the rock, carry it into the quarry yard
    const m = mason;
    if (m.state === "toRock") { if (!m.path) route(m, [[16.5, 11.6], [16.5, 8.7]]); if (step(m, dt)) { m.state = "work"; m.t = 3.2; m.act = true; m.fx = 0; m.fy = -1; } }
    else if (m.state === "work") { m.t -= dt; if (m.t <= 0) { m.act = false; rock.frame = (rock.frame + 1) % 4; m.unit = "traeger_stein"; m.state = "home"; route(m, [[16.5, 11.6], [18.5, 11.6]]); } }
    else if (m.state === "home") { if (step(m, dt)) m.state = "unload"; }
    else if (m.state === "unload") { if (yard.stone < 4) { yard.stone++; m.unit = "steinmetz"; m.state = "toRock"; } }
    quarry.frame = yard.stone === 0 ? 0 : yard.stone <= 2 ? 1 : 2;
    // carrier: quarry yard → through the gate → store
    const q = stoneman;
    if (q.state === "wait") { const s = slotFor("stein", true); if (yard.stone > 0 && s) { yard.stone--; q.unit = "traeger_stein"; q.slot = s; q.state = "go"; route(q, [[15.5, 11.7], [15.5, 16.5], [15.5, 17.3], [(15.5 + s.x) / 2, (17.3 + s.y) / 2]]); } }
    else if (q.state === "go") { if (step(q, dt)) { q.slot.n = Math.min(8, q.slot.n + 1); q.unit = "tageloehner"; q.state = "back"; route(q, [[15.5, 17.3], [15.5, 11.7], [17.6, 11.7]]); } }
    else if (q.state === "back") { if (step(q, dt)) { q.state = "wait"; q.fx = 1; q.fy = 0; } }
    // guard walks the wall walk
    const gd = guard;
    if (!gd.path) route(gd, [[gd.dirx > 0 ? 19.5 : 10.5, 12.5]]);
    if (step(gd, dt * 0.7)) { gd.dirx = -gd.dirx; gd.t = 1.5; }
    // drill: the armoured foot soldier marches a short square in front of the barracks
    const dr = drill[2];
    if (!dr.path) route(dr, [[19.0, 22.4], [18.0, 22.4], [18.0, 23.4], [19.0, 23.4]]);
    step(dr, dt * 0.8);
    // the gate opens while someone passes
    gate.frame = figs.some(f => !f.h && Math.abs(f.x - 15.5) < 0.6 && Math.abs(f.y - 12.5) < 1.4) ? 1 : 0;
    // full store: after a while the goods go to a building site
    if (total("holz") >= 15 || total("stein") >= 15) { msgT += dt; if (msgT > 6) { slots.forEach(s => { if (s.good === "holz" || s.good === "stein") s.n = Math.min(s.n, 2); }); msgT = 0; } }
    else msgT = 0;
  }
  function regrow() { cutTrees.forEach((t, i) => { if (i !== cutter.tree && t.state === "stumpf") { t.state = "steht"; t.key = t.kind; t.frame = 0; } }); }

  // ---------- drawing
  const cache = [];
  function terrainLayer() {
    if (cache[W.r]) return cache[W.r];
    const c = document.createElement("canvas"); c.width = CW; c.height = CH;
    const x = c.getContext("2d"); x.fillStyle = "#5f7d36"; x.fillRect(0, 0, CW, CH);
    W.ground(x, T, 0, null, "wasser");
    return (cache[W.r] = c);
  }
  let wf = 0, t = 0;
  function render() {
    g.drawImage(terrainLayer(), 0, 0);
    W.ground(g, T, wf, "wasser");
    // stack sprites follow the slot amounts; figures on walls, towers and in the gate are drawn with the building
    slots.forEach(s => { s.b.frame = s.n <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(s.n / 2))); s.b.box = W.box(...s.b.tile); });
    B.forEach(b => { b.on = []; if (b.tree || b.key === "fels" || b.key === "baum_stumpf") b.box = W.box(b.x - 0.4, b.y - 0.4, b.x + 0.4, b.y + 0.4); });
    figs.forEach(f => {
      f.on = null;
      let host = null;
      if (f.tower) host = B.find(b => b.key === "turm" && b.x === f.tower[0] && b.y === f.tower[1]);
      else if (f.h) host = wallAt.get(Math.floor(f.x) + "," + Math.floor(f.y));
      else if (Math.abs(f.x - 15.5) < 0.5 && Math.floor(f.y) === 12) host = gate;
      if (host) { host.on.push(f); f.on = host; }
    });
    W.flat(g, B);
    W.draw(g, B, figs);
    vctx.imageSmoothingEnabled = false;
    vctx.clearRect(0, 0, CW, CH);
    if (zoom === 1) vctx.drawImage(off, 0, 0);
    else vctx.drawImage(off, CW / 4, CH / 4, CW / 2, CH / 2, 0, 0, CW, CH);
    const sw = $("sWood"), ss = $("sStone");
    if (sw) sw.textContent = total("holz");
    if (ss) ss.textContent = total("stein");
  }

  // ---------- controls
  const needle = $("needle");
  let needleAng = null;
  function updateCompass() {
    const [du, dv] = turn(0, -1, -W.r), sx = (du - dv) * 32, sy = (du + dv) * 16;
    let ang = Math.atan2(sy, sx) * 180 / Math.PI + 90;
    if (needleAng !== null) { const delta = (((ang - needleAng) % 360) + 540) % 360 - 180; ang = needleAng + delta; }
    needleAng = ang;
    if (needle) needle.style.transform = `rotate(${ang}deg)`;
  }
  function rotate(dir) {
    W.r = (W.r + dir + 4) % 4; updateCompass(); render();
    if (!reduce && canvas.animate) canvas.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
  }
  function setZoom(z) { zoom = z; $("z1").setAttribute("aria-pressed", String(z === 1)); $("z2").setAttribute("aria-pressed", String(z === 2)); render(); }
  $("rotL").addEventListener("click", () => rotate(-1));
  $("rotR").addEventListener("click", () => rotate(1));
  $("z1").addEventListener("click", () => setZoom(1));
  $("z2").addEventListener("click", () => setZoom(2));
  $("stage").addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "q" || e.key === "Q") { rotate(-1); e.preventDefault(); }
    else if (e.key === "e" || e.key === "E") { rotate(1); e.preventDefault(); }
  });
  function fitCanvas() {
    const w = canvas.parentElement.clientWidth - 16, s = Math.floor(w / CW);
    canvas.style.width = s >= 1 ? CW * s + "px" : "100%";
    canvas.style.imageRendering = s >= 1 ? "" : "auto";
  }
  if ("ResizeObserver" in window) new ResizeObserver(fitCanvas).observe(canvas.parentElement); else window.addEventListener("resize", fitCanvas);
  fitCanvas(); updateCompass(); render();

  let visible = true, last = 0, acc = 0, accW = 0;
  if ("IntersectionObserver" in window) new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(canvas);
  function loop(ts) {
    const dt = Math.min(0.1, (ts - last) / 1000 || 0); last = ts;
    if (visible) {
      t += dt; tick(dt);
      acc += dt; while (acc >= 0.11) { acc -= 0.11; figs.forEach(f => { if (f.walk) f.frame++; if (f.act) f.aframe++; }); }
      accW += dt; while (accW >= 0.25) { accW -= 0.25; wf = (wf + 1) % 4; }
      render();
    }
    requestAnimationFrame(loop);
  }
  if (!reduce) requestAnimationFrame(ts => { last = ts; requestAnimationFrame(loop); });
  window.__mkHero = { world: W, figs, slots, render };   // for the page checks only
}

// ================================================================ ERAS
function eras() {
  const scenes = [
    { // Anfang: Strohdachhaus, Holzfällerhütte, Bäume, Waffenknecht (Speerträger), Tagelöhner
      tiles: (x, y) => [(x === 6 && y >= 4) || (y === 7 && x >= 6) ? "erde" : hash(x, y) < 0.3 ? "wiese" : "gras", Math.floor(hash(y, x) * 4)],
      b: [["haus", 5, 5, 0], ["holzfaeller", 8, 6, 3, 1], ["baum", 3.5, 3.5, 1], ["tanne", 2.5, 5.5, 0], ["baum", 4.5, 2.5, 2, 1], ["tanne", 8.5, 3.5, 0]],
      f: [["speer", 6.6, 8.2, 0, 1], ["traeger", 7.0, 6.6, -1, 0.4], ["tageloehner", 4.8, 7.6, 1, 0]],
    },
    { // Ausbau: Steinmauer mit Turm und Tor, Schwertkämpfer, gepanzerter Fußsoldat, Armbrustschütze
      tiles: (x, y) => [y === 6 && x !== 6 ? "erde" : x === 6 && y > 6 ? "erde" : hash(x, y) < 0.25 ? "wiese" : "gras", Math.floor(hash(y, x) * 4)],
      b: [["turm", 4, 6, 0], ["mauer_gerade", 5.5, 6.5, 0], ["tor", 6.5, 6.5, 0], ["mauer_gerade", 7.5, 6.5, 0], ["mauer_ende", 8.5, 6.5, 2]],
      f: [["schwert", 5.4, 7.6, 0, 1], ["ritter", 6.3, 7.9, 0, 1], ["armbrust", 8.0, 6.65, 0, -1, 3], ["bogen", 3.35, 5.35, 0, -1, 5]],
    },
    { // Umbruch: Landsknechte im Block mit Spießen (Speerträger als Ersatz), dazu Schützen (Armbrust als Ersatz)
      tiles: (x, y) => [hash(x, y) < 0.18 ? "erde" : hash(x, y) < 0.4 ? "wiese" : "gras", Math.floor(hash(y, x) * 4)],
      b: [["haus", 3.5, 3.5, 1], ["baum", 9.5, 3.5, 2, 1], ["tanne", 2.5, 5.5, 0], ["fels", 9.5, 6.5, 1, 1]],
      f: [["landsknecht", 5.2, 5.6, 0, 1], ["landsknecht", 6.0, 5.6, 0, 1], ["landsknecht", 6.8, 5.6, 0, 1], ["speer", 5.2, 6.4, 0, 1], ["speer", 6.0, 6.4, 0, 1], ["speer", 6.8, 6.4, 0, 1],
        ["armbrust", 4.3, 7.2, 0, 1], ["armbrust", 7.7, 7.2, 0, 1], ["landsknecht", 6.0, 7.2, 0, 1]],
    },
  ];
  document.querySelectorAll(".era-cv").forEach(cv => {
    const sc = scenes[+cv.dataset.era]; if (!sc) return;
    cv.width = 320; cv.height = 180;
    const c = cv.getContext("2d"), W = new World(12, 160, 130 - 6 * 32);
    c.fillStyle = "#5f7d36"; c.fillRect(0, 0, cv.width, cv.height);
    W.ground(c, sc.tiles, 0);
    const blds = sc.b.map(([key, x, y, o, frame]) => ({ key, x, y, o, frame: frame || 0, on: [] }));
    const figs = sc.f.map(([unit, x, y, fx, fy, h]) => ({ unit, x, y, fx, fy, h: h || 0 }));
    figs.forEach(f => {
      if (!f.h) return;
      const host = blds.find(b => Math.abs(b.x - f.x) <= (b.key === "turm" ? 1 : 0.5) && Math.abs(b.y - f.y) <= (b.key === "turm" ? 1 : 0.5));
      if (host) { host.on.push(f); f.on = host; }
    });
    W.draw(c, blds, figs);
  });
}

// ================================================================ TERRAIN SWATCHES
function swatches() {
  const MAP = { wiese: "wiese", wald: "waldboden", fels: "fels", erz: "erz", sumpf: "sumpf", wasser: "wasser", strasse: "erde", acker: "acker" };
  const water = [];
  document.querySelectorAll(".tile canvas[data-t]").forEach((cv, i) => {
    const key = MAP[cv.dataset.t]; if (!key) return;
    cv.width = 64; cv.height = 32;
    const c = cv.getContext("2d");
    const paint = f => { c.clearRect(0, 0, 64, 32); drawT(c, key, i % 4, f, 32, 16); };
    paint(0);
    if (key === "wasser") water.push(paint);
  });
  if (water.length && !reduce) { let f = 0; setInterval(() => { f = (f + 1) % 4; water.forEach(p => p(f)); }, 250); }
}

// ================================================================ STORE WITH SLIDER
function store() {
  const cv = $("stockCv"); if (!cv) return;
  const fill = $("fill"), fillV = $("fillV");
  cv.width = 224; cv.height = 140;
  const c = cv.getContext("2d"), W = new World(9, 112, 96 - 4.5 * 32), O = 3;   // store in the middle of a 9 × 9 patch
  const SLOTS = [[-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [0, 0]];
  const GOODS = ["stapel_holz", "stapel_holz", "stapel_stein", "stapel_eisen", "stapel_stein", "stapel_speer", "stapel_schwert", "stapel_bogen"];
  const NAMES = { stapel_holz: "Holz", stapel_stein: "Stein", stapel_eisen: "Eisen", stapel_speer: "Speere", stapel_schwert: "Schwerter", stapel_bogen: "Bögen" };
  function draw() {
    const f = +fill.value / 100;
    c.fillStyle = "#5f7d36"; c.fillRect(0, 0, cv.width, cv.height);
    W.ground(c, (x, y) => [x === O + 1 && y > O + 2 ? "erde" : hash(x, y) < 0.3 ? "wiese" : "gras", Math.floor(hash(y, x) * 4)], 0);
    const blds = [{ key: "lager_boden", x: O + 1.5, y: O + 1.5, o: 0, flat: true }, { key: "lager_boden", x: O + 1.5, y: O + 1.5, o: 0, over: true, frame: 0 }];
    const levels = [];
    SLOTS.forEach((m, k) => {
      const [dx, dy] = modelToWorld(m[0], m[1], 0), x = O + 1.5 + dx, y = O + 1.5 + dy;
      const n = Math.max(0, Math.min(4, Math.round(f * 4 * 1.3 - k * 0.3)));
      levels.push(NAMES[GOODS[k]] + " " + n + "/4");
      blds.push({ key: GOODS[k], x, y, o: 0, frame: n, box: W.box(x - 0.45, y - 0.45, x + 0.45, y + 0.45) });
    });
    W.flat(c, blds); W.draw(c, blds, []);
    fillV.textContent = fill.value + " %";
    cv.setAttribute("aria-label", "Lagerplatz aus dem Gebäudetest, Füllstand " + fill.value + " %: " + levels.join(", "));
  }
  fill.addEventListener("input", draw); draw();
  fitInt(cv, 3);
}

// ================================================================ TOWER IN FOUR VIEWS
function views() {
  const host = $("views"); if (!host) return;
  for (let r = 0; r < 4; r++) {
    const fig = document.createElement("figure"), cv = document.createElement("canvas"), cap = document.createElement("figcaption");
    cv.width = 256; cv.height = 212; cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", "Mauerturm mit Mauerstücken, Bogenschütze auf dem Turm, Speerträger davor, Ansicht " + (r + 1) + " von 4");
    cap.textContent = "Ansicht " + (r + 1) + " · " + (r * 90) + "°";
    fig.append(cv, cap); host.append(fig);
    const c = cv.getContext("2d"), W = new World(10, 128, 164 - 5 * 32), O = 2; W.r = r;   // tower in the middle of a 10 × 10 patch
    c.fillStyle = "#5f7d36"; c.fillRect(0, 0, cv.width, cv.height);
    W.ground(c, (x, y) => [x === O + 3 && y >= O + 4 ? "erde" : hash(x, y) < 0.3 ? "wiese" : "gras", Math.floor(hash(y, x) * 4)], 0);
    const blds = [{ key: "turm", x: O + 3, y: O + 3, o: 0, on: [] }, { key: "mauer_gerade", x: O + 1.5, y: O + 3.5, o: 0 }, { key: "mauer_ende", x: O + 0.5, y: O + 3.5, o: 0 },
      { key: "mauer_gerade", x: O + 4.5, y: O + 3.5, o: 0 }, { key: "mauer_ende", x: O + 5.5, y: O + 3.5, o: 2 }];
    // archer on the north-west corner post of the platform (model posts at ±0.65 tiles)
    const archer = { unit: "bogen", x: O + 3 - 0.65, y: O + 3 - 0.65, h: 5, fx: 0, fy: -1, on: blds[0] };
    blds[0].on.push(archer);
    W.draw(c, blds, [archer, { unit: "speer", x: O + 3.5, y: O + 5.0, fx: 0, fy: 1 }]);
    fitInt(cv, 2);
  }
}

// ================================================================ UNIT ICONS (barracks raster)
function unitIcons() {
  const c = FD.cell;
  document.querySelectorAll(".slot canvas[data-unit]").forEach(cv => {
    const key = cv.dataset.unit, e = FU[key]; if (!e) return;
    const I = e[0] === "f" ? IM.f : IM.x; if (!I) return;
    // standing, facing south (as the game's icons), cropped to the figure
    const tmp = document.createElement("canvas"); tmp.width = c; tmp.height = c;
    const tg = tmp.getContext("2d"); tg.drawImage(I, 0, e[1] * 8 * c, c, c, 0, 0, c, c);
    const d = tg.getImageData(0, 0, c, c).data;
    let x0 = c, y0 = c, x1 = -1, y1 = -1;
    for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) {
      const p = (y * c + x) * 4;
      // skip the soft cast shadow (dark, half transparent) so the figure sits in the middle
      if (d[p + 3] > 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return;
    const S = 48, w = x1 - x0 + 1, h = y1 - y0 + 1, s = Math.min(1, (S - 4) / w, (S - 4) / h);
    cv.width = S; cv.height = S;
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = s < 1;
    const dw = Math.round(w * s), dh = Math.round(h * s);
    g.drawImage(tmp, x0, y0, w, h, Math.floor((S - dw) / 2), S - 2 - dh, dw, dh);
  });
}

// ================================================================ UI MOCK: screenshot, minimap, building icons
function mock() {
  const shot = $("mockShot"), mini = $("mockMini");
  if (shot && WD.shot) shot.src = WD.shot;
  if (mini && WD.mini) mini.src = WD.mini;
  document.querySelectorAll(".m-tabs canvas[data-b]").forEach(cv => {
    const u = BU[cv.dataset.b]; if (!u || !IM.b) return;
    const S = cv.width, f = cv.dataset.b === "lager" ? u.frames - 1 : Math.min(u.frames - 1, 1);
    const g = cv.getContext("2d"); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    const s = Math.min((S - 4) / u.w, (S - 4) / u.h), dw = Math.round(u.w * s), dh = Math.round(u.h * s);
    g.drawImage(IM.b, f * u.w, u.at, u.w, u.h, Math.floor((S - dw) / 2), Math.floor((S - dh) / 2), dw, dh);
  });
}

Promise.all([load(BD.src), load(BD.fsrc), load(FD.src), load(FD.xsrc), load(WD.terrain.src), load(WD.act.src)]).then(([b, bf, f, x, t, act]) => {
  Object.assign(IM, { b, bf, f, x, t, act });
  if (!b || !f || !t) return;
  const run = fn => { try { fn(); } catch (e) { console.error(e); } };
  [hero, eras, swatches, store, views, unitIcons, mock].forEach(run);
});
})();
