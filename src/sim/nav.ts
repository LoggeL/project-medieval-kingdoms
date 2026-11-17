/**
 * Laufraster und Pfadsuche mit drei Laufebenen.
 *
 * Knoten = Laufebene · W · H + y · W + x. Ebene 0 Boden, 1 Wehrgang (Höhe 3: Mauer- und Tor-Tiles),
 * 2 Turmplattform (Höhe 5). Innerhalb einer Ebene 8er-Nachbarschaft ohne Eckenschneiden, zwischen den
 * Ebenen nur über Übergangskanten (links):
 *   Treppe:  unterer Tile (Boden) ↔ oberer Tile (nur über Kanten erreichbar) ↔ Mauer-Tile (Ebene 1);
 *            auf beiden Treppen-Tiles ergibt sich die Höhe aus der Lage entlang der Stufen (stairZ)
 *   Turm:    angrenzender Wehrgang ↔ Plattform; Eingangs-Tile am Boden ↔ Plattform
 * Tore sind am Boden nur für Team 0 offen. Gebäude blockieren den Boden; im Belagerungsmodus (breach)
 * sind sie mit hohen Kosten passierbar: Der Weg zeigt dann, welches Gebäude ein Angreifer einreißen muss.
 * Erreichbarkeit wird über Zusammenhangskomponenten je Team vorab geprüft, damit unerreichbare Ziele
 * keine volle Suche auslösen. Ergebnisse werden bis zur nächsten Änderung des Rasters zwischengespeichert.
 */
import { BUILDINGS, TERRAIN } from "../data";
import { center, entrance, footprintTiles, modelToWorld, stairEnds } from "./geom";
import type { Team } from "./types";
import type { World } from "./world";

export const BLOCKED = 0, OPEN = 1, GATE = 2, BUILT = 3;
export const LAYER_Z = [0, 3, 5];
const BREACH_COST = 14, BREACH_GATE = 10;
const MIN_COST = 0.7;
const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Ziel: alle Knoten der Ebene `layer` mit Tschebyschow-Abstand ≤ d zum Rechteck x0..x1 × y0..y1 (Tiles, inklusiv). */
export interface Goal { layer: number; x0: number; y0: number; x1: number; y1: number; d: number }

export class Nav {
  readonly W: number;
  readonly H: number;
  readonly N: number;
  /** Je Ebene: Ebene 0 BLOCKED/OPEN/GATE/BUILT, Ebene 1 und 2: 1 = begehbar. */
  readonly walk: Uint8Array[];
  /** Wegkosten am Boden (Gelände). */
  readonly cost: Float32Array;
  /** Höhe jedes Knotens in Höhenstufen. */
  readonly z: Float32Array;
  /** Knoten, die nur über Übergangskanten erreichbar sind (oberer Treppen-Tile). */
  readonly linkOnly: Uint8Array;
  readonly links = new Map<number, number[]>();
  /** Treppen-Tiles: Vorderkante (Welt) und Steigrichtung. */
  private readonly stairs = new Map<number, [number, number, number, number]>();
  /** Zusammenhangskomponenten je Team (−1 = nicht begehbar). */
  readonly comp: Int32Array[];
  private readonly cache = new Map<string, number[] | null>();
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;
  private hn: number[] = [];
  private hf: number[] = [];
  private readonly nbN = new Int32Array(16);
  private readonly nbC = new Float64Array(16);
  /** Zähler für den Lasttest. */
  searches = 0;

  constructor(private readonly w: World) {
    this.W = w.s.w; this.H = w.s.h; this.N = this.W * this.H;
    const M = this.N * 3;
    this.walk = [new Uint8Array(this.N), new Uint8Array(this.N), new Uint8Array(this.N)];
    this.cost = new Float32Array(this.N);
    this.z = new Float32Array(M);
    this.linkOnly = new Uint8Array(M);
    this.comp = [new Int32Array(M), new Int32Array(M)];
    this.g = new Float64Array(M);
    this.parent = new Int32Array(M);
    this.seen = new Uint32Array(M);
    this.closed = new Uint32Array(M);
  }

