/**
 * Landwirtschaft (BRIEF §5.2, §5.5, §13; ADR 0013): Getreidehof mit Feldern und Obstgarten.
 *
 * Ein Hof (BuildingDef.fields) bewirtschaftet die Felder in einem Rechteck neben seinem Grundriss. Jede Feldkachel ist
 * ein Beet mit einer Feldfrucht (CROPS) und durchläuft deren Stufen: Arbeitsstufen (work) brauchen den Bauern, der
 * hingeht und sichtbar arbeitet (Umgraben, Säen, Ernten); Wachstumsstufen (grow) laufen von selbst. Die Ernte trägt der
 * Bauer als Garbe bzw. Korb zum Hof (Hofstapel `output`), von dort bringen Träger sie in die Kornkammer (Lagertyp der
 * Ware). Danach beginnt das Beet wieder bei `after`.
 *
 * Neue Feldfrucht = ein Eintrag in CROPS (Schlüssel in CropKey) mit Sprite im Gebäudeblatt (Varianten = `frame` der
 * Stufen); neuer Hof = Gebäude mit `fields`, Arbeitszyklus [{ do: "farm" }] und `output` (Ware der Ernte).
 */
import type { Good } from "./goods";
import type { AnimKey, BuildingDef, TerrainKey } from "./index";

export type CropKey = "getreide" | "apfel";

export interface CropStage {
  /** Name der Stufe (Panel), z. B. „gepflügt“. */
  name: string;
  /** Sprite-Variante des Beets in dieser Stufe. */
  frame: number;
  /** Wächst ohne Zutun so viele Sekunden, dann folgt die nächste Stufe. */
  grow?: number;
  /**
   * Der Bauer muss hier arbeiten (anim, Sekunden), damit es weitergeht; verb steht im Panel („pflügt“). Forschung kann
   * die Zeit über die Animation verkürzen (TechEffects.work).
   */
  work?: { anim: AnimKey; seconds: number; verb: string };
  /**
   * Ertrag am Ende dieser Arbeit: amount Stück der Ware, die der Bauer in einem Gang zum Hof trägt (Garbe, Korb); danach
   * beginnt das Beet bei CropDef.after.
   */
  harvest?: { good: Good; amount: number };
}

export interface CropDef {
  name: string;
  /** Sprite des Beets im Gebäudeblatt (1 × 1, Varianten = Stufen). */
  sprite: string;
  stages: CropStage[];
  /** Stufe nach der Ernte (Getreide: wieder pflügen; Apfelbaum: er treibt neu aus). */
  after: number;
}

export const CROPS: Record<CropKey, CropDef> = {
  getreide: {
    name: "Getreide", sprite: "acker", after: 0,
    stages: [
      { name: "brach", frame: 0, work: { anim: "pfluegen", seconds: 4, verb: "hackt das Beet um" } },
      { name: "umgegraben", frame: 1, work: { anim: "saeen", seconds: 3, verb: "sät aus" } },
      { name: "gesät", frame: 2, grow: 20 },
      { name: "keimt", frame: 3, grow: 25 },
      { name: "wächst", frame: 4, grow: 25 },
      { name: "reif", frame: 5, work: { anim: "ernten", seconds: 4, verb: "erntet" }, harvest: { good: "getreide", amount: 2 } },
    ],
  },
  apfel: {
    name: "Äpfel", sprite: "apfelbaum", after: 1,
    stages: [
      { name: "Setzling", frame: 0, grow: 45 },
      { name: "belaubt", frame: 1, grow: 60 },
      { name: "blüht", frame: 2, grow: 60 },
      { name: "trägt Früchte", frame: 3, work: { anim: "pfluecken", seconds: 4, verb: "pflückt Äpfel" }, harvest: { good: "apfel", amount: 1 } },
    ],
  },
};

/**
 * Felder eines Hofs. rect = [x0, y0, Breite, Tiefe] in Tiles, Modellachsen ab Grundrissmitte (wie posts, door; Modell
 * −y = Vorderseite), dreht mit der Ausrichtung. Jede Kachel im Rechteck auf passendem Gelände (`terrain`), ohne Bau,
 * Baum, Fels, fremdes Feld und Vorplatz einer Tür wird ein Beet; es müssen mindestens `min` sein.
 */
export interface FieldDef {
  crop: CropKey;
  rect: [number, number, number, number];
  /** Gelände, auf dem die Frucht wächst (später „fruchtbar“ dazu, siehe ADR 0013). */
  terrain: TerrainKey[];
  min: number;
}

export type LandwirtschaftKey = "bauernhof" | "obstgarten";

export const LANDWIRTSCHAFT: Record<LandwirtschaftKey, BuildingDef> = {
  bauernhof: {
    name: "Getreidehof", desc: "Der Bauer hackt die Beete um, sät, und erntet das reife Korn. Die Garben trägt er auf den Hof, Träger bringen sie in die Kornkammer. Felder nur auf Wiese.",
    category: "nahrung", footprint: [2, 2], cost: { holz: 10 }, buildSeconds: 14, sprite: "bauernhof", door: [0, -1.5],
    construction: { ground: "baustelle_bauernhof", scaffold: "geruest_bauernhof", foundation: 0.15, piles: [[0.35, -0.82]] },
    workers: { unit: "bauer", count: 1, cycle: [{ do: "farm" }] },
    fields: { crop: "getreide", rect: [1, -1, 4, 3], terrain: ["wiese"], min: 6 },
    output: { good: "getreide", capacity: 6 }, hp: 150,
  },
  obstgarten: {
    name: "Obstgarten", desc: "Der Obstbauer pflegt die Apfelbäume neben seiner Hütte und pflückt die reifen Äpfel. Träger bringen die Körbe in die Kornkammer: Äpfel kann man gleich essen.",
    category: "nahrung", footprint: [2, 2], cost: { holz: 8 }, buildSeconds: 12, sprite: "obstgarten", door: [0, -1.5],
    construction: { ground: "baustelle_obstgarten", foundation: 0.15, piles: [[0.35, -0.82]] },
    workers: { unit: "obstbauer", count: 1, cycle: [{ do: "farm" }] },
    fields: { crop: "apfel", rect: [1, -1, 3, 3], terrain: ["gras", "wiese"], min: 4 },
    output: { good: "apfel", capacity: 6 }, hp: 120,
  },
};
