/**
 * Laufraster und Pfadsuche mit drei Laufebenen.
 *
 * Knoten = Laufebene · W · H + y · W + x. Ebene 0 Boden, 1 Wehrgang (Höhe 3: Mauer- und Tor-Tiles),
 * 2 Turmplattform (Höhe 5). Innerhalb einer Ebene 8er-Nachbarschaft ohne Eckenschneiden, zwischen den
 * Ebenen nur über Übergangskanten (links):
 *   Treppe:  unterer Tile (Boden) ↔ oberer Tile (nur über Kanten erreichbar) ↔ Mauer-Tile (Ebene 1);
 *            auf beiden Treppen-Tiles ergibt sich die Höhe aus der Lage entlang der Stufen (stairZ)
 *   Turm:    angrenzender Wehrgang ↔ Plattform; Eingangs-Tile am Boden ↔ Plattform (Turmtür). Ebenso der
 *            Bergfried ab Stufe 2 (Wehrplattform); seine Plattform liegt auf der Höhe BuildingDef.deck.
 * Tore und Turmtüren sind nur für Team 0 offen: Angreifer kommen weder durchs Tor noch durch die Turmtür
 * hinauf, sie müssen Tor, Mauer oder Turm einreißen. Eigene Treppen dürfen sie benutzen, wenn sie davorstehen. Gebäude blockieren
 * den Boden mit ihrem ganzen Grundriss (auch Lagerhaus, Bergfried und Baustellen); betreten werden sie nur über die Tür (Daten
 * `door`), die vor dem Grundriss liegt. Läge eine Tür im Grundriss (offene Einfahrt), bliebe nur sie begehbar. Im Belagerungsmodus (breach)
 * sind sie mit hohen Kosten passierbar: Der Weg zeigt dann, welches Gebäude ein Angreifer einreißen muss.
 * Wege und Brücken (BuildingDef.road, ADR 0015) sind keine Hindernisse: Fertig gelten dort ihre Wegkosten, eine Brücke
 * macht Wasser begehbar.
 *
 * Aktualisierung (ADR 0015): rebuild() baut alles neu (Start, Laden). refresh() vergleicht Gebäude, Felsbrocken und Gelände
 * mit dem Stand des letzten Aufbaus und rechnet nur die betroffenen Kacheln samt ihrer Übergänge neu (applyRect); das
 * Ergebnis ist dasselbe wie nach rebuild() (Eigenschaftstest tests/sim/transport-raster.test.ts). Die Komponenten werden
 * erst beim nächsten Lesen neu bestimmt und nur, wenn sich die Begehbarkeit geändert hat (nicht bei reinen Wegkosten).
 * Erreichbarkeit wird über Zusammenhangskomponenten je Team vorab geprüft, damit unerreichbare Ziele keine volle Suche auslösen.
 *
 * Pfad-Cache: Die Suche (A*) ordnet gleich gute Knoten nach ihrer Nummer; ihr Ergebnis hängt also nur vom Raster, vom Start
 * und vom Ziel ab. Ein gespeicherter Weg mit Kosten C bleibt nach einer Änderung gültig, wenn jeder Weg über die geänderten
 * Kacheln (samt Nachbarn, wegen der Eckenregel) schon nach der Luftlinie mehr als C kostet: Dann hätte die Suche diese
 * Kacheln nie angefasst und fände denselben Weg. Alle anderen Einträge werden verworfen. So bleibt der Cache unsichtbar
 * für das Ergebnis (gleiche Folge-Ticks nach dem Laden mit leerem Cache).
 */
import { BUILDINGS, TERRAIN, levelDef, type TerrainKey } from "../data";
import { center, doorInside, entrance, footprint, footprintTiles, modelToWorld, stairEnds } from "./geom";
import type { Team } from "./types";
import type { World } from "./world";

export const BLOCKED = 0, OPEN = 1, GATE = 2, BUILT = 3;
export const LAYER_Z = [0, 3, 5];
const BREACH_COST = 14, BREACH_GATE = 10;
/** Kleinste Kosten je Feld, die es nach den Daten geben kann (Gelände, Wege, Übergänge). */
export const MIN_COST = Math.min(1, ...Object.values(TERRAIN).map((t) => t.cost),
  ...Object.values(BUILDINGS).flatMap((d) => (d.road ? [d.road.cost] : [])));
