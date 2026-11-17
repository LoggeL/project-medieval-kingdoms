/**
 * Innenansicht: weiches Auf- und Zublenden des Schnittbilds für überfahrene und ausgewählte Gebäude.
 * Reine Darstellung; die Simulation kennt keine Innenansicht.
 */
import { BUILDINGS } from "../data";
import type { SimState } from "../sim/types";

/** Dauer des Aufblendens von zu (0) bis ganz offen (1). */
export const INTERIOR_MS = 180;

/** Gebäude, deren Innenansicht gerade offen sein soll: fertig, mit Schnittbild, überfahren oder ausgewählt. */
export function interiorTargets(state: SimState, ids: readonly (number | null)[]): Set<number> {
  const out = new Set<number>();
  for (const id of ids) {
    if (id == null) continue;
    const b = state.buildings.find((q) => q.id === id);
    if (b && b.built >= 1 && BUILDINGS[b.key].interior) out.add(id);
  }
  return out;
}

/**
 * Blendwerte einen Schritt weiterführen (dtMs Echtzeit). Ziele gehen gegen 1, alle anderen gegen 0 und fallen bei 0
 * heraus. instant (reduzierte Bewegung) springt sofort.
 */
export function stepInteriors(fade: Map<number, number>, targets: ReadonlySet<number>, dtMs: number, instant = false): void {
  const k = instant ? 1 : Math.max(0, dtMs) / INTERIOR_MS;
  for (const id of targets) if (!fade.has(id)) fade.set(id, 0);
  for (const [id, v] of fade) {
    const next = targets.has(id) ? Math.min(1, v + k) : Math.max(0, v - k);
    if (next <= 0) fade.delete(id);
    else fade.set(id, next);
  }
}
