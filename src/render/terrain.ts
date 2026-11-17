/**
 * Gelände: flache 64 × 32-Kacheln, in Abschnitte (16 × 16 Tiles der Ansicht) als RenderTexture vorgerendert.
 * Bei Drehung werden alle Abschnitte neu aufgebaut, bei Geländeänderung nur die betroffenen. Wasser wird zusätzlich
 * als animierte Ebene über den sichtbaren Wasser-Tiles gezeichnet, wenn das Blatt mehrere Bilder hat.
 * Ohne assets/terrain/<stil>/sheet.json: eingefärbte Rauten mit leichtem Rauschen (Ersatz, wird automatisch ersetzt).
 */
import { Container, RenderTexture, Sprite, type Renderer, type Texture } from "pixi.js";
import type { TerrainKey } from "../data";
import type { Rot } from "../sim/geom";
import type { SimState } from "../sim/types";
import { textureFromCanvas, type TerrainSheet } from "./assets";
import { HALF_H, HALF_W, fromView, viewSize, viewToScreen } from "./iso";

const CH = 16;
const TERRAIN_KEYS: TerrainKey[] = ["gras", "wiese", "waldboden", "erde", "fels", "wasser"];
const WATER_FPS = 4;

/** Ersatzfarben (Grundton, Akzent) je Gelände. */
const FALLBACK: Record<TerrainKey, [string, string]> = {
  gras: ["#5d8a3a", "#6f9c44"],
  wiese: ["#66923f", "#d9cf78"],
  waldboden: ["#4b6630", "#6b5a32"],
  erde: ["#8a6a42", "#6f5434"],
  fels: ["#868174", "#a39d8e"],
  wasser: ["#3b6d96", "#6d9cc0"],
};

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Pixelgenaue Raute 64 × 32 (wie diamond() in bauten.js) mit Rauschen. */
function fallbackTile(key: TerrainKey, variant: number, frame: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 32;
  const g = c.getContext("2d")!;
  const [baseCol, accent] = FALLBACK[key];
  const rand = rng(1 + TERRAIN_KEYS.indexOf(key) * 97 + variant * 13 + (key === "wasser" ? 0 : 0));
  g.fillStyle = baseCol;
  for (let y = 0; y < 32; y++) {
    const half = (y < 16 ? y + 1 : 32 - y) * 2;
    g.fillRect(32 - half, y, half * 2, 1);
  }
  const inside = (x: number, y: number) => Math.abs(x - 31.5) / 32 + Math.abs(y - 15.5) / 16 <= 0.94;
  const n = key === "wasser" ? 14 : 46;
  for (let i = 0; i < n; i++) {
    let x = Math.floor(rand() * 64), y = Math.floor(rand() * 32);
    if (key === "wasser") x = (x + frame * 6) % 64;
    if (!inside(x, y)) continue;
    const t = rand();
    if (key === "wasser") {
      g.fillStyle = accent;
      g.fillRect(x, y, 3 + Math.floor(t * 4), 1);
      continue;
    }
    if (key === "wiese" && t < 0.5 && rand() < 0.75) continue; // nur wenige Blüten
    g.fillStyle = t < 0.5 ? accent : t < 0.8 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.10)";
    g.fillRect(x, y, key === "fels" && t < 0.3 ? 2 : 1, 1);
    if (key === "gras" || key === "waldboden") { g.fillRect(x, y - 1, 1, 1); }
  }
  return c;
}

interface Chunk { cu: number; cv: number; sprite: Sprite; rt: RenderTexture; dirty: boolean }

export class TerrainLayer {
  readonly container = new Container();
  private water = new Container();
  private chunks: Chunk[] = [];
  private fallback = new Map<string, Texture[]>();
  private signature: Uint32Array = new Uint32Array(0);
  private r: Rot = 0;
  private W = 0;
  private H = 0;
  private scratch = new Container();
  private scratchSprites: Sprite[] = [];
  private waterSprites: Sprite[] = [];
  private smooth = false;

  constructor(private renderer: Renderer, private sheet: TerrainSheet | null) {
    this.container.addChild(this.water);
    this.water.zIndex = 1;
    this.container.sortableChildren = true;
  }

