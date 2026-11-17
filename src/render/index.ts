/**
 * Darstellung: setzt Gelände, Objekte und Hilfsebenen zusammen, führt Kamera, Drehung (mit kurzem Überblenden) und Zoom.
 * Liest den Simulationszustand nur. Bildschirmkoordinaten sind CSS-Pixel relativ zum Canvas.
 */
import { AlphaFilter, Container, Graphics, RenderTexture, Sprite, type Application } from "pixi.js";
import { TICKS_PER_SECOND, UNITS } from "../data";
import type { Rot } from "../sim/geom";
import { LAYER_Z } from "../sim/nav";
import type { SimState } from "../sim/types";
import { setSmoothing, type Sheets } from "./assets";
import { Camera } from "./camera";
import { screenToWorld, worldToScreen } from "./iso";
import { Overlays, WALL_GHOST_ALPHA, type Marker, type Preview } from "./overlays";
import { ObjectLayer, type Hit } from "./scene";
import { DustLayer } from "./dust";
import { SmokeLayer } from "./smoke";
import { TerrainLayer } from "./terrain";

export type { Preview, Marker, Hit };
export { Camera, ZOOMS } from "./camera";
export { LAYER_Z };

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

const FADE_MS = 150;

export class GameRenderer {
  readonly camera: Camera;
  readonly world = new Container();
  private terrain: TerrainLayer;
  private objects: ObjectLayer;
  private overlays: Overlays;
  private smoke = new SmokeLayer();
  private dust = new DustLayer();
  private screen = new Container();
  private rect = new Graphics();
  private fade: Sprite | null = null;
  private fadeT = 0;
  private builtR: Rot | -1 = -1;
  private smooth = false;
  stats = { items: 0, sprites: 0, pairs: 0, chunks: 0, silhouettes: 0, smoke: 0 };

  constructor(private app: Application, readonly sheets: Sheets, state: SimState) {
    this.camera = new Camera(state.w, state.h);
    this.terrain = new TerrainLayer(app.renderer, sheets.terrain);
    this.objects = new ObjectLayer(sheets.buildings, sheets.figures);
    this.overlays = new Overlays(sheets.buildings);
    this.world.addChild(this.terrain.container, this.overlays.ground, this.objects.container, this.objects.ghostGroup, this.smoke.container, this.dust.container, this.objects.silhouettes, this.overlays.top);
    // Mauerzug-Vorschau als Ganzes halbtransparent (einzeln transparente Stücke würden sich überlagern)
    this.objects.ghostGroup.filters = [new AlphaFilter({ alpha: WALL_GHOST_ALPHA })];
    this.screen.addChild(this.rect);
    app.stage.addChild(this.world, this.screen);
    app.stage.eventMode = "none";
    this.camera.sw = app.screen.width;
    this.camera.sh = app.screen.height;
    // Teamfarbe der Gegner und Silhouetten vorab im Leerlauf (kein Hänger beim ersten Überfall)
    sheets.figures?.prewarm(Object.values(UNITS).map((u) => u.sprite));
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

  /** Gelände neu zeichnen (z. B. nachdem Übergangsmasken gesetzt wurden). */
  invalidateTerrain(): void { this.terrain.invalidate(); }

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
    this.world.position.set(...this.origin());
    const view = cam.viewRect(48);
    this.terrain.update(state, view, time);
    const ghosts = this.overlays.ghosts(state, input.preview);
    this.objects.update(state, cam.r, alpha, cam.viewRect(160), {
      selectedUnits: input.selectedUnits, danger: input.danger, highlight: input.highlight, ghosts,
    });
    // Rauch läuft in Spielzeit (steht in der Pause, doppelt so schnell bei 2×)
    this.smoke.update(this.objects.emitters, (state.tick + alpha) / TICKS_PER_SECOND, cam.r);
    // Baustaub, Späne und Abrissstaub (Zeiten kommen aus der Objektebene)
    this.dust.update(this.objects.strikes, this.objects.rubble);
    this.overlays.update(state, cam.r, time, alpha, {
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
    const os = this.objects.stats;
    this.stats.items = os.items;
    this.stats.sprites = os.sprites;
    this.stats.pairs = os.pairs;
    this.stats.silhouettes = os.silhouettes;
    this.stats.smoke = this.smoke.count;
    this.stats.chunks = this.terrain.visibleChunks();
  }

  /** Bildschirm → Welt-Pixel (Zoom 1). */
  worldPx(sx: number, sy: number): [number, number] {
    const [ox, oy] = this.origin();
    const z = this.camera.zoom;
    return [(sx - ox) / z, (sy - oy) / z];
  }

  /** Bildschirmlage des Welt-Ursprungs (wie world.position, aber immer aus der aktuellen Kamera, auch vor dem nächsten Bild). */
  private origin(): [number, number] {
    const c = this.camera, z = c.zoom;
    return [Math.round(c.sw / 2 - c.x * z), Math.round(c.sh / 2 - c.y * z)];
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

  /** Oberstes Objekt (Figur oder Gebäude) unter der Maus, pixelgenau. Der Treffer gilt nur bis zum nächsten Bild. */
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
    const zz = this.camera.zoom, [ox, oy] = this.origin();
    return [X * zz + ox, Y * zz + oy];
  }

  /**
   * Sichtbarer Bodenbereich: die vier Bildschirmecken auf Höhe 0 in Welt-Tiles, im Uhrzeigersinn ab oben links.
   * Bildmitte in Welt-Tiles dazu (für die Übersichtskarte).
   */
  visibleGround(): { x: number; y: number; corners: [number, number][] } {
    const { sw, sh } = this.camera;
    const corners: [number, number][] = [this.worldAt(0, 0), this.worldAt(sw, 0), this.worldAt(sw, sh), this.worldAt(0, sh)];
    const [x, y] = this.worldAt(sw / 2, sh / 2);
    return { x, y, corners };
  }
}