const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const TERRAIN_KEYS = Object.keys(TERRAIN) as TerrainKey[];
const TERRAIN_CODE = new Map(TERRAIN_KEYS.map((k, i) => [k, i]));
/** Höchstzahl gespeicherter Wege. */
const CACHE_MAX = 4000;

/** Ziel: alle Knoten der Ebene `layer` mit Tschebyschow-Abstand ≤ d zum Rechteck x0..x1 × y0..y1 (Tiles, inklusiv). */
export interface Goal { layer: number; x0: number; y0: number; x1: number; y1: number; d: number }

/** Rechteck in Tiles (inklusiv). */
export interface Rect { x0: number; y0: number; x1: number; y1: number }

interface CacheEntry { path: number[] | null; cost: number; sx: number; sy: number; goal: Goal }

/** Stand eines Gebäudes beim letzten Aufbau (was das Laufraster beeinflusst) und sein Grundriss. */
interface Snap { sig: string; r: Rect }

const buildingSig = (b: { key: string; x: number; y: number; o: number; built: number; level?: number }): string =>
  `${b.key},${b.x},${b.y},${b.o},${b.built >= 1 ? 1 : 0},${b.level ?? 1}`;

/** Oktil-Abstand (Tiles) zwischen zwei Rechtecken. */
function octRect(a: Rect, b: Rect): number {
  const dx = Math.max(b.x0 - a.x1, 0, a.x0 - b.x1), dy = Math.max(b.y0 - a.y1, 0, a.y0 - b.y1);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

export class Nav {
  readonly W: number;
  readonly H: number;
  readonly N: number;
  /** Je Ebene: Ebene 0 BLOCKED/OPEN/GATE/BUILT, Ebene 1 und 2: 1 = begehbar. */
  readonly walk: Uint8Array[];
  /** Wegkosten am Boden (Gelände, Wege). */
  readonly cost: Float32Array;
  /** Höhe jedes Knotens in Höhenstufen. */
  readonly z: Float32Array;
  /** Knoten, die nur über Übergangskanten erreichbar sind (oberer Treppen-Tile). */
  readonly linkOnly: Uint8Array;
  readonly links = new Map<number, number[]>();
  /** Übergänge nur für Team 0 (Turmtür am Boden ↔ Plattform). */
  readonly ownLinks = new Map<number, number[]>();
  /** Treppen-Tiles: Vorderkante (Welt) und Steigrichtung. */
  private readonly stairs = new Map<number, [number, number, number, number]>();
  /** Zusammenhangskomponenten je Team (−1 = nicht begehbar), erst beim Lesen aktuell (compDirty). */
  private readonly comps: Int32Array[];
  private compDirty = true;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;
  private hn = new Int32Array(1024);
  private hf = new Float64Array(1024);
  /** Belegte Plätze im Haufen. */
  private hs = 0;
  private readonly nbN = new Int32Array(16);
  private readonly nbC = new Float64Array(16);
  /** Stand beim letzten Aufbau (für refresh). */
  private snaps = new Map<number, Snap>();
  private rocks = new Set<number>();
  private terr: Uint8Array;
  /**
   * Kleinste Kosten eines begehbaren Felds auf dieser Karte (höchstens 1, die Kosten eines Übergangs): untere Schranke
   * der Suche. Je höher, desto zielgerichteter sucht A*; erst gepflasterte Straßen senken sie. Ändert sie sich, wird der
   * Pfad-Cache geleert (die Suche wäre anders verlaufen).
   */
  private minCost = 1;
  /** Zähler für die Lasttests: Suchen, dabei abgeschlossene Knoten, Treffer im Pfad-Cache, Aufbauten. */
  searches = 0;
  expanded = 0;
  hits = 0;
  stats = { rebuilds: 0, refreshes: 0, tiles: 0, kept: 0, dropped: 0, patched: 0, relabels: 0 };

  constructor(private readonly w: World) {
    this.W = w.s.w; this.H = w.s.h; this.N = this.W * this.H;
    const M = this.N * 3;
    this.walk = [new Uint8Array(this.N), new Uint8Array(this.N), new Uint8Array(this.N)];
    this.cost = new Float32Array(this.N);
    this.z = new Float32Array(M);
    this.linkOnly = new Uint8Array(M);
    this.comps = [new Int32Array(M), new Int32Array(M)];
    this.g = new Float64Array(M);
    this.parent = new Int32Array(M);
    this.seen = new Uint32Array(M);
    this.closed = new Uint32Array(M);
    this.terr = new Uint8Array(this.N);
    for (let i = 0; i < this.N; i++) { this.z[i] = LAYER_Z[0]; this.z[this.N + i] = LAYER_Z[1]; this.z[2 * this.N + i] = LAYER_Z[2]; }
  }

  /** Zusammenhangskomponenten je Team (−1 = nicht begehbar); nach einer Änderung der Begehbarkeit beim ersten Lesen neu. */
  get comp(): Int32Array[] {
    if (this.compDirty) { this.labelComponents(); this.compDirty = false; this.stats.relabels++; }
    return this.comps;
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
  /** Alles neu aufbauen (Start, Laden, Vergleich im Test). bump: Rasterstand erhöhen (Wege der Figuren prüfen). */
  rebuild(bump = true): void {
    this.links.clear();
    this.ownLinks.clear();
    this.stairs.clear();
    this.applyRect({ x0: 0, y0: 0, x1: this.W - 1, y1: this.H - 1 }, false);
    this.snapshot();
    this.compDirty = true;
    this.minCost = this.lowestCost();
    if (bump) this.w.meta.navVersion++;
    this.cache.clear();
    this.stats.rebuilds++;
  }

  /**
   * Nur nachziehen, was sich seit dem letzten Aufbau geändert hat (Gebäude gesetzt, fertig, ausgebaut, entfernt;
   * Felsbrocken abgebaut; Gelände). Gleiches Ergebnis wie rebuild(), aber nur für die betroffenen Kacheln.
   */
  refresh(): void {
    const dirty = this.diff();
    if (!dirty.length) return;
    this.stats.refreshes++;
    const changed: Rect[] = [];
    let topo = false;
    for (const r of dirty) {
      const c = this.applyRect({ x0: r.x0 - 1, y0: r.y0 - 1, x1: r.x1 + 1, y1: r.y1 + 1 }, true);
      if (c) { changed.push(c.r); topo ||= c.topo; }
    }
    if (!changed.length) return;
    if (topo && !this.compDirty && !this.patchComponents(changed)) this.compDirty = true;
    this.w.meta.navVersion++;
    const low = this.lowestCost();
    if (low !== this.minCost) { this.minCost = low; this.stats.dropped += this.cache.size; this.cache.clear(); }
    else this.invalidate(changed);
  }

  /** Kleinste Wegkosten eines begehbaren Bodenfelds, höchstens 1. */
  private lowestCost(): number {
    let low = 1;
    const w0 = this.walk[0], c = this.cost;
    for (let i = 0; i < this.N; i++) if ((w0[i] === OPEN || w0[i] === GATE) && c[i] < low) low = c[i];
    return low;
  }

  /** Geänderte Bereiche seit dem letzten Stand (Grundrisse alt und neu, Felsbrocken, Gelände); aktualisiert den Stand. */
  private diff(): Rect[] {
    const s = this.w.s, W = this.W, out: Rect[] = [];
    const seen = new Set<number>();
    for (const b of s.buildings) {
      seen.add(b.id);
      const sig = buildingSig(b), old = this.snaps.get(b.id);
      if (old && old.sig === sig) continue;
      const [fw, fh] = footprint(b.key, b.o);
      const r = { x0: b.x, y0: b.y, x1: b.x + fw - 1, y1: b.y + fh - 1 };
      if (old) out.push(old.r);
      out.push(r);
      this.snaps.set(b.id, { sig, r });
    }
    for (const [id, old] of this.snaps) if (!seen.has(id)) { out.push(old.r); this.snaps.delete(id); }
    const rocks = new Set<number>();
    for (const r of s.rocks) if (r.amount > 0) rocks.add(r.y * W + r.x);
    for (const i of this.rocks) if (!rocks.has(i)) out.push({ x0: i % W, y0: (i / W) | 0, x1: i % W, y1: (i / W) | 0 });
    for (const i of rocks) if (!this.rocks.has(i)) out.push({ x0: i % W, y0: (i / W) | 0, x1: i % W, y1: (i / W) | 0 });
    this.rocks = rocks;
    for (let i = 0; i < this.N; i++) {
      const t = TERRAIN_CODE.get(s.tiles[i].terrain) ?? 0;
      if (t === this.terr[i]) continue;
      this.terr[i] = t;
      out.push({ x0: i % W, y0: (i / W) | 0, x1: i % W, y1: (i / W) | 0 });
    }
    return out;
  }

  private snapshot(): void {
    const s = this.w.s;
    this.snaps.clear();
    for (const b of s.buildings) {
      const [fw, fh] = footprint(b.key, b.o);
      this.snaps.set(b.id, { sig: buildingSig(b), r: { x0: b.x, y0: b.y, x1: b.x + fw - 1, y1: b.y + fh - 1 } });
    }
    this.rocks = new Set(s.rocks.filter((r) => r.amount > 0).map((r) => r.y * this.W + r.x));
    for (let i = 0; i < this.N; i++) this.terr[i] = TERRAIN_CODE.get(s.tiles[i].terrain) ?? 0;
  }

  /**
   * Kacheln im Rechteck q (auf die Karte begrenzt) aus Gelände, Felsbrocken und Gebäuden neu bestimmen, dazu alle
   * Übergänge, die einen Knoten darin berühren. compare: geänderte Kacheln melden (Rechteck und ob sich die Begehbarkeit
   * oder ein Übergang geändert hat; null = nichts geändert).
   */
  private applyRect(q: Rect, compare: boolean): { r: Rect; topo: boolean } | null {
    const s = this.w.s, N = this.N, W = this.W;
    const x0 = Math.max(0, q.x0), y0 = Math.max(0, q.y0), x1 = Math.min(W - 1, q.x1), y1 = Math.min(this.H - 1, q.y1);
    if (x0 > x1 || y0 > y1) return null;
    const [w0, w1, w2] = this.walk;
    const rw = x1 - x0 + 1, area = rw * (y1 - y0 + 1);
    const inR = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    // alter Stand zum Vergleich
    let old: { w: Uint8Array; c: Float32Array; z: Float32Array; lo: Uint8Array; links: string[] } | null = null;
    if (compare) {
      old = { w: new Uint8Array(area * 3), c: new Float32Array(area), z: new Float32Array(area), lo: new Uint8Array(area * 3), links: new Array(area) };
      for (let y = y0, k = 0; y <= y1; y++) for (let x = x0; x <= x1; x++, k++) {
        const i = y * W + x;
        old.w[k * 3] = w0[i]; old.w[k * 3 + 1] = w1[i]; old.w[k * 3 + 2] = w2[i];
        old.c[k] = this.cost[i]; old.z[k] = this.z[2 * N + i];
        old.lo[k * 3] = this.linkOnly[i]; old.lo[k * 3 + 1] = this.linkOnly[N + i]; old.lo[k * 3 + 2] = this.linkOnly[2 * N + i];
        old.links[k] = this.linkSig(i);
      }
    }
    // Übergänge, die einen Knoten im Rechteck berühren, lösen (beide Richtungen)
    if (compare) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let l = 0; l < 3; l++) {
      const n = l * N + y * W + x;
      this.unlink(n, this.links); this.unlink(n, this.ownLinks);
    }
    // Gelände und Felsbrocken
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x, t = TERRAIN[s.tiles[i].terrain];
      w0[i] = t.walkable ? OPEN : BLOCKED; w1[i] = 0; w2[i] = 0;
      this.cost[i] = t.cost;
      this.z[2 * N + i] = LAYER_Z[2];
      this.linkOnly[i] = 0; this.linkOnly[N + i] = 0; this.linkOnly[2 * N + i] = 0;
      this.stairs.delete(i);
    }
    for (const r of s.rocks) if (r.amount > 0 && inR(r.x, r.y)) w0[r.y * W + r.x] = BLOCKED;
    // Grundrisse
    const near: typeof s.buildings = [];
    for (const b of s.buildings) {
      const [fw, fh] = footprint(b.key, b.o);
      const bx1 = b.x + fw - 1, by1 = b.y + fh - 1;
      if (b.x - 3 <= x1 && bx1 + 3 >= x0 && b.y - 3 <= y1 && by1 + 3 >= y0) near.push(b);
      if (b.x > x1 || bx1 < x0 || b.y > y1 || by1 < y0) continue;
      const def = levelDef(b.key, b.level ?? 1), done = b.built >= 1;
      const road = BUILDINGS[b.key].road;
      // Tür im Grundriss (offene Einfahrt): bliebe am fertigen Gebäude begehbar, alles andere ist Hindernis. Die Gebäude
      // der Daten (auch Lagerhaus und Bergfried) haben ihre Tür vor dem Grundriss, dort ist der ganze Grundriss gesperrt.
      const [dx, dy] = entrance(b.key, b.x, b.y, b.o);
      const door = done && doorInside(b.key, b.x, b.y, b.o) ? dy * W + dx : -1;
      for (const [x, y] of footprintTiles(b.key, b.x, b.y, b.o)) {
        if (!inR(x, y)) continue;
        const i = y * W + x;
        // Weg bzw. Brücke: kein Hindernis; fertig gelten die Wegkosten (die Brücke macht das Wasser begehbar)
        if (road) { if (done) { w0[i] = OPEN; this.cost[i] = road.cost; } continue; }
        if (i === door) { if (w0[i] === OPEN) this.cost[i] = 1; continue; }
        if (w0[i] !== BLOCKED) w0[i] = BUILT;
        if (!done) continue;
        if (def.gate) { w0[i] = GATE; w1[i] = 1; }
        else if (def.walkway === 1) w1[i] = 1;
        else if (def.walkway === 2) { w2[i] = 1; this.z[2 * N + i] = def.deck ?? LAYER_Z[2]; }
      }
    }
    // Übergänge erst, wenn alle Wehrgänge stehen; nur solche mit einem Ende im Rechteck (die anderen bestehen weiter)
    const touches = (...ns: number[]) => ns.some((n) => { const i = n % N; return inR(i % W, (i / W) | 0); });
    for (const b of compare ? near : s.buildings) {
      if (b.built < 1) continue;
      if (BUILDINGS[b.key].stairs) {
        const e = stairEnds(b.x, b.y, b.o);
        if (!this.w.inMap(...e.bottom) || !this.w.inMap(...e.top)) continue;
        const bi = e.bottom[1] * W + e.bottom[0], top = N + e.top[1] * W + e.top[0];
        const [cx, cy] = center(b.key, b.x, b.y, b.o);
        const [fx, fy] = modelToWorld(0, -1, b.o), [ax, ay] = modelToWorld(0, 1, b.o);
        const geo: [number, number, number, number] = [cx + fx, cy + fy, ax, ay];
        if (touches(bi)) { w0[bi] = OPEN; this.cost[bi] = 1; this.stairs.set(bi, geo); }
        if (touches(top)) { this.linkOnly[top] = 1; this.stairs.set(top - N, geo); }
        if (touches(bi, top)) this.link(bi, top);
        if (this.w.inMap(...e.wall) && w1[e.wall[1] * W + e.wall[0]]) {
          const wall = N + e.wall[1] * W + e.wall[0];
          if (touches(top, wall)) this.link(top, wall);
        }
      } else if (levelDef(b.key, b.level ?? 1).walkway === 2) {
        const tiles = footprintTiles(b.key, b.x, b.y, b.o);
        const inside = new Set(tiles.map(([x, y]) => y * W + x));
        for (const [x, y] of tiles) for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], ny = y + DY[d];
          if (!this.w.inMap(nx, ny) || inside.has(ny * W + nx)) continue;
          const a = N + ny * W + nx, p = 2 * N + y * W + x;
          if (w1[ny * W + nx] && touches(a, p)) this.link(a, p);
        }
        const [ex, ey] = entrance(b.key, b.x, b.y, b.o);
        if (this.w.inMap(ex, ey) && w0[ey * W + ex] === OPEN) {
          let best = tiles[0], bd = Infinity;
          for (const t of tiles) { const d = Math.abs(t[0] - ex) + Math.abs(t[1] - ey); if (d < bd) { bd = d; best = t; } }
          const a = ey * W + ex, p = 2 * N + best[1] * W + best[0];
          if (touches(a, p)) this.link(a, p, this.ownLinks);
        }
      }
    }
    this.stats.tiles += area;
    if (!old) return null;
    // Vergleich: Rechteck der geänderten Kacheln
    let cx0 = Infinity, cy0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, topo = false;
    for (let y = y0, k = 0; y <= y1; y++) for (let x = x0; x <= x1; x++, k++) {
      const i = y * W + x;
      const walk = old.w[k * 3] !== w0[i] || old.w[k * 3 + 1] !== w1[i] || old.w[k * 3 + 2] !== w2[i]
        || old.lo[k * 3] !== this.linkOnly[i] || old.lo[k * 3 + 1] !== this.linkOnly[N + i] || old.lo[k * 3 + 2] !== this.linkOnly[2 * N + i]
        || old.links[k] !== this.linkSig(i);
      if (!walk && old.c[k] === this.cost[i] && old.z[k] === this.z[2 * N + i]) continue;
      topo ||= walk;
      cx0 = Math.min(cx0, x); cy0 = Math.min(cy0, y); cx1 = Math.max(cx1, x); cy1 = Math.max(cy1, y);
    }
    return cx0 === Infinity ? null : { r: { x0: cx0, y0: cy0, x1: cx1, y1: cy1 }, topo };
  }

  /** Übergänge der drei Knoten eines Tiles als Text (zum Vergleich). */
  private linkSig(i: number): string {
    let out = "";
    for (let l = 0; l < 3; l++) {
      const n = l * this.N + i;
      const a = this.links.get(n), b = this.ownLinks.get(n);
      if (a) out += `${n}:${[...a].sort((p, q) => p - q).join(",")};`;
      if (b) out += `${n}o${[...b].sort((p, q) => p - q).join(",")};`;
    }
    return out;
  }

  private unlink(n: number, from: Map<number, number[]>): void {
    const ls = from.get(n);
    if (!ls) return;
    for (const m of ls) {
      const back = from.get(m);
      if (!back) continue;
      const k = back.indexOf(n);
      if (k >= 0) back.splice(k, 1);
      if (!back.length) from.delete(m);
    }
    from.delete(n);
  }

  /**
   * Gespeicherte Wege nach einer Änderung prüfen: Ein Weg mit Kosten C von (sx, sy) bleibt, wenn jeder Umweg über ein
   * geändertes Rechteck (um 1 erweitert, Eckenregel) schon nach der Luftlinie mehr kostet. Unerreichbare Ziele (null)
   * werden immer neu gesucht.
   */
  private invalidate(changed: Rect[]): void {
    const grown = changed.map((r) => ({ x0: r.x0 - 1, y0: r.y0 - 1, x1: r.x1 + 1, y1: r.y1 + 1 }));
    for (const [key, e] of this.cache) {
      let keep = !!e.path;
      if (keep) {
        const s = { x0: e.sx, y0: e.sy, x1: e.sx, y1: e.sy };
        const g = { x0: e.goal.x0 - e.goal.d, y0: e.goal.y0 - e.goal.d, x1: e.goal.x1 + e.goal.d, y1: e.goal.y1 + e.goal.d };
        for (const r of grown) if ((octRect(s, r) + octRect(r, g)) * this.minCost <= e.cost + 1e-6) { keep = false; break; }
      }
      if (keep) this.stats.kept++;
      else { this.cache.delete(key); this.stats.dropped++; }
    }
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

  private link(a: number, b: number, into = this.links): void {
    const la = into.get(a); if (la) la.push(b); else into.set(a, [b]);
    const lb = into.get(b); if (lb) lb.push(a); else into.set(b, [a]);
  }

  /**
   * Komponenten nach einer örtlichen Änderung nachführen, ohne die ganze Karte neu zu beschriften. Fenster F = geänderte
   * Kacheln + 2 (Knoten mit geänderten Kanten liegen höchstens 1 daneben). Im Fenster werden die jetzt begehbaren Knoten
   * örtlich verbunden. Zerfällt dabei keine alte Komponente (alle ihre Knoten im Fenster hängen noch zusammen), bleibt
   * sie bestehen; was im Fenster zusammenhängt, wird verschmolzen; ganz neue Inseln bekommen eine neue Nummer. Sonst
   * (möglicherweise zerfallen) false: dann wird beim nächsten Lesen alles neu beschriftet. Die Einteilung ist dieselbe
   * wie nach labelComponents, nur die Nummern können sich unterscheiden.
   */
  private patchComponents(changed: Rect[]): boolean {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of changed) { x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1); }
    const W = this.W, N = this.N;
    const fx0 = Math.max(0, x0 - 2), fy0 = Math.max(0, y0 - 2), fx1 = Math.min(W - 1, x1 + 2), fy1 = Math.min(this.H - 1, y1 + 2);
    const fw = fx1 - fx0 + 1, fh = fy1 - fy0 + 1;
    if (fw * fh > 48 * 48) return false;
    const inF = (n: number) => { const i = n % N, x = i % W, y = (i / W) | 0; return x >= fx0 && x <= fx1 && y >= fy0 && y <= fy1; };
    const inE = (n: number) => { const i = n % N, x = i % W, y = (i / W) | 0; return x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1; };
    const nodes: number[] = [];
    for (let l = 0; l < 3; l++) for (let y = fy0; y <= fy1; y++) for (let x = fx0; x <= fx1; x++) nodes.push(l * N + y * W + x);
    const group = new Map<number, number>();
    const merges: [Team, Map<number, number>][] = [];
    for (const team of [0, 1] as Team[]) {
      const comp = this.comps[team];
      // örtliche Gruppen im Fenster (nur jetzt begehbare Knoten, nur Kanten innerhalb des Fensters)
      group.clear();
      let ng = 0;
      const queue: number[] = [];
      for (const n of nodes) {
        if (group.has(n) || this.pass(n, team, false) < 0) continue;
        group.set(n, ng); queue.length = 0; queue.push(n);
        for (let q = 0; q < queue.length; q++) {
          const k = this.neighbors(queue[q], team, false);
          for (let j = 0; j < k; j++) { const nb = this.nbN[j]; if (inF(nb) && !group.has(nb)) { group.set(nb, ng); queue.push(nb); } }
        }
        ng++;
      }
      // alte Komponenten, die geänderte Kanten hatten: ihre (noch begehbaren) Knoten im Fenster müssen in einer Gruppe liegen
      const home = new Map<number, number>();
      for (const n of nodes) {
        const c = comp[n];
        if (c < 0 || !inE(n)) continue;
        home.set(c, -1);
      }
      for (const n of nodes) {
        const c = comp[n];
        if (c < 0 || !home.has(c) || !group.has(n)) continue;
        const gid = group.get(n)!, h = home.get(c)!;
        if (h === -1) home.set(c, gid); else if (h !== gid) return false; // könnte zerfallen sein
      }
      // je Gruppe eine Nummer: die kleinste alte Nummer ihrer Knoten, sonst eine neue; weitere alte Nummern verschmelzen
      const label = new Array<number>(ng).fill(-1);
      const alias = new Map<number, number>();
      const find = (c: number): number => { let r = c; while (alias.has(r)) r = alias.get(r)!; return r; };
      for (const n of nodes) {
        const gid = group.get(n);
        if (gid === undefined || comp[n] < 0) continue;
        const c = find(comp[n]), cur = label[gid];
        if (cur < 0) label[gid] = c;
        else if (find(cur) !== c) { const a = Math.min(find(cur), c), b = Math.max(find(cur), c); alias.set(b, a); label[gid] = a; }
      }
      let next = -1;
      for (let gid = 0; gid < ng; gid++) if (label[gid] < 0) {
        if (next < 0) { next = 0; for (let i = 0; i < comp.length; i++) if (comp[i] >= next) next = comp[i] + 1; }
        label[gid] = next++;
      }
      for (const n of nodes) { const gid = group.get(n); comp[n] = gid === undefined ? -1 : find(label[gid]); }
      if (alias.size) merges.push([team, alias]);
    }
    // verschmolzene Nummern auf der ganzen Karte umschreiben
    for (const [team, alias] of merges) {
      const comp = this.comps[team];
      const find = (c: number): number => { let r = c; while (alias.has(r)) r = alias.get(r)!; return r; };
      for (let i = 0; i < comp.length; i++) if (comp[i] >= 0 && alias.has(comp[i])) comp[i] = find(comp[i]);
    }
    this.stats.patched++;
    return true;
  }

  private labelComponents(): void {
    const M = this.N * 3;
    const queue = new Int32Array(M);
    for (const team of [0, 1] as Team[]) {
      const comp = this.comps[team];
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
          // Keine Diagonale an einer gesperrten Ecke vorbei, auch nicht im Belagerungsmodus: Wer durch eine diagonale
          // Lücke zwischen zwei Gebäuden will, muss eines davon einreißen (der Weg führt dann durch dessen Tile).
          const a = base + y * W + nx, b = base + ny * W + x;
          if (this.linkOnly[a] || this.linkOnly[b] || this.pass(a, team, false) < 0 || this.pass(b, team, false) < 0) continue;
          this.nbN[k] = nb; this.nbC[k++] = c * SQRT2;
        } else { this.nbN[k] = nb; this.nbC[k++] = c; }
      }
    }
    const ls = this.links.get(n);
    if (ls) for (const nb of ls) {
      const c = this.pass(nb, team, breach);
      if (c >= 0 && k < 16) { this.nbN[k] = nb; this.nbC[k++] = Math.max(1, c); }
    }
    const os = team === 0 ? this.ownLinks.get(n) : undefined;
    if (os) for (const nb of os) {
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
    return (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy)) * this.minCost;
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

  /**
   * Nächster für `team` begehbarer Knoten der Ebene `layer` um (x, y) (kein reiner Übergangsknoten),
   * bevorzugt in einer Komponente; −1, wenn im Umkreis keiner ist. Für Einheiten, die auf einem gesperrten Tile stehen.
   */
  nearestOpen(team: Team, x: number, y: number, layer: number, maxR = 6): number {
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx, ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) continue;
        const n = this.node(layer, tx, ty);
        if (this.linkOnly[n] || this.pass(n, team, false) < 0) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = n; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // ------------------------------------------------------------ Suche
  /** Weg von `from` zum Ziel (ohne Startknoten), [] wenn schon am Ziel, null wenn unerreichbar. */
  route(team: Team, breach: boolean, from: number, goal: Goal): number[] | null {
    const key = `${team}${breach ? "b" : ""}:${from}:${goal.layer},${goal.x0},${goal.y0},${goal.x1},${goal.y1},${goal.d}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) { this.hits++; return hit.path; }
    let path: number[] | null;
    let cost = 0;
    const fc = this.comp[team][from];
    if (!breach && fc >= 0 && !this.goalInComp(goal, team, fc)) path = null;
    else { path = this.find(from, team, breach, goal); cost = path && path.length ? this.g[path[path.length - 1]] : 0; }
    if (this.cache.size >= CACHE_MAX) this.cache.clear();
    this.cache.set(key, { path, cost, sx: this.tileX(from), sy: this.tileY(from), goal: { ...goal } });
    return path;
  }

  /** A* mit fester Reihenfolge bei Gleichstand (Kosten, dann Knotennummer): Ergebnis nur abhängig von Raster, Start, Ziel. */
  private find(from: number, team: Team, breach: boolean, goal: Goal): number[] | null {
    this.searches++;
    if (this.isGoal(from, goal)) return [];
    if (++this.gen >= 0xfffffff0) { this.seen.fill(0); this.closed.fill(0); this.gen = 1; }
    const gen = this.gen, g = this.g, seen = this.seen, closed = this.closed, parent = this.parent;
    this.hs = 0;
    g[from] = 0; seen[from] = gen; parent[from] = -1;
    this.push(from, this.h(from, goal));
    let budget = this.N * 3;
    while (this.hs) {
      const n = this.pop();
      if (closed[n] === gen) continue;
      closed[n] = gen;
      this.expanded++;
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

  /**
   * Haufen (binär, in festen Feldern): Vorrang hat die kleinere Schätzung f, bei Gleichstand die kleinere Knotennummer.
   * Die Reihenfolge hängt so nur von den Knoten ab, nicht davon, wann sie in den Haufen kamen.
   */
  private push(n: number, f: number): void {
    if (this.hs === this.hn.length) {
      const hn = new Int32Array(this.hn.length * 2), hf = new Float64Array(this.hn.length * 2);
      hn.set(this.hn); hf.set(this.hf); this.hn = hn; this.hf = hf;
    }
    const hn = this.hn, hf = this.hf;
    let i = this.hs++;
    while (i > 0) {
      const p = (i - 1) >> 1, pf = hf[p];
      if (pf < f || (pf === f && hn[p] < n)) break;
      hn[i] = hn[p]; hf[i] = pf; i = p;
    }
    hn[i] = n; hf[i] = f;
  }

  private pop(): number {
    const hn = this.hn, hf = this.hf;
    const top = hn[0];
    const size = --this.hs;
    if (size) {
      const ln = hn[size], lf = hf[size];
      let i = 0;
      for (;;) {
        const a = 2 * i + 1, b = a + 1;
        let m = i, mf = lf, mn = ln;
        if (a < size && (hf[a] < mf || (hf[a] === mf && hn[a] < mn))) { m = a; mf = hf[a]; mn = hn[a]; }
        if (b < size && (hf[b] < mf || (hf[b] === mf && hn[b] < mn))) { m = b; mf = hf[b]; mn = hn[b]; }
        if (m === i) break;
        hn[i] = mn; hf[i] = mf; i = m;
      }
      hn[i] = ln; hf[i] = lf;
    }
    return top;
  }
}
