/**
 * Lebendige Welt (BRIEF §2.1, §10; ADR 0016): Tiere, nachwachsender Wald, Ruhe- und Wachbewegungen, Fahnen im Wind,
 * Tageslicht. Alles hier sind Daten; die Simulation (src/sim/animals.ts, src/sim/forest.ts) und die Darstellung lesen
 * sie nur. Zeiten in Sekunden, Strecken in Feldern.
 */
import type { TerrainKey } from "./index";

export type AnimalKey = "schaf" | "kuh" | "pferd" | "hirsch" | "reh" | "kraehe";

/** Animationen der Tiere (Spalten im Figurenblatt, tools/blender/figures.py ANIMAL_COLS bzw. BIRD_COLS). */
export type AnimalAnim = "stehen" | "gehen" | "grasen" | "rennen" | "sterben" | "tot" | "fliegen" | "picken" | "auffliegen";

export interface AnimalDef {
  name: string;
  /** Figur im Figurenblatt. */
  sprite: string;
  /** herde: weidet friedlich; wild: flieht vor Figuren; vogel: pickt am Boden und fliegt auf. */
  kind: "herde" | "wild" | "vogel";
  /** Gelände, auf dem das Tier lebt (Startplätze und Wanderziele). */
  terrain: TerrainKey[];
  /** Gehen und Rennen bzw. Fliegen (Felder pro Sekunde). */
  speed: number;
  run: number;
  /** Abstand, ab dem es vor einer Figur flieht bzw. auffliegt (0 = nie). */
  shy: number;
  /** So weit entfernt es sich höchstens von seinem Weideplatz. */
  roam: number;
  /** Größe einer Gruppe beim Start [min, max] und Zahl der Gruppen (Standardkarte 64 × 64, skaliert mit der Fläche). */
  group: [number, number];
  groups: number;
  /** Dauer einer Ruhe- bzw. Fresspause [min, max]. */
  pause: [number, number];
  /** Bilder pro Sekunde je Animation (fehlt = 10). */
  fps?: Partial<Record<AnimalAnim, number>>;
  /** Jagdbares Wild: Fleisch und Lebenspunkte (Schnittstelle für ein späteres Jägerhaus, siehe ADR 0016). */
  game?: { meat: number; hp: number };
}

export const ANIMALS: Record<AnimalKey, AnimalDef> = {
  schaf: {
    name: "Schaf", sprite: "schaf", kind: "herde", terrain: ["wiese", "gras"], speed: 0.6, run: 1.6, shy: 0, roam: 4,
    group: [3, 5], groups: 2, pause: [4, 10], fps: { grasen: 3, gehen: 8 },
  },
  kuh: {
    name: "Kuh", sprite: "kuh", kind: "herde", terrain: ["wiese", "gras"], speed: 0.5, run: 1.4, shy: 0, roam: 4,
    group: [2, 3], groups: 1, pause: [6, 14], fps: { grasen: 2, gehen: 6 },
  },
  pferd: {
    name: "Pferd", sprite: "pferd", kind: "herde", terrain: ["gras", "wiese"], speed: 0.8, run: 3.2, shy: 0, roam: 5,
    group: [2, 3], groups: 1, pause: [5, 12], fps: { grasen: 3, gehen: 8, rennen: 12 },
  },
  hirsch: {
    name: "Rothirsch", sprite: "hirsch", kind: "wild", terrain: ["waldboden"], speed: 0.9, run: 3.4, shy: 4.5, roam: 6,
    group: [1, 3], groups: 2, pause: [4, 10], fps: { grasen: 3, gehen: 8, rennen: 12 }, game: { meat: 6, hp: 40 },
  },
  reh: {
    name: "Reh", sprite: "reh", kind: "wild", terrain: ["waldboden"], speed: 0.9, run: 3.6, shy: 5, roam: 6,
    group: [1, 2], groups: 3, pause: [3, 8], fps: { grasen: 3, gehen: 9, rennen: 13 }, game: { meat: 3, hp: 25 },
  },
  kraehe: {
    name: "Krähe", sprite: "kraehe", kind: "vogel", terrain: ["wiese", "gras", "erde"], speed: 0.45, run: 3.2, shy: 2.5, roam: 4,
    group: [3, 5], groups: 2, pause: [2, 5], fps: { picken: 6, gehen: 8, fliegen: 8 },
  },
};

