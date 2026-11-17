/**
 * Baustaub und Späne: Bei jedem Hammerschlag eines Bauarbeiters springen ein paar Holzspäne oder Steinsplitter vom
 * Werkstück und ein kleines Staubwölkchen steigt auf; beim Abriss oder der Zerstörung eines Gebäudes wallt eine
 * Staubwolke über den Grundmauern. Wie der Schornsteinrauch (smoke.ts) ein reiner Effekt der Darstellung: Alles ist eine
 * Funktion der Zeit seit Beginn der Animation bzw. des Abrisses, kein Zustand pro Teilchen, kein Zufall pro Bild.
 *
 * Takt: Die Bauanimation des Tagelöhners hat 4 Bilder bei 10 Bildern/s (Figurenblatt, Spalten 9–12); der Hammer trifft
 * im vierten Bild (IMPACT, Hammer ganz unten). Die Späne fliegen in Bildschirm-Pixeln (Welt-Pixel bei Zoom 1) und fallen mit Schwerkraft.
 */
import { Container, Texture } from "pixi.js";
import { textureFromCanvas } from "./assets";
import { SpritePool } from "./pool";

/** Dauer eines Hammerzyklus (s) und Zeitpunkt des Treffers im Zyklus (s). */
export const STRIKE = 0.4;
export const IMPACT = 0.3;
/** Lebensdauer eines Spans (s), Späne je Schlag. */
export const CHIP_LIFE = 0.55;
export const CHIPS = 4;
/** Abriss: Dauer der Staubwolke (s) und Zahl der Wölkchen. */
export const RUBBLE_LIFE = 3.2;
const RUBBLE_PUFFS = 14;
const GRAVITY = 160;

/** Material, das bearbeitet wird: 1 = Holz, 2 = Stein (Bitmaske, beides = abwechselnd je Schlag). */
export type DustMat = 1 | 2 | 3;

export interface Particle {
  x: number; y: number;
  /** Textur: 0..3 Späne (Holz hell/dunkel, Stein hell/dunkel), 4..7 Staubwölkchen klein bis groß. */
  tex: number;
  alpha: number;
}

/** Ganzzahliger Streuwert (0..1) aus Samen und Zähler, stabil über Bilder hinweg. */
function rnd(seed: number, k: number): number {
  return ((Math.imul(seed * 977 + k, 2654435761) >>> 8) % 10007) / 10007;
}

/**
 * Teilchen eines hämmernden Bauarbeiters zur Zeit t (Sekunden seit Beginn der Bauanimation) am Trefferpunkt (X, Y).
 * dir = Bildschirmrichtung des Blicks (−1 links, 1 rechts), die Späne fliegen vom Werkstück zur Figur zurück.
 */
export function strikeParticles(X: number, Y: number, t: number, seed: number, mat: DustMat, dir: number, out: Particle[] = []): Particle[] {
  out.length = 0;
  const last = Math.floor((t - IMPACT) / STRIKE);
  for (let c = last; c >= 0 && c > last - 2; c--) {
    const age = t - (c * STRIKE + IMPACT);
    if (age < 0 || age > CHIP_LIFE) continue;
    const stone = mat === 2 || (mat === 3 && c % 2 === 1);
    const s = seed * 131 + c;
    for (let i = 0; i < CHIPS; i++) {
      const vx = (-dir * (8 + rnd(s, i) * 28)) + (rnd(s, i + 10) - 0.5) * 30;
      const vy = -(30 + rnd(s, i + 20) * 45);
      const k = age / CHIP_LIFE;
      out.push({
        x: Math.round(X + vx * age),
        y: Math.round(Y + vy * age + 0.5 * GRAVITY * age * age),
        tex: (stone ? 2 : 0) + (i % 2),
        alpha: k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3,
      });
    }
    // Staubwölkchen: bei Stein deutlich, bei Holz nur ein Hauch
    const k = age / CHIP_LIFE;
    out.push({ x: Math.round(X + dir * 2), y: Math.round(Y - 2 - 10 * k), tex: 4 + Math.min(2, Math.floor(k * 3)), alpha: (stone ? 0.75 : 0.35) * (1 - k) });
  }
  return out;
}

