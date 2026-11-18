/**
 * Landwirtschaft (BRIEF §5.2, §5.5; ADR 0013): Felder eines Hofs, Bauer bei der Arbeit, Wachstum.
 *
 * Ein Gebäude mit BuildingDef.fields bekommt beim Setzen der Baustelle seine Beete (Building.farm.plots): alle
 * passenden Kacheln im Feldrechteck (Modellachsen, dreht mit der Ausrichtung). Sie sind ab dann für andere Bauten
 * gesperrt, bleiben aber begehbar. Ist der Hof fertig, geht sein Bauer (Zyklus [{ do: "farm" }]) von Beet zu Beet:
 * Ernten (nur wenn auf dem Hof Platz ist), Säen, Umgraben; er steht dabei sichtbar auf der Kachel und arbeitet mit der
 * Animation der Stufe. Die Ernte trägt er (u.carry) zum Hof und legt sie auf den Hofstapel. Von dort bringen Träger sie
 * in die Kornkammer (Disponent, wie bei Holz und Stein). Wachstumsstufen laufen in updateFarms von selbst weiter.
 */
import { BUILDINGS, CROPS, TERRAIN, UNITS, fruchtbarkeit, type BuildingKey, type CropStage, type FieldDef, type Good, type TerrainKey } from "../data";
import { hasDoor } from "./build";
import { approach, center, footprintTiles, modelToWorld } from "./geom";
import { goalEntrance, tileGoal, travel } from "./move";
import { workFactor } from "./research";
import { waitGoal } from "./jobs";
import { yardFullMessage } from "./storage";
import type { Building, FarmState, Plot, SimState } from "./types";
import { TPS, face, setAnim, type Job, type SBuilding, type SUnit, type World } from "./world";

type CycleJob = Extract<Job, { k: "cycle" }>;

// ---------------------------------------------------------------- Geometrie und Platzierung
/** Kacheln des Feldrechtecks eines Hofs in Welt-Koordinaten (in der Reihenfolge der Daten, ohne Prüfung). */
export function fieldRect(key: BuildingKey, x: number, y: number, o: number): [number, number][] {
  const f = BUILDINGS[key].fields;
  if (!f) return [];
  const [x0, y0, fw, fh] = f.rect;
  const [cx, cy] = center(key, x, y, o);
  const out: [number, number][] = [];
  for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
    const [dx, dy] = modelToWorld(x0 + i + 0.5, y0 + j + 0.5, o);
    out.push([Math.floor(cx + dx), Math.floor(cy + dy)]);
  }
  return out;
}

/** Beet eines anderen Hofs auf (x, y)? */
export function plotAt(s: SimState, x: number, y: number): Building | undefined {
  for (const b of s.buildings) if (b.farm?.plots.some((p) => p.x === x && p.y === y)) return b;
  return undefined;
}

/** Warum auf (x, y) kein Beet entstehen kann (null = geeignet). */
function plotReason(w: World, f: FieldDef, x: number, y: number, fp: Set<string>): string | null {
  if (!w.inMap(x, y)) return "Außerhalb der Karte";
  const t = w.s.tiles[w.idx(x, y)];
  if (!f.terrain.includes(t.terrain)) return `${TERRAIN[t.terrain].name}: hier wächst nichts`;
  if (t.building || fp.has(`${x},${y}`)) return "Hier steht schon etwas";
  if (plotAt(w.s, x, y)) return "Hier liegt schon ein Feld";
  if (w.s.trees.some((tr) => tr.x === x && tr.y === y && tr.state !== "stumpf" && tr.state !== "waechst")) return "Bäume im Weg";
  if (w.s.rocks.some((r) => r.x === x && r.y === y && r.amount > 0)) return "Felsbrocken im Weg";
  for (const b of w.s.buildings) {
    if (!hasDoor(b.key)) continue;
    const [ax, ay] = approach(b.key, b.x, b.y, b.o);
    if (ax === x && ay === y) return "Vor einer Tür";
  }
  return null;
}

