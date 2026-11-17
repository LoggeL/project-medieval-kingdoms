/**
 * Platzhalter-Simulation für die parallele Entwicklung von Darstellung und UI.
 * Erzeugt eine feste kleine Welt und bewegt ein paar Figuren im Kreis. Keine Spiellogik.
 * Die echte Simulation (src/sim/index.ts, createGame) ersetzt das, die Schnittstelle ist dieselbe (types.ts).
 */
import { BUILDINGS, type BuildingKey, type Good, type UnitKey } from "../data";
import { NEIGHBOURS, footprintTiles } from "./geom";
import type { Building, Command, CommandResult, Game, PlacementCheck, SimState, Unit } from "./types";

export function createDemoGame(): Game {
  const W = 48, H = 48;
  const s: SimState = {
    tick: 0, seed: 1, w: W, h: H, tiles: [], trees: [], rocks: [], buildings: [], units: [], projectiles: [],
    gold: 150, population: 8, housing: 12,
    stock: { holz: 40, stein: 30, eisen: 0, speer: 3, schwert: 2, bogen: 4, getreide: 0, mehl: 0, brot: 0 }, capacity: 64,
    raid: { next: 6000, wave: 0, active: false }, messages: [{ tick: 0, text: "Willkommen, Burgherr.", kind: "info" }],
    research: { done: [], cur: null },
  };
  let rnd = 7;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let terrain: SimState["tiles"][number]["terrain"] = rand() < 0.15 ? "wiese" : "gras";
    if (x < 14 && y < 18) terrain = "waldboden";
    if (x > 36 && y < 12) terrain = "fels";
    if (y > 40 && x > 10 && x < 30) terrain = "wasser";
    if (y === 24 && x > 4 && x < 40) terrain = "erde";
    s.tiles.push({ terrain, variant: Math.floor(rand() * 4), building: 0 });
  }
  let id = 1;
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(rand() * 14), y = Math.floor(rand() * 18);
    if (s.trees.some((t) => t.x === x && t.y === y)) continue;
    const st = i % 11 === 0 ? "stumpf" : i % 13 === 0 ? "liegt" : "stehend";
    s.trees.push({ id: id++, x, y, kind: rand() < 0.35 ? "tanne" : "baum", variant: Math.floor(rand() * 2), state: st, progress: 0, fallX: 1, fallY: 0, logs: st === "liegt" ? 3 : 0, reservedBy: 0 });
  }
  for (let i = 0; i < 10; i++) {
    const max = 12;
    s.rocks.push({ id: id++, x: 38 + (i % 5) * 2, y: 2 + Math.floor(i / 5) * 3, amount: Math.max(1, max - i), max, reservedBy: 0 });
  }
  const add = (key: BuildingKey, x: number, y: number, o: number, built = 1): Building => {
    const b: Building = {
      id: id++, key, team: 0, x, y, o, built, needs: built < 1 ? { holz: 3 } : {}, site: built < 1 ? { holz: 2 } : {},
      hp: BUILDINGS[key].hp, output: BUILDINGS[key].output ? { good: BUILDINGS[key].output!.good, amount: 2, reserved: 0 } : null,
      slots: [], workers: [], wallMask: 0, training: null, queue: [],
    };
    if (key === "lager") {
      const goods: (Good | null)[] = ["holz", "holz", "stein", "stein", "speer", "schwert", "bogen", null];
      b.slots = goods.map((g, k) => ({ good: g, amount: g ? 1 + ((k * 3) % 8) : 0, reserved: 0, incoming: 0 }));
    }
    for (const [tx, ty] of footprintTiles(key, x, y, o)) s.tiles[ty * W + tx].building = b.id;
    s.buildings.push(b);
    return b;
  };
  add("lager", 20, 20, 0);
  add("holzfaeller", 14, 12, 1);
  add("steinbruch", 33, 6, 0);
  add("kaserne", 26, 26, 0);
  add("haus", 16, 26, 0);
  add("haus", 12, 22, 3, 0.4);
  for (let x = 20; x <= 30; x++) add(x === 25 ? "tor" : "mauer", x, 34, 0);
  add("turm", 31, 33, 0);
  add("treppe", 22, 32, 0);
  // Mauer-Nachbarschaft
  const fort = new Set(["mauer", "tor", "turm"]);
  for (const b of s.buildings) if (fort.has(b.key)) {
    for (const [tx, ty] of footprintTiles(b.key, b.x, b.y, b.o)) NEIGHBOURS.forEach(([dx, dy], bit) => {
      const n = s.tiles[(ty + dy) * W + tx + dx]?.building;
      const nb = n && n !== b.id ? s.buildings.find((q) => q.id === n) : undefined;
      if (nb && fort.has(nb.key)) b.wallMask |= 1 << bit;
    });
  }
  const unit = (key: UnitKey, x: number, y: number, team: 0 | 1 = 0, z = 0, layer = 0): Unit => {
    const u: Unit = { id: id++, key, team, x, y, z, layer, px: x, py: y, pz: z, fx: 1, fy: 0, anim: "stehen", animT: 0, carry: null, hp: 50, maxHp: 50, order: { t: "idle" }, home: 0, dead: false };
    s.units.push(u);
    return u;
  };
  const walkers = [unit("tageloehner", 22, 24), unit("tageloehner", 18, 22), unit("holzfaeller", 10, 10), unit("steinmetz", 36, 8)];
  walkers[0].carry = "holz"; walkers[1].carry = "stein";
  unit("speer", 26.5, 31.5); unit("schwert", 27.5, 31.5); unit("bogen", 23.5, 34.5, 0, 3, 1); unit("bogen", 32, 34, 0, 5, 2);
  unit("schwert", 26, 40, 1); unit("speer", 27, 41, 1);
  s.projectiles.push({ id: id++, team: 0, x0: 23.5, y0: 34.5, z0: 4, x1: 26, y1: 40, z1: 1, t: 0 });

  const no = (): PlacementCheck => ({ ok: false, reason: "Platzhalter-Simulation", tiles: [] });
  return {
    state: s,
    tick() {
      s.tick++;
      const t = s.tick / 20;
      walkers.forEach((u, i) => {
        u.px = u.x; u.py = u.y; u.pz = u.z;
        const a = t * 0.4 + i * 1.6, cx = [21, 19, 9, 37][i], cy = [23, 21, 9, 8][i];
        u.x = cx + Math.cos(a) * 2; u.y = cy + Math.sin(a) * 2;
        u.fx = -Math.sin(a); u.fy = Math.cos(a); u.anim = "gehen"; u.animT = t;
      });
      for (const p of s.projectiles) p.t = (p.t + 0.05) % 1;
    },
    dispatch: (_c: Command): CommandResult => ({ ok: false, reason: "Platzhalter-Simulation" }),
    canPlace: (key, x, y, o) => ({ ...no(), tiles: footprintTiles(key, x, y, o).map(([tx, ty]) => ({ x: tx, y: ty, ok: s.tiles[ty * W + tx]?.building === 0 })) }),
    wallPath: () => no(),
    roadPath: () => no(),
    walkLayerAt: (x, y) => { const b = s.buildings.find((q) => q.id === s.tiles[y * W + x]?.building); return b && BUILDINGS[b.key].walkway ? BUILDINGS[b.key].walkway! : 0; },
    save: () => JSON.stringify(s),
  };
}