/** Staubwolke eines abgerissenen Gebäudes zur Zeit t (s seit dem Abriss) über dem Grundriss (Mitte X, Y, Halbbreite w). */
export function rubbleParticles(X: number, Y: number, w: number, t: number, seed: number, out: Particle[] = []): Particle[] {
  out.length = 0;
  if (t < 0 || t > RUBBLE_LIFE) return out;
  for (let i = 0; i < RUBBLE_PUFFS; i++) {
    const start = rnd(seed, i) * 0.6;
    const age = t - start;
    const life = RUBBLE_LIFE - 0.6;
    if (age < 0 || age > life) continue;
    const k = age / life;
    const ox = (rnd(seed, i + 40) - 0.5) * 2 * w, oy = (rnd(seed, i + 80) - 0.5) * w;
    out.push({
      x: Math.round(X + ox * (0.6 + k * 0.6)),
      y: Math.round(Y + oy - 4 - 16 * Math.sqrt(k)),
      tex: 5 + Math.min(2, Math.floor(k * 3 + rnd(seed, i + 120))),
      alpha: 0.85 * Math.min(1, age / 0.15) * (1 - k * k),
    });
  }
  // Splitter, die aus der Wolke fallen
  for (let i = 0; i < 8; i++) {
    const age = t - rnd(seed, i + 200) * 0.3;
    if (age < 0 || age > 0.8) continue;
    const vx = (rnd(seed, i + 220) - 0.5) * 3 * w, vy = -(40 + rnd(seed, i + 240) * 40);
    out.push({ x: Math.round(X + vx * age), y: Math.round(Y - 8 + vy * age + 0.5 * GRAVITY * age * age), tex: 2 + (i % 2), alpha: 1 - age / 0.8 });
  }
  return out;
}

/** Pixel-Formen: Späne 1–2 px, Wölkchen wie der Rauch, aber erdfarben. */
const CHIP_COLORS = ["#d8b072", "#8a5a2c", "#d9d2c3", "#8f8678"];
const PUFF_SHAPES: string[][] = [
  [".h.", "hxo", ".o."],
  [".hh.", "hxxx", "xxxo", ".oo."],
  [".hhh..", "hxxxh.", "xxxxxx", "xxxxxo", ".xxoo.", "..oo.."],
  ["..hhh...", ".hxxxhh.", "hxxxxxxh", "xxxxxxxx", "xxxxxxxo", ".xxxxoo.", "..ooo..."],
];
let textures: Texture[] | null = null;
function dustTextures(): Texture[] | null {
  if (textures) return textures;
  if (typeof document === "undefined") return null;
  const chips = CHIP_COLORS.map((col, i) => {
    const c = document.createElement("canvas");
    c.width = i % 2 ? 1 : 2; c.height = 1;
    const g = c.getContext("2d")!;
    g.fillStyle = col; g.fillRect(0, 0, c.width, 1);
    return textureFromCanvas(c);
  });
  const puffs = PUFF_SHAPES.map((rows) => {
    const c = document.createElement("canvas");
    c.width = rows[0].length; c.height = rows.length;
    const g = c.getContext("2d")!;
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === ".") return;
      g.fillStyle = ch === "h" ? "#e8dcc4" : ch === "x" ? "#c9b896" : "#9c8a6c";
      g.fillRect(x, y, 1, 1);
    }));
    return textureFromCanvas(c);
  });
  textures = [...chips, ...puffs];
  return textures;
}

/** Ein Hammerschlag-Emitter (Bauarbeiter) dieses Bildes. */
export interface StrikeEmitter { x: number; y: number; t: number; seed: number; mat: DustMat; dir: number }
/** Eine Staubwolke über einem abgerissenen Gebäude. */
export interface RubbleEmitter { x: number; y: number; w: number; t: number; seed: number }

/** Staubebene über den Objekten (wie die Rauchebene, ohne Tiefensortierung). */
export class DustLayer {
  readonly container = new Container();
  private pool = new SpritePool(this.container);
  private tmp: Particle[] = [];
  count = 0;

  constructor() { this.container.eventMode = "none"; }

  update(strikes: readonly StrikeEmitter[], rubble: readonly RubbleEmitter[]): void {
    this.pool.reset();
    this.count = 0;
    const tex = dustTextures();
    if (tex) {
      for (const e of strikes) this.draw(tex, strikeParticles(e.x, e.y, e.t, e.seed, e.mat, e.dir, this.tmp));
      for (const e of rubble) this.draw(tex, rubbleParticles(e.x, e.y, e.w, e.t, e.seed, this.tmp));
    }
    this.pool.finish();
  }

  private draw(tex: Texture[], list: Particle[]): void {
    for (const q of list) {
      if (q.alpha <= 0.02) continue;
      const tx = tex[q.tex];
      const s = this.pool.next(tx);
      s.pivot.set(Math.floor(tx.frame.width / 2), Math.floor(tx.frame.height / 2));
      s.position.set(q.x, q.y);
      s.alpha = q.alpha;
      this.count++;
    }
  }
}
