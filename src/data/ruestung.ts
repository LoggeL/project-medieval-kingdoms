/**
 * Militärwirtschaft (BRIEF §5.5, §6.4, §13; ADR 0014): Erz → Eisen → Waffen und Rüstungen → Rekrut.
 *
 *   Erzmine (Bergleute brechen Erz aus den Erzbrocken am Fels, Hofstapel) → Lagerhaus
 *   Schmelzhütte (Erz + Holz → Eisen, Glut und Rauch, solange geschmolzen wird) → Lagerhaus
 *   Waffenschmiede (Eisen → Schwerter; Eisen + Holz → Piken), Bognerei (Holz → Bögen, Speere; Holz + Eisen → Armbrüste),
 *   Rüstungsschmiede (Eisen → Rüstungen) → Lagerhaus → Tagelöhner holt Waffe (und Rüstung) und tritt in die Kaserne ein
 *
 * Alles läuft über die vorhandenen Systeme: Waren (goods.ts), Rezepte (recipes.ts, BuildingDef.production),
 * Arbeitszyklen (Erzmine wie der Steinbruch, Tag „erz“ statt „rock“), Forschung (research.ts) und Ausbildung
 * (UnitDef.train). Diese Datei hängt sich mit je einer Zeile in GOODS, RECIPES, BUILDINGS, UNITS und TECHS ein.
 * Die Einheiten des Militärs selbst stehen in militaer.ts.
 */
import type { BuildingDef, UnitDef } from "./index";
import type { GoodDef } from "./goods";
import type { RecipeDef } from "./recipes";
import type { TechDef } from "./research";

// ---------------------------------------------------------------- Waren
export type RuestungGood = "erz" | "armbrust" | "pike" | "ruestung";

export const RUESTUNG_GOODS: Record<RuestungGood, GoodDef> = {
  erz: { name: "Erz", store: "material", group: "rohstoff", stack: "stapel_erz", carrier: "traeger_erz" },
  armbrust: { name: "Armbrüste", store: "material", group: "waffe", stack: "stapel_armbrust", carrier: "traeger_kiste" },
  pike: { name: "Piken", store: "material", group: "waffe", stack: "stapel_pike", carrier: "traeger_pike" },
  ruestung: { name: "Rüstungen", store: "material", group: "waffe", stack: "stapel_ruestung", carrier: "traeger_kiste" },
};

// ---------------------------------------------------------------- Rezepte
export type RuestungRecipe =
  | "schmelzen" | "schwert_schmieden" | "pike_schmieden" | "bogen_bauen" | "speer_bauen" | "armbrust_bauen" | "ruestung_schmieden";

export const RUESTUNG_RECIPES: Record<RuestungRecipe, RecipeDef> = {
  schmelzen: { name: "Eisen schmelzen", building: "schmelzhuette", inputs: { erz: 2, holz: 1 }, outputs: { eisen: 1 }, seconds: 14, anim: "schmelzen" },
  schwert_schmieden: { name: "Schwerter schmieden", building: "waffenschmiede", inputs: { eisen: 1 }, outputs: { schwert: 1 }, seconds: 12, anim: "schmieden" },
  pike_schmieden: { name: "Piken schmieden", building: "waffenschmiede", inputs: { eisen: 1, holz: 2 }, outputs: { pike: 2 }, seconds: 14, anim: "schmieden", tech: "gewalthaufen" },
  bogen_bauen: { name: "Bögen bauen", building: "bognerei", inputs: { holz: 2 }, outputs: { bogen: 1 }, seconds: 10, anim: "schnitzen" },
  speer_bauen: { name: "Speere schnitzen", building: "bognerei", inputs: { holz: 1 }, outputs: { speer: 1 }, seconds: 8, anim: "schnitzen" },
  armbrust_bauen: { name: "Armbrüste bauen", building: "bognerei", inputs: { holz: 2, eisen: 1 }, outputs: { armbrust: 1 }, seconds: 14, anim: "schnitzen", tech: "armbrustbau" },
  ruestung_schmieden: { name: "Rüstungen schmieden", building: "ruestungsschmiede", inputs: { eisen: 2 }, outputs: { ruestung: 1 }, seconds: 16, anim: "schmieden" },
};

