/**
 * Laden der Sprite-Blätter (Gebäude/Objekte, Figuren, Gelände) aus assets/<art>/<stil>/ und Aufbereitung als Pixi-Texturen.
 * Teamfarben per exaktem Farbtausch (team_swap), Alphadaten für pixelgenaue Treffer, Inhaltsrahmen je Zelle.
 * Fehlende Dateien oder Schlüssel sind kein Fehler: Die Darstellung fragt mit has()/fallback() nach und meldet einmal.
 */
import { Rectangle, Texture, CanvasSource } from "pixi.js";

export const STYLE = "vorgerendert";
const TEAM_NAMES = ["blau", "rot"] as const;

/** Meldet eine fehlende Grafik genau einmal in der Konsole. */
const warned = new Set<string>();
export function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn("[Grafik] " + msg);
}

function base(): string {
  const b = import.meta.env.BASE_URL || "./";
  return b.endsWith("/") ? b : b + "/";
}

async function loadJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(base() + path);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/html")) return null; // Vite liefert für fehlende Dateien index.html aus
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function loadImage(path: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = base() + path;
  });
}

function toCanvas(im: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = im.width; c.height = im.height;
  c.getContext("2d")!.drawImage(im, 0, 0);
  return c;
}

/** Exakter Farbtausch: Paare [r, g, b, r', g', b'] (wie paletteSwap in bauten.js). */
export function paletteSwap(src: HTMLCanvasElement, pairs: number[][] | undefined): HTMLCanvasElement {
  const c = toCanvas(src);
  if (!pairs || !pairs.length) return c;
  const g = c.getContext("2d")!;
  const id = g.getImageData(0, 0, c.width, c.height), p = id.data, map = new Map<number, number[]>();
  for (const q of pairs) map.set((q[0] << 16) | (q[1] << 8) | q[2], q.slice(3));
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    const to = map.get((p[i] << 16) | (p[i + 1] << 8) | p[i + 2]);
    if (to) { p[i] = to[0]; p[i + 1] = to[1]; p[i + 2] = to[2]; }
  }
  g.putImageData(id, 0, 0);
  return c;
}

const sources: CanvasSource[] = [];
function sourceOf(canvas: HTMLCanvasElement): CanvasSource {
  const s = new CanvasSource({ resource: canvas, scaleMode: "nearest", autoGenerateMipmaps: false });
  sources.push(s);
  return s;
}

/** Bei Übersichtszoom (< 1) weich verkleinern, sonst pixelscharf. */
export function setSmoothing(smooth: boolean): void {
  for (const s of sources) s.scaleMode = smooth ? "linear" : "nearest";
}

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** Bild mit Alphadaten für Treffer und Inhaltsrahmen. */
class Pixels {
  readonly data: Uint8ClampedArray;
  constructor(readonly canvas: HTMLCanvasElement) {
    this.data = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
  }
  alpha(x: number, y: number): number {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return 0;
    return this.data[(y * this.canvas.width + x) * 4 + 3];
  }
  bbox(x: number, y: number, w: number, h: number): Box | null {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    const W = this.canvas.width, d = this.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (d[((y + j) * W + x + i) * 4 + 3] > 8) {
        if (i < x0) x0 = i; if (i > x1) x1 = i;
        if (j < y0) y0 = j; if (j > y1) y1 = j;
      }
    }
    return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  }
}

// ---------------------------------------------------------------- Gebäude und Objekte

interface BuildingMetaUnit { key: string; name?: string; frames?: number; variants?: string[]; footprint?: [number, number]; posts?: number[][]; front?: boolean }
interface BuildingMeta { cell: [number, number]; anchor: [number, number]; units: BuildingMetaUnit[]; team_swap?: Record<string, number[][]> }

export interface BuildingSprite {
  key: string;
  frames: number;
  footprint: [number, number];
  /** Inhaltsrahmen je [Ansicht][Variante] in Zellkoordinaten. */
  bbox: (Box | null)[][];
  /** Alphadaten Team 0 (Körper). */
  pixels: Pixels;
  hasFront: boolean;
}

