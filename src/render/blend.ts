/**
 * Geländeübergänge (reine Logik, ohne Pixi und DOM, damit sie in Tests läuft).
 *
 * Absprache mit der Grafik: assets/terrain/<stil>/blend.png und im terrain-sheet.json
 *   "blend": { "image": "blend.png", "tile": [64, 32], "edges": ["ne", "se", "sw", "nw"], "variants": N }
 * Zeile = Kante der Bildschirm-Raute (ne = Kante zwischen oberer und rechter Ecke usw.), Spalte = Variante,
 * Zelle = weiße Maske mit Alpha (am jeweiligen Rand deckend, nach innen auslaufend).
 *
 * Beim Vorrendern eines Gelände-Abschnitts legt die Darstellung über eine Kachel die Kachel jedes Nachbarn mit höherem
 * Vorrang, maskiert mit der Maske der gemeinsamen Kante. Vorrang von unten nach oben: wasser, sumpf, sand, erde, gebirge,
 * fels, huegel, waldboden, fruchtbar, gras, wiese (BLEND_ORDER). Wasser überdeckt nie Land. Land über Wasser wird als
 * Ufer gezeichnet (eigene Ebene über der Wasser-Animation).
 */
import type { TerrainKey } from "../data";

export type Edge = "ne" | "se" | "sw" | "nw";
export const EDGES: Edge[] = ["ne", "se", "sw", "nw"];

/**
 * Nachbar in Ansichtskoordinaten (u, v) jenseits einer Kante der Bildschirm-Raute.
 * Raute des Ansicht-Tiles (u, v): oben (u, v), rechts (u + 1, v), unten (u + 1, v + 1), links (u, v + 1).
 * ne: oben → rechts liegt auf v = const → Nachbar (u, v − 1); se: u + 1; sw: v + 1; nw: u − 1.
 */
export const EDGE_NEIGHBOUR: Record<Edge, [number, number]> = { ne: [0, -1], se: [1, 0], sw: [0, 1], nw: [-1, 0] };

/** Vorrang (höher überdeckt niedriger). Unbekannte Geländearten nehmen an keinem Übergang teil. */
export const BLEND_ORDER: TerrainKey[] = ["wasser", "sumpf", "sand", "erde", "gebirge", "fels", "huegel", "waldboden", "fruchtbar", "gras", "wiese"];

export function precedence(t: TerrainKey): number {
  return BLEND_ORDER.indexOf(t);
}

export interface BlendStep {
  edge: Edge;
  /** Gelände, das über die Kachel gelegt wird. */
  terrain: TerrainKey;
  /** Land über Wasser (Ufer): eigene Ebene über der Wasser-Animation. */
  shore: boolean;
}

/**
 * Welche Überlagerungen eine Ansicht-Kachel bekommt, in Zeichenreihenfolge (niedriger Vorrang zuerst).
 * at(u, v) liefert das Gelände eines Ansicht-Tiles oder null außerhalb der Karte.
 */
export function blendPlan(at: (u: number, v: number) => TerrainKey | null, u: number, v: number): BlendStep[] {
  const self = at(u, v);
  if (!self) return [];
  const p = precedence(self);
  if (p < 0) return [];
  const out: BlendStep[] = [];
  for (const edge of EDGES) {
    const [du, dv] = EDGE_NEIGHBOUR[edge];
    const n = at(u + du, v + dv);
    if (!n || n === self) continue;
    const q = precedence(n);
    if (q <= p || n === "wasser") continue;
    out.push({ edge, terrain: n, shore: self === "wasser" });
  }
  out.sort((a, b) => precedence(a.terrain) - precedence(b.terrain));
  return out;
}

/** Stabile Maskenvariante je Tile und Kante (sieht unregelmäßig aus, flackert aber nicht beim Neuaufbau). */
export function maskVariant(x: number, y: number, edge: Edge, variants: number): number {
  if (variants <= 1) return 0;
  const h = Math.imul(x * 73856093 ^ y * 19349663 ^ (EDGES.indexOf(edge) + 1) * 83492791, 2654435761) >>> 0;
  return h % variants;
}

/**
 * Maskiert eine Kachel: out = Kachel mit Alpha · Maskenalpha / 255 (RGBA, gleiche Größe). Pixelart: harte Kante,
 * Alpha wird auf 0 oder 255 gerundet, damit keine weichen Verläufe entstehen.
 */
export function maskTile(tile: Uint8ClampedArray, mask: Uint8ClampedArray, out = new Uint8ClampedArray(tile.length)): Uint8ClampedArray {
  for (let i = 0; i < tile.length; i += 4) {
    const a = (tile[i + 3] * mask[i + 3]) / 255;
    if (a < 128) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }
    out[i] = tile[i]; out[i + 1] = tile[i + 1]; out[i + 2] = tile[i + 2]; out[i + 3] = 255;
  }
  return out;
}

/** Metadaten des Übergangsblatts (siehe Kopf). */
export interface BlendMeta { image: string; tile: [number, number]; edges: Edge[]; variants: number }
