/**
 * Welche Dateien eines Sprite-Ordners das Spiel lädt. Eine einzige Quelle für den Lader (render/assets.ts) und das
 * Ausdünnen im Build (vite.config.ts, Plugin spielAssets): Was der Build entfernt, darf der Lader nie verlangen.
 * Ohne Pixi und ohne DOM, damit vite.config.ts und Tests es nutzen können.
 */

export interface FigureFilesMeta { cell: number; units: { key: string; row?: number }[] }
export interface BuildingFilesMeta { units: { key: string; front?: unknown }[] }
export interface TerrainFilesMeta { image?: string; keys: Record<string, { image?: string }>; blend?: { image?: string } }

/** Erste Atlaszeile je Einheit (acht Richtungszeilen je Einheit). */
export function figureRow(u: { row?: number }, i: number): number {
  return u.row ?? i * 8;
}

/** Zeilen, die ein Atlas mindestens haben muss, damit er alle Einheiten des Blatts enthält. */
export function figureRows(meta: FigureFilesMeta): number {
  return Math.max(0, ...meta.units.map((u, i) => figureRow(u, i) + 8));
}

/** Enthält ein Atlas dieser Höhe (Pixel) alle Einheiten? Sonst lädt das Spiel die Einzelbilder <einheit>.png. */
export function atlasCovers(meta: FigureFilesMeta, atlasHeight: number | null): boolean {
  return atlasHeight !== null && atlasHeight >= figureRows(meta) * meta.cell;
}

/** Figurenordner: sheet.json und entweder atlas.png (deckt alle Einheiten) oder alle Einzelbilder. */
export function figureFiles(meta: FigureFilesMeta, atlasHeight: number | null): string[] {
  return atlasCovers(meta, atlasHeight) ? ["sheet.json", "atlas.png"] : ["sheet.json", ...meta.units.map((u) => `${u.key}.png`)];
}

/** Geländeordner: Hauptbild, die Bilder angehängter Geländearten und die Übergangsmasken. */
export function terrainImages(meta: TerrainFilesMeta): string[] {
  const main = meta.image || "terrain.png";
  return [...new Set([main, ...Object.values(meta.keys).map((k) => k.image ?? main)])];
}

export function terrainFiles(meta: TerrainFilesMeta): string[] {
  return ["sheet.json", ...terrainImages(meta), ...(meta.blend?.image ? [meta.blend.image] : [])];
}

/** Gebäudeordner: je Eintrag <key>.png und, falls vorhanden, <key>_front.png. */
export function buildingFiles(meta: BuildingFilesMeta): string[] {
  return ["sheet.json", ...meta.units.flatMap((u) => (u.front ? [`${u.key}.png`, `${u.key}_front.png`] : [`${u.key}.png`]))];
}

/** Höhe eines PNG aus dem Dateikopf (IHDR), ohne es zu dekodieren; null, wenn es kein PNG ist. */
export function pngHeight(bytes: Uint8Array): number | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  return ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
}
