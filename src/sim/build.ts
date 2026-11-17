/**
 * Bauen: Platzierungsregeln, Baustellen, Mauerlinien, Fertigstellung, Abriss und Zerstörung.
 * Eine Baustelle belegt sofort ihren Grundriss. Gold wird sofort bezahlt, Waren bringen Tagelöhner Stück für
 * Stück aus dem Lager (economy.ts), danach baut einer die Baustelle fertig (jobs.ts).
 */
import { BUILDINGS, GOODS, TERRAIN, type BuildingKey, type Good } from "../data";
import { NEIGHBOURS, center, entrance, footprintTiles, stairEnds } from "./geom";
import { abortJobsAt } from "./jobs";
import { available, storeDirect } from "./storage";
import type { PlacementCheck } from "./types";
import type { SBuilding, World } from "./world";

const FORT = new Set<BuildingKey>(["mauer", "tor", "turm"]);
export const isFort = (key: BuildingKey): boolean => FORT.has(key);
const MAX_WALL = 64;

// ---------------------------------------------------------------- Regeln
function tileReason(w: World, x: number, y: number, key: BuildingKey): string | null {
  if (!w.inMap(x, y)) return "Außerhalb der Karte";
  const t = w.s.tiles[w.idx(x, y)];
  if (!TERRAIN[t.terrain].buildable) return `${TERRAIN[t.terrain].name} ist kein Bauland`;
  if (t.building) {
    const b = w.buildings.get(t.building);
    if (!(key === "tor" && b && b.key === "mauer" && b.team === 0)) return "Hier steht schon etwas";
  }
  if (w.s.rocks.some((r) => r.x === x && r.y === y && r.amount > 0)) return "Felsbrocken im Weg";
  if (w.s.trees.some((tr) => tr.x === x && tr.y === y && tr.state !== "stumpf")) return "Bäume im Weg";
  return null;
}

function costReason(w: World, key: BuildingKey, times = 1): string | null {
  const cost = BUILDINGS[key].cost;
  if ((cost.gold ?? 0) * times > w.s.gold) return "Nicht genug Gold";
  for (const [g, n] of Object.entries(cost) as [Good | "gold", number][]) {
    if (g === "gold") continue;
    if (available(w, g) < n * times) return `Nicht genug ${GOODS[g].name}`;
  }
  return null;
}

export function canPlace(w: World, key: BuildingKey, x: number, y: number, o: number): PlacementCheck {
  const def = BUILDINGS[key];
  if (!def) return { ok: false, reason: "Unbekanntes Gebäude", tiles: [] };
  o = ((o % 4) + 4) % 4;
  let reason: string | null = null;
  const tiles = footprintTiles(key, x, y, o).map(([tx, ty]) => {
    const r = tileReason(w, tx, ty, key);
    if (r && !reason) reason = r;
    return { x: tx, y: ty, ok: !r };
  });
  if (!reason && (def.workers || def.trains || def.housing || def.storage)) {
    const [ex, ey] = entrance(key, x, y, o);
    if (!w.inMap(ex, ey) || !TERRAIN[w.s.tiles[w.idx(ex, ey)].terrain].walkable || w.s.tiles[w.idx(ex, ey)].building
      || w.s.rocks.some((r) => r.x === ex && r.y === ey && r.amount > 0)) reason = "Der Eingang ist versperrt";
  }
  if (!reason && def.placement?.adjacentTerrain) {
    const want = def.placement.adjacentTerrain;
    const touches = tiles.some((t) => NEIGHBOURS.some(([dx, dy]) => w.inMap(t.x + dx, t.y + dy) && w.s.tiles[w.idx(t.x + dx, t.y + dy)].terrain === want));
    if (!touches) reason = `Muss an ${TERRAIN[want].name} grenzen`;
  }
  if (!reason && def.placement?.nearTag) {
    const { tag, count, radius } = def.placement.nearTag;
    const [cx, cy] = center(key, x, y, o);
    const n = tag === "tree"
      ? w.s.trees.filter((t) => t.state === "stehend" && Math.hypot(t.x + 0.5 - cx, t.y + 0.5 - cy) <= radius).length
      : w.s.rocks.filter((r) => r.amount > 0 && Math.hypot(r.x + 0.5 - cx, r.y + 0.5 - cy) <= radius).length;
    if (n < count) reason = tag === "tree" ? "Zu wenige Bäume in der Nähe" : "Kein Felsbrocken in der Nähe";
  }
  if (!reason && def.stairs) {
    const e = stairEnds(x, y, o);
    const b = w.buildingAt(e.wall[0], e.wall[1]);
    if (!b || (b.key !== "mauer" && b.key !== "tor")) reason = "Die Rückseite muss an eine Mauer grenzen";
  }
  if (!reason) reason = costReason(w, key);
  return { ok: !reason, reason: reason ?? undefined, tiles };
}

