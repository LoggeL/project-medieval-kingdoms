/**
 * Nachwachsender Wald (BRIEF §2.1, §10; ADR 0016): Aus einem Baumstumpf treibt nach LIFE.forest.stumpSeconds ein Setzling
 * aus, der in drei Stufen (Setzling, Jungbaum, halbwüchsig) wieder zu einem fällbaren Baum wird. Solange weniger Bäume
 * stehen oder wachsen als beim Spielstart, sät ein zufälliger stehender Baum regelmäßig einen Setzling in seine
 * Nachbarschaft. So verschwindet der Wald nicht, wenn Holzfäller lange arbeiten, wächst aber auch nicht über seinen
 * Startbestand hinaus.
 *
 * Wachsende Bäume (Zustand "waechst") sind nicht fällbar und sperren das Bauen nicht (die Baustelle räumt sie weg,
 * wie Stümpfe). Zufall und IDs kommen aus dem Strom der lebendigen Welt (animals.ts: lifeRand, meta.life.nextId).
 */
import { LIFE } from "../data";
import { lifeRand } from "./animals";
import { plotAt } from "./farm";
import type { Tree } from "./types";
import { TPS, type World } from "./world";

/** Darf hier ein Baum (nach)wachsen: kein Gebäude (auch kein Weg), kein Beet eines Hofs (ADR 0013), kein Fels, kein anderer Baum. */
export function canGrow(w: World, x: number, y: number, self?: Tree): boolean {
  if (!w.inMap(x, y)) return false;
  const t = w.s.tiles[w.idx(x, y)];
  if (t.building) return false;
  if (plotAt(w.s, x, y)) return false;
  if (w.s.rocks.some((r) => r.x === x && r.y === y)) return false;
  return !w.s.trees.some((o) => o !== self && o.x === x && o.y === y);
}

/** Der Wald rechnet nur jeden FOREST_EVERY-ten Tick (Alter in Ticks wächst dann um so viel). */
export const FOREST_EVERY = 10;

export function updateForest(w: World): void {
  const life = w.meta.life;
  if (!life || w.s.tick % FOREST_EVERY !== 0) return;
  const F = LIFE.forest;
  const stump = F.stumpSeconds * TPS;
  let alive = 0;
  for (const t of w.s.trees) {
    if (t.state === "stumpf") {
      t.age = (t.age ?? 0) + FOREST_EVERY;
      if (t.age >= stump && canGrow(w, t.x, t.y, t)) {
        t.state = "waechst"; t.stage = 0; t.age = 0;
        t.progress = 0; t.logs = 0; t.fallX = 0; t.fallY = 0; t.reservedBy = 0;
      }
    } else if (t.state === "waechst") {
      alive++;
      t.age = (t.age ?? 0) + FOREST_EVERY;
      const stage = t.stage ?? 0;
      if (t.age >= F.stageSeconds[Math.min(stage, F.stageSeconds.length - 1)] * TPS) {
        t.age = 0;
        if (stage + 1 >= F.stageSeconds.length) { t.state = "stehend"; delete t.stage; delete t.age; }
        else t.stage = stage + 1;
      }
    } else if (t.state === "stehend") alive++;
  }
  // Säen, solange der Wald kleiner ist als beim Start
  if (w.s.tick % Math.round(F.seedSeconds * TPS) !== 0 || alive >= life.trees0) return;
  const standing = w.s.trees.filter((t) => t.state === "stehend");
  if (!standing.length) return;
  const mother = standing[Math.floor(lifeRand(w) * standing.length)];
  for (let k = 0; k < 6; k++) {
    const x = mother.x + Math.round((lifeRand(w) * 2 - 1) * F.seedRadius), y = mother.y + Math.round((lifeRand(w) * 2 - 1) * F.seedRadius);
    if (!w.inMap(x, y) || !F.seedTerrain.includes(w.s.tiles[w.idx(x, y)].terrain) || !canGrow(w, x, y)) continue;
    w.s.trees.push({
      id: life.nextId++, x, y, kind: mother.kind, variant: Math.floor(lifeRand(w) * 2), state: "waechst", stage: 0, age: 0,
      progress: 0, fallX: 0, fallY: 0, logs: 0, reservedBy: 0,
    });
    return;
  }
}