  /** Neues Geländeblatt (z. B. nachgeladen) übernehmen. */
  setSheet(sheet: TerrainSheet | null): void {
    this.sheet = sheet;
    for (const c of this.chunks) c.dirty = true;
  }

  private tex(key: TerrainKey, variant: number, frame = 0): Texture {
    const t = this.sheet?.texture(key, variant, frame);
    if (t) return t;
    const id = key;
    let list = this.fallback.get(id);
    if (!list) {
      list = [];
      const frames = key === "wasser" ? 4 : 1;
      for (let v = 0; v < 4; v++) for (let f = 0; f < frames; f++) list.push(textureFromCanvas(fallbackTile(key, v, f)));
      this.fallback.set(id, list);
    }
    const frames = key === "wasser" ? 4 : 1;
    return list[(variant % 4) * frames + (frame % frames)];
  }

  private waterFrames(): number {
    if (this.sheet) return this.sheet.has("wasser") ? this.sheet.frames("wasser") : 4;
    return 4;
  }

  /** Abschnitte für Drehung r aufbauen (alle). */
  rebuild(state: SimState, r: Rot): void {
    this.r = r; this.W = state.w; this.H = state.h;
    for (const c of this.chunks) { c.sprite.destroy(); c.rt.destroy(true); }
    this.chunks = [];
    const [vu, vv] = viewSize(r, state.w, state.h);
    for (let cv = 0; cv < Math.ceil(vv / CH); cv++) for (let cu = 0; cu < Math.ceil(vu / CH); cu++) {
      const rt = RenderTexture.create({ width: CH * 2 * HALF_W, height: CH * 2 * HALF_H, resolution: 1, scaleMode: this.smooth ? "linear" : "nearest" });
      const sprite = new Sprite(rt);
      // Ursprung des Abschnitts: Bildpunkt der Ecke (u0, v0) liegt oben in der Mitte
      const [ox, oy] = viewToScreen(cu * CH, cv * CH);
      sprite.position.set(ox - CH * HALF_W, oy);
      this.container.addChild(sprite);
      this.chunks.push({ cu, cv, sprite, rt, dirty: true });
    }
    this.signature = new Uint32Array(state.tiles.length);
    for (let i = 0; i < state.tiles.length; i++) this.signature[i] = this.sig(state, i);
  }

  private sig(state: SimState, i: number): number {
    const t = state.tiles[i];
    return (TERRAIN_KEYS.indexOf(t.terrain) + 1) * 256 + (t.variant & 255);
  }

  /** Geänderte Tiles erkennen und betroffene Abschnitte markieren. */
  private detectChanges(state: SimState): void {
    const sig = this.signature;
    for (let i = 0; i < sig.length; i++) {
      const s = this.sig(state, i);
      if (s === sig[i]) continue;
      sig[i] = s;
      const x = i % state.w, y = Math.floor(i / state.w);
      const [u, v] = this.tileView(x, y);
      const ch = this.chunks.find((c) => c.cu === Math.floor(u / CH) && c.cv === Math.floor(v / CH));
      if (ch) ch.dirty = true;
    }
  }

  /** Ansicht-Tile (ganzzahlig) eines Welt-Tiles. */
  private tileView(x: number, y: number): [number, number] {
    // Tile-Mitte drehen, dann abrunden
    const r = this.r, W = this.W, H = this.H;
    const cx = x + 0.5, cy = y + 0.5;
    let u = cx, v = cy;
    if (r === 1) { u = H - cy; v = cx; } else if (r === 2) { u = W - cx; v = H - cy; } else if (r === 3) { u = cy; v = W - cx; }
    return [Math.floor(u), Math.floor(v)];
  }