// ---------------------------------------------------------------- Gebäude
export type RuestungBuilding = "erzmine" | "schmelzhuette" | "waffenschmiede" | "bognerei" | "ruestungsschmiede";

/**
 * Werkstatt 3 × 2 (tools/blender/buildings_ruestung.py): Haus im Westen und in der Mitte, Hof im Osten. Eingänge links
 * und rechts vor der Vorderwand, Ausgabe im Hof hinten rechts; Arbeitsplatz am Amboss bzw. an der Schnitzbank
 * (Modell (−0,55 m, 0,46 m) bzw. (−0,35 m, 0,46 m)), der Arbeiter steht westlich davon und schaut nach +x.
 */
const WERKSTATT = {
  buffer: 3, stock: 3, spot: [-0.42, 0.18] as [number, number], face: [1, 0] as [number, number],
  inputPiles: [[-1.05, -0.78], [1.05, -0.78]] as [number, number][], outputPiles: [[1.1, 0.3]] as [number, number][],
};
const WERKSTATT_BAU = (key: string) => ({ ground: `baustelle_${key}`, scaffold: `geruest_${key}`, foundation: 0.15, piles: [[0.55, -0.78], [-1.0, -0.78]] as [number, number][] });

export const RUESTUNG_BUILDINGS: Record<RuestungBuilding, BuildingDef> = {
  erzmine: {
    name: "Erzmine", desc: "Zwei Bergleute brechen Erz aus den rostroten Erzbrocken am Fels und schütten es auf den Hof. Muss nahe an einem Erzvorkommen stehen.",
    category: "wirtschaft", footprint: [3, 3], cost: { holz: 14, stein: 4 }, buildSeconds: 20, sprite: "erzmine", door: [0, -2],
    construction: { ground: "baustelle_erzmine", foundation: 0.2, piles: [[-0.5, -0.75], [0.45, -0.75]] },
    placement: { nearTag: { tag: "erz", count: 1, radius: 7 } },
    workers: {
      unit: "bergmann", count: 2, cycle: [
        { do: "reserveNearest", tag: "erz", radius: 9 },
        { do: "walkTo", target: "reserved" },
        { do: "work", anim: "abbauen", seconds: 7, effect: "mineRock", produce: { erz: 1 }, carry: true },
        { do: "walkTo", target: "home" },
        { do: "deposit", into: "output" },
      ],
    },
    output: { good: "erz", capacity: 6 }, hp: 260,
  },
  schmelzhuette: {
    name: "Schmelzhütte", desc: "Der Schmelzer schmilzt im Rennofen aus zwei Erz und einem Holz ein Eisen. Solange er schmilzt, glüht das Abstichloch und der Schlot raucht.",
    category: "handwerk", footprint: [3, 2], cost: { holz: 8, stein: 12 }, buildSeconds: 22, sprite: "schmelzhuette", door: [-0.5, -1.5],
    construction: WERKSTATT_BAU("schmelzhuette"),
    workers: { unit: "schmelzer", count: 1, cycle: [{ do: "process" }] },
    production: { ...WERKSTATT, spot: [-0.12, 0.1], face: [1, 0.3] },
    // Variante 0 = kalter Ofen, 1–3 = Glut (laufen, solange geschmolzen wird)
    workAnim: { fps: 4, idle: 0 },
    interior: { sprite: "schmelzhuette_innen" }, tech: "rennofen", hp: 280,
  },
  waffenschmiede: {
    name: "Waffenschmiede", desc: "Der Schmied schmiedet aus Eisen Schwerter, nach der Forschung „Gewalthaufen“ aus Eisen und Holz auch Piken. Rauch über der Esse, solange gearbeitet wird.",
    category: "handwerk", footprint: [3, 2], cost: { holz: 10, stein: 8 }, buildSeconds: 20, sprite: "waffenschmiede", door: [0, -1.5],
    construction: WERKSTATT_BAU("waffenschmiede"),
    workers: { unit: "schmied", count: 1, cycle: [{ do: "process" }] },
    production: WERKSTATT,
    interior: { sprite: "waffenschmiede_innen" }, hp: 240,
  },
  bognerei: {
    name: "Bognerei", desc: "Der Bogner schnitzt aus Holz Bögen und Speere, nach der Forschung „Armbrustbau“ mit einem Eisen auch Armbrüste.",
    category: "handwerk", footprint: [3, 2], cost: { holz: 12 }, buildSeconds: 16, sprite: "bognerei", door: [0, -1.5],
    construction: WERKSTATT_BAU("bognerei"),
    workers: { unit: "bogner", count: 1, cycle: [{ do: "process" }] },
    production: { ...WERKSTATT, spot: [-0.24, 0.18] },
    interior: { sprite: "bognerei_innen" }, hp: 180,
  },
  ruestungsschmiede: {
    name: "Rüstungsschmiede", desc: "Der Schmied flicht und schmiedet aus zwei Eisen eine Rüstung (Kettenhemd und Harnisch). Pikeniere brauchen sie.",
    category: "handwerk", footprint: [3, 2], cost: { holz: 8, stein: 14 }, buildSeconds: 24, sprite: "ruestungsschmiede", door: [0, -1.5],
    construction: WERKSTATT_BAU("ruestungsschmiede"),
    workers: { unit: "schmied", count: 1, cycle: [{ do: "process" }] },
    production: WERKSTATT,
    interior: { sprite: "ruestungsschmiede_innen" }, tech: "kettenschmiede", hp: 280,
  },
};

