/**
 * Kamera: Mittelpunkt in Welt-Pixeln (Zoom 1) der aktuellen Ansicht, Zoomstufe, Drehung.
 * Drehen hält den Welt-Tile in der Bildmitte fest; Zoomen hält den Punkt unter der Maus fest.
 */
import type { Rot } from "../sim/geom";
import { mapScreenBounds, screenToWorld, worldToScreen } from "./iso";

/** Ganzzahlige Stufen für pixelscharfe Darstellung plus 0,5× Übersicht. */
export const ZOOMS = [0.5, 1, 2, 3];

export class Camera {
  /** Bildmitte in Welt-Pixeln. */
  x = 0;
  y = 0;
  zoomIndex = 2;
  r: Rot = 0;
  /** Bildschirmgröße in CSS-Pixeln. */
  sw = 800;
  sh = 600;

  constructor(public W: number, public H: number) {}

  get zoom(): number { return ZOOMS[this.zoomIndex]; }

  /** Auf einen Weltpunkt (Tile-Einheiten) blicken. */
  lookAt(wx: number, wy: number): void {
    [this.x, this.y] = worldToScreen(wx, wy, 0, this.r, this.W, this.H);
    this.clamp();
  }

  /** Weltpunkt (Boden) in der Bildmitte. */
  focus(): [number, number] {
    return screenToWorld(this.x, this.y, 0, this.r, this.W, this.H);
  }

  rotate(dir: 1 | -1): void {
    const [wx, wy] = this.focus();
    this.r = (((this.r + dir) % 4) + 4) % 4 as Rot;
    this.lookAt(wx, wy);
  }

  /** Bildschirmpunkt (CSS-Pixel) → Welt-Pixel. */
  toWorldPx(sx: number, sy: number): [number, number] {
    return [this.x + (sx - this.sw / 2) / this.zoom, this.y + (sy - this.sh / 2) / this.zoom];
  }

  /** Welt-Pixel → Bildschirm (CSS-Pixel). */
  toScreenPx(px: number, py: number): [number, number] {
    return [(px - this.x) * this.zoom + this.sw / 2, (py - this.y) * this.zoom + this.sh / 2];
  }

  /** Zoomstufe wechseln, Punkt (sx, sy) am Bildschirm bleibt stehen. */
  zoomAt(dir: 1 | -1, sx = this.sw / 2, sy = this.sh / 2): boolean {
    const next = Math.max(0, Math.min(ZOOMS.length - 1, this.zoomIndex + dir));
    if (next === this.zoomIndex) return false;
    const [wx, wy] = this.toWorldPx(sx, sy);
    this.zoomIndex = next;
    this.x = wx - (sx - this.sw / 2) / this.zoom;
    this.y = wy - (sy - this.sh / 2) / this.zoom;
    this.clamp();
    return true;
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.x += dxScreen / this.zoom;
    this.y += dyScreen / this.zoom;
    this.clamp();
  }

  /** Bildmitte innerhalb der Karte halten (etwas Rand erlaubt). */
  clamp(): void {
    const b = mapScreenBounds(this.r, this.W, this.H);
    const m = 64;
    this.x = Math.max(b.x0 - m, Math.min(b.x1 + m, this.x));
    this.y = Math.max(b.y0 - m, Math.min(b.y1 + m, this.y));
  }

  /** Sichtbarer Bereich in Welt-Pixeln mit Rand. */
  viewRect(margin = 0): { x0: number; y0: number; x1: number; y1: number } {
    const hw = this.sw / 2 / this.zoom + margin, hh = this.sh / 2 / this.zoom + margin;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }
}
