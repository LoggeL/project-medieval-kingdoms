/**
 * Schornsteinrauch: dezente, pixelige Rauchwölkchen über Gebäuden mit Feuerstelle (Effekt der Darstellung, keine
 * Simulation). Alles ist eine reine Funktion der Spielzeit: Jeder Schornstein hat einige Wölkchen mit fester Phase,
 * die aufsteigen, mit dem Wind treiben, wachsen und ausblenden. Kein Zustand, kein Zufall pro Bild.
 *
 * Ankerpunkt: Mitte der Schornsteinöffnung in Modellkoordinaten (Meter, wie tools/blender/buildings.py: x rechts,
 * y nach hinten, z oben). Er wird wie der Grundriss über modelToWorld mit der Ausrichtung des Gebäudes in die Welt
 * gedreht und dann mit der Kameradrehung projiziert. So sitzt der Rauch in allen vier Ansichten auf demselben Schornstein
 * wie im Sprite (geprüft gegen die Sprite-Pixel aller vier Ansichten von haus.png und kaserne.png).
 * Wind weht in einer festen Weltrichtung und dreht deshalb mit der Kamera mit.
 */
import { Container, Texture } from "pixi.js";
import { modelToWorld } from "../sim/geom";
import { textureFromCanvas } from "./assets";
import { vecToScreen } from "./iso";
import { SpritePool } from "./pool";

/** Maßstab der Blender-Modelle (tools/blender/buildings.py: PPM, T, STEP). */
const PPM = 32 / 1.8;
const TILE_M = 64 / (Math.SQRT2 * PPM);
const STEP_M = 16 / (Math.cos(Math.PI / 6) * PPM);

/**
 * Schornsteine je Sprite: Öffnung in Modellmetern (aus buildings.py: b_haus masonry 0.75–1.3 × 0.25–0.8, Oberkante
 * 5.37; b_kaserne masonry −2.3…−1.7 × 0.6…1.2 um (0, cy = 1.469), Oberkante 6.6). Schmiede folgt, sobald es sie gibt.
 */
export const CHIMNEYS: Record<string, readonly [number, number, number][]> = {
  haus: [[1.025, 0.525, 5.37]],
  kaserne: [[-2.0, 2.369, 6.6]],
};

/** Schornsteinöffnung als Welt-Versatz zur Gebäudemitte (Tiles) und Höhe (Höhenstufen) für Ausrichtung o. */
export function chimneyWorld(m: readonly [number, number, number], o: number): [number, number, number] {
  const [wx, wy] = modelToWorld(m[0] / TILE_M, m[1] / TILE_M, o);
  return [wx, wy, m[2] / STEP_M];
}

/** Wölkchen je Schornstein, Dauer eines Wölkchens (s), Steighöhe (px) und Windrichtung (Welt, normiert). */
export const PUFFS = 7;
export const LIFE = 4.2;
const RISE = 40;
const DRIFT = 14;
const WIND: [number, number] = [0.8, -0.6];
const MAX_ALPHA = 0.8;

export interface Puff { x: number; y: number; size: number; alpha: number }

/** Kleiner ganzzahliger Streuwert je Schornstein, damit nicht alle im Gleichtakt rauchen. */
function phase(seed: number): number {
  return ((Math.imul(seed, 2654435761) >>> 0) % 1000) / 1000;
}

/**
 * Wölkchen eines Schornsteins zur Zeit t (Spielsekunden) an Bildpunkt (X, Y) bei Kameradrehung r. Schreibt in out
 * (Länge PUFFS) und liefert out. Reine Funktion.
 */
export function puffs(X: number, Y: number, t: number, r: number, seed: number, out: Puff[] = []): Puff[] {
  const [wx, wy] = vecToScreen(WIND[0], WIND[1], r);
  const wl = Math.hypot(wx, wy) || 1;
  const dx = wx / wl, dy = (wy / wl) * 0.5;
  const ph = phase(seed);
  for (let i = 0; i < PUFFS; i++) {
    const p = (((t / LIFE + i / PUFFS + ph) % 1) + 1) % 1;
    const sway = Math.sin((t + i * 1.7 + ph * 10) * 1.3) * 1.2 * p;
    let q = out[i];
    if (!q) { q = { x: 0, y: 0, size: 0, alpha: 0 }; out[i] = q; }
    // Wind wirkt stärker, je höher das Wölkchen steigt
    q.x = Math.round(X + dx * DRIFT * p * p + sway);
    q.y = Math.round(Y - RISE * p + dy * DRIFT * p * p);
    q.size = p < 0.15 ? 0 : p < 0.4 ? 1 : p < 0.7 ? 2 : 3;
    const fadeIn = Math.min(1, p / 0.12);
    q.alpha = MAX_ALPHA * fadeIn * (1 - p * p);
  }
  out.length = PUFFS;
  return out;
}

/** Pixelige Wölkchen in vier Größen (Licht oben links, grauer Unterrand), Pivot in der Mitte. */
const SHAPES: string[][] = [
  [".h.", "hxo", ".o."],
  [".hh.", "hxxx", "xxxo", ".oo."],
  [".hhh..", "hxxxh.", "xxxxxx", "xxxxxo", ".xxoo.", "..oo.."],
  ["..hhh...", ".hxxxhh.", "hxxxxxxh", "xxxxxxxx", "xxxxxxxo", ".xxxxoo.", "..ooo..."],
];
let textures: Texture[] | null = null;
function puffTextures(): Texture[] | null {
  if (textures) return textures;
  if (typeof document === "undefined") return null;
  textures = SHAPES.map((rows) => {
    const c = document.createElement("canvas");
    c.width = rows[0].length; c.height = rows.length;
    const g = c.getContext("2d")!;
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === ".") return;
      g.fillStyle = ch === "h" ? "#f2efe8" : ch === "x" ? "#cfccc5" : "#8f8b84";
      g.fillRect(x, y, 1, 1);
    }));
    return textureFromCanvas(c);
  });
  return textures;
}

export interface Emitter { x: number; y: number; seed: number }

/** Rauchebene über den Objekten: zeichnet die Wölkchen der in diesem Bild sichtbaren Schornsteine. */
export class SmokeLayer {
  readonly container = new Container();
  private pool = new SpritePool(this.container);
  private tmp: Puff[] = [];
  count = 0;

  constructor() { this.container.eventMode = "none"; }

  update(emitters: readonly Emitter[], t: number, r: number): void {
    this.pool.reset();
    const tex = puffTextures();
    this.count = 0;
    if (tex) for (const e of emitters) {
      for (const q of puffs(e.x, e.y, t, r, e.seed, this.tmp)) {
        if (q.alpha <= 0.02) continue;
        const tx = tex[q.size];
        const s = this.pool.next(tx);
        s.pivot.set(Math.floor(tx.frame.width / 2), Math.floor(tx.frame.height / 2));
        s.position.set(q.x, q.y);
        s.alpha = q.alpha;
        this.count++;
      }
    }
    this.pool.finish();
  }
}
