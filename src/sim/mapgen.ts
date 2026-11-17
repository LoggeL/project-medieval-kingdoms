/**
 * Kartengenerator (deterministisch aus dem Seed).
 *
 * Aufbau der Standardkarte (Welt-Achsen, x nach Osten, y nach Süden im Sinne von geom.NEIGHBOURS):
 *   Westen  dichter Wald (Laub und Tannen) auf Waldboden, ein Waldweg führt hindurch zum Kartenrand
 *   Norden  Felsfeld mit Felsbrocken (je 8–16 Blöcke), ein Weg führt hinunter zur Hauptstraße
 *   Mitte   Wiesen und Gras, das Startlager an der Straße, viel Baufläche zwischen Wald und Fels
 *   Osten   Fluss von Nord nach Süd (unpassierbar) mit einer Furt, über die die Straße zum Ostrand führt
 * Die Angreifer kommen von Osten (dem Wald abgewandt) über die Furt: ein natürlicher Engpass für Mauern.
 */
import type { TerrainKey } from "../data";
import type { Rock, Tile, Tree } from "./types";

export interface MapResult {
  tiles: Tile[];
  trees: Tree[];
  rocks: Rock[];
  /** Linke obere Ecke des Startlagers (Ausrichtung 0, Eingang an der Straße). */
  lager: [number, number];
  camp: [number, number];
  entry: [number, number];
  raidSpawn: [number, number];
}

type Rand = () => number;

function valueNoise(W: number, H: number, cell: number, rand: Rand): Float32Array {
  const gw = Math.ceil(W / cell) + 2, gh = Math.ceil(H / cell) + 2;
  const g = Array.from({ length: gw * gh }, rand);
  const out = new Float32Array(W * H);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = sm(fx - ix), ty = sm(fy - iy);
    const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
    out[y * W + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
  return out;
}

export function generateMap(W: number, H: number, rand: Rand, nextId: () => number): MapResult {
  const n1 = valueNoise(W, H, 7, rand), n2 = valueNoise(W, H, 4, rand), n3 = valueNoise(W, H, 11, rand);
  const roadY = Math.floor(H * 0.5) + 2;
  const lager: [number, number] = [Math.floor(W * 0.45) - 1, roadY - 3];
  const quarryX = Math.round(W * 0.56);
  const fels = { cx: W * 0.56, cy: H * 0.14, rx: W * 0.15, ry: H * 0.11 };
  const terrain: TerrainKey[] = new Array(W * H);
  const forestEdge = (y: number) => W * 0.22 + (n3[y * W] - 0.5) * 8;
  const riverX = (y: number) => W * 0.8 + Math.sin((y / H) * Math.PI * 2.2) * W * 0.035 + (n3[y * W + W - 1] - 0.5) * 2;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let t: TerrainKey = n1[i] > 0.6 ? "wiese" : "gras";
    if (x < forestEdge(y) + (n2[i] - 0.5) * 3) t = "waldboden";
    const e = ((x - fels.cx) / fels.rx) ** 2 + ((y - fels.cy) / fels.ry) ** 2 + (n2[i] - 0.5) * 0.7;
    if (e < 1) t = "fels";
    if (Math.abs(x + 0.5 - riverX(y)) < 1.6) t = Math.abs(y - roadY) <= 1 ? "erde" : "wasser"; // Furt
    if (y === roadY && t !== "wasser") t = "erde";
    terrain[i] = t;
  }
  // Weg vom Felsfeld zur Straße (endet am Fels)
  for (let y = roadY - 1; y >= 0; y--) {
    const i = y * W + quarryX;
    if (terrain[i] === "fels" || terrain[i] === "wasser") break;
    terrain[i] = "erde";
  }

  const tiles: Tile[] = terrain.map((t) => ({ terrain: t, variant: Math.floor(rand() * 4), building: 0 }));

  // Bäume: dichter Wald im Westen, ein paar einzelne Bäume in der Ebene
  const trees: Tree[] = [];
  const [lx, ly] = lager;
  const clear = (x: number, y: number) => Math.max(Math.abs(x - (lx + 1)), Math.abs(y - (ly + 1))) <= 7;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, t = terrain[i];
    const r = rand(), r2 = rand();
    let place = false;
    if (t === "waldboden") place = r < 0.45 + (n2[i] - 0.5) * 0.3;
    else if ((t === "gras" || t === "wiese") && !clear(x, y) && Math.abs(y - roadY) > 1 && Math.abs(x + 0.5 - riverX(y)) > 3) place = r < 0.012;
    if (!place) continue;
    const tanne = n1[i] > 0.45 ? r2 < 0.65 : r2 < 0.25;
    trees.push({
      id: nextId(), x, y, kind: tanne ? "tanne" : "baum", variant: Math.floor(rand() * 2),
      state: "stehend", progress: 0, fallX: 0, fallY: 0, logs: 0, reservedBy: 0,
    });
  }

  // Felsbrocken im Inneren des Felsfelds, mit Abstand zueinander
  const rocks: Rock[] = [];
  const isFels = (x: number, y: number) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && terrain[y * W + x] === "fels";
  const cand: [number, number][] = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let inner = true;
    for (let dy = -1; dy <= 1 && inner; dy++) for (let dx = -1; dx <= 1; dx++) if (!isFels(x + dx, y + dy)) { inner = false; break; }
    if (inner) cand.push([x, y]);
  }
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const maxRocks = Math.max(8, Math.round((W * H) / 4096 * 13));
  for (const [x, y] of cand) {
    if (rocks.length >= maxRocks) break;
    if (rocks.some((r) => Math.max(Math.abs(r.x - x), Math.abs(r.y - y)) < 3)) continue;
    const max = 8 + Math.floor(rand() * 9);
    rocks.push({ id: nextId(), x, y, amount: max, max, reservedBy: 0 });
  }

  return {
    tiles, trees, rocks, lager,
    camp: [lx + 5, roadY + 2],
    entry: [0, roadY],
    raidSpawn: [W - 1, roadY],
  };
}

/** Leere Wiese (für Tests und Versuche). */
export function emptyMap(W: number, H: number): MapResult {
  const tiles: Tile[] = Array.from({ length: W * H }, () => ({ terrain: "gras" as TerrainKey, variant: 0, building: 0 }));
  const cy = Math.floor(H / 2);
  return { tiles, trees: [], rocks: [], lager: [Math.floor(W / 2) - 1, cy - 1], camp: [Math.floor(W / 2), cy], entry: [0, cy], raidSpawn: [W - 1, cy] };
}