export const LIFE = {
  animals: {
    /** Fehlen Tiere einer Art (erlegt, verjagt), kommt in diesem Abstand eine neue Gruppe vom Rand ihres Geländes. */
    respawnSeconds: 90,
    /** So lange flieht Wild, nachdem es eine Figur bemerkt hat. */
    fleeSeconds: 3,
    /** Prüfabstand auf Figuren in der Nähe (Ticks, gestaffelt nach Tier). */
    lookTicks: 5,
    /** Krähen: Flughöhe in Höhenstufen, Dauer des Auffliegens, Flugstrecke [min, max]. */
    flyHeight: 7,
    takeoffSeconds: 0.4,
    flight: [8, 16] as [number, number],
    /** Erlegtes Wild bleibt so lange liegen, wenn niemand es holt. */
    carcassSeconds: 120,
  },
  forest: {
    /** Baumstumpf → Setzling. */
    stumpSeconds: 60,
    /** Je Wachstumsstufe (Setzling, Jungbaum, halbwüchsig), danach ein fällbarer Baum. */
    stageSeconds: [45, 60, 75] as [number, number, number],
    /** Abstand, in dem ein stehender Baum einen Setzling in die Nachbarschaft sät, solange der Wald kleiner ist als beim Start. */
    seedSeconds: 30,
    /** Säen nur auf diesem Gelände und höchstens so weit vom Mutterbaum. */
    seedTerrain: ["waldboden", "gras"] as TerrainKey[],
    seedRadius: 2,
  },
  /** Tagelöhner ohne Auftrag: wechseln alle paar Sekunden zwischen Stehen, Sitzen und Plaudern (wenn jemand daneben steht). */
  idle: { switchSeconds: 7, chatRadius: 1.7 },
  /** Wachen auf dem Posten schauen sich um und treten von einem Fuß auf den anderen. */
  guard: { lookSeconds: 4, stepSeconds: 0.5 },
  /**
   * Fliehende Tagelöhner rennen (Rennbilder). factor: Faktor auf die Gehgeschwindigkeit. Steht auf 1: schon 1,2 verschiebt
   * die Abwehr-Balance (die Angreifer erreichen den Bergfried früher, tests/sim/bergfried.test.ts); siehe ADR 0016.
   */
  run: { factor: 1 },
  /** Treffer: so lange zuckt die Figur zusammen. */
  hitSeconds: 0.25,
  /** Gefallene: die letzten Sekunden vor dem Wegräumen blendet der Körper aus. */
  corpseFadeSeconds: 3,
};

/**
 * Wehende Fahnen: zu einem Gebäudebild das Bild mit Bannern im Wind (gleiches Gebäude, nur das Tuch bewegt sich) und die
 * Bilder pro Sekunde. Fehlt das Fahnenbild, bleibt das stille Bild.
 */
export const FLAGS: Record<string, { sprite: string; fps: number }> = {
  kaserne: { sprite: "kaserne_fahne", fps: 6 },
  turm: { sprite: "turm_fahne", fps: 6 },
  bergfried_holz: { sprite: "bergfried_holz_fahne", fps: 6 },
  bergfried_stein: { sprite: "bergfried_stein_fahne", fps: 6 },
  bergfried_burg: { sprite: "bergfried_burg_fahne", fps: 6 },
};

/** Bäume im Wind (Varianten = Baum · 4 + Phase) und nachwachsende Bäume (Varianten = Wachstumsstufe). */
export const TREE_ART = {
  wind: { baum: "baum_wind", tanne: "tanne_wind" } as Record<string, string>,
  phases: 4,
  /** Sekunden für einen ganzen Wiegezyklus. */
  swaySeconds: 2.4,
  young: { baum: "baum_jung", tanne: "tanne_jung" } as Record<string, string>,
};

/** Figuren mit Zusatzbildern (Rennen, Treffer, Sitzen, Plaudern): Figur → Blatt mit diesen Animationen. */
export const LIFE_FIGURES: Record<string, string> = {
  tageloehner: "tageloehner_leben",
  speer: "speer_leben",
  schwert: "schwert_leben",
  bogen: "bogen_leben",
};

/**
 * Tageslicht: Färbung der Welt über eine Tageslänge (Spielzeit). Stützstellen [Tagesanteil, Farbe]; dazwischen wird
 * gemischt. Die Nacht bleibt hell genug zum Spielen; aus = keine Färbung.
 */
export const DAYLIGHT = {
  on: true,
  daySeconds: 480,
  /** Spielbeginn am Vormittag. */
  start: 0.3,
  keys: [
    [0.0, 0xa4acd6],
    [0.2, 0xaab0d4],
    [0.27, 0xf0c8a8],
    [0.35, 0xfff4e6],
    [0.5, 0xffffff],
    [0.68, 0xfff0dc],
    [0.76, 0xf5c294],
    [0.84, 0xb4b2d6],
    [1.0, 0xa4acd6],
  ] as [number, number][],
};
