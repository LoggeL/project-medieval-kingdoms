/**
 * Gelände in der Simulation (ADR 0012): Geröllhalde am Gebirge und Nachrutschen von Felsbrocken.
 *
 * Felskacheln bis STEIN.reach Felder vom Gebirge bilden die Halde. Alle STEIN.slideSeconds rutscht dort ein neuer
 * Brocken nach, solange weniger als STEIN.slideMax Brocken auf der Halde liegen. Die Stelle ist frei (kein Brocken
 * daneben, kein Gebäude, keine Figur in der Nähe, keine Tür), und der Brocken trennt keine Wege (die begehbaren
 * Nachbarn hängen auch ohne die Stelle zusammen). Gewählt wird über einen Hash aus Tick und Seed, nicht über den
 * Weltzufall: Der Ablauf bleibt deterministisch, und andere Systeme ziehen dieselben Zufallszahlen wie ohne Halde.
 * Kein eigener Zustand: Ob ein Brocken nachrutscht, folgt aus Tick, Gelände und Brocken (alles im Spielstand).
 */
import { STEIN } from "../data";
import { hasDoor } from "./build";
import { approach } from "./geom";
import type { Rock, SimState } from "./types";
import { TPS, type World } from "./world";

const slopeCache = new WeakMap<SimState["tiles"], { list: number[]; set: Uint8Array }>();

/** Kacheln der Geröllhalde (Fels bis STEIN.reach Felder vom Gebirge), gecacht je Kartenfeld (Gelände ändert sich nicht). */
export function slopeTiles(s: SimState): { list: number[]; set: Uint8Array } {
  let c = slopeCache.get(s.tiles);
  if (c) return c;
  const W = s.w, H = s.h, R = STEIN.reach;
  const list: number[] = [], set = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (s.tiles[y * W + x].terrain !== "fels") continue;
    let near = false;
    for (let dy = -R; dy <= R && !near; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && s.tiles[yy * W + xx].terrain === "gebirge") { near = true; break; }
    }
    if (near) { list.push(y * W + x); set[y * W + x] = 1; }
  }
  c = { list, set };
  slopeCache.set(s.tiles, c);
  return c;
}

/** Brocken (mit Blöcken), die auf der Halde liegen. */
export function slopeRocks(s: SimState): Rock[] {
  const { set } = slopeTiles(s);
  return s.rocks.filter((r) => r.amount > 0 && set[r.y * s.w + r.x]);
}

const RING: [number, number][] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/**
 * Trennt ein Hindernis auf (x, y) Wege? Die begehbaren Nachbarn im 3 × 3-Fenster müssen ohne die Mitte über
 * Kantennachbarn zusammenhängen (Diagonalen an gesperrten Ecken gibt es nicht, ADR 0010).
 */
export function wouldSplit(w: World, x: number, y: number): boolean {
  const open = (dx: number, dy: number) => w.inMap(x + dx, y + dy) && w.nav.open(w.nav.node(0, x + dx, y + dy), 0);
  const cells = RING.filter(([dx, dy]) => open(dx, dy));
  if (cells.length <= 1) return false;
  const seen = new Set<string>([cells[0].join()]);
  const todo = [cells[0]];
  while (todo.length) {
    const [cx, cy] = todo.pop()!;
    for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
      if ((nx === 0 && ny === 0) || Math.abs(nx) > 1 || Math.abs(ny) > 1 || seen.has(`${nx},${ny}`) || !open(nx, ny)) continue;
      seen.add(`${nx},${ny}`);
      todo.push([nx, ny]);
    }
  }
  return seen.size < cells.length;
}

/** Darf hier ein Brocken nachrutschen? */
export function slideFree(w: World, x: number, y: number): boolean {
  const s = w.s;
  const t = s.tiles[w.idx(x, y)];
  if (t.terrain !== "fels" || t.building) return false;
  if (s.rocks.some((r) => Math.max(Math.abs(r.x - x), Math.abs(r.y - y)) < 2)) return false;
  if (s.trees.some((tr) => tr.x === x && tr.y === y)) return false;
  if (s.units.some((u) => !u.dead && Math.abs(u.x - (x + 0.5)) < 2 && Math.abs(u.y - (y + 0.5)) < 2)) return false;
  for (const b of s.buildings) {
    if (!hasDoor(b.key)) continue;
    const [ax, ay] = approach(b.key, b.x, b.y, b.o);
    if (Math.max(Math.abs(ax - x), Math.abs(ay - y)) <= 1) return false;
  }
  return !wouldSplit(w, x, y);
}

function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x6d2b79f5, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Je Tick: alle STEIN.slideSeconds einen Brocken auf der Halde nachrutschen lassen. Liefert den neuen Brocken. */
export function updateSlides(w: World): Rock | null {
  const s = w.s;
  const every = Math.max(1, Math.round(STEIN.slideSeconds * TPS));
  if (s.tick % every !== 0) return null;
  const { list } = slopeTiles(s);
  if (!list.length || slopeRocks(s).length >= STEIN.slideMax) return null;
  const h = hash(s.tick, s.seed);
  for (let k = 0; k < list.length; k++) {
    const i = list[(h + k * 7919) % list.length];
    const x = i % s.w, y = Math.floor(i / s.w);
    if (!slideFree(w, x, y)) continue;
    const [a0, a1] = STEIN.slideAmount;
    const amount = a0 + (hash(h, i) % (a1 - a0 + 1));
    const rock: Rock = { id: w.newId(), x, y, amount, max: amount, reservedBy: 0 };
    s.rocks.push(rock);
    w.nav.rebuild();
    w.msg("Am Gebirgshang ist Fels nachgerutscht: neue Brocken für den Steinbruch.", "info", "nachgerutscht", 300);
    return rock;
  }
  return null;
}
