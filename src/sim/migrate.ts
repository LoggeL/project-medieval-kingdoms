/**
 * Spielstände älterer Versionen auf SAVE_VERSION heben (ADR 0019).
 *
 * Ein Spielstand ist `{ v, state, meta }` (Simulation.save). Jede Version, die Felder ändert oder ergänzt, bekommt hier
 * einen Schritt `MIGRATIONS[v]`, der einen Stand der Version v in einen der Version v + 1 verwandelt. loadGame wendet
 * die Schritte der Reihe nach an. Neue, optionale Felder, die beim Laden fehlen dürfen (Code liest `?? Vorgabe`),
 * brauchen keine neue Version; tests/sim/speicher.test.ts prüft jede Rundreise über den gesamten Zustand.
 */
import { DEFAULT_SCENARIO } from "../data";
import { newMatch } from "./match";
import type { SState, Meta } from "./world";

export interface SaveData { v: number; state: SState; meta: Meta }

/** Älteste Version, die sich noch laden lässt (Version 1 hatte keinen Bergfried). */
export const OLDEST_LOADABLE = 2;

export const MIGRATIONS: Record<number, (d: SaveData) => void> = {
  /** 2 → 3: Partie (Szenario, Schwierigkeitsgrad, Einführung, Statistik ab jetzt). */
  2: (d) => {
    const s = d.state as SState & { match?: SState["match"] };
    if (!s.match) {
      const m = newMatch(d.meta.tutorial !== undefined ? DEFAULT_SCENARIO : null);
      m.tutorial = d.meta.tutorial ?? null;
      m.endTick = s.outcome ? s.tick : null;
      s.match = m;
    }
  },
};

/** Spielstand prüfen und auf die Version `target` heben; wirft bei unbekannten oder zu alten Ständen. */
export function migrate(d: SaveData, target: number): SaveData {
  if (!d || typeof d !== "object" || typeof d.v !== "number" || !d.state || !d.meta) throw new Error("Kein gültiger Spielstand");
  if (d.v < OLDEST_LOADABLE) throw new Error(`Spielstand aus einer älteren Version (${d.v}, ohne Bergfried) kann nicht geladen werden`);
  if (d.v > target) throw new Error(`Unbekannte Spielstand-Version ${d.v} (neuer als dieses Spiel)`);
  while (d.v < target) {
    const step = MIGRATIONS[d.v];
    if (!step) throw new Error(`Unbekannte Spielstand-Version ${d.v}`);
    step(d);
    d.v++;
  }
  d.meta.version = target;
  return d;
}
