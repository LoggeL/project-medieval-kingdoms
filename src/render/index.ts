/**
 * Darstellung: setzt Gelände, Objekte und Hilfsebenen zusammen, führt Kamera, Drehung (mit kurzem Überblenden) und Zoom.
 * Liest den Simulationszustand nur. Bildschirmkoordinaten sind CSS-Pixel relativ zum Canvas.
 */
import { Container, Graphics, RenderTexture, Sprite, type Application } from "pixi.js";
import type { Rot } from "../sim/geom";
import type { SimState } from "../sim/types";
import { setSmoothing, type Sheets } from "./assets";
import { Camera } from "./camera";
import { screenToWorld, worldToScreen } from "./iso";
import { Overlays, type Marker, type Preview } from "./overlays";
import { ObjectLayer, type Hit } from "./scene";
import { TerrainLayer } from "./terrain";

export type { Preview, Marker, Hit };
export { Camera, ZOOMS } from "./camera";

export interface FrameInput {
  selectedUnits: ReadonlySet<number>;
  selectedBuilding: number | null;
  danger: number | null;
  highlight: number | null;
  preview: Preview | null;
  markers: Marker[];
  /** Auswahlrahmen in Bildschirmkoordinaten. */
  dragRect: { x0: number; y0: number; x1: number; y1: number } | null;
}

/** Höhenstufe einer Laufebene. */
export const LAYER_Z = [0, 3, 5];

const FADE_MS = 150;

export class GameRenderer {
  readonly camera: Camera;
  readonly world = new Container();
  private terrain: TerrainLayer;
  private objects: ObjectLayer;
  private overlays: Overlays;
  private screen = new Container();
  private rect = new Graphics();
  private fade: Sprite | null = null;
  private fadeT = 0;
  private builtR: Rot | -1 = -1;
  private smooth = false;
  stats = { items: 0, sprites: 0, pairs: 0, chunks: 0 };

  constructor(private app: Application, readonly sheets: Sheets, state: SimState) {
    this.camera = new Camera(state.w, state.h);
    this.terrain = new TerrainLayer(app.renderer, sheets.terrain);
    this.objects = new ObjectLayer(sheets.buildings, sheets.figures);
    this.overlays = new Overlays(sheets.buildings);
    this.world.addChild(this.terrain.container, this.overlays.ground, this.objects.container, this.overlays.ghost, this.overlays.top);
    this.screen.addChild(this.rect);
    app.stage.addChild(this.world, this.screen);
    app.stage.eventMode = "none";
    this.camera.sw = app.screen.width;
    this.camera.sh = app.screen.height;
  }

  get r(): Rot { return this.camera.r; }

  /** Drehen mit kurzem Überblenden; Fokus bleibt auf demselben Welt-Tile. */
  rotate(dir: 1 | -1): void {
    this.snapshot();
    this.camera.rotate(dir);
  }

  zoom(dir: 1 | -1, sx?: number, sy?: number): boolean {
    return this.camera.zoomAt(dir, sx, sy);
  }

  private snapshot(): void {
    const { app } = this;
    if (this.fade) { this.fade.texture.destroy(true); this.fade.destroy(); this.fade = null; }
    const rt = RenderTexture.create({ width: app.screen.width, height: app.screen.height, resolution: app.renderer.resolution });
    app.renderer.render({ container: app.stage, target: rt });
    this.fade = new Sprite(rt);
    this.screen.addChild(this.fade);
    this.fadeT = performance.now();
  }