// ---------------------------------------------------------------- Arbeiter
export type RuestungWorker = "bergmann" | "schmelzer" | "schmied" | "bogner";

export const RUESTUNG_WORKERS: Record<RuestungWorker, UnitDef> = {
  bergmann: { name: "Bergmann", sprite: "bergmann", role: "arbeiter", hp: 35, speed: 1.4, armor: 0 },
  schmelzer: { name: "Schmelzer", sprite: "schmelzer", role: "arbeiter", hp: 35, speed: 1.4, armor: 0 },
  schmied: { name: "Schmied", sprite: "schmied", role: "arbeiter", hp: 40, speed: 1.4, armor: 0 },
  bogner: { name: "Bogner", sprite: "bogner", role: "arbeiter", hp: 35, speed: 1.5, armor: 0 },
};

// ---------------------------------------------------------------- Forschung
export type RuestungTech = "rennofen" | "armbrustbau" | "kettenschmiede" | "gewalthaufen";

/** Ikonen im Blatt assets/ui/forschung_ruestung.png (tools/ui/forschung_ikonen_ruestung.py). */
export const RUESTUNG_TECHS: Record<RuestungTech, TechDef> = {
  rennofen: {
    name: "Rennofen", desc: "Lehmofen mit Blasebalg: Aus Erz und Holz wird Eisen. Schaltet die Schmelzhütte frei.",
    icon: 0, iconSheet: "forschung_ruestung", cost: { gold: 15, stein: 10 }, seconds: 35, branch: 1,
  },
  kettenschmiede: {
    name: "Kettenschmiede", desc: "Ringe flechten, Platten treiben: Schaltet die Rüstungsschmiede frei.",
    icon: 2, iconSheet: "forschung_ruestung", cost: { gold: 25, eisen: 4 }, seconds: 45, branch: 1,
    requires: { techs: ["rennofen"], buildings: ["waffenschmiede"] },
  },
  armbrustbau: {
    name: "Armbrustbau", desc: "Stahlbogen, Nuss und Steigbügel: Die Bognerei baut Armbrüste, die Kaserne bildet Armbrustschützen aus.",
    icon: 1, iconSheet: "forschung_ruestung", cost: { gold: 25, holz: 8, eisen: 2 }, seconds: 45, branch: 2,
    requires: { techs: ["rennofen"], buildings: ["bognerei"] },
  },
  gewalthaufen: {
    name: "Gewalthaufen", desc: "Der Pikenblock: Die Waffenschmiede schmiedet Piken, die Kaserne bildet Pikeniere aus.",
    icon: 3, iconSheet: "forschung_ruestung", cost: { gold: 30, holz: 10, eisen: 2 }, seconds: 50, branch: 2,
    requires: { techs: ["kettenschmiede"], buildings: ["kaserne"] },
  },
};
