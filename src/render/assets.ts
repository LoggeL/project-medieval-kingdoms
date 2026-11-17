/**
 * Laden der Sprite-Blätter (Gebäude/Objekte, Figuren, Gelände) aus assets/<art>/<stil>/ und Aufbereitung als Pixi-Texturen.
 * Teamfarben per exaktem Farbtausch (team_swap), Alphadaten für pixelgenaue Treffer, Inhaltsrahmen je Zelle,
 * weiße Silhouetten für verdeckte Figuren, maskierte Geländeübergänge.
 * Fehlende Dateien oder Schlüssel sind kein Fehler: Die Darstellung fragt mit has()/fallback() nach und meldet einmal.
 */
import { Rectangle, Texture, CanvasSource } from "pixi.js";
import { STEP_PX } from "./iso";
import { maskTile, type BlendMeta, type Edge } from "./blend";
import { STYLE } from "./style";

export { STYLE };
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

/**
 * Exakter Farbtausch: Paare [r, g, b, r', g', b'] (wie paletteSwap in bauten.js). Kann auf einen Ausschnitt beschränkt
 * werden (z. B. nur die acht Zeilen einer Einheit im Figurenatlas statt des ganzen Atlas).
 */
export function paletteSwap(src: HTMLCanvasElement, pairs: number[][] | undefined, sx = 0, sy = 0, sw = src.width, sh = src.height): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = sw; c.height = sh;
  const g = c.getContext("2d")!;
  g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  if (!pairs || !pairs.length || !sw || !sh) return c;
  const id = g.getImageData(0, 0, sw, sh);
  swapPixels(id.data, pairs);
  g.putImageData(id, 0, 0);
  return c;
}

/** Farbtausch direkt auf RGBA-Daten (ohne DOM). */
export function swapPixels(p: Uint8ClampedArray, pairs: number[][]): void {
  const map = new Map<number, number>();
  for (const q of pairs) map.set(q[0] | (q[1] << 8) | (q[2] << 16), q[3] | (q[4] << 8) | (q[5] << 16));
  for (let k = 0; k < p.length; k += 4) {
    if (!p[k + 3]) continue;
    const to = map.get(p[k] | (p[k + 1] << 8) | (p[k + 2] << 16));
    if (to === undefined) continue;
    p[k] = to & 255; p[k + 1] = (to >> 8) & 255; p[k + 2] = (to >> 16) & 255;
  }
}

/** Weiße Silhouette (Alpha bleibt) eines Ausschnitts, für verdeckte Figuren (wird mit der Teamfarbe eingefärbt). */
function silhouette(src: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = sw; c.height = sh;
  const g = c.getContext("2d")!;
  g.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = "#fff";
  g.fillRect(0, 0, sw, sh);
  return c;
}