  /** Ein Bild zeichnen. alpha = Anteil zwischen vorigem und aktuellem Tick. */
  frame(state: SimState, alpha: number, time: number, input: FrameInput): void {
    const cam = this.camera;
    cam.sw = this.app.screen.width;
    cam.sh = this.app.screen.height;
    if (cam.W !== state.w || cam.H !== state.h) { cam.W = state.w; cam.H = state.h; cam.clamp(); this.builtR = -1; }
    if (this.builtR !== cam.r) { this.terrain.rebuild(state, cam.r); this.builtR = cam.r; }
    const smooth = cam.zoom < 1;
    if (smooth !== this.smooth) { this.smooth = smooth; setSmoothing(smooth); this.terrain.setSmoothing(smooth); }

    // Welt-Container: Bildmitte auf ganze Bildschirmpixel
    const z = cam.zoom;
    this.world.scale.set(z);
    this.world.position.set(Math.round(cam.sw / 2 - cam.x * z), Math.round(cam.sh / 2 - cam.y * z));
    const view = cam.viewRect(48);
    this.terrain.update(state, view, time);
    this.objects.update(state, cam.r, alpha, cam.viewRect(160), {
      selectedUnits: input.selectedUnits, danger: input.danger, highlight: input.highlight,
    });
    this.overlays.update(state, cam.r, time, {
      preview: input.preview, selectedBuilding: input.selectedBuilding, markers: input.markers, units: this.objects.units,
    });

    // Auswahlrahmen
    this.rect.clear();
    const d = input.dragRect;
    if (d) {
      const x0 = Math.min(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      this.rect.rect(x0, y0, w, h).fill({ color: 0xf2e6a0, alpha: 0.08 }).stroke({ width: 1, color: 0xf2e6a0, alpha: 0.9 });
    }
    // Überblenden nach dem Drehen
    if (this.fade) {
      const k = (performance.now() - this.fadeT) / FADE_MS;
      if (k >= 1) { this.fade.texture.destroy(true); this.fade.destroy(); this.fade = null; }
      else this.fade.alpha = 1 - k;
    }
    this.stats.items = this.objects.stats.items;
    this.stats.sprites = this.objects.stats.sprites;
    this.stats.pairs = this.objects.stats.pairs;
    this.stats.chunks = this.terrain.visibleChunks();
  }

  /** Bildschirm → Welt-Pixel (Zoom 1). */
  worldPx(sx: number, sy: number): [number, number] {
    // dieselbe Rundung wie world.position
    const z = this.camera.zoom;
    return [(sx - this.world.position.x) / z, (sy - this.world.position.y) / z];
  }

  /** Bildschirm → Weltpunkt auf Höhe z. */
  worldAt(sx: number, sy: number, z = 0): [number, number] {
    const [X, Y] = this.worldPx(sx, sy);
    return screenToWorld(X, Y, z, this.camera.r, this.camera.W, this.camera.H);
  }

  /**
   * Ziel-Tile unter der Maus. Höhere Laufebenen zuerst (Turm, Wehrgang): trifft der Strahl dort einen Tile mit passender
   * Laufebene, gewinnt er, sonst der Boden-Tile.
   */
  tileAt(sx: number, sy: number, walkLayerAt?: (x: number, y: number) => number): { x: number; y: number; layer: number; z: number } {
    if (walkLayerAt) for (const layer of [2, 1]) {
      const z = LAYER_Z[layer];
      const [wx, wy] = this.worldAt(sx, sy, z);
      const x = Math.floor(wx), y = Math.floor(wy);
      if (x >= 0 && y >= 0 && x < this.camera.W && y < this.camera.H && walkLayerAt(x, y) === layer) return { x, y, layer, z };
    }
    const [wx, wy] = this.worldAt(sx, sy, 0);
    return { x: Math.floor(wx), y: Math.floor(wy), layer: 0, z: 0 };
  }

  /** Oberstes Objekt (Figur oder Gebäude) unter der Maus, pixelgenau. */
  pick(sx: number, sy: number, filter?: (h: Hit) => boolean): Hit | null {
    const [X, Y] = this.worldPx(sx, sy);
    return this.objects.pick(X, Y, filter);
  }

  /** Figuren (dieses Bildes), deren Fußpunkt im Bildschirmrechteck liegt. */
  unitsInRect(x0: number, y0: number, x1: number, y1: number, team: number): number[] {
    const [ax, ay] = this.worldPx(Math.min(x0, x1), Math.min(y0, y1));
    const [bx, by] = this.worldPx(Math.max(x0, x1), Math.max(y0, y1));
    return this.objects.units.filter((u) => u.team === team && u.x >= ax && u.x <= bx && u.y - 14 <= by && u.y >= ay).map((u) => u.id);
  }

  /** Bildschirmposition (CSS-Pixel) eines Weltpunkts, z. B. für Hinweise. */
  screenOf(wx: number, wy: number, z = 0): [number, number] {
    const [X, Y] = worldToScreen(wx, wy, z, this.camera.r, this.camera.W, this.camera.H);
    const zz = this.camera.zoom;
    return [X * zz + this.world.position.x, Y * zz + this.world.position.y];
  }
}

