/**
 * Prüfstand: lädt die echten Blätter im Stil „Vorgerendert“ (Gebäude und Figuren) und schneidet daraus Icons.
 * Nur für ui-test.html. Die echte Brücke (Darstellung) liefert icon() selbst.
 */
const STYLE = "vorgerendert";

interface BuildingSheet { cell: [number, number]; anchor: [number, number]; units: { key: string; frames: number; front: boolean }[] }
interface FigureSheet { cell: number; anchor: [number, number]; units: { key: string; anims?: Record<string, [number, number]> }[] }

export interface Sprites {
  buildings: BuildingSheet;
  figures: FigureSheet;
  bimg: Map<string, HTMLImageElement>;
  atlas: HTMLImageElement;
  /** Ausschnitt eines Gebäudes (Ansicht view, Variante variant) als Bild mit Anker, oder null. */
  building(key: string, view: number, variant?: number): { img: HTMLImageElement; sx: number; sy: number } | null;
  figureRow(key: string): number;
}

const loadImg = (src: string) => new Promise<HTMLImageElement | null>((res) => {
  const i = new Image();
  i.onload = () => res(i);
  i.onerror = () => res(null);
  i.src = src;
});

export async function loadSprites(): Promise<Sprites> {
  const base = import.meta.env.BASE_URL;
  const [buildings, figures] = await Promise.all([
    fetch(`${base}buildings/${STYLE}/sheet.json`).then((r) => r.json() as Promise<BuildingSheet>),
    fetch(`${base}figures/${STYLE}/sheet.json`).then((r) => r.json() as Promise<FigureSheet>),
  ]);
  const bimg = new Map<string, HTMLImageElement>();
  await Promise.all(buildings.units.map(async (u) => {
    const im = await loadImg(`${base}buildings/${STYLE}/${u.key}.png`);
    if (im) bimg.set(u.key, im);
  }));
  const atlas = await loadImg(`${base}figures/${STYLE}/atlas.png`);
  if (!atlas) throw new Error("Figurenblatt fehlt");
  const [cw, ch] = buildings.cell;
  return {
    buildings, figures, bimg, atlas,
    building(key, view, variant) {
      const u = buildings.units.find((q) => q.key === key);
      const img = bimg.get(key);
      if (!u || !img) return null;
      const col = Math.min(u.frames - 1, variant ?? u.frames - 1);
      return { img, sx: col * cw, sy: (view & 3) * ch };
    },
    figureRow(key) {
      const i = figures.units.findIndex((q) => q.key === key);
      return i < 0 ? -1 : i * 8;
    },
  };
}

/** Undurchsichtigen Bereich eines Ausschnitts zuschneiden. */
export function cropToAlpha(src: CanvasImageSource, sx: number, sy: number, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(src, sx, sy, w, h, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return c;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** In ein quadratisches Icon einpassen (verkleinern geglättet, vergrößern pixelig). */
export function fitIcon(src: HTMLCanvasElement, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d")!;
  let k = Math.min(size / src.width, size / src.height);
  if (k >= 1) k = Math.floor(k);
  g.imageSmoothingEnabled = k < 1;
  g.imageSmoothingQuality = "high";
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  g.drawImage(src, Math.floor((size - w) / 2), size - h, w, h);
  return c;
}
