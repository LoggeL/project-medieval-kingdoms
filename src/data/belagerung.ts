/**
 * Belagerung und Befestigung (BRIEF §4.2, §4.3, §7; ADR 0017): Holzpalisade und Graben als Bauten, Sturmknechte mit
 * Sturmleitern und der Rammbock als Angriffswerkzeug der Überfälle, Trümmer zerstörter Befestigungen (Breschen),
 * Schadensstufen, Reparatur und Heilung. Alles hier sind Daten; die Regeln stehen in src/sim/belagerung.ts.
 * Eingehängt in BUILDINGS und UNITS (index.ts) mit je einer Zeile.
 */
import type { BuildingDef, BuildingKey, UnitDef } from "./index";
import type { Good } from "./goods";

export type BelagerungKey = "palisade" | "graben";
export type BelagerungUnitKey = "sturmknecht" | "rammbock";

export const BEFESTIGUNG: Record<BelagerungKey, BuildingDef> = {
  palisade: {
    name: "Holzpalisade", desc: "Zaun aus angespitzten Stämmen: billig und früh, nur Holz. Ziehen, um eine Linie zu bauen. Hält Angreifer auf, bis sie ihn einreißen, trägt aber keinen Wehrgang.",
    category: "befestigung", footprint: [1, 1], cost: { holz: 2 }, buildSeconds: 3, sprite: "palisade_gerade",
    construction: { ground: "baustelle_mauer", foundation: 0.15, courses: 6, piles: [[0, 0]] },
    pieces: { prefix: "palisade", joinFort: true }, drag: true, hp: 220,
  },
  graben: {
    name: "Graben", desc: "Tagelöhner heben einen Graben aus (kostet nur Arbeit). Eigene Leute waten langsam hindurch, Angreifer müssen ihn umgehen oder Stück für Stück zuschütten. Ziehen, um eine Linie zu bauen.",
    category: "befestigung", footprint: [1, 1], cost: {}, buildSeconds: 8, sprite: "graben_gerade",
    // flach: Nach dem Abstecken wächst der Aushub von vorn nach hinten (das fertige Bild wird von unten aufgedeckt)
    construction: { ground: "baustelle_graben", foundation: 0.15, piles: [] },
    pieces: { prefix: "graben" }, drag: true, flat: true,
    ditch: { ownCost: 3 }, hp: 60,
  },
};

export const BELAGERUNG_UNITS: Record<BelagerungUnitKey, UnitDef> = {
  sturmknecht: {
    name: "Sturmknecht", sprite: "sturmknecht", role: "nahkampf", armorClass: "leder", hp: 60, speed: 1.45, armor: 1, damage: 9, damageType: "hieb",
    range: 1.1, cooldown: 1.1, gearSprite: { leiter: "leitertraeger" }, foeOnly: true,
  },
  rammbock: {
    name: "Rammbock", sprite: "rammbock", role: "belagerung", hp: 700, speed: 0.55, armor: 5, damage: 100, damageType: "wucht", // Wucht wirkt zu 0,6 auf Gebäude (DAMAGE_TYPES): 60 je Stoß
    range: 1.1, cooldown: 3, vehicle: { crew: 3 }, foeOnly: true,
  },
};

/** Stellschrauben der Belagerung (Sekunden, Felder, Lebenspunkte). */
export const SIEGE = {
  /** So lange richtet ein Sturmknecht die Leiter an der Mauer auf. */
  ladderPlaceSeconds: 2,
  /** So lange braucht ein Verteidiger auf dem Wehrgang, um eine Leiter umzustoßen (zwei schaffen es doppelt so schnell). */
  ladderPushSeconds: 3,
  /** Verteidiger stoßen eine Leiter um, wenn sie höchstens so weit (Felder) von ihrem oberen Ende stehen. */
  ladderPushReach: 1.3,
  /** Ein Angreifer oben am Leiterkopf (so nah, Felder) verhindert das Umstoßen. */
  ladderHeadGuard: 0.9,
  /** Kippen und Liegen einer umgestoßenen Leiter (danach verschwindet sie). */
  ladderFallSeconds: 1,
  ladderLieSeconds: 8,
  /** Schaden für jeden, der beim Umstoßen auf der Leiter steht. */
  ladderFallDamage: 22,
  /** Wegkosten über die Leiter (Boden ↔ Wehrgang) und Tempo beim Klettern (Anteil). */
  ladderCost: 3,
  climbFactor: 0.4,
  /** Wegkosten auf Trümmern (Bresche). */
  rubbleCost: 1.8,
  /** Zuschütten eines Grabens: Füllmenge je Schaufelwurf eines Angreifers (Graben-LP). */
  ditchFillPerStrike: 6,
  /** Die Mannschaft schiebt den Rammbock nur, wenn mindestens einer so nah (Felder) bei ihm ist. */
  ramCrewReach: 2.5,
};

/** Überfälle mit Belagerungswerkzeug: ab Welle `wave` (die höchste passende Zeile gilt) ersetzen sie Krieger der Welle. */
export const RAID_SIEGE: { wave: number; ladders: number; rams: number }[] = [
  { wave: 2, ladders: 2, rams: 0 },
  { wave: 3, ladders: 2, rams: 1 },
];

/** Trümmer zerstörter Befestigungen: begehbar (Bresche), Sprite im Gebäudeblatt mit `variants` Varianten. */
export const RUINS: Partial<Record<BuildingKey, { sprite: string; variants: number }>> = {
  mauer: { sprite: "truemmer_stein", variants: 3 },
  tor: { sprite: "truemmer_stein", variants: 3 },
  turm: { sprite: "truemmer_stein", variants: 3 },
  treppe: { sprite: "truemmer_stein", variants: 3 },
  palisade: { sprite: "truemmer_holz", variants: 2 },
  graben: { sprite: "graben_verfuellt", variants: 1 },
};

/** Schadensstufen: Anteil der Lebenspunkte, unter dem Stufe 1, 2, 3 beginnt (sichtbar am Gebäude). */
export const DAMAGE_STAGES = [0.75, 0.5, 0.25];
export const DAMAGE_STAGE_NAMES = ["unversehrt", "leicht beschädigt", "schwer beschädigt", "dem Einsturz nahe"];

/**
 * Reparatur: Ein Tagelöhner bringt ein Stück der Hauptware des Baus (die häufigste Ware seiner Kosten) und arbeitet
 * `seconds` daran; das stellt Lebenspunkte / Stückzahl der Kosten wieder her. Nur ohne Kampf in der Nähe.
 */
export const REPAIR = {
  seconds: 3,
  /** Kein Treffer am Gebäude seit so vielen Sekunden und kein Angreifer in diesem Umkreis (Felder). */
  calmSeconds: 8,
  enemyRadius: 6,
  /** Höchstens so viele Reparaturen gleichzeitig (die Wirtschaft soll weiterlaufen). */
  crews: 3,
  /** Für Bauten ohne Warenkosten (Bergfried Stufe 1). */
  fallback: { good: "holz" as Good, pieces: 12 },
};

/** Heilung verwundeter eigener Leute: langsam in Ruhe, schneller nahe dem Bergfried oder der Kaserne. */
export const HEAL = {
  /** Ruhe = so viele Sekunden ohne erlittenen Treffer. */
  calmSeconds: 6,
  restPerSecond: 0.4,
  nearPerSecond: 2.5,
  nearRadius: 4.5,
  near: ["bergfried", "kaserne"] as BuildingKey[],
};
