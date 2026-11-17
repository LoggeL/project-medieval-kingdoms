/**
 * Spielschleife: feste Simulationsschritte (TICKS_PER_SECOND) mit Akkumulator, Darstellung in jedem Bild.
 * Geschwindigkeit 0 (Pause), 1, 2. Liefert den Interpolationsanteil zwischen zwei Ticks.
 */
import { TICKS_PER_SECOND } from "../data";
import type { Game } from "../sim/types";

export const TICK_MS = 1000 / TICKS_PER_SECOND;
const MAX_STEPS = 6;

export class FixedLoop {
  private acc = 0;
  /** Dauer des letzten Ticks (ms) und gleitender Mittelwert. */
  tickMs = 0;
  tickAvg = 0;
  ticksSinceEmit = 0;

  constructor(private game: Game) {}

  /** dtMs = vergangene Echtzeit seit dem letzten Bild. Gibt alpha (0..1) zurück. */
  advance(dtMs: number, speed: number): number {
    if (speed <= 0) return 1;
    this.acc += Math.min(250, dtMs) * speed;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < MAX_STEPS) {
      const t0 = performance.now();
      this.game.tick();
      this.tickMs = performance.now() - t0;
      this.tickAvg = this.tickAvg * 0.9 + this.tickMs * 0.1;
      this.acc -= TICK_MS;
      steps++;
      this.ticksSinceEmit++;
    }
    if (steps === MAX_STEPS) this.acc = Math.min(this.acc, TICK_MS); // nicht aufschaukeln
    return Math.max(0, Math.min(1, this.acc / TICK_MS));
  }
}
