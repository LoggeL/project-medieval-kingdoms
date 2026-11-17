/**
 * Raum-Raster für Nachbarschaftsfragen (Zielwahl im Kampf, Abstoßung). Wird jeden Tick neu gefüllt,
 * enthält nur lebende Einheiten. Zellen 4 × 4 Tiles, verkettete Listen in flachen Arrays.
 */
import type { Unit } from "./types";

const CELL = 4;

export class Spatial {
  private readonly cols: number;
  private readonly rows: number;
  private readonly heads: Int32Array;
  private next = new Int32Array(64);
  private list: Unit[] = [];

  constructor(w: number, h: number) {
    this.cols = Math.ceil(w / CELL);
    this.rows = Math.ceil(h / CELL);
    this.heads = new Int32Array(this.cols * this.rows);
  }

  rebuild(units: readonly Unit[]): void {
    this.heads.fill(-1);
    this.list = [];
    if (this.next.length < units.length) this.next = new Int32Array(units.length * 2);
    for (const u of units) {
      if (u.dead) continue;
      const i = this.list.length;
      this.list.push(u);
      const c = this.cell(u.x, u.y);
      this.next[i] = this.heads[c];
      this.heads[c] = i;
    }
  }

  private cell(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / CELL)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / CELL)));
    return cy * this.cols + cx;
  }

  /** Ruft fn für jede Einheit im Quadrat ±r (der Aufrufer prüft den genauen Abstand). true bricht ab. */
  query(x: number, y: number, r: number, fn: (u: Unit) => boolean | void): void {
    const x0 = Math.max(0, Math.floor((x - r) / CELL)), x1 = Math.min(this.cols - 1, Math.floor((x + r) / CELL));
    const y0 = Math.max(0, Math.floor((y - r) / CELL)), y1 = Math.min(this.rows - 1, Math.floor((y + r) / CELL));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      for (let i = this.heads[cy * this.cols + cx]; i >= 0; i = this.next[i]) if (fn(this.list[i])) return;
    }
  }
}
