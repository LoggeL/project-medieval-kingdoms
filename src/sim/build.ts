/**
 * Bauen: Platzierungsregeln, Baustellen, Mauerlinien, Fertigstellung, Abriss und Zerstörung.
 * Eine Baustelle belegt sofort ihren Grundriss. Gold wird sofort bezahlt, Waren bringen Tagelöhner Stück für
 * Stück aus dem Lager (economy.ts) und legen sie auf der Baustelle ab. Ein Bauarbeiter (jobs.ts) verbaut sie Stück für
 * Stück: Der Fortschritt wächst nur durch Arbeit und kommt nie über den Anteil des verbauten Materials hinaus.
 */
import { BUILDINGS, GOODS, TECHS, TERRAIN, levelDef, type BuildingKey, type Cost, type Good } from "../data";
import type { VoiceKey } from "../data/audio";
import { NEIGHBOURS, approach, center, footprintTiles, gateOrientation, stairEnds, wallPiece } from "./geom";
import { abortJobsAt } from "./jobs";
import { evictUnits } from "./move";
import { available, storeDirect } from "./storage";
import { lockedBy, levelOf } from "./research";
import { newProc, returnProcGoods } from "./production";
import type { PlacementCheck } from "./types";
import type { SBuilding, World } from "./world";

/** Befestigungen mit Wehrgang oder Plattform (Mauer, Tor, Turm), aus den Daten abgeleitet. */
const FORT = new Set<BuildingKey>((Object.keys(BUILDINGS) as BuildingKey[]).filter((k) => BUILDINGS[k].walkway));
export const isFort = (key: BuildingKey): boolean => FORT.has(key);
const MAX_WALL = 64;

// ---------------------------------------------------------------- Regeln
/** Nachbarschaftsmaske (Bits wie geom.NEIGHBOURS) eines Tiles zu eigenen Befestigungen, ohne das Gebäude `self`. */
function fortMaskAt(w: World, x: number, y: number, self = 0): number {
  let mask = 0;
  NEIGHBOURS.forEach(([dx, dy], bit) => {
    const n = w.buildingAt(x + dx, y + dy);
    if (n && n.id !== self && n.team === 0 && FORT.has(n.key)) mask |= 1 << bit;
  });
  return mask;
}

/** Tor nur in einem geraden Mauerstück (genau zwei gegenüberliegende Nachbarn). */
function gateReason(w: World, x: number, y: number): string | null {
  const old = w.buildingAt(x, y);
  const mask = fortMaskAt(w, x, y, old?.id);
  if (wallPiece(mask).piece === "mauer_gerade") return null;
  return old ? "Ein Tor passt nur in ein gerades Mauerstück, nicht in Ecken oder Enden" : "Ein Tor gehört in eine gerade Mauerlinie";
}

/**
 * Gebäude mit Tür, durch die Figuren ein- und ausgehen: alle mit Daten `door` (Werkstatt, Kaserne, Wohnhaus, Lagerhaus,
 * Bergfried, auch der Mauerturm, dessen Tür der Übergang Boden ↔ Plattform ist) und alle, die Leute aufnehmen.
 */
export function hasDoor(key: BuildingKey): boolean {
  const def = BUILDINGS[key];
  return !!(def.door || def.workers || def.trains || def.housing || def.storage || def.seat);
}

/** Gebäude, dessen Tür bzw. Vorplatz (vor einer Einfahrt im Grundriss) auf (x, y) liegt, oder undefined. */
function doorAt(w: World, x: number, y: number): SBuilding | undefined {
  for (const b of w.s.buildings) {
    if (!hasDoor(b.key)) continue;
    const [ax, ay] = approach(b.key, b.x, b.y, b.o);
    if (ax === x && ay === y) return b;
  }
  return undefined;
}

/** Weg oder Brücke (BuildingDef.road): kein Hindernis, darf vor Türen liegen. */
export const isRoad = (key: BuildingKey): boolean => !!BUILDINGS[key].road;

