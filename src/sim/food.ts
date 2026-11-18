/**
 * Ernährung (BRIEF §5.1, §8.2; ADR 0013).
 *
 * Jeden Tick wächst der Hunger der Bewohner um Bevölkerung × Ration / Minute (state.food.debt). Sobald eine ganze
 * Portion offen ist, wird sie aus einem Fach der Kornkammer gegessen: ein Stück der essbaren Ware (FOOD.goods), von der
 * am meisten da ist, aus dem Fach mit dem kleinsten Rest (damit Fächer leer werden). Der Vorrat schrumpft so sichtbar in
 * den Fächern. Was Träger gerade abholen (reserviert), bleibt liegen.
 *
 * Ist nichts Essbares mehr da, hungert die Siedlung (food.hunger in Sekunden): Es zieht niemand mehr zu (economy.ts),
 * nach FOOD.graceSeconds geht alle FOOD.leaveSeconds ein untätiger Tagelöhner zum Kartenrand und verlässt die
 * Siedlung (Auftrag "leave", sichtbar). Kommt wieder Essen in die Kornkammer, endet der Hunger beim ersten Bissen.
 */
import { FOOD, GOODS, RATIONS, type Good, type RationKey } from "../data";
import { isFreePeasant } from "./economy";
import { tileGoal, travel } from "./move";
import { storagesNear, tidy } from "./storage";
import type { CommandResult, FoodState } from "./types";
import { TPS, type SUnit, type World } from "./world";

const FOOD_GOODS = (Object.entries(FOOD.goods) as [Good, number][]).filter(([, v]) => v > 0).map(([g]) => g);

export function newFood(): FoodState {
  return { ration: FOOD.start, perMinute: 0, stock: 0, kinds: 0, debt: 0, hunger: 0, leave: 0, eaten: 0 };
}

/** Ernährungszustand (legt ihn in alten Spielständen an). */
export function foodOf(w: World): FoodState {
  if (!w.s.food) w.s.food = newFood();
  return w.s.food;
}

/** Essbarer Vorrat je Ware (nur fertige eigene Kornkammern, ohne von Trägern reservierte Stücke). */
function edible(w: World): Map<Good, number> {
  const out = new Map<Good, number>();
  for (const b of w.s.buildings) {
    if (b.team !== 0 || b.built < 1) continue;
    for (const sl of b.slots) {
      if (!sl.good || !FOOD.goods[sl.good]) continue;
      const n = sl.amount - sl.reserved;
      if (n > 0) out.set(sl.good, (out.get(sl.good) ?? 0) + n);
    }
  }
  return out;
}

/** Ein Stück essen: die Ware mit dem größten Vorrat, aus dem Fach mit dem kleinsten Rest. Liefert die Portionen (0 = nichts da). */
function eatOne(w: World, have: Map<Good, number>): number {
  let good: Good | null = null;
  for (const g of FOOD_GOODS) if ((have.get(g) ?? 0) > 0 && (!good || have.get(g)! > have.get(good)!)) good = g;
  if (!good) return 0;
  const [cx, cy] = w.meta.camp;
  for (const b of storagesNear(w, cx, cy, GOODS[good].store)) {
    let best = -1;
    b.slots.forEach((sl, k) => {
      if (sl.good !== good || sl.amount - sl.reserved <= 0) return;
      if (best < 0 || sl.amount < b.slots[best].amount) best = k;
    });
    if (best < 0) continue;
    const sl = b.slots[best];
    sl.amount--; tidy(sl);
    have.set(good, have.get(good)! - 1);
    return FOOD.goods[good] ?? 1;
  }
  return 0;
}