/** Arbeit in Leerlaufzeiten erledigen (eine Aufgabe je Aufruf), damit kein Bild hängt. */
export function idle(tasks: (() => void)[]): void {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const next = () => {
    const t = tasks.shift();
    if (!t) return;
    try { t(); } catch (e) { console.warn("[Grafik] Vorbereitung fehlgeschlagen", e); }
    if (tasks.length) schedule();
  };
  const schedule = () => { if (ric) ric(next, { timeout: 3000 }); else window.setTimeout(next, 50); };
  schedule();
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
  readonly w: number;
  readonly h: number;
  constructor(readonly canvas: HTMLCanvasElement) {
    this.w = canvas.width; this.h = canvas.height;
    this.data = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data;
  }
  alpha(x: number, y: number): number {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }
  bbox(x: number, y: number, w: number, h: number): Box | null {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    const W = this.w, d = this.data;
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
interface BuildingMeta { cell: [number, number]; anchor: [number, number]; units: BuildingMetaUnit[]; team_swap?: Record<string, number[][]>; step_px?: number }

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
    if (meta.step_px && meta.step_px !== STEP_PX) warnOnce(`Gebäudeblatt: step_px ${meta.step_px} weicht von der Darstellung (${STEP_PX}) ab`);
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

  /** Canvas des Blatts (für Icons), Team 1 mit getauschten Farben. */
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

interface FigureMetaUnit { key: string; name?: string; row?: number; anims?: Record<string, [number, number]> }
interface FigureMeta { cell: number; frames: number; anchor: [number, number]; units: FigureMetaUnit[]; team_swap?: Record<string, number[][]>; shadow?: boolean }

export interface FigureSprite {
  key: string;
  anims: Record<string, [number, number]>;
  pixels: Pixels;
  /** Zeile der Einheit im Bild (Richtungen darunter). */
  row: number;
  img: string;
}

/**
 * Figurenblatt. Team 0 nutzt den ganzen Atlas als eine Textur. Teamfarbe (Team 1) und Silhouette werden je Einheit
 * (acht Zeilen) als eigenes kleines Bild erzeugt: beim ersten Bedarf oder vorab im Leerlauf (prewarm), nie für den
 * ganzen Atlas auf einmal.
 */
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
    const c = meta.cell;
    const rowOf = (u: FigureMetaUnit, i: number) => u.row ?? i * 8;
    const rows = Math.max(0, ...meta.units.map((u, i) => rowOf(u, i) + 8));
    const atlas = await loadImage(`figures/${STYLE}/atlas.png`);
    if (atlas && atlas.height >= rows * c) {
      const canvas = toCanvas(atlas), px = new Pixels(canvas);
      sheet.canvases.set("atlas", canvas);
      meta.units.forEach((u, i) => sheet.sprites.set(u.key, { key: u.key, anims: u.anims ?? {}, pixels: px, row: rowOf(u, i), img: "atlas" }));
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
  keys(): string[] { return [...this.sprites.keys()]; }

  private cols(sp: FigureSprite): number {
    return Math.floor(this.canvases.get(sp.img)!.width / this.cell);
  }

  /** Texturliste: Team 0 = ganzes Bild (Zeilen ab 0), sonst acht Zeilen der Einheit (Variante team / "weiss"). */
  private list(sp: FigureSprite, variant: number | "weiss"): Texture[] {
    const id = variant === 0 ? `${sp.img}:0` : `${sp.key}:${variant}`;
    let list = this.tex.get(id);
    if (list) return list;
    const full = this.canvases.get(sp.img)!, cell = this.cell, cols = this.cols(sp);
    let canvas: HTMLCanvasElement, rows: number;
    if (variant === 0) { canvas = full; rows = Math.floor(full.height / cell); }
    else {
      const y = sp.row * cell, h = Math.min(8 * cell, full.height - y);
      canvas = variant === "weiss" ? silhouette(full, 0, y, full.width, h)
        : paletteSwap(full, this.meta.team_swap?.[TEAM_NAMES[variant]], 0, y, full.width, h);
      this.canvases.set(id, canvas);
      rows = Math.floor(h / cell);
    }
    const src = sourceOf(canvas);
    list = [];
    for (let r = 0; r < rows; r++) for (let f = 0; f < cols; f++) {
      list.push(new Texture({ source: src, frame: new Rectangle(f * cell, r * cell, cell, cell) }));
    }
    this.tex.set(id, list);
    return list;
  }

  texture(key: string, dir: number, frame: number, team = 0): Texture | null {
    const sp = this.sprites.get(key);
    if (!sp) return null;
    const cols = this.cols(sp);
    const f = Math.max(0, Math.min(cols - 1, frame));
    const row = (team === 0 ? sp.row : 0) + (dir & 7);
    return this.list(sp, team)[row * cols + f] ?? null;
  }

  /** Weiße Silhouette derselben Zelle (zum Einfärben mit der Teamfarbe). */
  silhouette(key: string, dir: number, frame: number): Texture | null {
    const sp = this.sprites.get(key);
    if (!sp) return null;
    const cols = this.cols(sp);
    return this.list(sp, "weiss")[(dir & 7) * cols + Math.max(0, Math.min(cols - 1, frame))] ?? null;
  }

  /** Teamfarben und Silhouetten der genannten Figuren im Leerlauf vorbereiten (kein Hänger beim ersten Gegner). */
  prewarm(keys: string[]): void {
    const tasks: (() => void)[] = [];
    for (const k of new Set(keys)) {
      const sp = this.sprites.get(k);
      if (!sp) continue;
      tasks.push(() => { this.list(sp, 1); }, () => { this.list(sp, "weiss"); });
    }
    idle(tasks);
  }

  /** Alpha an Zellpixel (cx, cy) der Figur in Richtung dir, Bild frame. */
  alpha(key: string, dir: number, frame: number, cx: number, cy: number): number {
    const sp = this.sprites.get(key);
    if (!sp || cx < 0 || cy < 0 || cx >= this.cell || cy >= this.cell) return 0;
    return sp.pixels.alpha(frame * this.cell + cx, (sp.row + dir) * this.cell + cy);
  }

  /** Canvas und Lage einer Zelle (für Icons); Team 1 aus dem getauschten Einheitenbild. */
  canvasCell(key: string, dir: number, frame: number, team = 0): { canvas: HTMLCanvasElement; x: number; y: number } | null {
    const sp = this.sprites.get(key);
    if (!sp) return null;
    if (team > 0) {
      this.list(sp, team);
      return { canvas: this.canvases.get(`${sp.key}:${team}`)!, x: frame * this.cell, y: dir * this.cell };
    }
    return { canvas: this.canvases.get(sp.img)!, x: frame * this.cell, y: (sp.row + dir) * this.cell };
  }
}

// ---------------------------------------------------------------- Gelände

interface TerrainMeta {
  tile: [number, number]; anchor: [number, number]; image: string; fps?: number;
  keys: Record<string, { row: number; variants: number; frames: number }>;
  blend?: BlendMeta;
}

export class TerrainSheet {
  private tex = new Map<string, Texture[][]>();
  private canvas: HTMLCanvasElement | null = null;
  private cells = new Map<string, [number, number]>();
  private blendCanvas: HTMLCanvasElement | null = null;
  private blendMeta: BlendMeta | null = null;
  private blendTex = new Map<string, Texture>();
  constructor(readonly meta: TerrainMeta) {}

  static async load(): Promise<TerrainSheet | null> {
    const meta = await loadJson<TerrainMeta>(`terrain/${STYLE}/sheet.json`);
    if (!meta) return null;
    const [im, bl] = await Promise.all([
      loadImage(`terrain/${STYLE}/${meta.image || "terrain.png"}`),
      meta.blend?.image ? loadImage(`terrain/${STYLE}/${meta.blend.image}`) : Promise.resolve(null),
    ]);
    if (!im) { warnOnce("Geländebild fehlt, Ersatzdarstellung"); return null; }
    const sheet = new TerrainSheet(meta);
    const canvas = toCanvas(im);
    sheet.canvas = canvas;
    const src = sourceOf(canvas);
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
          if (f === 0) sheet.cells.set(`${key}:${v}`, [col * tw, k.row * th]);
        }
        variants.push(frames);
      }
      sheet.tex.set(key, variants);
    }
    if (meta.blend && bl) sheet.setBlend(toCanvas(bl), meta.blend);
    else if (meta.blend) warnOnce(`Übergangsmasken ${meta.blend.image} fehlen, Gelände ohne Übergänge`);
    return sheet;
  }

  has(key: string): boolean { return this.tex.has(key); }
  frames(key: string): number { return this.tex.get(key)?.[0]?.length ?? 0; }
  variants(key: string): number { return this.tex.get(key)?.length ?? 0; }
  /** Bilder je Sekunde der Wasser-Animation (sheet.json "fps"). */
  get fps(): number { return this.meta.fps ?? 4; }
  texture(key: string, variant: number, frame = 0): Texture | null {
    const v = this.tex.get(key);
    if (!v) return null;
    const fr = v[variant % v.length];
    return fr[frame % fr.length];
  }
  get anchor(): [number, number] { return this.meta.anchor; }

  /** Übergangsmasken setzen (beim Laden aus blend.png; Tests können eine erzeugte Maske übergeben). */
  setBlend(canvas: HTMLCanvasElement, meta: BlendMeta): void {
    this.blendCanvas = canvas;
    this.blendMeta = meta;
    for (const t of this.blendTex.values()) t.destroy(true);
    this.blendTex.clear();
  }

  /** Anzahl der Maskenvarianten je Kante, 0 = keine Übergänge. */
  get blendVariants(): number { return this.blendCanvas && this.blendMeta ? Math.max(1, this.blendMeta.variants) : 0; }

  /** Kachel des Geländes key (Variante), maskiert mit der Kantenmaske edge (Variante mv). Gecacht. */
  blended(key: string, variant: number, edge: Edge, mv: number): Texture | null {
    const bm = this.blendMeta, bc = this.blendCanvas, tc = this.canvas;
    if (!bm || !bc || !tc) return null;
    const nv = Math.max(1, this.variants(key));
    const v = variant % nv;
    const id = `${key}:${v}:${edge}:${mv}`;
    let t = this.blendTex.get(id);
    if (t) return t;
    const cell = this.cells.get(`${key}:${v}`);
    const row = bm.edges.indexOf(edge);
    if (!cell || row < 0) return null;
    const [tw, th] = this.meta.tile;
    const [mw, mh] = bm.tile;
    const c = document.createElement("canvas");
    c.width = tw; c.height = th;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(tc, cell[0], cell[1], tw, th, 0, 0, tw, th);
    const tile = g.getImageData(0, 0, tw, th);
    const m = document.createElement("canvas");
    m.width = tw; m.height = th;
    const mg = m.getContext("2d", { willReadFrequently: true })!;
    mg.imageSmoothingEnabled = false;
    mg.drawImage(bc, (mv % Math.max(1, bm.variants)) * mw, row * mh, mw, mh, 0, 0, tw, th);
    maskTile(tile.data, mg.getImageData(0, 0, tw, th).data, tile.data);
    g.putImageData(tile, 0, 0);
    t = new Texture({ source: sourceOf(c) });
    this.blendTex.set(id, t);
    return t;
  }
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
