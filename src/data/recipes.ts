/**
 * Rezepte der Verarbeitung (BRIEF §5.2, §5.5, ADR 0011).
 *
 * Ein Rezept nennt Eingänge und Ausgänge (Ware × Menge), die Arbeitszeit, das Gebäude und die Arbeitsanimation des
 * Arbeiters. Das Gebäude beschreibt in BuildingDef.production, wo sein Arbeiter steht und wie viel Eingangspuffer und
 * Ausgabestapel es fasst; seine Arbeiter tragen im Arbeitszyklus den Schritt { do: "process" }.
 *
 * Ablauf (src/sim/production.ts): Tagelöhner bringen die Eingänge aus dem passenden Lager (Lagertyp der Ware) zum
 * Eingangspuffer vor der Tür. Liegt genug für einen Arbeitsgang da und passt die Ausgabe auf den Ausgabestapel,
 * nimmt der Arbeiter die Eingänge, arbeitet `seconds` lang sichtbar (anim) und legt die Ausgänge auf den Stapel.
 * Träger bringen sie ins passende Lager. Ist das Ziellager voll, läuft der Stapel voll und die Arbeit ruht.
 *
 * Neues Rezept = ein Eintrag hier (Schlüssel in `RecipeKey` ergänzen). Mehrere Rezepte für dasselbe Gebäude sind
 * möglich: Das erste ist voreingestellt, der Spieler wechselt im Auswahlpanel (Befehl „rezept“).
 */
import type { Good } from "./goods";
import type { AnimKey, BuildingKey, TechKey } from "./index";
import { RUESTUNG_RECIPES, type RuestungRecipe } from "./ruestung";

export type RecipeKey = "mahlen" | "backen" | RuestungRecipe;

export interface RecipeDef {
  /** Name im Panel, z. B. „Mehl mahlen“. */
  name: string;
  /** Gebäude, in dem das Rezept läuft (es braucht BuildingDef.production). */
  building: BuildingKey;
  /** Verbrauch je Arbeitsgang. */
  inputs: Partial<Record<Good, number>>;
  /** Ertrag je Arbeitsgang. */
  outputs: Partial<Record<Good, number>>;
  /** Arbeitszeit je Arbeitsgang in Sekunden (Forschung kann sie über die Animation verkürzen, TechEffects.work). */
  seconds: number;
  /** Animation des Arbeiters während des Arbeitsgangs (Figurenblatt, mit Ersatz, falls sie fehlt). */
  anim: AnimKey;
  /** Gesperrt, bis diese Forschung abgeschlossen ist. */
  tech?: TechKey;
}

export const RECIPES: Record<RecipeKey, RecipeDef> = {
  mahlen: { name: "Mehl mahlen", building: "muehle", inputs: { getreide: 2 }, outputs: { mehl: 1 }, seconds: 10, anim: "mahlen" },
  backen: { name: "Brot backen", building: "baeckerei", inputs: { mehl: 1 }, outputs: { brot: 2 }, seconds: 12, anim: "backen" },
  // Schmelzen, Schmieden, Bogner (src/data/ruestung.ts)
  ...RUESTUNG_RECIPES,
};

export const RECIPE_KEYS = Object.keys(RECIPES) as RecipeKey[];

/** Rezepte eines Gebäudes in Datenreihenfolge (das erste ist voreingestellt). */
export function recipesOf(key: BuildingKey): RecipeKey[] {
  return RECIPE_KEYS.filter((k) => RECIPES[k].building === key);
}

/**
 * Verarbeitungsgebäude (BuildingDef.production). Positionen in Tiles ab Grundrissmitte, Modellachsen (wie posts,
 * shelves; Modell −y = Vorderseite mit der Tür), sie drehen mit der Ausrichtung des Gebäudes.
 */
export interface ProductionDef {
  /** Eingangspuffer: so viele Arbeitsgänge an Eingängen fasst das Gebäude (je Ware Menge × buffer). */
  buffer: number;
  /** Ausgabestapel: so viele Arbeitsgänge an Ausgängen (je Ware Menge × stock); voll = die Arbeit ruht. */
  stock: number;
  /** Arbeitsplatz im Inneren (der Arbeiter geht durch die Tür dorthin und ist dann nur im Schnittbild zu sehen). */
  spot: [number, number];
  /** Blickrichtung am Arbeitsplatz (Modellachsen), z. B. zum Ofen oder zum Mahlgang. */
  face: [number, number];
  /**
   * Sichtbare Stapel am Gebäude (Lagerstapel der Ware, Füllstufe nach Menge): Plätze für die Eingänge bzw. Ausgänge
   * in der Reihenfolge der Rezeptwaren, innerhalb des Grundrisses (dort läuft niemand hindurch).
   */
  inputPiles: [number, number][];
  outputPiles: [number, number][];
}