/** Tiles einer Mauerlinie: gerade oder L-förmig (zuerst entlang der längeren Achse). */
export function wallLine(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  let x = x0, y = y0;
  out.push([x, y]);
  if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
    while (x !== x1) { x += sx; out.push([x, y]); }
    while (y !== y1) { y += sy; out.push([x, y]); }
  } else {
    while (y !== y1) { y += sy; out.push([x, y]); }
    while (x !== x1) { x += sx; out.push([x, y]); }
  }
  return out.slice(0, MAX_WALL);
}

export function wallPath(w: World, x0: number, y0: number, x1: number, y1: number): PlacementCheck & { build: [number, number][] } {
  let reason: string | null = null;
  const build: [number, number][] = [];
  const tiles = wallLine(x0, y0, x1, y1).map(([x, y]) => {
    const b = w.buildingAt(x, y);
    if (b && b.team === 0 && FORT.has(b.key)) return { x, y, ok: true }; // schon Mauer: wird übersprungen
    const r = tileReason(w, x, y, "mauer");
    if (r) { reason ??= r; return { x, y, ok: false }; }
    build.push([x, y]);
    return { x, y, ok: true };
  });
  if (!reason && build.length) reason = costReason(w, "mauer", build.length);
  if (!build.length) reason ??= "Hier steht schon eine Mauer";
  return { ok: !reason, reason: reason ?? undefined, tiles, build };
}

// ---------------------------------------------------------------- Baustellen
export function placeSite(w: World, key: BuildingKey, x: number, y: number, o: number): SBuilding {
  const def = BUILDINGS[key];
  o = ((o % 4) + 4) % 4;
  if (key === "tor") {
    const old = w.buildingAt(x, y);
    if (old && old.key === "mauer") {
      // Tor quer zur Mauerlinie ausrichten
      o = old.wallMask & 0b1010 ? 0 : 1;
      removeBuilding(w, old, "ersetzt");
    }
  }
  const b = w.addBuilding(key, 0, x, y, o);
  const fp = footprintTiles(key, x, y, o);
  const onFp = new Set(fp.map(([tx, ty]) => w.idx(tx, ty)));
  for (const [tx, ty] of fp) w.s.tiles[w.idx(tx, ty)].building = b.id;
  w.s.trees = w.s.trees.filter((t) => !onFp.has(w.idx(t.x, t.y))); // Baumstümpfe weichen der Baustelle
  w.s.gold -= def.cost.gold ?? 0;
  for (const [g, n] of Object.entries(def.cost) as [Good | "gold", number][]) if (g !== "gold" && n > 0) b.needs[g] = n;
  b.hp = Math.max(1, Math.round(def.hp * 0.2));
  updateWallMasks(w);
  w.nav.rebuild();
  return b;
}

