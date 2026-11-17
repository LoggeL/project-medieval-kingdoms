/**
 * Wirtschaft: Disponent (2× pro Sekunde), Bäume, Zuzug und untätige Tagelöhner.
 *
 * Der Disponent verteilt freie Tagelöhner auf Aufgaben, in dieser Reihenfolge: Werkstätten besetzen,
 * Rekruten (Waffe holen), Baustellen bauen (sobald Material dort liegt), dann abwechselnd Baumaterial anliefern und Hofstapel
 * ins Lager tragen. Jede Aufgabe reserviert Ware bzw. Platz sofort, damit nichts doppelt vergeben wird.
 */
import { BUILDINGS, TUNING, UNITS, levelDef, type Good, type TechKey } from "../data";
import { canWork } from "./build";
import { center, entrance } from "./geom";
import { nearestEnemy } from "./combat";
import { goalAround, goalEntrance, goalSlot, tileGoal, travel, unitNode, type TravelGoal } from "./move";
import { hasRoom, reservePut, reserveTake, tidy } from "./storage";
import { isSite, levelOf } from "./research";
import type { StorageSlot } from "./types";
import { TPS, setAnim, type SBuilding, type SUnit, type World } from "./world";

export const DISPATCH_EVERY = TPS / 2;

export function isFreePeasant(u: SUnit, tick = -1): boolean {
  return !u.dead && u.team === 0 && u.key === "tageloehner" && !u.ai.job && !u.inside && !(tick >= 0 && (u.ai.noJob ?? 0) > tick);
}

/** Kann u das Ziel ohne Einreißen erreichen? (Komponenten-Vorprüfung, keine Suche.) Unbekannt (gesperrtes Startfeld) zählt als ja. */
export function canReach(w: World, u: SUnit, g: TravelGoal): boolean {
  const c = w.nav.comp[0][unitNode(w, u)];
  return c < 0 || w.nav.goalInComp(g, 0, c);
}

