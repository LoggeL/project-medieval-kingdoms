/**
 * Kleine erzeugte Hilfsgrafiken: Auswahlring und Zielmarke (gehören zur Oberfläche der Welt) sowie Ersatzgrafiken
 * für Objekte, deren Sprite im Blatt noch fehlt (Fels, Warenstapel). Ersatz wird beim ersten Gebrauch in der
 * Konsole gemeldet (warnOnce) und automatisch durch das echte Sprite ersetzt, sobald es im Blatt steht.
 */
import type { Texture } from "pixi.js";
import type { Good } from "../data";
import { textureFromCanvas } from "./assets";

const cache = new Map<string, Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")!];
}

/** Pixelige Iso-Ellipse (2:1) als Ring. */
function ellipse(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string, thick = 1): void {
  g.fillStyle = color;
  for (let a = 0; a < 360; a += 2) {
    const t = (a * Math.PI) / 180;
    for (let k = 0; k < thick; k++) g.fillRect(Math.round(cx + Math.cos(t) * (rx - k)), Math.round(cy + Math.sin(t) * (ry - k / 2)), 1, 1);
  }
}

/** Auswahlring unter einer Figur: Pivot = Mitte (14, 7). */
export function ringTexture(kind: "eigen" | "feind" | "ziel"): Texture {
  const id = "ring:" + kind;
  let t = cache.get(id);
  if (!t) {
    const [c, g] = canvas(30, 16);
    const col = kind === "eigen" ? "#f2e6a0" : kind === "feind" ? "#e05a45" : "#9fe07a";
    ellipse(g, 15, 8, 13, 6.5, "rgba(0,0,0,0.45)");
    ellipse(g, 15, 7, 13, 6.5, col);
    t = textureFromCanvas(c);
    cache.set(id, t);
  }
  return t;
}

/** Ersatz für einen Felsbrocken (Abbaustufe 0 = voll). Pivot (32, 40). */
export function rockTexture(stage: number): Texture {
  const id = "fels:" + stage;
  let t = cache.get(id);
  if (!t) {
    const [c, g] = canvas(64, 48);
    const s = 1 - stage * 0.22;
    const blocks: [number, number, number, number][] = [[-14, -6, 16, 14], [2, -10, 15, 18], [-6, -18, 14, 14], [10, -2, 10, 9], [-20, 0, 9, 7]];
    blocks.forEach(([x, y, w, h], i) => {
      if (i >= 5 - stage) return;
      const X = 32 + x * s, Y = 40 + y * s, W = Math.max(3, w * s), H = Math.max(3, h * s);
      g.fillStyle = "#6d675c"; g.fillRect(Math.round(X), Math.round(Y), Math.round(W), Math.round(H));
      g.fillStyle = "#9a9384"; g.fillRect(Math.round(X), Math.round(Y), Math.round(W), 2);
      g.fillStyle = "#4e4a42"; g.fillRect(Math.round(X + W - 2), Math.round(Y + 2), 2, Math.round(H - 2));
    });
    t = textureFromCanvas(c);
    cache.set(id, t);
  }
  return t;
}

const PILE: Record<Good, [string, string]> = {
  holz: ["#8a5a2b", "#c08a4e"],
  stein: ["#7b766b", "#aaa395"],
  eisen: ["#4a4f57", "#8d949e"],
  speer: ["#6b4a2a", "#c9c9c0"],
  schwert: ["#5a4a3a", "#d6d8dc"],
  bogen: ["#6b4320", "#b08850"],
  getreide: ["#9a7a3a", "#d9b866"],
  mehl: ["#a89c86", "#ece4d2"],
  brot: ["#7a4a1e", "#c88a4a"],
};

/** Ersatz für einen Warenstapel, Füllstufe 1..4. Pivot (16, 22). */
export function pileTexture(good: Good, level: number): Texture {
  const id = `stapel:${good}:${level}`;
  let t = cache.get(id);
  if (!t) {
    const [c, g] = canvas(32, 26);
    const [dark, light] = PILE[good];
    for (let i = 0; i < level * 2; i++) {
      const row = Math.floor(i / 3), col = i % 3;
      const x = 6 + col * 7 + (row % 2) * 3, y = 18 - row * 4;
      g.fillStyle = dark; g.fillRect(x, y, 7, 4);
      g.fillStyle = light; g.fillRect(x, y, 6, 1);
    }
    t = textureFromCanvas(c);
    cache.set(id, t);
  }
  return t;
}
