/**
 * Tiefensortierung aller Objekte (Gebäude, Bäume, Felsen, Stapel, Figuren) in der Ansicht.
 *
 * Wie order() in tools/konzeptseite/bauten.js: Jedes Objekt hat eine Bodenbox in Ansichtskoordinaten (u0..u1, v0..v1).
 * A liegt vor B (wird zuerst gezeichnet), wenn A in u oder v ganz hinter B liegt. Daraus entsteht eine Halbordnung,
 * die topologisch sortiert wird. Damit das bei vielen Objekten schnell bleibt, werden nur Paare verglichen,
 * deren Bildrechtecke sich überlappen (Raster-Eimer im Bildraum); nur dort ist die Reihenfolge sichtbar.
 * Bei Widersprüchen (z. B. zwei sich überkreuzende Figuren) entscheidet die Tiefe u + v.
 */

export interface DepthItem {
  /** Bodenbox in Ansichtskoordinaten. */
  u0: number; u1: number; v0: number; v1: number;
  /** Bildrechteck (Welt-Pixel). */
  x0: number; y0: number; x1: number; y1: number;
  /** Flach am Boden (Lagerboden): wird vor allem gezeichnet, was seine Box überlappt. */
  flat: boolean;
  /**
   * Figur (klein, beweglich): steht sie in einer Box (Hof, Einfahrt) oder davor, kommt sie nach dem Gebäude; ragt nur
   * ihre Sortierbox von hinten hinein (Fußpunkt hinter der Box), davor.
   */
  fig: boolean;
  /** Feinsortierung bei Gleichstand (z. B. Höhe). */
  bias: number;
  /**
   * Vorderteil (z. B. vorderer Lagerzaun): wird nach allem gezeichnet, was seine Box überlappt (Stapel, Figuren im Hof).
   * Was ganz vor der Box liegt, kommt weiter danach.
   */
  cover?: boolean;
}

const EPS = 1e-3;
const CELL = 128;

/** A vor B? 1 = A zuerst, -1 = B zuerst, 0 = egal (z. B. getrennt diagonal). */
export function relation(a: DepthItem, b: DepthItem): number {
  const aBehind = a.u1 <= b.u0 + EPS || a.v1 <= b.v0 + EPS;
  const bBehind = b.u1 <= a.u0 + EPS || b.v1 <= a.v0 + EPS;
  if (aBehind && !bBehind) return 1;
  if (bBehind && !aBehind) return -1;
  if (aBehind && bBehind) return 0;
  // Boxen überlappen sich
  if (!!a.cover !== !!b.cover) return a.cover ? -1 : 1;
  if (a.flat !== b.flat) return a.flat ? 1 : -1;
  if (a.fig !== b.fig) {
    // Figur dicht an einem Objekt: Nur ihre Sortierbox ragt hinein, der Fußpunkt liegt dahinter (z. B. ein Angreifer
    // direkt an der Rückwand) → Figur zuerst. Steht sie wirklich darin (Einfahrt des Lagers, Hof) oder davor → danach.
    const f = a.fig ? a : b, o = a.fig ? b : a;
    const cu = (f.u0 + f.u1) / 2, cv = (f.v0 + f.v1) / 2;
    const behind = cu <= o.u0 + EPS || cv <= o.v0 + EPS, ahead = cu >= o.u1 - EPS || cv >= o.v1 - EPS;
    const figFirst = behind && !ahead;
    return figFirst === a.fig ? 1 : -1;
  }
  const da = a.u0 + a.u1 + a.v0 + a.v1 + a.bias, db = b.u0 + b.u1 + b.v0 + b.v1 + b.bias;
  return da < db ? 1 : da > db ? -1 : 0;
}

export class DepthSorter {
  private cells = new Map<number, number[]>();
  private edges: number[][] = [];
  private indeg: Int32Array = new Int32Array(64);
  private seen: Int32Array = new Int32Array(64);
  private done: Uint8Array = new Uint8Array(64);
  private heap: number[] = [];
  private depth: Float64Array = new Float64Array(64);
  /** Anzahl der zuletzt geprüften Paare (Debug). */
  pairs = 0;

