import type { BuildingKey } from "../../src/data";
import type { Simulation } from "../../src/sim/game";

/** Nächster gültiger Bauplatz um (cx, cy) nach den Regeln von canPlace. */
export function findSpot(g: Simulation, key: BuildingKey, cx: number, cy: number, o = 0, maxR = 20): [number, number] {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (g.canPlace(key, cx + dx, cy + dy, o).ok) return [cx + dx, cy + dy];
    }
  }
  throw new Error(`kein Platz für ${key} um ${cx},${cy}`);
}

/** Startlager der Standardkarte. */
export function lagerOf(g: Simulation) {
  return g.state.buildings.find((b) => b.key === "lager")!;
}