export class BuildingSheet {
  readonly cell: [number, number];
  readonly anchor: [number, number];
  private sprites = new Map<string, BuildingSprite>();
  private canvases = new Map<string, HTMLCanvasElement>();
  private tex = new Map<string, Texture[]>();
  private cropCache = new Map<string, Texture>();

  constructor(private meta: BuildingMeta) {
    this.cell = meta.cell;
    this.anchor = meta.anchor;
  }

  static async load(): Promise<BuildingSheet | null> {
    const meta = await loadJson<BuildingMeta>(`buildings/${STYLE}/sheet.json`);
    if (!meta) return null;
    const sheet = new BuildingSheet(meta);
    await Promise.all(meta.units.map(async (u) => {
      const [im, fr] = await Promise.all([
        loadImage(`buildings/${STYLE}/${u.key}.png`),
        u.front ? loadImage(`buildings/${STYLE}/${u.key}_front.png`) : Promise.resolve(null),
      ]);
      if (!im) { warnOnce(`Gebäudeblatt ${u.key}.png fehlt`); return; }
      const c = toCanvas(im);
      const px = new Pixels(c);
      const frames = Math.max(1, Math.min(u.frames ?? 1, Math.floor(c.width / meta.cell[0])));
      const bbox: (Box | null)[][] = [];
      for (let v = 0; v < 4; v++) {
        bbox.push([]);
        for (let f = 0; f < frames; f++) bbox[v].push(px.bbox(f * meta.cell[0], v * meta.cell[1], meta.cell[0], meta.cell[1]));
      }
      sheet.canvases.set(u.key + ":body", c);
      if (fr) sheet.canvases.set(u.key + ":front", toCanvas(fr));
      sheet.sprites.set(u.key, { key: u.key, frames, footprint: u.footprint ?? [1, 1], bbox, pixels: px, hasFront: !!fr });
    }));
    return sheet;
  }

  has(key: string): boolean { return this.sprites.has(key); }
  get(key: string): BuildingSprite | undefined { return this.sprites.get(key); }
  keys(): string[] { return [...this.sprites.keys()]; }

  /** Textur einer Zelle (Ansicht 0..3, Variante); part "front" = Vorderteil. */
  texture(key: string, view: number, frame: number, team = 0, part: "body" | "front" = "body"): Texture | null {
    const sp = this.sprites.get(key);
    if (!sp || (part === "front" && !sp.hasFront)) return null;
    const list = this.textures(key, team, part);
    if (!list) return null;
    const f = Math.max(0, Math.min(sp.frames - 1, frame));
    return list[(view & 3) * sp.frames + f];
  }

  /**
   * Ausschnitt einer Zelle (für Baustellen: nur der untere Teil, und Baumstümpfe): Zeilen y0..y1 in Zellkoordinaten.
   * Gecacht nach Schlüssel.
   */
  crop(key: string, view: number, frame: number, team: number, y0: number, y1: number): Texture | null {
    const full = this.texture(key, view, frame, team);
    if (!full) return null;
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(this.cell[1], Math.ceil(y1));
    if (y1 <= y0) return null;
    const id = `${key}:${view}:${frame}:${team}:${y0}:${y1}`;
    let t = this.cropCache.get(id);
    if (!t) {
      const fr = full.frame;
      t = new Texture({ source: full.source, frame: new Rectangle(fr.x, fr.y + y0, fr.width, y1 - y0) });
      this.cropCache.set(id, t);
    }
    return t;
  }

  /** Canvas der Zelle (für Icons). */
  canvas(key: string, team = 0): HTMLCanvasElement | null {
    if (team === 0) return this.canvases.get(key + ":body") ?? null;
    this.textures(key, team, "body");
    return this.canvases.get(`${key}:body:${team}`) ?? null;
  }