export function dispatcher(w: World): void {
  const free = w.s.units.filter((u) => isFreePeasant(u, w.s.tick));
  /** Nächster freier Tagelöhner, der alle Ziele erreicht. */
  const take = (x: number, y: number, ...goals: TravelGoal[]): SUnit | null => {
    let bi = -1, bd = Infinity;
    free.forEach((u, i) => {
      const d = (u.x - x) ** 2 + (u.y - y) ** 2;
      if (d < bd && goals.every((g) => canReach(w, u, g))) { bd = d; bi = i; }
    });
    return bi < 0 ? null : free.splice(bi, 1)[0];
  };
  const own = w.s.buildings.filter((b) => b.team === 0);

  // 1. Werkstätten besetzen
  for (const b of own) {
    const wk = BUILDINGS[b.key].workers;
    if (!wk || b.built < 1) continue;
    while (b.workers.length < wk.count && free.length) {
      const [ex, ey] = entrance(b.key, b.x, b.y, b.o);
      const u = take(ex, ey, goalEntrance(w, b));
      if (!u) break;
      u.ai.job = { k: "employ", b: b.id }; u.order = { t: "job" };
      b.workers.push(u.id);
    }
  }
  // 2. Rekruten: Waffe aus dem Lager holen
  for (const b of own) {
    if (!free.length) return;
    if (b.built < 1 || !b.queue.length || b.ai.recruit || b.training) continue;
    const unit = b.queue[0];
    const eq = UNITS[unit].train!.equipment;
    const [cx, cy] = center(b.key, b.x, b.y, b.o);
    const ref = reserveTake(w, eq, cx, cy);
    if (!ref) { w.msg(`Keine ${goodName(eq)} im Lager für die Ausbildung.`, "warnung", `waffe-${eq}`, 30, "keine_waffe"); continue; }
    const u = take(cx, cy, goalSlot(w, ref.b, ref.k), goalEntrance(w, b));
    if (!u) { unreserveTake(ref.b.slots[ref.k]); continue; }
    u.ai.job = { k: "recruit", b: b.id, from: ref.b.id, slot: ref.k, good: eq, unit, ph: 0 }; u.order = { t: "job" };
    b.ai.recruit = u.id; b.ai.recruitPicked = false;
  }
  // 3. Baustellen bauen, sobald Material dort liegt (verbaut wird Stück für Stück, jobs.ts runBuild)
  for (const b of own) {
    if (!free.length) return;
    // Ausbau (Bergfried): erst bauen, wenn alles angeliefert ist; neue Baustelle: sobald Material dort liegt
    if (!isSite(b) || b.ai.builder || (b.upgrade ? Object.keys(b.needs).length > 0 : !canWork(b))) continue;
    const [cx, cy] = center(b.key, b.x, b.y, b.o);
    const u = take(cx, cy, goalAround(b));
    if (!u) { w.msg(`${BUILDINGS[b.key].name}: Die Baustelle ist nicht erreichbar.`, "warnung", `unerreichbar-${b.id}`, 60); continue; }
    u.ai.job = { k: "build", site: b.id, spot: b.ai.nextSpot ?? 0 }; u.order = { t: "job" };
    b.ai.builder = u.id;
  }
  // 4. Anliefern (Baustellen, Ausbau, dann Forschung im Bergfried) und Abholen abwechselnd
  const supplies: { site: SBuilding; good: Good; rk?: TechKey }[] = [];
  for (const b of own) {
    if (!isSite(b)) continue;
    for (const [g, n] of Object.entries(b.needs) as [Good, number][]) {
      for (let k = n - (b.ai.enroute[g] ?? 0); k > 0; k--) supplies.push({ site: b, good: g });
    }
  }
  const cur = w.s.research.cur;
  const seat = cur ? own.find((b) => b.built >= 1 && BUILDINGS[b.key].seat) : undefined;
  if (cur && seat) {
    for (const [g, n] of Object.entries(cur.needs) as [Good, number][]) {
      for (let k = n - (cur.enroute[g] ?? 0); k > 0; k--) supplies.push({ site: seat, good: g, rk: cur.key });
    }
  }
  const hauls: SBuilding[] = [];
  for (const b of own) {
    if (b.built < 1 || !b.output) continue;
    for (let k = b.output.amount - b.output.reserved; k > 0; k--) hauls.push(b);
  }
  const noStock = new Set<Good>();
  const noReach = new Set<number>();
  let full = false;
  for (let i = 0; free.length && (i < supplies.length || i < hauls.length); i++) {
    const sp = supplies[i];
    if (sp && !noStock.has(sp.good)) {
      const [cx, cy] = center(sp.site.key, sp.site.x, sp.site.y, sp.site.o);
      const ref = noReach.has(sp.site.id) ? null : reserveTake(w, sp.good, cx, cy);
      if (!ref) { if (!noReach.has(sp.site.id)) noStock.add(sp.good); }
      else {
        const u = take(cx, cy, goalSlot(w, ref.b, ref.k), sp.rk ? goalEntrance(w, sp.site) : goalAround(sp.site));
        if (!u) {
          unreserveTake(ref.b.slots[ref.k]);
          noReach.add(sp.site.id);
          w.msg(`${BUILDINGS[sp.site.key].name}: Die Baustelle ist nicht erreichbar.`, "warnung", `unerreichbar-${sp.site.id}`, 60);
        } else {
          u.ai.job = { k: "supply", site: sp.site.id, from: ref.b.id, slot: ref.k, good: sp.good, ph: 0 }; u.order = { t: "job" };
          if (sp.rk && cur) { u.ai.job.rk = sp.rk; cur.enroute[sp.good] = (cur.enroute[sp.good] ?? 0) + 1; }
          else sp.site.ai.enroute[sp.good] = (sp.site.ai.enroute[sp.good] ?? 0) + 1;
        }
      }
    }
    const hb = hauls[i];
    if (hb && free.length && !full) {
      const out = hb.output!;
      const [ex, ey] = entrance(hb.key, hb.x, hb.y, hb.o);
      const ref = reservePut(w, out.good, ex, ey);
      if (!ref) full = !hasRoom(w, out.good);
      else {
        const u = take(ex, ey, goalEntrance(w, hb), goalSlot(w, ref.b, ref.k));
        if (!u) { const sl = ref.b.slots[ref.k]; sl.incoming--; tidy(sl); }
        else {
          u.ai.job = { k: "haul", from: hb.id, to: ref.b.id, slot: ref.k, good: out.good, ph: 0 }; u.order = { t: "job" };
          out.reserved++;
        }
      }
    }
  }
  if (full) w.msg("Das Lager ist voll! Baue ein weiteres Lagerhaus.", "warnung", "lagervoll", 30, "lager_voll");
  for (const g of noStock) w.msg(`Für die Baustelle fehlt ${goodName(g)} im Lager.`, "warnung", `fehlt-${g}`, 45, "material_fehlt");
}

/** Reservierung zum Abholen zurückgeben (Auftrag kam nicht zustande). */
function unreserveTake(slot: StorageSlot): void { slot.reserved--; tidy(slot); }