/**
 * Feldkacheln eines geplanten Hofs mit Eignung (für Vorschau und Bau). usable = Anzahl der Beete; der Vorplatz der
 * eigenen Tür zählt nie dazu.
 */
export function fieldPlan(w: World, key: BuildingKey, x: number, y: number, o: number): { tiles: { x: number; y: number; ok: boolean }[]; usable: number } {
  const f = BUILDINGS[key].fields;
  if (!f) return { tiles: [], usable: 0 };
  const fp = new Set(footprintTiles(key, x, y, o).map(([tx, ty]) => `${tx},${ty}`));
  const [ax, ay] = approach(key, x, y, o);
  fp.add(`${ax},${ay}`);
  const tiles = fieldRect(key, x, y, o).map(([tx, ty]) => ({ x: tx, y: ty, ok: !plotReason(w, f, tx, ty, fp) }));
  return { tiles, usable: tiles.filter((t) => t.ok).length };
}

/** Platzierungsregel der Felder: Grund, warum der Hof hier nicht geht, oder null. */
export function fieldReason(w: World, key: BuildingKey, x: number, y: number, o: number): string | null {
  const f = BUILDINGS[key].fields;
  if (!f) return null;
  const { usable } = fieldPlan(w, key, x, y, o);
  if (usable >= f.min) return null;
  const names = f.terrain.map((t) => TERRAIN[t].name).join(" oder ");
  return `Zu wenig freie ${names} für die Felder (${usable} von mindestens ${f.min} Beeten)`;
}

/** Beete anlegen (beim Setzen der Baustelle bzw. eines fertigen Hofs). */
export function newFarm(w: World, b: SBuilding): FarmState | undefined {
  const f = BUILDINGS[b.key].fields;
  if (!f) return undefined;
  const plan = fieldPlan(w, b.key, b.x, b.y, b.o);
  const plots: Plot[] = plan.tiles.filter((t) => t.ok).map((t) => ({ x: t.x, y: t.y, stage: 0, t: 0, by: 0 }));
  // Nachwachsende Bäume (ADR 0016) sperren ein Beet nicht, das neue Feld räumt sie (wie die Baustelle); Stümpfe auf
  // Beeten treiben nicht mehr aus (forest.ts: canGrow).
  const onPlot = new Set(plots.map((p) => w.idx(p.x, p.y)));
  w.s.trees = w.s.trees.filter((t) => t.state !== "waechst" || !onPlot.has(w.idx(t.x, t.y)));
  return { crop: f.crop, plots, harvested: 0 };
}

// ---------------------------------------------------------------- Lesen (Oberfläche)
export const stageOf = (farm: FarmState, p: Plot): CropStage => CROPS[farm.crop].stages[p.stage];

/** Anzahl der Beete je Stufe (Index wie CROPS[..].stages). */
export function stageCounts(farm: FarmState): number[] {
  const out = CROPS[farm.crop].stages.map(() => 0);
  for (const p of farm.plots) out[p.stage]++;
  return out;
}

/** Ist auf dem Hof Platz für eine weitere Ernte (Stapel plus das, was die Bauern schon tragen)? */
function yardRoom(w: World, b: Building): boolean {
  const cap = BUILDINGS[b.key].output?.capacity ?? 0;
  const per = harvestOf(b)?.amount ?? 1;
  let carried = 0;
  for (const id of b.workers) {
    const u = w.units.get(id), j = u?.ai.job;
    if (u?.carry) carried += j?.k === "cycle" ? j.n ?? 1 : 1;
  }
  return !!b.output && b.output.amount + carried + per <= Math.max(cap, per);
}

/** Ernte einer Feldfrucht (Ware und Stück je Ernte). */
function harvestOf(b: Building): { good: Good; amount: number } | undefined {
  return b.farm ? CROPS[b.farm.crop].stages.find((st) => st.harvest)?.harvest : undefined;
}

