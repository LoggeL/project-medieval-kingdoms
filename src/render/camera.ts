/**
 * Kamera: Mittelpunkt in Welt-Pixeln (Zoom 1) der aktuellen Ansicht, Zoomstufe, Drehung.
 * Drehen hält den Welt-Tile in der Bildmitte fest; Zoomen hält den Punkt unter der Maus fest.
 *
 * Zoom: feste Stufen (src/data/view.ts). Ein Stufenwechsel läuft sanft über ZOOM_MS (logarithmisch, abbremsend), der
 * Punkt unter der Maus bleibt dabei stehen. zoom ist der gerade gezeigte Faktor, targetZoom die angesteuerte Stufe.
 */
import { ZOOMS, ZOOM_DEFAULT, ZOOM_MS } from "../data/view";
import type { Rot } from "../sim/geom";
import { mapScreenBounds, screenToWorld, worldToScreen } from "./iso";

export { ZOOMS };

/**
 * Wie eine Zoomstufe gezeichnet wird.
 * - smooth: Texturen linear filtern (nur beim Verkleinern unter 1).
 * - resolution: Canvas-Pixel je CSS-Pixel. Bei 1,5 ist sie 2/1,5: Die Welt landet dann mit ganzzahligem Faktor 2 im
 *   Canvas (pixelgenau, nächster Nachbar) und der Browser verkleinert das Canvas weich auf die Fenstergröße.
 * - cssSmooth: Canvas weich statt pixelig skalieren (CSS image-rendering).
 */
export interface PixelMode { smooth: boolean; resolution: number; cssSmooth: boolean }

export function pixelMode(zoom: number): PixelMode {
  if (zoom < 1) return { smooth: true, resolution: 1, cssSmooth: true };
  if (Number.isInteger(zoom)) return { smooth: false, resolution: 1, cssSmooth: false };
  return { smooth: false, resolution: Math.ceil(zoom) / zoom, cssSmooth: true };
}

export class Camera {
  /** Bildmitte in Welt-Pixeln. */
  x = 0;
  y = 0;
  /** Angesteuerte Stufe (Index in ZOOMS). */
  zoomIndex = ZOOM_DEFAULT;
  r: Rot = 0;
  /** Bildschirmgröße in CSS-Pixeln. */
  sw = 800;
  sh = 600;
  /** Sanfter Übergang abschalten (reduzierte Bewegung, Tests). */
  instant = false;
  private z: number = ZOOMS[ZOOM_DEFAULT];
  /** Laufender Übergang: Ausgangsfaktor, verstrichene ms, fester Weltpunkt (wx, wy) unter Bildschirmpunkt (sx, sy). */
  private anim: { from: number; t: number; wx: number; wy: number; sx: number; sy: number } | null = null;

  constructor(public W: number, public H: number) {}

  /** Gerade gezeigter Zoomfaktor (während eines Übergangs zwischen zwei Stufen). */
  get zoom(): number { return this.z; }
  /** Angesteuerte Zoomstufe. */
  get targetZoom(): number { return ZOOMS[this.zoomIndex]; }
  get zooming(): boolean { return this.anim !== null; }

  /** Auf einen Weltpunkt (Tile-Einheiten) blicken. */
  lookAt(wx: number, wy: number): void {
    [this.x, this.y] = worldToScreen(wx, wy, 0, this.r, this.W, this.H);
    this.clamp();
    this.reanchor();
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

  /** Zoomstufe wechseln, Punkt (sx, sy) am Bildschirm bleibt stehen. Sanft, außer instant. */
  zoomAt(dir: 1 | -1, sx = this.sw / 2, sy = this.sh / 2): boolean {
    return this.zoomTo(this.zoomIndex + dir, sx, sy);
  }

  /** Auf Stufe index (in ZOOMS) zoomen, Punkt (sx, sy) bleibt stehen. */
  zoomTo(index: number, sx = this.sw / 2, sy = this.sh / 2): boolean {
    const next = Math.max(0, Math.min(ZOOMS.length - 1, Math.round(index)));
    if (next === this.zoomIndex) return false;
    const [wx, wy] = this.toWorldPx(sx, sy);
    this.zoomIndex = next;
    if (this.instant || ZOOM_MS <= 0) {
      this.anim = null;
      this.apply(this.targetZoom, wx, wy, sx, sy);
    } else this.anim = { from: this.z, t: 0, wx, wy, sx, sy };
    return true;
  }

  /** Übergang fortschreiben (dt in Sekunden). true, solange sich der Zoom geändert hat. */
  step(dt: number): boolean {
    const a = this.anim;
    if (!a) return false;
    a.t += Math.max(0, dt) * 1000;
    const k = Math.min(1, a.t / ZOOM_MS);
    const e = 1 - (1 - k) ** 3;
    const z = k >= 1 ? this.targetZoom : Math.exp(Math.log(a.from) + (Math.log(this.targetZoom) - Math.log(a.from)) * e);
    this.apply(z, a.wx, a.wy, a.sx, a.sy);
    if (k >= 1) this.anim = null;
    return true;
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.x += dxScreen / this.zoom;
    this.y += dyScreen / this.zoom;
    this.clamp();
    this.reanchor();
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

  private apply(z: number, wx: number, wy: number, sx: number, sy: number): void {
    this.z = z;
    this.x = wx - (sx - this.sw / 2) / z;
    this.y = wy - (sy - this.sh / 2) / z;
    this.clamp();
  }

  /** Kamera wurde verschoben: Der laufende Übergang hält ab jetzt den neuen Punkt fest. */
  private reanchor(): void {
    const a = this.anim;
    if (!a) return;
    [a.wx, a.wy] = this.toWorldPx(a.sx, a.sy);
  }
}
