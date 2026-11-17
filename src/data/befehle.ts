/**
 * Befehle und Steuerung der Soldaten (Briefing §7, ADR 0018): Formationen, Haltungen, Rückzug, Angriffsbewegung,
 * Patrouille. Alles hier ist Daten; die Simulation (src/sim/befehle.ts) und das Auswahlpanel lesen nur diese Werte.
 * Tasten stehen in src/data/hotkeys.ts (BUTTON_KEYS), die Ikonen in assets/ui/befehle.png (Spalte `icon`, 64 px).
 */

// ---------------------------------------------------------------- Formationen
export type FormationKey = "linie" | "block" | "locker";

export interface FormationDef {
  name: string;
  /** Tooltip im Panel. */
  desc: string;
  /** Abstand zwischen zwei Plätzen (Felder). */
  spacing: number;
  /**
   * Seitenverhältnis Breite : Tiefe. Spalten = ⌈√(n · aspect)⌉, höchstens n. Linie 8: bis 8 Mann eine Reihe,
   * Block 1: quadratisch.
   */
  aspect: number;
  /** Spalte im Ikonenblatt. */
  icon: number;
}

/**
 * Plätze entstehen als Reihen quer zur Blickrichtung: vorn die Nahkämpfer, dahinter in eigenen Reihen die Fernkämpfer.
 * Belegte oder unerreichbare Plätze (Gebäude, Wasser, Bäume) weichen auf das nächste freie Feld aus.
 */
export const FORMATIONS: Record<FormationKey, FormationDef> = {
  linie: { name: "Linie", desc: "Breite Reihe quer zur Blickrichtung, Schützen in einer zweiten Reihe dahinter", spacing: 1, aspect: 8, icon: 5 },
  block: { name: "Block", desc: "Dichtes Viereck, Schützen in den hinteren Reihen", spacing: 1, aspect: 1, icon: 6 },
  locker: { name: "Locker", desc: "Weit auseinander (zwei Felder Abstand), Schützen hinten", spacing: 2, aspect: 1.5, icon: 7 },
};

export const FORMATION_ORDER: FormationKey[] = ["linie", "block", "locker"];
/** Ohne gewählte Formation (alte Spielstände, neue Rekruten). */
export const DEFAULT_FORMATION: FormationKey = "block";

// ---------------------------------------------------------------- Haltungen
export type StanceKey = "aggressiv" | "defensiv" | "stellung";

export interface StanceDef {
  name: string;
  desc: string;
  /**
   * Untätig: Gegner in diesem Umkreis (Felder) angreifen. null = nur, was ohne einen Schritt in Reichweite ist
   * (Stellung halten).
   */
  engage: number | null;
  /**
   * Verfolgen bis zu diesem Abstand (Felder). anchored: gemessen vom Standplatz (danach zurück dorthin), sonst vom
   * Verfolger zum Ziel (läuft das Ziel weiter weg, lässt er ab und bleibt, wo er ist).
   */
  leash: number;
  anchored: boolean;
  icon: number;
}

export const STANCES: Record<StanceKey, StanceDef> = {
  aggressiv: { name: "Aggressiv", desc: "Greift Gegner in Sichtweite an und verfolgt sie weit", engage: 8, leash: 12, anchored: false, icon: 8 },
  defensiv: { name: "Defensiv", desc: "Greift nur nahe Gegner an, verfolgt sie kurz und kehrt an seinen Platz zurück", engage: 4, leash: 6, anchored: true, icon: 9 },
  stellung: { name: "Stellung halten", desc: "Bleibt stehen und kämpft nur, was in Reichweite ist", engage: null, leash: 0, anchored: true, icon: 1 },
};

export const STANCE_ORDER: StanceKey[] = ["aggressiv", "defensiv", "stellung"];
export const DEFAULT_STANCE: StanceKey = "aggressiv";

// ---------------------------------------------------------------- Befehle
export type CommandKey = "stationieren" | "angriffsbewegung" | "patrouille" | "rueckzug";

export interface CommandDef {
  name: string;
  desc: string;
  icon: number;
  /** Braucht der Befehl Klicks in die Welt (Werkzeug), oder wirkt er sofort? */
  tool: boolean;
}

export const COMMANDS: Record<CommandKey, CommandDef> = {
  stationieren: { name: "Stationieren", desc: "Auf freie Posten an Mauern und Türmen verteilen", icon: 0, tool: false },
  angriffsbewegung: { name: "Angriffsmarsch", desc: "Zum Zielpunkt marschieren und unterwegs jeden Gegner angreifen (danach Klick in die Welt)", icon: 3, tool: true },
  patrouille: { name: "Patrouille", desc: "Zwischen dem Standort und den angeklickten Wegmarken hin und her gehen, Gegner unterwegs angreifen (Umschalt: weitere Wegmarken)", icon: 2, tool: true },
  rueckzug: { name: "Rückzug", desc: "Schneller laufend zum Bergfried zurückziehen, ohne zu kämpfen", icon: 4, tool: false },
};

export const COMMAND_TUNING = {
  /** Tempo beim Rückzug (Faktor auf das Lauftempo); die Laufanimation läuft entsprechend schneller. */
  retreatSpeed: 1.4,
  /** Angriffsmarsch und Patrouille: Gegner in diesem Umkreis (Felder) angreifen, verfolgen bis leash. */
  marchEngage: 7,
  marchLeash: 10,
  /** Höchstens so viele Wegmarken je Patrouille (ohne Startpunkt). */
  patrolPoints: 8,
  /** Suchradius (Felder) für einen freien Ersatzplatz, wenn ein Formationsplatz blockiert ist. */
  slotSearch: 6,
};