/** Ernährung eines Ticks: Verbrauch, Essen aus der Kornkammer, Hunger und Fortgang (nach updatePopulation). */
export function updateFood(w: World): void {
  const s = w.s, f = foodOf(w);
  const have = edible(w);
  const ration = RATIONS[f.ration] ?? RATIONS.normal;
  f.perMinute = s.population * ration.perMinute;
  if (w.meta.hungerOff || s.outcome === "niederlage") { f.hunger = 0; f.leave = 0; refresh(f, have); return; }
  f.debt += f.perMinute / (60 * TPS);
  while (f.debt >= 1) {
    const v = eatOne(w, have);
    if (!v) break;
    f.debt -= v; f.eaten += v;
  }
  if (f.debt >= 1) {
    // nichts mehr da: die offene Portion bleibt offen (es staut sich kein Berg auf), der Hunger wächst
    f.debt = 1;
    if (f.hunger === 0) w.msg("Die Kornkammer ist leer: Deine Leute hungern! Baue Getreidehof oder Obstgarten.", "warnung", "hunger", 30);
    f.hunger += 1 / TPS;
    if (f.hunger >= FOOD.graceSeconds - 1e-9) {
      // der Erste geht, sobald die Schonfrist um ist, danach alle leaveSeconds einer (ist keiner frei: sobald einer frei ist)
      if (f.hunger - 1 / TPS < FOOD.graceSeconds - 1e-9) f.leave = FOOD.leaveSeconds;
      else f.leave += 1 / TPS;
      if (f.leave >= FOOD.leaveSeconds - 1e-9 && sendAway(w)) f.leave = 0;
    }
  } else { f.hunger = 0; f.leave = 0; }
  refresh(f, have);
}

function refresh(f: FoodState, have: Map<Good, number>): void {
  let stock = 0, kinds = 0;
  for (const [g, n] of have) if (n > 0) { stock += n * (FOOD.goods[g] ?? 1); kinds++; }
  f.stock = stock; f.kinds = kinds;
}

/** Ein untätiger Tagelöhner verlässt hungrig die Siedlung. false = keiner frei (dann beim nächsten Tick erneut). */
function sendAway(w: World): boolean {
  const u = w.s.units.find((x) => isFreePeasant(x) && !x.ai.fresh);
  if (!u) return false;
  u.ai.job = { k: "leave" }; u.order = { t: "job" };
  w.msg("Ein hungriger Tagelöhner verlässt die Siedlung.", "warnung", "fortgang", 10);
  return true;
}

/** Auftrag "leave": zum Kartenrand (Zuzugspunkt) gehen und dort verschwinden. */
export function runLeave(w: World, u: SUnit): void {
  const [ex, ey] = w.meta.entry;
  const r = travel(w, u, tileGoal(ex, ey));
  if (r === "arrived" || r === "unreachable") {
    u.carry = null;
    w.removeUnit(u);
  }
}

/** Hält der Hunger den Zuzug auf? Dann der Meldungstext, sonst null. */
export function hungerBlocks(w: World): string | null {
  const f = w.s.food;
  if (w.meta.hungerOff || !f || f.hunger <= 0) return null;
  return "Niemand zieht in eine hungernde Siedlung: Fülle die Kornkammer.";
}

/** Faktor auf den Abstand des Zuzugs: Ration und Vielfalt der vorrätigen Nahrung. */
export function immigrationFactor(w: World): number {
  const f = w.s.food;
  if (w.meta.hungerOff || !f) return 1;
  const r = RATIONS[f.ration] ?? RATIONS.normal;
  return r.immigration * FOOD.variety ** Math.max(0, f.kinds - 1);
}

/** Befehl „rationen“. */
export function setRation(w: World, ration: RationKey): CommandResult {
  const r = RATIONS[ration];
  if (!r) return { ok: false, reason: "Diese Ration gibt es nicht" };
  const f = foodOf(w);
  if (f.ration !== ration) { f.ration = ration; w.msg(`Rationen: ${r.name}.`); }
  return { ok: true };
}

/** Wie lange reicht der Vorrat bei diesem Verbrauch (Sekunden, Infinity ohne Verbrauch)? */
export function foodSeconds(f: FoodState): number {
  return f.perMinute > 0 ? ((f.stock + (1 - f.debt)) / f.perMinute) * 60 : Infinity;
}
