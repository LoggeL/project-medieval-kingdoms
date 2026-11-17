/**
 * Gelände: flache 64 × 32-Kacheln, in Abschnitte (16 × 16 Tiles der Ansicht) als RenderTexture vorgerendert.
 * Bei Drehung werden alle Abschnitte neu aufgebaut, bei Geländeänderung nur die betroffenen. Wasser wird zusätzlich
 * als animierte Ebene über den sichtbaren Wasser-Tiles gezeichnet, wenn das Blatt mehrere Bilder hat.
 * Übergänge (blend.ts): Beim Vorrendern liegt über jeder Kachel die Kachel des Nachbarn mit höherem Vorrang, maskiert mit
 * der Kantenmaske aus blend.png. Ufer (Land über Wasser) liegen in einer eigenen Abschnittsebene über der Wasser-Animation.
 * Ohne blend.png bleibt alles wie bisher (harte Kanten).
 * Ohne assets/terrain/<stil>/sheet.json: eingefärbte Rauten mit leichtem Rauschen (Ersatz, wird automatisch ersetzt).
 */
import { Container, RenderTexture, Sprite, type Renderer, type Texture } from "pixi.js";
import type { TerrainKey } from "../data";
import type { Rot } from "../sim/geom";
import type { SimState } from "../sim/types";
import { textureFromCanvas, type TerrainSheet } from "./assets";
import { blendPlan, maskVariant } from "./blend";
import { HALF_H, HALF_W, fromView, viewSize, viewToScreen } from "./iso";