export function completeBuilding(w: World, b: SBuilding): void {
  const def = BUILDINGS[b.key];
  b.built = 1;
  b.hp = def.hp;
  b.needs = {}; b.site = {};
  b.ai.enroute = {}; b.ai.picked = {}; b.ai.builder = 0;
  if (def.storage && !b.slots.length) b.slots = Array.from({ length: def.storage.slots }, () => ({ good: null, amount: 0, reserved: 0, incoming: 0 }));
  if (def.output && !b.output) b.output = { good: def.output.good, amount: 0, reserved: 0 };
  updateWallMasks(w);
  w.nav.rebuild();
  if (FORT.has(b.key) || def.stairs) w.msg(`${def.name} fertiggestellt.`, "info", `fertig-${b.key}`, 10);
  else w.msg(`${def.name} ist fertig.`);
}

/**
 * Gebäude entfernen. why: "abriss" gibt die Hälfte der Kosten zurück (Waren direkt ins Lager),
 * "zerstoert" verliert alles, "ersetzt" (Mauer unter einem neuen Tor) gibt nichts zurück.
 */
export function removeBuilding(w: World, b: SBuilding, why: "abriss" | "zerstoert" | "ersetzt"): void {
  const def = BUILDINGS[b.key];
  w.removeBuildingRecord(b);
  for (const [tx, ty] of footprintTiles(b.key, b.x, b.y, b.o)) if (w.inMap(tx, ty) && w.s.tiles[w.idx(tx, ty)].building === b.id) w.s.tiles[w.idx(tx, ty)].building = 0;
  abortJobsAt(w, b);
  if (b.ai.inside) { b.ai.inside = null; b.training = null; } // Rekrut in der Ausbildung geht verloren
  for (const u of w.s.units) if (u.order.t === "station" && u.order.building === b.id) u.order = { t: "idle" };
  if (why === "abriss") {
    for (const s of b.slots) if (s.good && s.amount > 0) storeDirect(w, s.good, s.amount); // Bestand umlagern, soweit Platz ist
    for (const [g, n] of Object.entries(def.cost) as [Good | "gold", number][]) {
      const half = Math.floor(n / 2);
      if (g === "gold") w.s.gold += half; else if (half > 0) storeDirect(w, g, half);
    }
  }
  updateWallMasks(w);
  w.nav.rebuild();
  // Wer auf einem verschwundenen Wehrgang stand, fällt herunter
  for (const u of w.s.units) {
    if (u.dead || u.layer === 0) continue;
    const n = w.nav.node(u.layer, Math.floor(u.x), Math.floor(u.y));
    if (!w.nav.open(n, u.team)) { u.layer = 0; u.z = 0; u.hp -= 10; u.ai.path = null; u.ai.goal = ""; }
  }
  if (why === "zerstoert") w.msg(`${def.name} wurde zerstört!`, "kampf", `zerstoert-${b.key}`, 5);
  else if (why === "abriss") w.msg(`${def.name} abgerissen.`);
}

/** Nachbarschaftsmasken aller Befestigungen neu berechnen (Bits wie geom.NEIGHBOURS). */
export function updateWallMasks(w: World): void {
  for (const b of w.s.buildings) {
    if (!FORT.has(b.key)) { b.wallMask = 0; continue; }
    let mask = 0;
    for (const [tx, ty] of footprintTiles(b.key, b.x, b.y, b.o)) NEIGHBOURS.forEach(([dx, dy], bit) => {
      const n = w.buildingAt(tx + dx, ty + dy);
      if (n && n.id !== b.id && FORT.has(n.key)) mask |= 1 << bit;
    });
    b.wallMask = mask;
  }
}

/** Laufebene am Tile: 1 auf fertigen Mauern und Toren, 2 auf fertigen Türmen. */
export function walkLayerAt(w: World, x: number, y: number): number {
  const b = w.buildingAt(x, y);
  if (!b || b.built < 1) return 0;
  return BUILDINGS[b.key].walkway ?? 0;
}
