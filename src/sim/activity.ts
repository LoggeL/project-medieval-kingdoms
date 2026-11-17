/**
 * Anzeige-Zustand aus der Simulation ableiten: Unit.activity (was eine Figur gerade tut) und Building.recruits
 * (Rekruten einer Kaserne auf dem Weg). Beides ändert keine Spielregeln, es wird nach dem Handeln jeder Einheit
 * bzw. einmal pro Tick neu gesetzt.
 */
import { BUILDINGS } from "../data";
import { isSoldier } from "./combat";
import type { UnitActivity } from "./types";
import type { SUnit, World } from "./world";

const FIGHT = new Set(["angriff", "schiessen"]);

export function activityOf(w: World, u: SUnit): UnitActivity {
  const moving = u.anim === "gehen";
  if (u.team === 1) {
    if (FIGHT.has(u.anim) || u.ai.target || u.ai.targetB) return FIGHT.has(u.anim) || !moving ? "kaempft" : "unterwegs";
    return moving ? "unterwegs" : "wartet";
  }
  if (isSoldier(u.key)) {
    const o = u.order;
    if (FIGHT.has(u.anim)) return "kaempft";
    switch (o.t) {
      case "move": return "unterwegs";
      case "attack": return "kaempft";
      case "hold": return "haelt";
      case "station": return moving ? "unterwegs" : "wache";
      default: return u.ai.target ? "kaempft" : moving ? "unterwegs" : "wartet";
    }
  }
  const j = u.ai.job;
  if (!j) {
    if (u.ai.flee > 0) return "flieht";
    if (u.ai.fresh) return "zieht_zu";
    return moving ? "unterwegs" : "wartet";
  }
  switch (j.k) {
    case "cycle": {
      const home = w.buildings.get(u.home);
      const step = home && BUILDINGS[home.key].workers?.cycle[j.step];
      if (!step) return "wartet";
      if (step.do === "work") {
        if (u.anim === "stehen") return "wartet";
        return step.effect === "fellTree" ? "faellt" : step.effect === "cutTree" ? "zerlegt" : step.effect === "mineRock" ? "baut_ab" : "baut";
      }
      if (u.carry) return moving ? "traegt" : "wartet";
      return moving ? "unterwegs" : "wartet";
    }
    case "employ": return moving ? "unterwegs" : "wartet";
    case "haul":
    case "supply": return j.ph === 1 ? (moving ? "traegt" : "wartet") : moving ? "unterwegs" : "wartet";
    case "build": return u.anim === "bauen" ? "baut" : moving ? "unterwegs" : "wartet";
    case "recruit": return "holt_waffe";
  }
  return "wartet";
}

export function updateActivity(w: World, u: SUnit): void {
  if (u.dead) return;
  if (u.ai.fresh && (u.ai.job || u.ai.flee > 0)) u.ai.fresh = false;
  u.activity = activityOf(w, u);
}

/** Building.recruits für alle Ausbildungsstätten: der Tagelöhner, der die Waffe holt („waffe“) bzw. bringt („weg“). */
export function updateRecruits(w: World): void {
  for (const b of w.s.buildings) {
    if (!BUILDINGS[b.key].trains) continue;
    const list: NonNullable<typeof b.recruits> = [];
    const r = w.aliveUnit(b.ai.recruit);
    if (r && r.ai.job?.k === "recruit" && r.ai.job.b === b.id) list.push({ unit: r.ai.job.unit, stage: r.ai.job.ph === 0 ? "waffe" : "weg" });
    b.recruits = list;
  }
}