const CH = 16;
const TERRAIN_KEYS: TerrainKey[] = ["gras", "wiese", "waldboden", "erde", "fels", "wasser"];

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
  const rand = rng(1 + TERRAIN_KEYS.indexOf(key) * 97 + variant * 13);
  g.fillStyle = baseCol;
  for (let y = 0; y < 32; y++) {
    const half = (y < 16 ? y + 1 : 32 - y) * 2;
    g.fillRect(32 - half, y, half * 2, 1);
  }
  const inside = (x: number, y: number) => Math.abs(x - 31.5) / 32 + Math.abs(y - 15.5) / 16 <= 0.94;
  const n = key === "wasser" ? 14 : 46;
  for (let i = 0; i < n; i++) {
    let x = Math.floor(rand() * 64);
    const y = Math.floor(rand() * 32);
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

interface Layer { sprite: Sprite; rt: RenderTexture }
interface Chunk { cu: number; cv: number; base: Layer; shore: Layer | null; dirty: boolean }

export class TerrainLayer {
  readonly container = new Container();
  private water = new Container();
  private shoreLayer = new Container();
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
    this.container.sortableChildren = true;
    this.water.zIndex = 1;
    this.shoreLayer.zIndex = 2;
    this.container.addChild(this.water, this.shoreLayer);
  }

  private tex(key: TerrainKey, variant: number, frame = 0): Texture {
    const t = this.sheet?.texture(key, variant, frame);
    if (t) return t;
    let list = this.fallback.get(key);
    const frames = key === "wasser" ? 4 : 1;
    if (!list) {
      list = [];
      for (let v = 0; v < 4; v++) for (let f = 0; f < frames; f++) list.push(textureFromCanvas(fallbackTile(key, v, f)));
      this.fallback.set(key, list);
    }
    return list[(variant % 4) * frames + (frame % frames)];
  }

  private waterFrames(): number {
    if (this.sheet) return this.sheet.has("wasser") ? this.sheet.frames("wasser") : 4;
    return 4;
  }

  private newLayer(cu: number, cv: number, parent: Container, z: number): Layer {
    const rt = RenderTexture.create({ width: CH * 2 * HALF_W, height: CH * 2 * HALF_H, resolution: 1, scaleMode: this.smooth ? "linear" : "nearest" });
    const sprite = new Sprite(rt);
    // Ursprung des Abschnitts: Bildpunkt der Ecke (u0, v0) liegt oben in der Mitte
    const [ox, oy] = viewToScreen(cu * CH, cv * CH);
    sprite.position.set(ox - CH * HALF_W, oy);
    sprite.zIndex = z;
    parent.addChild(sprite);
    return { sprite, rt };
  }

  private dropLayer(l: Layer): void { l.sprite.destroy(); l.rt.destroy(true); }

  /** Abschnitte für Drehung r aufbauen (alle). */
  rebuild(state: SimState, r: Rot): void {
    this.r = r; this.W = state.w; this.H = state.h;
    for (const c of this.chunks) { this.dropLayer(c.base); if (c.shore) this.dropLayer(c.shore); }
    this.chunks = [];
    const [vu, vv] = viewSize(r, state.w, state.h);
    for (let cv = 0; cv < Math.ceil(vv / CH); cv++) for (let cu = 0; cu < Math.ceil(vu / CH); cu++) {
      this.chunks.push({ cu, cv, base: this.newLayer(cu, cv, this.container, 0), shore: null, dirty: true });
    }
    this.signature = new Uint32Array(state.tiles.length);
    for (let i = 0; i < state.tiles.length; i++) this.signature[i] = this.sig(state, i);
  }

  /** Alle Abschnitte neu zeichnen (z. B. nach neuen Übergangsmasken). */
  invalidate(): void { for (const c of this.chunks) c.dirty = true; }

  private sig(state: SimState, i: number): number {
    const t = state.tiles[i];
    return (TERRAIN_KEYS.indexOf(t.terrain) + 1) * 256 + (t.variant & 255);
  }

  /** Geänderte Tiles erkennen und betroffene Abschnitte markieren (mit Nachbarn, wegen der Übergänge). */
  private detectChanges(state: SimState): void {
    const sig = this.signature;
    for (let i = 0; i < sig.length; i++) {
      const s = this.sig(state, i);
      if (s === sig[i]) continue;
      sig[i] = s;
      const x = i % state.w, y = Math.floor(i / state.w);
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const [u, v] = this.tileView(x + dx, y + dy);
        const ch = this.chunks.find((c) => c.cu === Math.floor(u / CH) && c.cv === Math.floor(v / CH));
        if (ch) ch.dirty = true;
      }
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

  /** Welt-Tile eines Ansicht-Tiles. */
  private worldTile(state: SimState, iu: number, iv: number): [number, number] {
    const [wx, wy] = fromView(iu + 0.5, iv + 0.5, this.r, state.w, state.h);
    return [Math.floor(wx), Math.floor(wy)];
  }

  private renderChunk(state: SimState, ch: Chunk): void {
    const [vu, vv] = viewSize(this.r, state.w, state.h);
    const sheet = this.sheet;
    const nMask = sheet?.blendVariants ?? 0;
    const at = (u: number, v: number): TerrainKey | null => {
      if (u < 0 || v < 0 || u >= vu || v >= vv) return null;
      const [x, y] = this.worldTile(state, u, v);
      return state.tiles[y * state.w + x]?.terrain ?? null;
    };
    const a = sheet?.anchor ?? [32, 16];
    const ox = ch.base.sprite.x, oy = ch.base.sprite.y;
    let n = 0;
    const put = (tex: Texture, X: number, Y: number) => {
      let sp = this.scratchSprites[n];
      if (!sp) { sp = new Sprite(); this.scratchSprites.push(sp); this.scratch.addChild(sp); }
      sp.visible = true;
      sp.texture = tex;
      sp.position.set(Math.round(X - a[0] - ox), Math.round(Y - a[1] - oy));
      n++;
    };
    const shore: { tex: Texture; X: number; Y: number }[] = [];
    for (let iv = ch.cv * CH; iv < Math.min(vv, ch.cv * CH + CH); iv++) for (let iu = ch.cu * CH; iu < Math.min(vu, ch.cu * CH + CH); iu++) {
      const [x, y] = this.worldTile(state, iu, iv);
      const tile = state.tiles[y * state.w + x];
      if (!tile) continue;
      const [X, Y] = viewToScreen(iu + 0.5, iv + 0.5);
      put(this.tex(tile.terrain, tile.variant), X, Y);
      if (!nMask || !sheet) continue;
      for (const step of blendPlan(at, iu, iv)) {
        // Maske hängt am Welt-Tile, damit sie sich beim Drehen nicht ändert
        const tex = sheet.blended(step.terrain, tile.variant, step.edge, maskVariant(x, y, step.edge, nMask));
        if (!tex) continue;
        if (step.shore) shore.push({ tex, X, Y }); else put(tex, X, Y);
      }
    }
    for (let i = n; i < this.scratchSprites.length; i++) this.scratchSprites[i].visible = false;
    this.renderer.render({ container: this.scratch, target: ch.base.rt, clear: true, clearColor: [0, 0, 0, 0] });
    // Ufer: eigene Ebene über der Wasser-Animation
    if (shore.length) {
      if (!ch.shore) ch.shore = this.newLayer(ch.cu, ch.cv, this.shoreLayer, 0);
      n = 0;
      for (const s of shore) put(s.tex, s.X, s.Y);
      for (let i = n; i < this.scratchSprites.length; i++) this.scratchSprites[i].visible = false;
      this.renderer.render({ container: this.scratch, target: ch.shore.rt, clear: true, clearColor: [0, 0, 0, 0] });
    } else if (ch.shore) { this.dropLayer(ch.shore); ch.shore = null; }
    ch.dirty = false;
  }

  setSmoothing(smooth: boolean): void {
    this.smooth = smooth;
    for (const c of this.chunks) {
      c.base.rt.source.scaleMode = smooth ? "linear" : "nearest";
      if (c.shore) c.shore.rt.source.scaleMode = smooth ? "linear" : "nearest";
    }
  }

  /** Jedes Bild: Änderungen nachziehen, Abschnitte cullen, Wasser animieren. */
  update(state: SimState, view: { x0: number; y0: number; x1: number; y1: number }, time: number): void {
    this.detectChanges(state);
    let rebuilt = 0;
    for (const ch of this.chunks) {
      const s = ch.base.sprite;
      const vis = s.x < view.x1 && s.x + CH * 2 * HALF_W > view.x0 && s.y < view.y1 && s.y + CH * 2 * HALF_H > view.y0;
      s.visible = vis;
      if (ch.shore) ch.shore.sprite.visible = vis;
      if (ch.dirty && (vis || rebuilt < 1) && rebuilt < 8) { this.renderChunk(state, ch); rebuilt++; }
    }
    this.updateWater(state, view, time);
  }

  private updateWater(state: SimState, view: { x0: number; y0: number; x1: number; y1: number }, time: number): void {
    const frames = this.waterFrames();
    let n = 0;
    if (frames > 1) {
      const frame = Math.floor(time * (this.sheet?.fps ?? 4)) % frames;
      // sichtbare Ansicht-Tiles grob aus dem Bildrechteck
      const [vu, vv] = viewSize(this.r, state.w, state.h);
      const a = this.sheet?.anchor ?? [32, 16];
      const toUV = (X: number, Y: number) => [(X / HALF_W + Y / HALF_H) / 2, (Y / HALF_H - X / HALF_W) / 2];
      const c = [toUV(view.x0, view.y0), toUV(view.x1, view.y0), toUV(view.x0, view.y1), toUV(view.x1, view.y1)];
      const u0 = Math.max(0, Math.floor(Math.min(c[0][0], c[1][0], c[2][0], c[3][0])) - 1);
      const u1 = Math.min(vu - 1, Math.ceil(Math.max(c[0][0], c[1][0], c[2][0], c[3][0])) + 1);
      const v0 = Math.max(0, Math.floor(Math.min(c[0][1], c[1][1], c[2][1], c[3][1])) - 1);
      const v1 = Math.min(vv - 1, Math.ceil(Math.max(c[0][1], c[1][1], c[2][1], c[3][1])) + 1);
      for (let iv = v0; iv <= v1; iv++) for (let iu = u0; iu <= u1; iu++) {
        const [x, y] = this.worldTile(state, iu, iv);
        const tile = state.tiles[y * state.w + x];
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
  visibleChunks(): number {
    let n = 0;
    for (const c of this.chunks) if (c.base.sprite.visible) n++;
    return n;
  }
}
