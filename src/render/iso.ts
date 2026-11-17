/**
 * Iso-Projektion und Drehung für die Darstellung (docs/concept/09-technik.md §3, ADR 0002).
 * Welt (x, y, z) → Ansicht (u, v) über geom.toView → Bild (X, Y) in Welt-Pixeln (Zoom 1, Ursprung = Ansicht (0, 0)).
 * Reine Mathematik ohne Pixi, damit sie in Tests läuft.
 */
import { toView, turn, type Rot } from "../sim/geom";

export const TILE_W = 64;
export const TILE_H = 32;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;
/** Bildpixel je Höhenstufe. */
export const STEP_PX = 16;

/** Ansicht (u, v, z) → Bildpunkt. */
export function viewToScreen(u: number, v: number, z = 0): [number, number] {
  return [(u - v) * HALF_W, (u + v) * HALF_H - z * STEP_PX];
}

/** Weltpunkt (Tile-Einheiten, Mitte eines Tiles = x + 0.5) → Bildpunkt bei Drehung r. */
export function worldToScreen(x: number, y: number, z: number, r: Rot, W: number, H: number): [number, number] {
  const [u, v] = toView(x, y, r, W, H);
  return viewToScreen(u, v, z);
}

/** Umkehrung von toView: Ansicht (u, v) → Welt (x, y). */
export function fromView(u: number, v: number, r: Rot, W: number, H: number): [number, number] {
  switch (r) {
    case 1: return [v, H - u];
    case 2: return [W - u, H - v];
    case 3: return [W - v, u];
    default: return [u, v];
  }
}

/** Bildpunkt → Weltpunkt auf Höhe z (Ebene). */
export function screenToWorld(X: number, Y: number, z: number, r: Rot, W: number, H: number): [number, number] {
  const a = X / HALF_W, b = (Y + z * STEP_PX) / HALF_H;
  return fromView((a + b) / 2, (b - a) / 2, r, W, H);
}

/** Welt-Richtungsvektor → Ansicht-Richtungsvektor (Kameradrehung ist die Umkehrung der Gebäudedrehung). */
export function vecToView(dx: number, dy: number, r: number): [number, number] {
  return turn(dx, dy, -r);
}

/** Welt-Richtungsvektor → Bildschirm-Richtungsvektor (Pixel). */
export function vecToScreen(dx: number, dy: number, r: number): [number, number] {
  const [du, dv] = vecToView(dx, dy, r);
  return [(du - dv) * HALF_W, (du + dv) * HALF_H];
}

/**
 * Bildrichtung der Figur (Zeile im Blatt: 0 S, 1 SO, 2 O, 3 NO, 4 N, 5 NW, 6 W, 7 SW) aus dem Welt-Blickvektor.
 * Wie octant() in tools/konzeptseite/bauten.js.
 */
export function figureDir(fx: number, fy: number, r: number): number {
  if (fx === 0 && fy === 0) return 0;
  const [sx, sy] = vecToScreen(fx, fy, r);
  const a = Math.atan2(sy, sx) / (Math.PI / 4);
  return (((2 - Math.round(a)) % 8) + 8) % 8;
}

/** Größe der Ansicht (Ausdehnung in u und v) bei Drehung r. */
export function viewSize(r: number, W: number, H: number): [number, number] {
  return r % 2 === 0 ? [W, H] : [H, W];
}

/** Bildschirm-Grenzen der Karte (Welt-Pixel, Zoom 1). */
export function mapScreenBounds(r: number, W: number, H: number): { x0: number; x1: number; y0: number; y1: number } {
  const [vu, vv] = viewSize(r, W, H);
  return { x0: -vv * HALF_W, x1: vu * HALF_W, y0: 0, y1: (vu + vv) * HALF_H };
}

/** Ausrichtung (0..3) der Welt-Achse, die einem Vektor am nächsten liegt; 0 = +x, 1 = −y, 2 = −x, 3 = +y (Sinn von geom.turn). */
export function axisOrientation(dx: number, dy: number): number {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 2;
  return dy < 0 ? 1 : 3;
}
