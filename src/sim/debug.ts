/**
 * Hilfen für Tests und Versuche: fertige Gebäude setzen, Einheiten erzeugen, Lager füllen.
 * Nicht Teil der Spielregeln; das Spiel selbst nutzt nur Befehle (dispatch).
 */
import type { BuildingKey, Good, UnitKey } from "../data";
import { spawnBuilt, type Simulation } from "./game";
import { LAYER_Z } from "./nav";
import { storeDirect, updateStock } from "./storage";
import type { Team } from "./types";
import type { SBuilding, SUnit, World } from "./world";

export const worldOf = (g: Simulation): World => g.world;

export function buildNow(g: Simulation, key: BuildingKey, x: number, y: number, o = 0): SBuilding {
  const b = spawnBuilt(g.world, key, x, y, o);
  updateStock(g.world);
  return b;
}

export function spawn(g: Simulation, key: UnitKey, team: Team, x: number, y: number, layer = 0): SUnit {
  return g.world.addUnit(key, team, x + 0.5, y + 0.5, layer, LAYER_Z[layer]);
}

export function stockUp(g: Simulation, good: Good, n: number): number {
  const k = storeDirect(g.world, good, n);
  updateStock(g.world);
  return k;
}

export function run(g: Simulation, ticks: number, each?: (tick: number) => void | boolean): void {
  for (let i = 0; i < ticks; i++) { g.tick(); if (each && each(g.state.tick) === true) return; }
}
