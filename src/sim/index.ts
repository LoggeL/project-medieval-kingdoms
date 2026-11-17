/**
 * Einstieg der Simulation. Wird von der echten Simulation ersetzt (createGame mit Karte, Wirtschaft, Kampf).
 * Bis dahin liefert sie die Platzhalter-Welt aus demo.ts.
 */
import { createDemoGame } from "./demo";
import type { Game } from "./types";

export * from "./types";
export * from "./geom";

export interface GameOptions { seed?: number; size?: number }

export function createGame(_opts: GameOptions = {}): Game {
  return createDemoGame();
}