/** Was hält den Hof gerade auf (Spielertext), null = es wird gearbeitet oder wächst. */
export function farmReason(s: SimState, b: Building): string | null {
  const farm = b.farm, def = BUILDINGS[b.key];
  if (!farm || b.built < 1) return null;
  if (!b.workers.length) return `Kein ${UNITS[def.workers?.unit ?? "tageloehner"].name}: Es fehlt ein freier Tagelöhner.`;
  const ripe = farm.plots.some((p) => stageOf(farm, p).harvest);
  const cap = def.output?.capacity ?? 0;
  if (ripe && b.output && b.output.amount + (harvestOf(b)?.amount ?? 1) > cap) return "Hof voll: Die reife Ernte wartet auf dem Feld, bis Träger den Hof leeren.";
  if (!farm.plots.length) return "Keine Beete.";
  void s;
  return null;
}

/** Beete je Bodenart (für das Panel; Reihenfolge nach Ertragsfaktor absteigend). */
export function soilCounts(s: SimState, farm: FarmState): Partial<Record<TerrainKey, number>> {
  const n: Partial<Record<TerrainKey, number>> = {};
  for (const p of farm.plots) { const t = s.tiles[p.y * s.w + p.x].terrain; n[t] = (n[t] ?? 0) + 1; }
  const keys = (Object.keys(n) as TerrainKey[]).sort((a, b) => fruchtbarkeit(b) - fruchtbarkeit(a));
  return Object.fromEntries(keys.map((k) => [k, n[k]]));
}

// ---------------------------------------------------------------- Wachstum
/**
 * Wachstumsgeschwindigkeit eines Beets: Für eine Ackerfrucht (CropDef.boden) der Ertragsfaktor des Bodens unter dem
 * Beet (FELD_BODEN, ADR 0012: fruchtbar 1, Wiese 0,7), sonst 1. Eine Wachstumsstufe dauert grow / Faktor Sekunden.
 */
export function plotGrowth(s: SimState, farm: FarmState, p: Plot): number {
  if (!CROPS[farm.crop].boden) return 1;
  const f = fruchtbarkeit(s.tiles[p.y * s.w + p.x].terrain);
  return f > 0 ? f : 1;
}

/** Wachstumsstufen aller fertigen eigenen Höfe weiterzählen (einmal je Tick). */
export function updateFarms(w: World): void {
  for (const b of w.s.buildings) {
    const farm = b.farm;
    if (!farm || b.team !== 0 || b.built < 1) continue;
    const crop = CROPS[farm.crop];
    for (const p of farm.plots) {
      const st = crop.stages[p.stage];
      if (st.grow === undefined) continue;
      p.t += plotGrowth(w.s, farm, p) / TPS;
      if (p.t >= st.grow - 1e-9) { p.stage = Math.min(crop.stages.length - 1, p.stage + 1); p.t = 0; }
    }
  }
}

// ---------------------------------------------------------------- Bauer
/** Beet mit Arbeit wählen: Ernte vor Saat vor Umgraben (spätere Stufe zuerst), dann das nächste. −1 = nichts zu tun. */
function pickPlot(w: World, u: SUnit, home: SBuilding): number {
  const farm = home.farm!;
  const room = yardRoom(w, home);
  let best = -1, bestScore = Infinity;
  farm.plots.forEach((p, k) => {
    if (p.by && p.by !== u.id && w.aliveUnit(p.by)) return;
    const st = stageOf(farm, p);
    if (!st.work || (st.harvest && !room)) return;
    const score = -p.stage * 1000 + Math.hypot(p.x + 0.5 - u.x, p.y + 0.5 - u.y);
    if (score < bestScore) { bestScore = score; best = k; }
  });
  return best;
}

function release(home: SBuilding, j: CycleJob, u: SUnit): void {
  const p = home.farm?.plots[j.tgt - 1];
  if (p && p.by === u.id) { p.by = 0; p.t = 0; }
  j.tgt = 0; j.t = 0;
}

