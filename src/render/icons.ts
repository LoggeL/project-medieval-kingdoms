/**
 * Kleine Icons für die Oberfläche, aus den echten Sprites geschnitten: Gebäude (Ansicht 0), Figur (Richtung S, Stehen),
 * Ware (Stapel in voller Füllstufe, sonst der Träger). Quadratisch, pixelscharf skaliert, gecacht.
 */
import { BUILDINGS, GOODS, UNITS, type Good, type UnitKey } from "../data";
import type { IconKind } from "../app/contract";
import type { Box, Sheets } from "./assets";

const cache = new Map<string, HTMLCanvasElement>();

function bboxOf(c: HTMLCanvasElement, x: number, y: number, w: number, h: number): Box | null {
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(x, y, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (d[(j * w + i) * 4 + 3] > 8) {
    if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

function draw(src: HTMLCanvasElement, sx: number, sy: number, bb: Box, size: number): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = size; out.height = size;
  const g = out.getContext("2d")!;
  const bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
  let s = Math.min(size / bw, size / bh);
  if (s >= 1) { s = Math.floor(s); g.imageSmoothingEnabled = false; } else { g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; }
  const dw = Math.round(bw * s), dh = Math.round(bh * s);
  g.drawImage(src, sx + bb.x0, sy + bb.y0, bw, bh, Math.floor((size - dw) / 2), size - dh - Math.floor((size - dh) / 2), dw, dh);
  return out;
}

function buildingIcon(sheets: Sheets, key: string, size: number, frame?: number): HTMLCanvasElement | null {
  const bs = sheets.buildings;
  if (!bs) return null;
  let sk = (BUILDINGS as Record<string, { sprite: string } | undefined>)[key]?.sprite ?? key;
  if (key === "lager" && bs.has("lager")) sk = "lager";
  if (!bs.has(sk) && key === "tor") sk = "mauer";
  const sp = bs.get(sk);
  const c = bs.canvas(sk);
  if (!sp || !c) return null;
  const f = Math.min(sp.frames - 1, frame ?? (key === "lager" ? sp.frames - 1 : 0));
  const bb = sp.bbox[0][f];
  if (!bb) return null;
  return draw(c, f * bs.cell[0], 0, bb, size);
}

function figureIcon(sheets: Sheets, key: string, size: number): HTMLCanvasElement | null {
  const fs = sheets.figures;
  if (!fs) return null;
  const cell = fs.canvasCell(key, 0, 0);
  if (!cell) return null;
  const bb = bboxOf(cell.canvas, cell.x, cell.y, fs.cell, fs.cell);
  return bb ? draw(cell.canvas, cell.x, cell.y, bb, size) : null;
}

export function makeIcon(sheets: Sheets, kind: IconKind, key: string, size: number): HTMLCanvasElement | null {
  const id = `${kind}:${key}:${size}`;
  const hit = cache.get(id);
  if (hit) return hit;
  let out: HTMLCanvasElement | null = null;
  if (kind === "gebaeude") out = buildingIcon(sheets, key, size);
  else if (kind === "einheit") out = figureIcon(sheets, (UNITS as Record<string, { sprite: string } | undefined>)[key as UnitKey]?.sprite ?? key, size);
  else if (kind === "ware") {
    const g = (GOODS as Record<string, { stack: string; carrier: string } | undefined>)[key as Good];
    if (g) {
      out = sheets.buildings?.has(g.stack) ? buildingIcon(sheets, g.stack, size, 4) : null;
      if (!out) out = figureIcon(sheets, sheets.figures?.has(g.carrier) ? g.carrier : "traeger", size);
    }
  }
  if (out) cache.set(id, out);
  return out;
}

/** Nach dem Nachladen von Blättern alte Icons verwerfen. */
export function clearIcons(): void { cache.clear(); }

