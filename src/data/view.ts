/**
 * Zoomstufen der Kamera (Faktor auf die Welt-Pixel).
 *
 * Ganzzahlige Stufen (1, 2, 3, 4) sind pixelgenau: jedes Sprite-Pixel wird zu einem Quadrat aus ganzen Bildschirmpixeln.
 * 1,5 rendert pixelgenau bei 2× und verkleinert das ganze Bild danach weich (scharf mit weichen Kanten), siehe
 * pixelMode in src/render/camera.ts. Unter 1 (0,25, 0,5, 0,75) wird weich verkleinert; 0,25 zeigt die ganze Karte.
 */
export const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

/** Startstufe: 2× (Index in ZOOMS). */
export const ZOOM_DEFAULT = 5;

/** Dauer des sanften Übergangs zwischen zwei Stufen (ms); bei reduzierter Bewegung springt der Zoom. */
export const ZOOM_MS = 160;

/** Zoomfaktor für die Anzeige, deutsch: 0,25×, 1,5×, 2×. */
export function zoomLabel(z: number): string {
  return `${String(Math.round(z * 100) / 100).replace(".", ",")}×`;
}