  private renderChunk(state: SimState, ch: Chunk): void {
    const [vu, vv] = viewSize(this.r, state.w, state.h);
    let n = 0;
    const [ox, oy] = [ch.sprite.x, ch.sprite.y];
    for (let iv = ch.cv * CH; iv < Math.min(vv, ch.cv * CH + CH); iv++) for (let iu = ch.cu * CH; iu < Math.min(vu, ch.cu * CH + CH); iu++) {
      const [wx, wy] = fromView(iu + 0.5, iv + 0.5, this.r, state.w, state.h);
      const x = Math.floor(wx), y = Math.floor(wy);
      const tile = state.tiles[y * state.w + x];
      if (!tile) continue;
      let sp = this.scratchSprites[n];
      if (!sp) { sp = new Sprite(); this.scratchSprites.push(sp); this.scratch.addChild(sp); }
      sp.visible = true;
      sp.texture = this.tex(tile.terrain, tile.variant);
      const [X, Y] = viewToScreen(iu + 0.5, iv + 0.5);
      const a = this.sheet?.anchor ?? [32, 16];
      sp.position.set(Math.round(X - a[0] - ox), Math.round(Y - a[1] - oy));
      n++;
    }
    for (let i = n; i < this.scratchSprites.length; i++) this.scratchSprites[i].visible = false;
    this.renderer.render({ container: this.scratch, target: ch.rt, clear: true, clearColor: [0, 0, 0, 0] });
    ch.dirty = false;
  }

  setSmoothing(smooth: boolean): void {
    this.smooth = smooth;
    for (const c of this.chunks) c.rt.source.scaleMode = smooth ? "linear" : "nearest";
  }

  /** Jedes Bild: Änderungen nachziehen, Abschnitte cullen, Wasser animieren. */
  update(state: SimState, view: { x0: number; y0: number; x1: number; y1: number }, time: number): void {
    this.detectChanges(state);
    let rebuilt = 0;
    for (const ch of this.chunks) {
      const s = ch.sprite;
      const vis = s.x < view.x1 && s.x + CH * 2 * HALF_W > view.x0 && s.y < view.y1 && s.y + CH * 2 * HALF_H > view.y0;
      s.visible = vis;
      if (ch.dirty && (vis || rebuilt < 1) && rebuilt < 8) { this.renderChunk(state, ch); rebuilt++; }
    }
    this.updateWater(state, view, time);
  }

  private updateWater(state: SimState, view: { x0: number; y0: number; x1: number; y1: number }, time: number): void {
    const frames = this.waterFrames();
    let n = 0;
    if (frames > 1) {
      const frame = Math.floor(time * WATER_FPS) % frames;
      // sichtbare Ansicht-Tiles grob aus dem Bildrechteck
      const [vu, vv] = viewSize(this.r, state.w, state.h);
      const a = this.sheet?.anchor ?? [32, 16];
      const uvs = [[view.x0, view.y0], [view.x1, view.y0], [view.x0, view.y1], [view.x1, view.y1]].map(([X, Y]) => [(X / HALF_W + Y / HALF_H) / 2, (Y / HALF_H - X / HALF_W) / 2]);
      const u0 = Math.max(0, Math.floor(Math.min(...uvs.map((p) => p[0]))) - 1), u1 = Math.min(vu - 1, Math.ceil(Math.max(...uvs.map((p) => p[0]))) + 1);
      const v0 = Math.max(0, Math.floor(Math.min(...uvs.map((p) => p[1]))) - 1), v1 = Math.min(vv - 1, Math.ceil(Math.max(...uvs.map((p) => p[1]))) + 1);
      for (let iv = v0; iv <= v1; iv++) for (let iu = u0; iu <= u1; iu++) {
        const [wx, wy] = fromView(iu + 0.5, iv + 0.5, this.r, state.w, state.h);
        const tile = state.tiles[Math.floor(wy) * state.w + Math.floor(wx)];
        if (!tile || tile.terrain !== "wasser") continue;
        const [X, Y] = viewToScreen(iu + 0.5, iv + 0.5);
        if (X + 32 < view.x0 || X - 32 > view.x1 || Y + 16 < view.y0 || Y - 16 > view.y1) continue;
        let sp = this.waterSprites[n];
        if (!sp) { sp = new Sprite(); this.waterSprites.push(sp); this.water.addChild(sp); }
        sp.visible = true;
        sp.texture = this.tex("wasser", tile.variant, frame + ((iu * 3 + iv * 5) % 2));
        sp.position.set(Math.round(X - a[0]), Math.round(Y - a[1]));
        n++;
      }
    }
    for (let i = n; i < this.waterSprites.length; i++) this.waterSprites[i].visible = false;
  }

  /** Anzahl sichtbarer Abschnitte (Debug). */
  visibleChunks(): number { return this.chunks.filter((c) => c.sprite.visible).length; }
}