const NAMES: Record<Good, string> = { holz: "Holz", stein: "Stein", eisen: "Eisen", speer: "Speere", schwert: "Schwerter", bogen: "Bögen" };
const goodName = (g: Good) => NAMES[g];

// ---------------------------------------------------------------- Untätige Tagelöhner
const SPOTS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let r = 1; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([dx, dy]);
  return out;
})();

/** Untätige Tagelöhner warten am Sammelplatz (jeder an seinem Fleck) und laufen vor Angreifern davon. */
export function idlePeasant(w: World, u: SUnit): void {
  const ai = u.ai;
  if (ai.flee > 0) {
    ai.flee--;
    const r = travel(w, u, tileGoal(ai.cx, ai.cy, 0, 1));
    if (r !== "moving" && r !== "waiting") ai.flee = 0;
    return;
  }
  if ((w.s.tick + u.id) % 5 === 0) {
    const e = nearestEnemy(w, u, 5);
    if (e) {
      const dx = u.x - e.x, dy = u.y - e.y, d = Math.hypot(dx, dy) || 1;
      const nav = w.nav, c = nav.comp[0][nav.node(u.layer, Math.floor(u.x), Math.floor(u.y))];
      const n = c < 0 ? -1 : nav.nearestInComp(0, c, Math.floor(u.x + (dx / d) * 7), Math.floor(u.y + (dy / d) * 7), 0, 5);
      if (n >= 0) { ai.cx = nav.tileX(n); ai.cy = nav.tileY(n); ai.flee = 4 * TPS; ai.think = 0; return; }
    }
  }
  if (ai.think > 0) { ai.think--; setAnim(u, "stehen"); return; }
  const [x, y] = campSpot(w, u);
  const r = travel(w, u, tileGoal(x, y, 0, 0));
  if (r === "arrived" || r === "unreachable") { setAnim(u, "stehen"); ai.think = 2 * TPS; ai.fresh = false; }
}

function campSpot(w: World, u: SUnit): [number, number] {
  const [cx, cy] = w.meta.camp;
  for (let k = 0; k < SPOTS.length; k++) {
    const [dx, dy] = SPOTS[(u.id * 7 + k) % SPOTS.length];
    const x = cx + dx, y = cy + dy;
    if (w.inMap(x, y) && w.nav.open(w.nav.node(0, x, y), 0)) return [x, y];
  }
  // Sammelplatz zugebaut: nächster freie Tile weiter draußen
  const n = w.nav.nearestOpen(0, cx, cy, 0, 16);
  return n >= 0 ? [w.nav.tileX(n), w.nav.tileY(n)] : [cx, cy];
}

// ---------------------------------------------------------------- Bäume
export function updateTrees(w: World): void {
  const step = 1 / (TUNING.fallSeconds * TPS);
  for (const t of w.s.trees) {
    if (t.state !== "faellt") continue;
    t.progress = Math.min(1, t.progress + step);
    if (t.progress >= 1) { t.state = "liegt"; t.progress = 0; }
  }
}

// ---------------------------------------------------------------- Bevölkerung
export function updatePopulation(w: World): void {
  const s = w.s;
  let housing = TUNING.baseHousing;
  for (const b of s.buildings) if (b.team === 0 && b.built >= 1) housing += levelDef(b.key, levelOf(b)).housing ?? 0;
  let pop = 0;
  for (const u of s.units) if (u.team === 0 && !u.dead) pop++;
  for (const b of s.buildings) if (b.ai.inside) pop++;
  s.housing = housing; s.population = pop;
  if (!w.meta.immigration || s.tick < w.meta.nextImmigrant) return;
  w.meta.nextImmigrant = s.tick + TUNING.immigrantSeconds * TPS;
  if (pop >= housing) {
    w.msg("Kein Wohnraum mehr: Baue Wohnhäuser, damit weitere Leute zuziehen.", "warnung", "wohnraum", 120, "wohnraum");
    return;
  }
  const [ex, ey] = w.meta.entry;
  const u = w.addUnit("tageloehner", 0, ex + 0.5, ey + 0.5);
  u.ai.fresh = true;
  w.msg("Ein neuer Tagelöhner ist zugezogen.", "info", "zuzug", 60, "zuzug");
}

/** Werkstätten mit Arbeitern, die weg sind (gestorben), freigeben. */
export function pruneWorkers(w: World): void {
  for (const b of w.s.buildings) {
    if (!b.workers.length) continue;
    b.workers = b.workers.filter((id) => {
      const u = w.units.get(id);
      return !!u && !u.dead && (u.home === b.id || (u.ai.job?.k === "employ" && u.ai.job.b === b.id));
    });
  }
}
