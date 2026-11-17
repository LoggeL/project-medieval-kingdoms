/**
 * Gemeinsame Geometrie von Simulation und Darstellung. Einzige Quelle für Drehsinn und Grundrisse.
 *
 * Welt: Tile (x, y), x nach rechts unten, y nach links unten (Ansicht r = 0).
 * Modellachsen der Blender-Sprites: Raster-u = Modell +x, Raster-v = Modell −y (sheet.json "axes").
 * Ein Gebäude mit Ausrichtung o wird um o · 90° gedreht; angezeigt wird die Sprite-Ansicht (o − r) mod 4
 * (siehe docs/decisions/0002-koordinaten-und-drehung.md, Referenz: tools/konzeptseite/bauten.js).
 */
import { BUILDINGS, type BuildingKey } from "../data";

export type Rot = 0 | 1 | 2 | 3;

/** Dreht einen Welt-Versatz k-mal um 90° (gleicher Sinn wie eine Gebäudeansicht +1). */
export function turn(dx: number, dy: number, k: number): [number, number] {
  let x = dx, y = dy;
  for (let i = 0; i < (((k % 4) + 4) % 4); i++) [x, y] = [y, -x];
  return [x, y];
}

/** Versatz in Modellachsen (Tiles, Modell-y zeigt nach hinten) → Welt-Versatz für Ausrichtung o. */
export function modelToWorld(mx: number, my: number, o: number): [number, number] {
  return turn(mx, -my, o);
}

/** Grundriss (Breite, Tiefe) in Welt-Tiles für Ausrichtung o. */
export function footprint(key: BuildingKey, o: number): [number, number] {
  const [w, h] = BUILDINGS[key].footprint;
  return o % 2 === 0 ? [w, h] : [h, w];
}

/** Belegte Welt-Tiles eines Gebäudes mit linker oberer Ecke (x, y). */
export function footprintTiles(key: BuildingKey, x: number, y: number, o: number): [number, number][] {
  const [w, h] = footprint(key, o);
  const out: [number, number][] = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push([x + i, y + j]);
  return out;
}

/** Mittelpunkt des Grundrisses in Welt-Koordinaten (Tile-Einheiten, Kanten bei ganzen Zahlen). */
export function center(key: BuildingKey, x: number, y: number, o: number): [number, number] {
  const [w, h] = footprint(key, o);
  return [x + w / 2, y + h / 2];
}

/**
 * Eingang: der Tile vor der Vorderseite (Modell −y, im Sprite die Tür).
 * Liegt außerhalb des Grundrisses, mittig vor der Vorderkante.
 */
export function entrance(key: BuildingKey, x: number, y: number, o: number): [number, number] {
  const [, d] = BUILDINGS[key].footprint;
  const [cx, cy] = center(key, x, y, o);
  const [ox, oy] = modelToWorld(0, -(d / 2 + 0.5), o);
  return [Math.floor(cx + ox), Math.floor(cy + oy)];
}

/** Lager-Slot k (0..7) → Welt-Tile. Reihenfolge wie in buildings.py b_lager: (i, j) ∈ 3 × 3 ohne die Einfahrt (0, −1). */
export const STORAGE_SLOTS: [number, number][] = [[-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [0, 0]];
export function slotTile(x: number, y: number, o: number, k: number): [number, number] {
  const [cx, cy] = center("lager", x, y, o);
  const [mx, my] = STORAGE_SLOTS[k];
  const [dx, dy] = modelToWorld(mx, my, o);
  return [Math.floor(cx + dx), Math.floor(cy + dy)];
}

/** Posten eines Gebäudes in Welt-Koordinaten (Bruchteile von Tiles) mit Höhenstufe. */
export function postWorld(key: BuildingKey, x: number, y: number, o: number, k: number): [number, number, number] {
  const p = BUILDINGS[key].posts![k];
  const [cx, cy] = center(key, x, y, o);
  const [dx, dy] = modelToWorld(p[0], p[1], o);
  return [cx + dx, cy + dy, p[2]];
}

/** Treppe: oberer Tile (am Wehrgang) und unterer Tile (am Boden), sowie der Mauer-Tile, an den sie anschließt. */
export function stairEnds(x: number, y: number, o: number): { top: [number, number]; bottom: [number, number]; wall: [number, number] } {
  const [cx, cy] = center("treppe", x, y, o);
  // Modell: Stufen steigen zu Modell +y; der Grundriss ist 1 × 2.
  const t = modelToWorld(0, 0.5, o), b = modelToWorld(0, -0.5, o), w = modelToWorld(0, 1.5, o);
  return {
    top: [Math.floor(cx + t[0]), Math.floor(cy + t[1])],
    bottom: [Math.floor(cx + b[0]), Math.floor(cy + b[1])],
    wall: [Math.floor(cx + w[0]), Math.floor(cy + w[1])],
  };
}

/** Welt-Richtungen der Mauer-Nachbarschaft: Bit 0 = −y (N), 1 = +x (O), 2 = +y (S), 3 = −x (W). */
export const NEIGHBOURS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Ansicht r: Welt → (u, v) (Tabelle aus docs/concept/09-technik.md §3, Karte W × H). */
export function toView(x: number, y: number, r: Rot, W: number, H: number): [number, number] {
  switch (r) {
    case 1: return [H - y, x];
    case 2: return [W - x, H - y];
    case 3: return [y, W - x];
    default: return [x, y];
  }
}

/** Sprite-Ansicht eines Gebäudes mit Ausrichtung o bei Kameradrehung r. */
export const viewOf = (o: number, r: number): number => (((o - r) % 4) + 4) % 4;

/**
 * Mauer-Autotiling: Teil und Ausrichtung aus der Nachbarschaftsmaske (Bits wie NEIGHBOURS).
 * Die Teile sind bei o = 0 so gebaut (Welt-Richtungen): gerade O+W, ende O, ecke O+N, t O+W+N, kreuz alle, einzel keine.
 * Für o = 1..3 werden die Verbindungen mit turn() mitgedreht.
 */
export type WallPiece = "mauer_gerade" | "mauer_ende" | "mauer_ecke" | "mauer_t" | "mauer_kreuz" | "mauer_einzel";
const PIECE_MASK: [WallPiece, number][] = [
  ["mauer_einzel", 0], ["mauer_ende", 0b0010], ["mauer_gerade", 0b1010], ["mauer_ecke", 0b0011], ["mauer_t", 0b1011], ["mauer_kreuz", 0b1111],
];
function rotMask(mask: number, o: number): number {
  let out = 0;
  NEIGHBOURS.forEach(([dx, dy], bit) => {
    if (!(mask & (1 << bit))) return;
    const [rx, ry] = turn(dx, dy, o);
    out |= 1 << NEIGHBOURS.findIndex(([nx, ny]) => nx === rx && ny === ry);
  });
  return out;
}
export function wallPiece(mask: number): { piece: WallPiece; o: number } {
  for (const [piece, m] of PIECE_MASK) for (let o = 0; o < 4; o++) if (rotMask(m, o) === mask) return { piece, o };
  return { piece: "mauer_einzel", o: 0 };
}