  /** Liefert die Zeichenreihenfolge als Indexliste in items. */
  sort(items: DepthItem[], out: number[] = [], n = items.length): number[] {
    out.length = 0;
    if (n === 0) return out;
    this.ensure(n);
    const { cells, edges, indeg, seen, done, depth } = this;
    for (const arr of cells.values()) arr.length = 0;
    for (let i = 0; i < n; i++) {
      const it = items[i];
      depth[i] = it.u0 + it.u1 + it.v0 + it.v1 + it.bias;
      indeg[i] = 0; seen[i] = -1; done[i] = 0;
      if (edges[i]) edges[i].length = 0; else edges[i] = [];
      const cx0 = Math.floor(it.x0 / CELL), cx1 = Math.floor(it.x1 / CELL);
      const cy0 = Math.floor(it.y0 / CELL), cy1 = Math.floor(it.y1 / CELL);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const key = (cy + 4096) * 8192 + (cx + 4096);
        let arr = cells.get(key);
        if (!arr) { arr = []; cells.set(key, arr); }
        arr.push(i);
      }
    }
    // Kanten zwischen sich überlappenden Bildrechtecken
    let pairs = 0;
    for (let i = 0; i < n; i++) {
      const a = items[i];
      const cx0 = Math.floor(a.x0 / CELL), cx1 = Math.floor(a.x1 / CELL);
      const cy0 = Math.floor(a.y0 / CELL), cy1 = Math.floor(a.y1 / CELL);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const arr = cells.get((cy + 4096) * 8192 + (cx + 4096))!;
        for (let k = 0; k < arr.length; k++) {
          const j = arr[k];
          if (j <= i || seen[j] === i) continue;
          seen[j] = i;
          const b = items[j];
          if (a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0) continue;
          pairs++;
          const rel = relation(a, b);
          if (rel > 0) { edges[i].push(j); indeg[j]++; }
          else if (rel < 0) { edges[j].push(i); indeg[i]++; }
        }
      }
    }
    this.pairs = pairs;
    // Kahn mit Min-Heap nach Tiefe
    const heap = this.heap;
    heap.length = 0;
    for (let i = 0; i < n; i++) if (indeg[i] === 0) this.push(i);
    while (out.length < n) {
      if (heap.length === 0) {
        // Zyklus: das noch nicht gezeichnete Objekt mit der kleinsten Tiefe nehmen
        let m = -1;
        for (let i = 0; i < n; i++) if (!done[i] && (m < 0 || depth[i] < depth[m])) m = i;
        indeg[m] = 0;
        this.push(m);
      }
      const i = this.pop();
      if (done[i]) continue;
      done[i] = 1;
      out.push(i);
      const e = edges[i];
      for (let k = 0; k < e.length; k++) {
        const j = e[k];
        if (--indeg[j] === 0 && !done[j]) this.push(j);
      }
    }
    return out;
  }

  private ensure(n: number): void {
    if (this.indeg.length >= n) return;
    const m = Math.max(n, this.indeg.length * 2);
    this.indeg = new Int32Array(m);
    this.seen = new Int32Array(m);
    this.done = new Uint8Array(m);
    this.depth = new Float64Array(m);
  }

  private push(i: number): void {
    const h = this.heap, d = this.depth;
    h.push(i);
    let c = h.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (d[h[p]] <= d[h[c]]) break;
      [h[p], h[c]] = [h[c], h[p]];
      c = p;
    }
  }

  private pop(): number {
    const h = this.heap, d = this.depth;
    const top = h[0], last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let m = c;
        if (l < h.length && d[h[l]] < d[h[m]]) m = l;
        if (r < h.length && d[h[r]] < d[h[m]]) m = r;
        if (m === c) break;
        [h[m], h[c]] = [h[c], h[m]];
        c = m;
      }
    }
    return top;
  }
}