/**
 * Arbeitsschritt { do: "farm" }: Ernte zum Hof bringen, sonst ein Beet mit Arbeit wählen, hingehen und dort arbeiten.
 * j.tgt = Beet + 1 (0 = keins), j.t = Arbeitsticks auf dem Beet.
 */
export function runFarm(w: World, u: SUnit, j: CycleJob, home: SBuilding): void {
  const farm = home.farm, def = BUILDINGS[home.key];
  if (!farm) { setAnim(u, "stehen"); return; }
  if (u.carry) {
    const r = travel(w, u, goalEntrance(w, home));
    if (r === "unreachable") { setAnim(u, "stehen"); return; }
    if (r !== "arrived") return;
    const out = home.output, cap = def.output?.capacity ?? 0, n = j.n ?? 1;
    if (out && out.good === u.carry && out.amount + n <= Math.max(cap, n)) {
      out.amount += n; u.carry = null; delete j.n;
      return;
    }
    setAnim(u, "stehen");
    yardFullMessage(w, home, u.carry, "die Ernte wartet");
    return;
  }
  if (j.wait > 0) { j.wait--; idle(w, u, home); return; }
  let k = j.tgt - 1;
  const cur = k >= 0 ? farm.plots[k] : undefined;
  const st = cur ? stageOf(farm, cur) : undefined;
  if (!cur || !st?.work || (cur.by && cur.by !== u.id) || (st.harvest && !yardRoom(w, home) && j.t === 0)) {
    if (cur) release(home, j, u);
    k = pickPlot(w, u, home);
    if (k < 0) { j.wait = TPS; idle(w, u, home); return; }
    j.tgt = k + 1; j.t = 0;
    farm.plots[k].by = u.id;
  }
  const p = farm.plots[k], stage = stageOf(farm, p), work = stage.work!;
  const r = travel(w, u, tileGoal(p.x, p.y));
  if (r === "unreachable") { release(home, j, u); j.wait = 2 * TPS; idle(w, u, home); return; }
  if (r !== "arrived") return;
  // Blick über das Beet: abwechselnd entlang der Furchen (Welt-x), damit er nicht starr in eine Richtung schaut
  face(u, (p.x + p.y) % 2 ? 1 : -1, 0.35);
  setAnim(u, work.anim);
  j.t++;
  p.t = j.t / TPS;
  if (j.t < Math.round(work.seconds * workFactor(w.s, work.anim) * TPS)) return;
  const crop = CROPS[farm.crop];
  p.stage = stage.harvest ? crop.after : Math.min(crop.stages.length - 1, p.stage + 1);
  p.t = 0; p.by = 0;
  j.tgt = 0; j.t = 0;
  // geerntet zählt ab dem Pflücken (die Last auf dem Weg zum Hof gehört dazu), nicht erst beim Abladen
  if (stage.harvest) { u.carry = stage.harvest.good; j.n = stage.harvest.amount; farm.harvested += j.n; }
}

function idle(w: World, u: SUnit, home: SBuilding): void {
  const r = travel(w, u, waitGoal(w, home, u));
  if (r !== "moving") setAnim(u, "stehen");
}

/** Arbeitet u gerade auf einem Beet (für Activity)? */
export function farming(w: World, u: SUnit): boolean {
  const j = u.ai.job, home = w.buildings.get(u.home);
  if (j?.k !== "cycle" || !home?.farm || !j.tgt) return false;
  const st = home.farm.plots[j.tgt - 1];
  return !!st && j.t > 0;
}

/** Beete freigeben, die ein Bauer reserviert hatte (er verliert seinen Hof). */
export function releasePlots(w: World, u: SUnit): void {
  for (const b of w.s.buildings) for (const p of b.farm?.plots ?? []) if (p.by === u.id) { p.by = 0; p.t = 0; }
}