  private textures(key: string, team: number, part: "body" | "front"): Texture[] | null {
    const id = `${key}:${part}:${team}`;
    let list = this.tex.get(id);
    if (list) return list;
    const sp = this.sprites.get(key)!;
    let c = this.canvases.get(`${key}:${part}`);
    if (!c) return null;
    if (team > 0) {
      c = paletteSwap(c, this.meta.team_swap?.[TEAM_NAMES[team]]);
      this.canvases.set(`${key}:${part}:${team}`, c);
    }
    const src = sourceOf(c);
    list = [];
    const [cw, ch] = this.cell;
    for (let v = 0; v < 4; v++) for (let f = 0; f < sp.frames; f++) {
      list.push(new Texture({ source: src, frame: new Rectangle(f * cw, v * ch, cw, ch) }));
    }
    this.tex.set(id, list);
    return list;
  }
}

// ---------------------------------------------------------------- Figuren

interface FigureMetaUnit { key: string; name?: string; anims?: Record<string, [number, number]> }
interface FigureMeta { cell: number; frames: number; anchor: [number, number]; units: FigureMetaUnit[]; team_swap?: Record<string, number[][]>; shadow?: boolean }

export interface FigureSprite {
  key: string;
  anims: Record<string, [number, number]>;
  pixels: Pixels;
  /** Zeile der Einheit im Bild (Richtungen darunter). */
  row: number;
  img: string;
}

export class FigureSheet {
  readonly cell: number;
  readonly frames: number;
  readonly anchor: [number, number];
  private sprites = new Map<string, FigureSprite>();
  private canvases = new Map<string, HTMLCanvasElement>();
  private tex = new Map<string, Texture[]>();

  constructor(private meta: FigureMeta) {
    this.cell = meta.cell;
    this.frames = meta.frames;
    this.anchor = meta.anchor;
  }

  /**
   * Nutzt atlas.png, wenn es alle Einheiten des Blatts enthält (neues Format), sonst die Einzelbilder <einheit>.png.
   */
  static async load(): Promise<FigureSheet | null> {
    const meta = await loadJson<FigureMeta>(`figures/${STYLE}/sheet.json`);
    if (!meta) return null;
    const sheet = new FigureSheet(meta);
    const c = meta.cell, rows = meta.units.length * 8;
    const atlas = await loadImage(`figures/${STYLE}/atlas.png`);
    if (atlas && atlas.height >= rows * c) {
      const canvas = toCanvas(atlas), px = new Pixels(canvas);
      sheet.canvases.set("atlas", canvas);
      meta.units.forEach((u, i) => sheet.sprites.set(u.key, { key: u.key, anims: u.anims ?? {}, pixels: px, row: i * 8, img: "atlas" }));
    } else {
      await Promise.all(meta.units.map(async (u) => {
        const im = await loadImage(`figures/${STYLE}/${u.key}.png`);
        if (!im) { warnOnce(`Figurenbild ${u.key}.png fehlt`); return; }
        const canvas = toCanvas(im);
        sheet.canvases.set(u.key, canvas);
        sheet.sprites.set(u.key, { key: u.key, anims: u.anims ?? {}, pixels: new Pixels(canvas), row: 0, img: u.key });
      }));
    }
    return sheet;
  }

  has(key: string): boolean { return this.sprites.has(key); }
  get(key: string): FigureSprite | undefined { return this.sprites.get(key); }

  texture(key: string, dir: number, frame: number, team = 0): Texture | null {
    const sp = this.sprites.get(key);
    if (!sp) return null;
    const id = `${sp.img}:${team}`;
    let list = this.tex.get(id);
    if (!list) {
      let canvas = this.canvases.get(sp.img)!;
      if (team > 0) {
        canvas = paletteSwap(canvas, this.meta.team_swap?.[TEAM_NAMES[team]]);
        this.canvases.set(id, canvas);
      }
      const src = sourceOf(canvas);
      list = [];
      const cols = Math.floor(canvas.width / this.cell), rowsN = Math.floor(canvas.height / this.cell);
      for (let r = 0; r < rowsN; r++) for (let f = 0; f < cols; f++) {
        list.push(new Texture({ source: src, frame: new Rectangle(f * this.cell, r * this.cell, this.cell, this.cell) }));
      }
      this.tex.set(id, list);
    }
    const cols = Math.floor(this.canvases.get(sp.img)!.width / this.cell);
    const f = Math.max(0, Math.min(cols - 1, frame));
    return list[(sp.row + (dir & 7)) * cols + f] ?? null;
  }

