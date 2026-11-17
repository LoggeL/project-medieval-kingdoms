/**
 * Spielziel als Daten (ADR 0019): Szenarien mit Siegbedingungen, Schwierigkeitsgrade und die Speicherplätze der
 * Oberfläche. Die Simulation (src/sim/match.ts) prüft die Ziele, die Oberfläche zeigt sie in der Aufgabenleiste und
 * auf der Sieg- bzw. Niederlagetafel. Ein neues Szenario oder ein neuer Schwierigkeitsgrad ist ein Eintrag hier.
 */
import type { UnitKey } from "./index";

// ---------------------------------------------------------------- Siegbedingungen
/**
 * Ein Teilziel. Gewonnen ist, wenn alle Teilziele eines Szenarios zugleich erfüllt sind und kein Angreifer mehr auf der
 * Karte steht. Neue Arten brauchen eine Zeile in goalProgress (src/sim/match.ts).
 */
export type VictoryGoal =
  /** So viele Überfallwellen abgewehrt (alle Angreifer gefallen oder abgezogen). */
  | { wellen: number }
  /** Der Bergfried hat diese Ausbaustufe erreicht (fertig ausgebaut). */
  | { stufe: number };

export type ScenarioKey = "tal";

export interface ScenarioDef {
  name: string;
  /** Auftrag in einem Satz (Titel, Aufgabenleiste, Siegtafel). */
  text: string;
  /** Alle Teilziele zusammen ergeben den Sieg. */
  sieg: VictoryGoal[];
  /** Wie die Partie verloren geht (Spielertext; die Regel selbst: Der Bergfried fällt, src/sim/build.ts). */
  niederlage: string;
}

export const SCENARIOS: Record<ScenarioKey, ScenarioDef> = {
  tal: {
    name: "Das Tal halten",
    text: "Baue die Siedlung zur Burg aus und wehre fünf Überfälle ab. Dann ist das Tal sicher.",
    sieg: [{ wellen: 5 }],
    niederlage: "Fällt der Bergfried, ist die Burg verloren.",
  },
};

export const DEFAULT_SCENARIO: ScenarioKey = "tal";

// ---------------------------------------------------------------- Schwierigkeitsgrade
export type DifficultyKey = "leicht" | "normal" | "schwer";

/** Überfall-Werte, die ein Schwierigkeitsgrad gegenüber START.raid ändert (fehlende Felder: wie START.raid). */
export interface RaidOverride {
  firstSeconds?: number;
  everySeconds?: number;
  baseSize?: number;
  growth?: number;
  mix?: UnitKey[];
}

export interface DifficultyDef {
  name: string;
  /** Kurzbeschreibung für die Auswahl im Titel. */
  text: string;
  /** Startgold (fehlt = START.gold). */
  gold?: number;
  /** Überfälle (fehlende Felder wie START.raid). */
  raid: RaidOverride;
  /** Lebenspunkte der Angreifer als Faktor (1 = Werte aus UNITS). */
  raiderHp: number;
}

/** Normal entspricht genau START (darauf ist die Balance der Tests abgestimmt). */
export const DIFFICULTIES: Record<DifficultyKey, DifficultyDef> = {
  leicht: {
    name: "Leicht",
    text: "Mehr Gold, mehr Zeit bis zum ersten Überfall, kleinere Wellen.",
    gold: 250,
    raid: { firstSeconds: 420, everySeconds: 300, baseSize: 3, growth: 1 },
    raiderHp: 0.85,
  },
  normal: {
    name: "Normal",
    text: "Erster Überfall nach fünf Minuten, jede Welle zwei Krieger stärker.",
    raid: {},
    raiderHp: 1,
  },
  schwer: {
    name: "Schwer",
    text: "Wenig Gold, früher und öfter Überfälle, zähere Angreifer.",
    gold: 100,
    raid: { firstSeconds: 240, everySeconds: 210, baseSize: 5, growth: 3 },
    raiderHp: 1.2,
  },
};

export const DIFFICULTY_KEYS = Object.keys(DIFFICULTIES) as DifficultyKey[];
export const DEFAULT_DIFFICULTY: DifficultyKey = "normal";

// ---------------------------------------------------------------- Speicherplätze (Oberfläche)
export type SaveSlotKey = "auto" | "schnell" | "platz1" | "platz2" | "platz3";

export interface SaveSlotDef {
  name: string;
  /** Der Spieler kann hier über das Menü speichern (auto und schnell beschreibt das Spiel selbst). */
  manual: boolean;
}

export const SAVE_SLOTS: Record<SaveSlotKey, SaveSlotDef> = {
  auto: { name: "Automatisch", manual: false },
  schnell: { name: "Schnellspeicher", manual: false },
  platz1: { name: "Platz 1", manual: true },
  platz2: { name: "Platz 2", manual: true },
  platz3: { name: "Platz 3", manual: true },
};

export const SAVE_SLOT_KEYS = Object.keys(SAVE_SLOTS) as SaveSlotKey[];

/** Automatisch speichern alle so viele Spielsekunden (0 = nie) und beim Wechsel ins Hauptmenü. */
export const AUTOSAVE_SECONDS = 120;
