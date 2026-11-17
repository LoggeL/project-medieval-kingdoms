/**
 * Gemeinsame Geometrie von Simulation und Darstellung. Einzige Quelle für Drehsinn und Grundrisse.
 *
 * Welt: Tile (x, y), x nach rechts unten, y nach links unten (Ansicht r = 0).
 * Modellachsen der Blender-Sprites: Raster-u = Modell +x, Raster-v = Modell −y (sheet.json "axes").
 * Ein Gebäude mit Ausrichtung o wird um o · 90° gedreht; angezeigt wird die Sprite-Ansicht (o − r) mod 4
 * (siehe docs/decisions/0002-koordinaten-und-drehung.md, Referenz: tools/konzeptseite/bauten.js).
 */
import { BUILDINGS, levelDef, type BuildingKey } from "../data";

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

/** Tür in Modellachsen ab Grundrissmitte (Daten `door`, sonst mittig vor der Vorderkante). */
export function doorModel(key: BuildingKey): [number, number] {
  const def = BUILDINGS[key];
  return def.door ?? [0, -(def.footprint[1] / 2 + 0.5)];
}

/**
 * Eingang: die Tür- bzw. Zugangskachel (Daten `door`, dreht mit der Ausrichtung). Meist der Tile vor der Vorderseite
 * (Modell −y, im Sprite die Tür, beim Lagerhaus vor dem Tor). Figuren betreten und verlassen Gebäude nur hier.
 */
export function entrance(key: BuildingKey, x: number, y: number, o: number): [number, number] {
  const [mx, my] = doorModel(key);
  const [cx, cy] = center(key, x, y, o);
  const [ox, oy] = modelToWorld(mx, my, o);
  return [Math.floor(cx + ox), Math.floor(cy + oy)];
}

/** Liegt (tx, ty) im Grundriss des Gebäudes? */
export function inFootprint(key: BuildingKey, x: number, y: number, o: number, tx: number, ty: number): boolean {
  const [w, h] = footprint(key, o);
  return tx >= x && ty >= y && tx < x + w && ty < y + h;
}

/** Tür im Grundriss (offene Einfahrt, die als einziger Tile des Grundrisses begehbar bleibt)? */
export function doorInside(key: BuildingKey, x: number, y: number, o: number): boolean {
  const [ex, ey] = entrance(key, x, y, o);
  return inFootprint(key, x, y, o, ex, ey);
}

/**
 * Vorplatz: der erste Tile vor der Tür außerhalb des Grundrisses (Modell −y). Liegt die Tür schon draußen (alle
 * Gebäude der Daten, auch das Lagerhaus), ist es die Tür selbst. Er muss frei bleiben.
 */
export function approach(key: BuildingKey, x: number, y: number, o: number): [number, number] {
  let [ex, ey] = entrance(key, x, y, o);
  const [fx, fy] = modelToWorld(0, -1, o);
  for (let i = 0; i < 8 && inFootprint(key, x, y, o, ex, ey); i++) { ex += fx; ey += fy; }
  return [ex, ey];
}

/** Modellpunkt (Tiles ab Grundrissmitte) → Weltpunkt. */
function modelPoint(key: BuildingKey, x: number, y: number, o: number, mx: number, my: number): [number, number] {
  const [cx, cy] = center(key, x, y, o);
  const [dx, dy] = modelToWorld(mx, my, o);
  return [cx + dx, cy + dy];
}

/** Mitte von Fach k eines Lagers in Welt-Koordinaten (Bruchteile von Tiles), aus BuildingDef.storage.shelves. */
export function shelfWorld(key: BuildingKey, x: number, y: number, o: number, k: number): [number, number] {
  const [mx, my] = BUILDINGS[key].storage!.shelves[k];
  return modelPoint(key, x, y, o, mx, my);
}

/**
 * Weg eines Trägers im Lagerhaus zu Fach k (Weltpunkte): Mitte der Zugangskachel → durch die Tür → den Mittelgang
 * (Modell x = 0) entlang bis auf die Höhe des Fachs → davor stehen (zum Gang hin). Rückweg = derselbe Weg rückwärts.
 */
export function storeWalk(key: BuildingKey, x: number, y: number, o: number, k: number): [number, number][] {
  const def = BUILDINGS[key];
  const [sx, sy] = def.storage!.shelves[k];
  const doorY = -def.footprint[1] / 2 + 0.25;
  const side = Math.sign(sx);
  const inside: [number, number][] = [[0, doorY], [0, sy], side ? [side * (Math.abs(sx) - 0.53), sy] : [0, sy - 0.5]];
  const [ex, ey] = entrance(key, x, y, o);
  return [[ex + 0.5, ey + 0.5], ...inside.map(([mx, my]) => modelPoint(key, x, y, o, mx, my))];
}

/** Länge eines Linienzugs. */
export function polyLength(pts: [number, number][]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** Punkt auf einem Linienzug nach Strecke s (geklemmt), mit Richtung des Abschnitts. */
export function polyAt(pts: [number, number][], s: number): { x: number; y: number; dx: number; dy: number } {
  let rest = Math.max(0, s);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (rest <= d || i === pts.length - 1) {
      const f = d > 1e-9 ? Math.min(1, rest / d) : 1;
      return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, dx: x1 - x0, dy: y1 - y0 };
    }
    rest -= d;
  }
  const [x, y] = pts[pts.length - 1];
  return { x, y, dx: 0, dy: 0 };
}

/** Posten eines Gebäudes (auf Ausbaustufe level) in Welt-Koordinaten (Bruchteile von Tiles) mit Höhenstufe. */
export function postWorld(key: BuildingKey, x: number, y: number, o: number, k: number, level = 1): [number, number, number] {
  const p = levelDef(key, level).posts![k];
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

/**
 * Ausrichtung eines Tors aus der Nachbarschaftsmaske (Bits wie NEIGHBOURS): Mauerlinie entlang x (O + W) → 0,
 * entlang y (N + S) → 1, sonst die gewünschte Ausrichtung o. Dieselbe Regel nutzen Bau (build.ts) und Vorschau.
 */
export function gateOrientation(mask: number, o: number): number {
  return mask & 0b1010 ? 0 : mask & 0b0101 ? 1 : o;
}

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
