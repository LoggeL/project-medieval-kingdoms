/**
 * Gebäude der Brotkette (BRIEF §5.2, §5.4, §5.5; ADR 0011): Kornkammer (Lager für Lebensmittel), Mühle (Getreide →
 * Mehl) und Bäckerei (Mehl → Brot). Sie werden in BUILDINGS (index.ts) eingehängt. Weitere Ketten legen ihre Gebäude
 * genauso in einer eigenen Datei an und hängen sie dort mit einer Zeile ein (Muster und Felder: src/sim/README.md).
 */
import type { BuildingDef } from "./index";

export type VerarbeitungKey = "kornkammer" | "muehle" | "baeckerei";

export const VERARBEITUNG: Record<VerarbeitungKey, BuildingDef> = {
  kornkammer: {
    name: "Kornkammer", desc: "Bohlenspeicher mit Strohdach für Getreide, Mehl, Brot und andere Lebensmittel: sechs Fächer mit Säcken, Fässern und Körben. Maus darüber zeigt die Fächer.",
    category: "nahrung", footprint: [3, 3], cost: { holz: 12 }, buildSeconds: 16, sprite: "kornkammer", door: [0, -2],
    construction: { ground: "baustelle_kornkammer", scaffold: "geruest_kornkammer", foundation: 0.15, piles: [[0.62, -1.32]] },
    storage: {
      kind: "nahrung", slots: 6, perSlot: 20,
      // dieselben Werte stehen in tools/blender/buildings/buildings.json (kornkammer_innen)
      shelves: [[-0.95, -0.62], [0.95, -0.62], [-0.95, 0.12], [0.95, 0.12], [-0.95, 0.86], [0.95, 0.86]],
    },
    // leichter Holzspeicher: Angreifer räumen ihn schnell (er steht ab Beginn und soll die erste Welle nicht spürbar
    // länger vom Bergfried fernhalten, tests/sim/bergfried.test.ts „braucht dort über zwei Minuten“)
    interior: { sprite: "kornkammer_innen" }, hp: 100,
  },
  muehle: {
    name: "Windmühle", desc: "Der Müller mahlt Getreide aus der Kornkammer zu Mehl, solange sich die Flügel drehen. Neben der Tür liegen das angelieferte Getreide und das fertige Mehl.",
    category: "nahrung", footprint: [3, 3], cost: { holz: 14, stein: 10 }, buildSeconds: 24, sprite: "muehle", door: [0, -2],
    construction: { ground: "baustelle_muehle", scaffold: "geruest_muehle", foundation: 0.15, piles: [[-1.0, -1.0], [1.0, -1.0]] },
    workers: { unit: "mueller", count: 1, cycle: [{ do: "process" }] },
    production: {
      buffer: 3, stock: 4, spot: [0.3, 0.05], face: [-1, 0.55],
      inputPiles: [[-0.98, -1.02]], outputPiles: [[0.98, -1.02]],
    },
    workAnim: { fps: 6 },
    interior: { sprite: "muehle_innen" }, hp: 350,
  },
  baeckerei: {
    name: "Bäckerei", desc: "Der Bäcker backt aus Mehl Brot im Steinofen. Rauch steigt auf, solange gebacken wird; Mehlsäcke und Brotkörbe stehen vor dem Haus.",
    category: "nahrung", footprint: [3, 2], cost: { holz: 10, stein: 6 }, buildSeconds: 18, sprite: "baeckerei", door: [-0.5, -1.5],
    construction: { ground: "baustelle_baeckerei", scaffold: "geruest_baeckerei", foundation: 0.15, piles: [[0.55, -0.78], [-1.0, -0.78]] },
    workers: { unit: "baecker", count: 1, cycle: [{ do: "process" }] },
    production: {
      buffer: 3, stock: 3, spot: [0.45, 0.1], face: [1, 0],
      inputPiles: [[-1.18, -0.78]], outputPiles: [[0.25, -0.78]],
    },
    interior: { sprite: "baeckerei_innen" }, hp: 220,
  },
};