  /** Alpha an Zellpixel (cx, cy) der Figur in Richtung dir, Bild frame. */
  alpha(key: string, dir: number, frame: number, cx: number, cy: number): number {
    const sp = this.sprites.get(key);
    if (!sp || cx < 0 || cy < 0 || cx >= this.cell || cy >= this.cell) return 0;
    return sp.pixels.alpha(frame * this.cell + cx, (sp.row + dir) * this.cell + cy);
  }

  canvasCell(key: string, dir: number, frame: number): { canvas: HTMLCanvasElement; x: number; y: number } | null {
    const sp = this.sprites.get(key);
    if (!sp) return null;
    return { canvas: this.canvases.get(sp.img)!, x: frame * this.cell, y: (sp.row + dir) * this.cell };
  }
}

// ---------------------------------------------------------------- Gelände

interface TerrainMeta { tile: [number, number]; anchor: [number, number]; image: string; keys: Record<string, { row: number; variants: number; frames: number }> }

export class TerrainSheet {
  private tex = new Map<string, Texture[][]>();
  constructor(readonly meta: TerrainMeta) {}

  static async load(): Promise<TerrainSheet | null> {
    const meta = await loadJson<TerrainMeta>(`terrain/${STYLE}/sheet.json`);
    if (!meta) return null;
    const im = await loadImage(`terrain/${STYLE}/${meta.image || "terrain.png"}`);
    if (!im) { warnOnce("Geländebild fehlt, Ersatzdarstellung"); return null; }
    const sheet = new TerrainSheet(meta);
    const src = sourceOf(toCanvas(im));
    const [tw, th] = meta.tile;
    const cols = Math.floor(im.width / tw);
    for (const [key, k] of Object.entries(meta.keys)) {
      const variants: Texture[][] = [];
      const V = Math.max(1, k.variants), F = Math.max(1, k.frames);
      for (let v = 0; v < V; v++) {
        const frames: Texture[] = [];
        for (let f = 0; f < F; f++) {
          // Spalten: Variante · Bilder + Bild (passt das nicht ins Bild, nur Bilder)
          const col = V * F <= cols ? v * F + f : f % cols;
          frames.push(new Texture({ source: src, frame: new Rectangle(col * tw, k.row * th, tw, th) }));
        }
        variants.push(frames);
      }
      sheet.tex.set(key, variants);
    }
    return sheet;
  }

  has(key: string): boolean { return this.tex.has(key); }
  frames(key: string): number { return this.tex.get(key)?.[0]?.length ?? 0; }
  texture(key: string, variant: number, frame = 0): Texture | null {
    const v = this.tex.get(key);
    if (!v) return null;
    const fr = v[variant % v.length];
    return fr[frame % fr.length];
  }
  get anchor(): [number, number] { return this.meta.anchor; }
}

export interface Sheets {
  buildings: BuildingSheet | null;
  figures: FigureSheet | null;
  terrain: TerrainSheet | null;
}

export async function loadSheets(): Promise<Sheets> {
  const [buildings, figures, terrain] = await Promise.all([BuildingSheet.load(), FigureSheet.load(), TerrainSheet.load()]);
  if (!buildings) warnOnce("Gebäudeblatt fehlt");
  if (!figures) warnOnce("Figurenblatt fehlt");
  if (!terrain) warnOnce("Geländeblatt assets/terrain/" + STYLE + " fehlt, Ersatzdarstellung mit eingefärbten Rauten");
  return { buildings, figures, terrain };
}

/** Neue Pixi-Quelle aus einem eigenen Canvas (Ersatzgrafik), nimmt am Glätten bei Übersicht teil. */
export function textureFromCanvas(c: HTMLCanvasElement): Texture {
  return new Texture({ source: sourceOf(c) });
}