function tileReason(w: World, x: number, y: number, key: BuildingKey): string | null {
  if (!w.inMap(x, y)) return "Außerhalb der Karte";
  const t = w.s.tiles[w.idx(x, y)];
  const road = BUILDINGS[key].road;
  if (road?.bridge) { if (t.terrain !== "wasser") return "Eine Brücke gehört über das Wasser"; }
  else if (!TERRAIN[t.terrain].buildable) return `${TERRAIN[t.terrain].name} ist kein Bauland`;
  if (t.building) {
    const b = w.buildings.get(t.building);
    if (road && b && isRoad(b.key)) return "Hier liegt schon ein Weg";
    if (!(key === "tor" && b && b.key === "mauer" && b.team === 0)) return "Hier steht schon etwas";
  }
  if (key === "tor") { const r = gateReason(w, x, y); if (r) return r; }
  // Nichts vor eine Tür setzen: Figuren betreten Gebäude nur dort, nicht durch die Wand (ein Weg darf zur Tür führen)
  const d = road ? undefined : doorAt(w, x, y);
  if (d) return `Versperrt den Eingang: ${BUILDINGS[d.key].name}`;
  if (w.s.rocks.some((r) => r.x === x && r.y === y && r.amount > 0)) return "Felsbrocken im Weg";
  if (w.s.trees.some((tr) => tr.x === x && tr.y === y && tr.state !== "stumpf")) return "Bäume im Weg";
  return null;
}

/**
 * Kosten eines Baus an (x, y): Ein Tor in einem Mauerstück übernimmt dessen Steine, es kostet also nur den Unterschied
 * (Mauer ziehen, dann das Tor hineinsetzen, verschwendet nichts). Bei einer fertigen Mauer zählt ihr ganzes Material,
 * bei einer Mauer-Baustelle das schon angelieferte (liegend oder verbaut, also Kosten minus needs); Gold zählt dort nicht,
 * es ist mit der Baustelle bezahlt.
 */
export function costAt(w: World, key: BuildingKey, x: number, y: number): Cost {
  const cost: Cost = { ...BUILDINGS[key].cost };
  const old = key === "tor" ? w.buildingAt(x, y) : undefined;
  if (old && old.key === "mauer" && old.team === 0) {
    for (const [g, n] of Object.entries(BUILDINGS.mauer.cost) as [Good | "gold", number][]) {
      const have = old.built >= 1 ? n : g === "gold" ? 0 : Math.max(0, n - (old.needs[g] ?? 0));
      if (have > 0) cost[g] = Math.max(0, (cost[g] ?? 0) - have);
    }
  }
  return cost;
}

function costReason(w: World, key: BuildingKey, times = 1, cost: Cost = BUILDINGS[key].cost): string | null {
  if ((cost.gold ?? 0) * times > w.s.gold) return "Nicht genug Gold";
  for (const [g, n] of Object.entries(cost) as [Good | "gold", number][]) {
    if (g === "gold") continue;
    if (available(w, g) < n * times) return `Nicht genug ${GOODS[g].name}`;
  }
  return null;
}

/** Ansage zu einer abgelehnten Platzierung: zu_teuer bei fehlendem Material oder Gold, sonst kein_platz. */
export function placeVoice(chk: PlacementCheck & { costFail?: boolean }): VoiceKey | undefined {
  if (chk.ok) return undefined;
  return chk.costFail ? "zu_teuer" : "kein_platz";
}