  node(layer: number, x: number, y: number): number { return layer * this.N + y * this.W + x; }
  layerOf(n: number): number { return (n / this.N) | 0; }
  tileX(n: number): number { return (n % this.N) % this.W; }
  tileY(n: number): number { return ((n % this.N) / this.W) | 0; }

  /** Kosten, einen Knoten zu betreten, oder −1. */
  pass(n: number, team: Team, breach: boolean): number {
    if (this.linkOnly[n]) return 1;
    const l = (n / this.N) | 0, i = n - l * this.N;
    const v = this.walk[l][i];
    if (l > 0) return v ? 1 : -1;
    if (v === OPEN) return this.cost[i];
    if (v === GATE) return team === 0 ? this.cost[i] : breach ? BREACH_GATE : -1;
    if (v === BUILT) return breach ? BREACH_COST : -1;
    return -1;
  }

  /** Ist der Knoten ohne Einreißen begehbar? */
  open(n: number, team: Team): boolean { return this.pass(n, team, false) >= 0; }

  // ------------------------------------------------------------ Aufbau
  rebuild(bump = true): void {
    const s = this.w.s, N = this.N, W = this.W;
    const [w0, w1, w2] = this.walk;
    w0.fill(BLOCKED); w1.fill(0); w2.fill(0);
    this.linkOnly.fill(0);
    this.links.clear();
    this.stairs.clear();
    for (let i = 0; i < N; i++) {
      const t = TERRAIN[s.tiles[i].terrain];
      w0[i] = t.walkable ? OPEN : BLOCKED;
      this.cost[i] = t.cost;
      this.z[i] = LAYER_Z[0]; this.z[N + i] = LAYER_Z[1]; this.z[2 * N + i] = LAYER_Z[2];
    }
    for (const r of s.rocks) if (r.amount > 0) w0[r.y * W + r.x] = BLOCKED;
    for (const b of s.buildings) {
      const def = BUILDINGS[b.key], done = b.built >= 1;
      for (const [x, y] of footprintTiles(b.key, b.x, b.y, b.o)) {
        if (!this.w.inMap(x, y)) continue;
        const i = y * W + x;
        if (b.key === "lager") { if (w0[i] === OPEN) this.cost[i] = 1; continue; } // Hof bleibt begehbar
        if (w0[i] !== BLOCKED) w0[i] = BUILT;
        if (!done) continue;
        if (def.gate) { w0[i] = GATE; w1[i] = 1; }
        else if (def.walkway === 1) w1[i] = 1;
        else if (def.walkway === 2) w2[i] = 1;
      }
    }
    // Übergänge erst, wenn alle Wehrgänge stehen
    for (const b of s.buildings) {
      if (b.built < 1) continue;
      if (BUILDINGS[b.key].stairs) {
        const e = stairEnds(b.x, b.y, b.o);
        if (!this.w.inMap(...e.bottom) || !this.w.inMap(...e.top)) continue;
        const bi = e.bottom[1] * W + e.bottom[0], top = N + e.top[1] * W + e.top[0];
        w0[bi] = OPEN; this.cost[bi] = 1;
        this.linkOnly[top] = 1;
        const [cx, cy] = center(b.key, b.x, b.y, b.o);
        const [fx, fy] = modelToWorld(0, -1, b.o), [ax, ay] = modelToWorld(0, 1, b.o);
        const geo: [number, number, number, number] = [cx + fx, cy + fy, ax, ay];
        this.stairs.set(bi, geo); this.stairs.set(top - N, geo);
        this.link(bi, top);
        if (this.w.inMap(...e.wall) && w1[e.wall[1] * W + e.wall[0]]) this.link(top, N + e.wall[1] * W + e.wall[0]);
      } else if (BUILDINGS[b.key].walkway === 2) {
        const tiles = footprintTiles(b.key, b.x, b.y, b.o);
        const inside = new Set(tiles.map(([x, y]) => y * W + x));
        for (const [x, y] of tiles) for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (!this.w.inMap(nx, ny) || inside.has(ny * W + nx)) continue;
          if (w1[ny * W + nx]) this.link(N + ny * W + nx, 2 * N + y * W + x);
        }
        const [ex, ey] = entrance(b.key, b.x, b.y, b.o);
        if (this.w.inMap(ex, ey) && w0[ey * W + ex] === OPEN) {
          let best = tiles[0], bd = Infinity;
          for (const t of tiles) { const d = Math.abs(t[0] - ex) + Math.abs(t[1] - ey); if (d < bd) { bd = d; best = t; } }
          this.link(ey * W + ex, 2 * N + best[1] * W + best[0]);
        }
      }
    }
    this.labelComponents();
    if (bump) this.w.meta.navVersion++;
    this.cache.clear();
  }

  /** Höhe auf einer Treppe an der Weltposition (x, y) oder −1, wenn dort keine Treppe ist. */
  stairZ(x: number, y: number): number {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return -1;
    const g = this.stairs.get(ty * this.W + tx);
    if (!g) return -1;
    const s = (x - g[0]) * g[2] + (y - g[1]) * g[3]; // 0 an der Vorderkante, 2 an der Mauer
    return Math.min(LAYER_Z[1], Math.max(0, (s / 2) * LAYER_Z[1]));
  }

  private link(a: number, b: number): void {
    const la = this.links.get(a); if (la) la.push(b); else this.links.set(a, [b]);
    const lb = this.links.get(b); if (lb) lb.push(a); else this.links.set(b, [a]);
  }

  private labelComponents(): void {
    const M = this.N * 3;
    const queue = new Int32Array(M);
    for (const team of [0, 1] as Team[]) {
      const comp = this.comp[team];
      comp.fill(-1);
      let label = 0;
      for (let n = 0; n < M; n++) {
        if (comp[n] !== -1 || this.pass(n, team, false) < 0) continue;
        let qh = 0, qt = 0;
        queue[qt++] = n; comp[n] = label;
        while (qh < qt) {
          const c = queue[qh++];
          const k = this.neighbors(c, team, false);
          for (let j = 0; j < k; j++) { const nb = this.nbN[j]; if (comp[nb] === -1) { comp[nb] = label; queue[qt++] = nb; } }
        }
        label++;
      }
    }
  }

  /** Nachbarn eines Knotens in nbN/nbC (Kosten inkl. Diagonale). */
  private neighbors(n: number, team: Team, breach: boolean): number {
    const N = this.N, W = this.W, H = this.H;
    const l = (n / N) | 0, i = n - l * N, x = i % W, y = (i / W) | 0, base = l * N;
    let k = 0;
    if (!this.linkOnly[n]) {
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nb = base + ny * W + nx;
        if (this.linkOnly[nb]) continue;
        const c = this.pass(nb, team, breach);
        if (c < 0) continue;
        if (d >= 4) {
          const a = base + y * W + nx, b = base + ny * W + x;
          if (this.linkOnly[a] || this.linkOnly[b] || this.pass(a, team, breach) < 0 || this.pass(b, team, breach) < 0) continue;
          this.nbN[k] = nb; this.nbC[k++] = c * SQRT2;
        } else { this.nbN[k] = nb; this.nbC[k++] = c; }
      }
    }
    const ls = this.links.get(n);
    if (ls) for (const nb of ls) {
      const c = this.pass(nb, team, breach);
      if (c >= 0 && k < 16) { this.nbN[k] = nb; this.nbC[k++] = Math.max(1, c); }
    }
    return k;
  }

  // ------------------------------------------------------------ Ziele
  isGoal(n: number, goal: Goal): boolean {
    if (this.layerOf(n) !== goal.layer) return false;
    const x = this.tileX(n), y = this.tileY(n);
    return Math.max(goal.x0 - x, 0, x - goal.x1) <= goal.d && Math.max(goal.y0 - y, 0, y - goal.y1) <= goal.d;
  }

  private h(n: number, goal: Goal): number {
    const x = this.tileX(n), y = this.tileY(n);
    const dx = Math.max(0, Math.max(goal.x0 - x, 0, x - goal.x1) - goal.d);
    const dy = Math.max(0, Math.max(goal.y0 - y, 0, y - goal.y1) - goal.d);
    return (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * MIN_COST;
  }

  /** Liegt irgendein Zielknoten in Komponente c? */
  goalInComp(goal: Goal, team: Team, c: number): boolean {
    const comp = this.comp[team];
    for (let y = Math.max(0, goal.y0 - goal.d); y <= Math.min(this.H - 1, goal.y1 + goal.d); y++)
      for (let x = Math.max(0, goal.x0 - goal.d); x <= Math.min(this.W - 1, goal.x1 + goal.d); x++)
        if (comp[this.node(goal.layer, x, y)] === c) return true;
    return false;
  }

  /** Nächster Knoten in Komponente c um (x, y), bevorzugt auf Ebene `layer`; −1, wenn keiner im Umkreis. */
  nearestInComp(team: Team, c: number, x: number, y: number, layer: number, maxR = 12): number {
    const comp = this.comp[team];
    const layers = [layer, 0, 1, 2].filter((l, i, a) => a.indexOf(l) === i);
    for (let r = 0; r <= maxR; r++) {
      for (const l of layers) {
        let best = -1, bd = Infinity;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const tx = x + dx, ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) continue;
          const n = this.node(l, tx, ty);
          if (comp[n] !== c) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = n; }
        }
        if (best >= 0) return best;
      }
    }
    return -1;
  }

  // ------------------------------------------------------------ Suche
  /** Weg von `from` zum Ziel (ohne Startknoten), [] wenn schon am Ziel, null wenn unerreichbar. */
  route(team: Team, breach: boolean, from: number, goal: Goal): number[] | null {
    const key = `${team}${breach ? "b" : ""}:${from}:${goal.layer},${goal.x0},${goal.y0},${goal.x1},${goal.y1},${goal.d}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let path: number[] | null;
    const fc = this.comp[team][from];
    if (!breach && fc >= 0 && !this.goalInComp(goal, team, fc)) path = null;
    else path = this.find(from, team, breach, goal);
    if (this.cache.size > 4000) this.cache.clear();
    this.cache.set(key, path);
    return path;
  }

  private find(from: number, team: Team, breach: boolean, goal: Goal): number[] | null {
    this.searches++;
    if (this.isGoal(from, goal)) return [];
    if (++this.gen >= 0xfffffff0) { this.seen.fill(0); this.closed.fill(0); this.gen = 1; }
    const gen = this.gen, g = this.g, seen = this.seen, closed = this.closed, parent = this.parent;
    this.hn.length = 0; this.hf.length = 0;
    g[from] = 0; seen[from] = gen; parent[from] = -1;
    this.push(from, this.h(from, goal));
    let budget = this.N * 3;
    while (this.hn.length) {
      const n = this.pop();
      if (closed[n] === gen) continue;
      closed[n] = gen;
      if (this.isGoal(n, goal)) return this.trace(n);
      if (--budget <= 0) return null;
      const k = this.neighbors(n, team, breach), gn = g[n];
      for (let j = 0; j < k; j++) {
        const nb = this.nbN[j];
        if (closed[nb] === gen) continue;
        const ng = gn + this.nbC[j];
        if (seen[nb] !== gen || ng < g[nb] - 1e-9) {
          g[nb] = ng; parent[nb] = n; seen[nb] = gen;
          this.push(nb, ng + this.h(nb, goal));
        }
      }
    }
    return null;
  }

  private trace(n: number): number[] {
    const out: number[] = [];
    for (let c = n; this.parent[c] !== -1; c = this.parent[c]) out.push(c);
    return out.reverse();
  }

  private push(n: number, f: number): void {
    const hn = this.hn, hf = this.hf;
    let i = hn.length;
    hn.push(n); hf.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      hn[i] = hn[p]; hf[i] = hf[p]; i = p;
    }
    hn[i] = n; hf[i] = f;
  }

  private pop(): number {
    const hn = this.hn, hf = this.hf;
    const top = hn[0];
    const ln = hn.pop()!, lf = hf.pop()!;
    const size = hn.length;
    if (size) {
      let i = 0;
      for (;;) {
        const a = 2 * i + 1, b = a + 1;
        let m = i, mf = lf;
        if (a < size && hf[a] < mf) { m = a; mf = hf[a]; }
        if (b < size && hf[b] < mf) { m = b; mf = hf[b]; }
        if (m === i) break;
        hn[i] = hn[m]; hf[i] = hf[m]; i = m;
      }
      hn[i] = ln; hf[i] = lf;
    }
    return top;
  }
}
