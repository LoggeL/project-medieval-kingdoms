/**
 * Ersatz-Blätter für Darstellungstests ohne Browser: gleiche Schnittstelle wie BuildingSheet/FigureSheet (assets.ts),
 * Texturen ohne Bilddaten, Alphawerte aus einer Regel. Schlüssel und Bildzahlen kommen aus dem echten sheet.json.
 */
import { Rectangle, Texture, TextureSource } from "pixi.js";
import type { BuildingSheet, FigureSheet } from "../../src/render/assets";
import BMETA from "../../assets/buildings/vorgerendert/sheet.json";
import FMETA_RAW from "../../assets/figures/vorgerendert/sheet.json";

const META = BMETA as unknown as {
  cell: [number, number]; anchor: [number, number]; units: { key: string; frames?: number; front?: boolean }[];
};
const FMETA = FMETA_RAW as unknown as {
  cell: number; anchor: [number, number]; units: { key: string; anims?: Record<string, [number, number]> }[];
};

/** Alpha an Zellpixel (x, y) in Zellkoordinaten eines Gebäudesprites. */
export type AlphaRule = (key: string, x: number, y: number) => number;

export interface FakeOptions {
  /** Diese Schlüssel fehlen im Blatt (wie nach einem fehlgeschlagenen Laden). */
  without?: string[];
  alpha?: AlphaRule;
  /** texture() wirft für diese Schlüssel (simuliert einen unerwarteten Fehler). */
  throwOn?: string[];
}

export function fakeBuildingSheet(o: FakeOptions = {}): BuildingSheet & { calls: string[] } {
  const [cw, ch] = META.cell;
  const without = new Set(o.without ?? []);
  const rule = o.alpha ?? (() => 255);
  const sprites = new Map<string, { frames: number; front: boolean }>();
  for (const u of META.units) if (!without.has(u.key)) sprites.set(u.key, { frames: u.frames ?? 1, front: !!u.front });
  const src = new TextureSource({ width: cw * 5, height: ch * 4 });
  const tex = new Map<string, Texture>();
  const calls: string[] = [];
  const texture = (key: string, view: number, frame: number, _team = 0, part: "body" | "front" = "body") => {
    const sp = sprites.get(key);
    if (!sp || (part === "front" && !sp.front)) return null;
    if (o.throwOn?.includes(key)) throw new Error(`Testfehler ${key}`);
    calls.push(`${key}:${part}`);
    const f = Math.max(0, Math.min(sp.frames - 1, frame));
    const id = `${key}:${part}:${view & 3}:${f}`;
    let t = tex.get(id);
    if (!t) { t = new Texture({ source: src, frame: new Rectangle(f * cw, (view & 3) * ch, cw, ch) }); tex.set(id, t); }
    return t;
  };
  const sheet = {
    cell: META.cell,
    anchor: META.anchor,
    calls,
    has: (k: string) => sprites.has(k),
    keys: () => [...sprites.keys()],
    get: (k: string) => {
      const sp = sprites.get(k);
      if (!sp) return undefined;
      const box = { x0: 100, y0: 40, x1: 220, y1: 200 };
      return {
        key: k, frames: sp.frames, footprint: [1, 1] as [number, number], hasFront: sp.front,
        bbox: [0, 1, 2, 3].map(() => Array.from({ length: sp.frames }, () => box)),
        pixels: { alpha: (x: number, y: number) => rule(k, ((x % cw) + cw) % cw, ((y % ch) + ch) % ch) },
      };
    },
    texture,
    crop: (key: string, view: number, frame: number, team: number) => texture(key, view, frame, team),
    canvas: () => null,
  };
  return sheet as unknown as BuildingSheet & { calls: string[] };
}

/** Figurenblatt: Körper als schmaler deckender Streifen über dem Fußpunkt. */
export function fakeFigureSheet(): FigureSheet {
  const cell = FMETA.cell, [ax, ay] = FMETA.anchor;
  const src = new TextureSource({ width: cell * 17, height: cell * 8 });
  const tex = new Map<string, Texture>();
  const anims = new Map(FMETA.units.map((u) => [u.key, u.anims ?? {}]));
  const t = (dir: number, frame: number) => {
    const id = `${dir}:${frame}`;
    let x = tex.get(id);
    if (!x) { x = new Texture({ source: src, frame: new Rectangle(frame * cell, (dir & 7) * cell, cell, cell) }); tex.set(id, x); }
    return x;
  };
  const sheet = {
    cell, frames: 17, anchor: FMETA.anchor,
    has: (k: string) => anims.has(k),
    keys: () => [...anims.keys()],
    get: (k: string) => (anims.has(k) ? { key: k, anims: anims.get(k)!, row: 0, img: k } : undefined),
    texture: (k: string, dir: number, frame: number) => (anims.has(k) ? t(dir, frame) : null),
    silhouette: (k: string, dir: number, frame: number) => (anims.has(k) ? t(dir, frame) : null),
    alpha: (_k: string, _d: number, _f: number, cx: number, cy: number) => (Math.abs(cx - ax) <= 4 && cy <= ay && cy >= ay - 30 ? 255 : 0),
    prewarm: () => {},
  };
  return sheet as unknown as FigureSheet;
}