export function canPlace(w: World, key: BuildingKey, x: number, y: number, o: number): PlacementCheck & { costFail?: boolean } {
  const def = BUILDINGS[key];
  if (!def) return { ok: false, reason: "Unbekanntes Gebäude", tiles: [] };
  o = ((o % 4) + 4) % 4;
  let reason: string | null = def.seat ? `Den ${def.name} gibt es nur einmal, er steht seit Beginn` : null;
  const lock = lockedBy(w.s, def);
  if (!reason && lock) reason = `Erst erforschen: ${TECHS[lock].name}`;
  const tiles = footprintTiles(key, x, y, o).map(([tx, ty]) => {
    const r = tileReason(w, tx, ty, key);
    if (r && !reason) reason = r;
    return { x: tx, y: ty, ok: !r };
  });
  if (!reason && hasDoor(key)) {
    // Tür bzw. Vorplatz einer Einfahrt im Grundriss (Daten `door`) muss frei und begehbar sein
    const [ex, ey] = approach(key, x, y, o);
    const onDoor = w.inMap(ex, ey) ? w.buildingAt(ex, ey) : undefined;
    if (!w.inMap(ex, ey) || !TERRAIN[w.s.tiles[w.idx(ex, ey)].terrain].walkable || (onDoor && !isRoad(onDoor.key))
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
  let costFail = false;
  if (!reason) { reason = costReason(w, key, 1, costAt(w, key, x, y)); costFail = !!reason; }
  return costFail ? { ok: false, reason: reason!, tiles, costFail } : { ok: !reason, reason: reason ?? undefined, tiles };
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

/**
 * Mauerlinie prüfen. Vorschau (Game.wallPath) und Bau (Befehl "mauer") nutzen genau dieses Ergebnis:
 * - Ein Hindernis irgendwo auf der Linie: ok false, gebaut wird nichts (keine Mauer mit Lücke).
 * - Reicht das Material nur für einen Teil: ok true, `build` enthält nur die bezahlbaren Stücke (vom Start aus),
 *   die übrigen Tiles sind rot, reason nennt es („Nur 5 von 9 Mauerstücken bezahlbar“).
 * - Gar nichts bezahlbar: ok false („Nicht genug Stein“, costFail).
 * Vorhandene eigene Mauern, Tore und Türme auf der Linie werden übersprungen.
 */
export function wallPath(w: World, x0: number, y0: number, x1: number, y1: number): PlacementCheck & { build: [number, number][]; costFail?: boolean } {
  let reason: string | null = null;
  let build: [number, number][] = [];
  const tiles = wallLine(x0, y0, x1, y1).map(([x, y]) => {
    const b = w.buildingAt(x, y);
    if (b && b.team === 0 && FORT.has(b.key)) return { x, y, ok: true }; // schon Mauer: wird übersprungen
    const r = tileReason(w, x, y, "mauer");
    if (r) { reason ??= r; return { x, y, ok: false }; }
    build.push([x, y]);
    return { x, y, ok: true };
  });
  if (reason) return { ok: false, reason, tiles, build: [] };
  if (!build.length) return { ok: false, reason: "Hier steht schon eine Mauer", tiles, build };
  const want = build.length;
  const n = affordable(w, "mauer", want);
  if (n <= 0) return { ok: false, reason: costReason(w, "mauer") ?? "Nicht genug Material", tiles, build: [], costFail: true };
  if (n < want) {
    const cut = new Set(build.slice(n).map(([x, y]) => `${x},${y}`));
    for (const t of tiles) if (cut.has(`${t.x},${t.y}`)) t.ok = false;
    build = build.slice(0, n);
    return { ok: true, reason: `Nur ${n} von ${want} Mauerstücken bezahlbar`, tiles, build };
  }
  return { ok: true, tiles, build };
}

/** Längste Brücke (Felder über dem Wasser). */
export const MAX_BRIDGE = 8;

/**
 * Weg oder Brücke ziehen (BuildingDef.road, ADR 0015). Vorschau (Game.roadPath) und Bau (Befehl "weg") nutzen genau
 * dieses Ergebnis, nach denselben Regeln wie die Mauer: Ein Hindernis lehnt die ganze Linie ab, reicht das Material nur
 * für einen Teil, werden nur die bezahlbaren Stücke vom Start aus gebaut. Schon liegende Wege und Brücken werden
 * übersprungen. Wege laufen gerade oder L-förmig. Eine Brücke läuft gerade in Zugrichtung über das Wasser (o = 0 entlang
 * Welt-x, 1 entlang Welt-y); Landfelder an ihren Enden werden übersprungen, beide Enden müssen an begehbarem Ufer liegen.
 */
export function roadPath(w: World, key: BuildingKey, x0: number, y0: number, x1: number, y1: number): PlacementCheck & { build: [number, number, number][]; costFail?: boolean } {
  const road = BUILDINGS[key]?.road;
  if (!road) return { ok: false, reason: "Kein Weg", tiles: [], build: [] };
  const lock = lockedBy(w.s, BUILDINGS[key]);
  if (lock) return { ok: false, reason: `Erst erforschen: ${TECHS[lock].name}`, tiles: [], build: [] };
  let line: [number, number, number][];
  let reason: string | null = null;
  if (road.bridge) {
    const alongX = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
    const n = alongX ? Math.abs(x1 - x0) : Math.abs(y1 - y0), sx = alongX ? Math.sign(x1 - x0) : 0, sy = alongX ? 0 : Math.sign(y1 - y0);
    line = [];
    for (let i = 0; i <= n; i++) line.push([x0 + sx * i, y0 + sy * i, alongX ? 0 : 1]);
    // Wasserstrecke: vom ersten bis zum letzten Wasser- bzw. Brückenfeld; davor und danach nur Land (übersprungen)
    const water = (x: number, y: number) => w.inMap(x, y) && (w.s.tiles[w.idx(x, y)].terrain === "wasser");
    const first = line.findIndex(([x, y]) => water(x, y)), last = line.length - 1 - [...line].reverse().findIndex(([x, y]) => water(x, y));
    if (first < 0) reason = "Eine Brücke gehört über das Wasser";
    else {
      line = line.slice(first, last + 1);
      const shore = (x: number, y: number) => w.inMap(x, y) && !water(x, y) && w.nav.open(w.nav.node(0, x, y), 0);
      const [ax, ay] = line[0], [bx, by] = line[line.length - 1];
      if (!shore(ax - sx, ay - sy) || !shore(bx + sx, by + sy)) reason = "Die Brücke muss an beiden Ufern ansetzen: über den ganzen Fluss ziehen";
      else if (line.length > MAX_BRIDGE) reason = `Zu lang für eine Brücke (höchstens ${MAX_BRIDGE} Felder)`;
    }
  } else line = wallLine(x0, y0, x1, y1).map(([x, y]) => [x, y, 0]);
  let build: [number, number, number][] = [];
  const tiles = line.map(([x, y, o]) => {
    const b = w.buildingAt(x, y);
    if (b && b.team === 0 && isRoad(b.key)) return { x, y, ok: true }; // schon Weg oder Brücke: übersprungen
    const r = tileReason(w, x, y, key);
    if (r) { reason ??= r; return { x, y, ok: false }; }
    build.push([x, y, o]);
    return { x, y, ok: true };
  });
  if (reason) return { ok: false, reason, tiles, build: [] };
  if (!build.length) return { ok: false, reason: "Hier liegt schon ein Weg", tiles, build };
  const want = build.length;
  const n = affordable(w, key, want);
  if (n <= 0) return { ok: false, reason: costReason(w, key) ?? "Nicht genug Material", tiles, build: [], costFail: true };
  if (n < want) {
    const cut = new Set(build.slice(n).map(([x, y]) => `${x},${y}`));
    for (const t of tiles) if (cut.has(`${t.x},${t.y}`)) t.ok = false;
    build = build.slice(0, n);
    return { ok: true, reason: `Nur ${n} von ${want} Stücken bezahlbar`, tiles, build };
  }
  return { ok: true, tiles, build };
}

/** Wie viele Stück (höchstens max) sind mit Gold und freiem Lagerbestand bezahlbar? */
function affordable(w: World, key: BuildingKey, max: number): number {
  let n = max;
  for (const [g, k] of Object.entries(BUILDINGS[key].cost) as [Good | "gold", number][]) {
    if (k <= 0) continue;
    n = Math.min(n, Math.floor((g === "gold" ? w.s.gold : available(w, g)) / k));
  }
  return Math.max(0, n);
}

// ---------------------------------------------------------------- Baustellen
const total = (rec: Partial<Record<Good, number>>): number => {
  let n = 0;
  for (const k in rec) n += rec[k as Good] ?? 0;
  return n;
};

/** Verbautes Material einer Baustelle (Stück). */
export function siteUsed(b: SBuilding): number {
  return b.mat === undefined ? 0 : Math.max(0, b.mat - total(b.needs) - total(b.site));
}

/** Wie weit darf die Baustelle gebaut sein (0..1)? Verbautes Material / Material insgesamt; ohne Material 1. */
export function buildCap(b: SBuilding): number {
  if (b.mat === undefined) return total(b.needs) ? 0 : 1; // alte Spielstände: erst bauen, wenn alles da ist
  return b.mat > 0 ? siteUsed(b) / b.mat : 1;
}

/** Kann ein Bauarbeiter jetzt etwas tun (Material liegt bereit oder verbautes ist noch nicht verarbeitet)? */
export function canWork(b: SBuilding): boolean {
  if (b.built >= 1) return false;
  if (b.mat === undefined) return !total(b.needs);
  return total(b.site) > 0 || b.built < buildCap(b) - 1e-9;
}

/** Ein Stück Material von der Baustelle verbauen (die Ware mit dem größten Rest zuerst). Liefert die Ware oder null. */
export function useMaterial(b: SBuilding): Good | null {
  let best: Good | null = null;
  for (const k in b.site) {
    const g = k as Good;
    if ((b.site[g] ?? 0) > 0 && (!best || (b.site[g] ?? 0) > (b.site[best] ?? 0))) best = g;
  }
  if (!best) return null;
  const n = (b.site[best] ?? 0) - 1;
  if (n > 0) b.site[best] = n; else delete b.site[best];
  return best;
}

/** Baustelle setzen. deferNav: Laufraster nicht sofort neu aufbauen (mehrere Stücke auf einmal, danach refreshAfterPlace). */
export function placeSite(w: World, key: BuildingKey, x: number, y: number, o: number, deferNav = false): SBuilding {
  const def = BUILDINGS[key];
  o = ((o % 4) + 4) % 4;
  const cost = costAt(w, key, x, y);
  if (key === "tor") {
    // Tor quer zur Mauerlinie ausrichten: Linie entlang x (Nachbarn O + W) → o = 0, entlang y → o = 1
    const old = w.buildingAt(x, y);
    o = gateOrientation(fortMaskAt(w, x, y, old?.id), o);
    if (old && old.key === "mauer") removeBuilding(w, old, "ersetzt");
  }
  const b = w.addBuilding(key, 0, x, y, o);
  const fp = footprintTiles(key, x, y, o);
  const onFp = new Set(fp.map(([tx, ty]) => w.idx(tx, ty)));
  for (const [tx, ty] of fp) w.s.tiles[w.idx(tx, ty)].building = b.id;
  w.s.trees = w.s.trees.filter((t) => !onFp.has(w.idx(t.x, t.y))); // Baumstümpfe weichen der Baustelle
  w.s.gold -= cost.gold ?? 0;
  for (const [g, n] of Object.entries(cost) as [Good | "gold", number][]) if (g !== "gold" && n > 0) b.needs[g] = n;
  b.mat = total(b.needs);
  b.hp = Math.max(1, Math.round(def.hp * 0.2));
  if (!deferNav) refreshAfterPlace(w);
  return b;
}

/** Nach dem Setzen von Baustellen: Mauermasken, Laufraster, Einheiten aus den Grundrissen schieben. */
export function refreshAfterPlace(w: World): void {
  updateWallMasks(w);
  w.nav.refresh();
  evictUnits(w);
}

export function completeBuilding(w: World, b: SBuilding): void {
  const def = levelDef(b.key, levelOf(b));
  b.built = 1;
  b.hp = def.hp;
  b.needs = {}; b.site = {}; delete b.mat;
  b.ai.enroute = {}; b.ai.picked = {}; b.ai.builder = 0;
  if (def.storage && !b.slots.length) b.slots = Array.from({ length: def.storage.slots }, () => ({ good: null, amount: 0, reserved: 0, incoming: 0 }));
  if (def.output && !b.output) b.output = { good: def.output.good, amount: 0, reserved: 0 };
  if (def.production && !b.proc) b.proc = newProc(b.key);
  updateWallMasks(w);
  w.nav.refresh();
  evictUnits(w);
  if (def.road) w.msg(`${def.name} fertig.`, "info", `fertig-${b.key}`, 30); // Feld für Feld, daher nur selten melden
  else if (FORT.has(b.key) || def.stairs) w.msg(`${def.name} fertiggestellt.`, "info", `fertig-${b.key}`, 10, "mauer_fertig");
  else w.msg(`${def.name} ist fertig.`, "info", undefined, 20, "bau_fertig");
}

/**
 * Gebäude entfernen. why: "abriss" gibt die Hälfte der Kosten zurück (Waren direkt ins Lager; bei einer Baustelle nur
 * die Hälfte des Goldes und des schon verbauten Materials, unverbautes Material auf der Baustelle ganz),
 * "zerstoert" verliert alles, "ersetzt" (Mauer unter einem neuen Tor) gibt nichts zurück: Das Tor hat ihr fertiges oder
 * schon angeliefertes Material in costAt übernommen.
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
    returnProcGoods(w, b); // Puffer und Ausgabestapel einer Verarbeitung ebenso
    if (b.built < 1 && b.mat !== undefined) {
      // Baustelle: was nie geliefert wurde, kostete nichts; liegendes Material kommt ganz zurück, verbautes zur Hälfte
      w.s.gold += Math.floor((def.cost.gold ?? 0) / 2);
      for (const [g, n] of Object.entries(b.site) as [Good, number][]) if (n > 0) storeDirect(w, g, n);
      const used = siteUsed(b), cost = Object.entries(def.cost).filter(([g]) => g !== "gold") as [Good, number][];
      const sum = cost.reduce((a, [, n]) => a + n, 0);
      for (const [g, n] of cost) { const half = Math.floor((used * n) / Math.max(1, sum) / 2); if (half > 0) storeDirect(w, g, half); }
    } else for (const [g, n] of Object.entries(def.cost) as [Good | "gold", number][]) {
      const half = Math.floor(n / 2);
      if (g === "gold") w.s.gold += half; else if (half > 0) storeDirect(w, g, half);
    }
  }
  updateWallMasks(w);
  w.nav.refresh();
  // Wer auf einem verschwundenen Wehrgang stand, fällt herunter (Schaden nur, wenn der Bau zerstört wurde);
  // wer am Boden auf einer verschwundenen Treppe stand, steht wieder auf dem Boden
  for (const u of w.s.units) {
    if (u.dead) continue;
    if (u.layer === 0) { if (u.z !== 0 && w.nav.stairZ(u.x, u.y) < 0) u.z = 0; continue; }
    const n = w.nav.node(u.layer, Math.floor(u.x), Math.floor(u.y));
    if (!w.nav.open(n, u.team)) {
      u.layer = 0; u.z = 0; u.ai.path = null; u.ai.goal = "";
      if (why === "zerstoert") u.hp = Math.max(1, u.hp - 10);
    }
  }
  evictUnits(w);
  if (why === "zerstoert" && b.team === 0 && def.seat && !w.s.outcome) {
    // Der Bergfried ist gefallen: Die Partie ist verloren, es kommen keine Wellen und keine Leute mehr (raidTick,
    // updatePopulation prüfen outcome). Eine laufende Forschung verfällt samt angelieferter Waren; ihre Träger hat
    // abortJobsAt schon entlassen. Die Simulation läuft weiter (Tests, Zuschauen); die Oberfläche zeigt die Niederlage
    // und hält das Spiel an.
    w.s.outcome = "niederlage";
    w.s.research.cur = null;
    w.msg(`Der ${def.name} ist gefallen! Die Burg ist verloren.`, "kampf", undefined, 20, "zerstoert");
  } else if (why === "zerstoert" && b.team === 0) {
    if (FORT.has(b.key)) w.msg(`${def.name} wurde zerstört! Die Mauer ist offen.`, "kampf", `zerstoert-${b.key}`, 5, "mauer_faellt");
    else w.msg(`${def.name} wurde zerstört!`, "kampf", `zerstoert-${b.key}`, 5, "zerstoert");
  }
  else if (why === "abriss") w.msg(`${def.name} abgerissen.`, "info", def.road ? `abriss-${b.key}` : undefined, 5);
}

/**
 * Nachbarschaftsmasken aller Befestigungen neu berechnen (Bits wie geom.NEIGHBOURS). Wege und Brücken bekommen die
 * Maske ihrer Nachbarn, die ebenfalls Weg oder Brücke sind (Autotiling der Darstellung, geom.wallPiece).
 */
export function updateWallMasks(w: World): void {
  for (const b of w.s.buildings) {
    if (isRoad(b.key)) {
      let mask = 0;
      NEIGHBOURS.forEach(([dx, dy], bit) => { const n = w.buildingAt(b.x + dx, b.y + dy); if (n && n.team === b.team && isRoad(n.key)) mask |= 1 << bit; });
      b.wallMask = mask;
      continue;
    }
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
  return levelDef(b.key, levelOf(b)).walkway ?? 0;
}
