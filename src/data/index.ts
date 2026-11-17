/**
 * Datendefinitionen des Prototyps: Gelände, Waren, Gebäude, Einheiten.
 * Neue Inhalte sind Einträge hier (plus Grafik), kein neuer Code. Spielertexte auf Deutsch.
 * Zeiten in Sekunden, die Simulation rechnet sie in Ticks um (TICKS_PER_SECOND).
 */
import type { VoiceKey } from "./audio";

export const TICKS_PER_SECOND = 20;

// ---------------------------------------------------------------- Gelände
export type TerrainKey = "gras" | "wiese" | "waldboden" | "erde" | "fels" | "wasser";

export interface TerrainDef {
  name: string;
  /** Kann man darauf laufen? */
  walkable: boolean;
  /** Darf man darauf bauen? */
  buildable: boolean;
  /** Bewegungskosten-Faktor (1 = normal). */
  cost: number;
}

export const TERRAIN: Record<TerrainKey, TerrainDef> = {
  gras: { name: "Gras", walkable: true, buildable: true, cost: 1 },
  wiese: { name: "Wiese", walkable: true, buildable: true, cost: 1 },
  waldboden: { name: "Waldboden", walkable: true, buildable: true, cost: 1.2 },
  erde: { name: "Weg", walkable: true, buildable: true, cost: 0.7 },
  fels: { name: "Fels", walkable: true, buildable: false, cost: 1.6 },
  wasser: { name: "Wasser", walkable: false, buildable: false, cost: 99 },
};

// ---------------------------------------------------------------- Waren
export type Good = "holz" | "stein" | "eisen" | "speer" | "schwert" | "bogen";

export interface GoodDef {
  name: string;
  /** Sprite-Schlüssel des Stapels im Lager (Gebäudeblatt, Varianten = Füllstufen 0..4). */
  stack: string;
  /** Figur, die diese Ware trägt (Figurenblatt). */
  carrier: string;
  /** Baumaterial auf der Baustelle (Gebäudeblatt, Varianten = Menge 0..4); fehlt es, liegt der Lagerstapel dort. */
  sitePile?: string;
}

export const GOODS: Record<Good, GoodDef> = {
  holz: { name: "Holz", stack: "stapel_holz", carrier: "traeger", sitePile: "baustoff_holz" },
  stein: { name: "Stein", stack: "stapel_stein", carrier: "traeger_stein", sitePile: "baustoff_stein" },
  eisen: { name: "Eisen", stack: "stapel_eisen", carrier: "traeger_kiste" },
  speer: { name: "Speere", stack: "stapel_speer", carrier: "traeger_speer" },
  schwert: { name: "Schwerter", stack: "stapel_schwert", carrier: "traeger_schwert" },
  bogen: { name: "Bögen", stack: "stapel_bogen", carrier: "traeger_bogen" },
};

export type Cost = Partial<Record<Good | "gold", number>>;

// ---------------------------------------------------------------- Arbeitszyklen (siehe docs/concept/09-technik.md §6)
export type CycleStep =
  | { do: "reserveNearest"; tag: "tree" | "rock"; radius: number }
  | { do: "walkTo"; target: "reserved" | "home" }
  /** Arbeit am Ziel: anim sagt der Darstellung, was gezeigt wird; effect ändert die Welt. */
  | { do: "work"; anim: AnimKey; seconds: number; effect?: "fellTree" | "cutTree" | "mineRock"; produce?: Partial<Record<Good, number>>; carry?: boolean }
  /** Getragene Ware im eigenen Hof ablegen (output). Wartet, solange der Hof voll ist. */
  | { do: "deposit"; into: "output" };

// ---------------------------------------------------------------- Gebäude
export type BuildingKey =
  | "lager" | "holzfaeller" | "steinbruch" | "kaserne" | "haus"
  | "mauer" | "tor" | "treppe" | "turm";

/**
 * Baustelle (Darstellung, siehe docs/decisions/0005-baustellen.md): Ein gesetzter Bau ist erst abgesteckt (Pflöcke und
 * Schnur, Variante 0 von ground), mit dem ersten verbauten Material entsteht das Fundament (Variante 1), danach steht
 * das Gerüst und der Bau wächst von unten nach oben. Wie weit, entscheidet die Simulation (Arbeit und verbautes Material).
 */
export interface ConstructionDef {
  /** Sprite der Baustelle im Gebäudeblatt: Variante 0 abgesteckt, 1 Fundament. */
  ground: string;
  /** Gerüst (mit Vorderteil, das vor dem wachsenden Bau liegt); fehlt bei niedrigen Bauten. */
  scaffold?: string;
  /** Anteil des Baufortschritts, der aufs Fundament entfällt, bevor der Bau sichtbar wächst. */
  foundation: number;
  /** Der Bau wächst in so vielen sichtbaren Lagen (Mauern Stein für Stein); fehlt = stufenlos. */
  courses?: number;
  /**
   * Ablage des Baumaterials, je Ware ein Platz in der Reihenfolge der Kosten: [x, y] in Tiles ab Grundrissmitte,
   * Modellachsen (wie posts), innerhalb des Grundrisses (dort läuft niemand hindurch).
   */
  piles: [number, number][];
}

export interface BuildingDef {
  name: string;
  /** Kurzbeschreibung im Baumenü. */
  desc: string;
  category: "wirtschaft" | "wohnen" | "militaer" | "befestigung";
  /** Grundriss in Tiles bei Ausrichtung o = 0 (Breite entlang x, Tiefe entlang y). */
  footprint: [number, number];
  cost: Cost;
  /** Reine Arbeitszeit eines Bauarbeiters in Sekunden (er baut nur, solange verbaubares Material auf der Baustelle liegt). */
  buildSeconds: number;
  /** Bauphasen und Materialablage der Baustelle. */
  construction: ConstructionDef;
  /** Sprite-Schlüssel im Gebäudeblatt (assets/buildings/<stil>/sheet.json). Mauerteile wählt die Darstellung selbst. */
  sprite: string;
  /** Platzierungsregeln. */
  placement?: { nearTag?: { tag: "tree" | "rock"; count: number; radius: number }; adjacentTerrain?: TerrainKey };
  workers?: { unit: UnitKey; count: number; cycle: CycleStep[] };
  /** Hofstapel (Ausgang) mit Kapazität; Träger holen von hier ab. */
  output?: { good: Good; capacity: number };
  /** Lagerplatz: Slots mit eigenem Stapel. */
  storage?: { slots: number; perSlot: number };
  /** Wohnraum (erhöht die Bevölkerungsgrenze). */
  housing?: number;
  /** Ausbildung von Einheiten. */
  trains?: UnitKey[];
  /** Laufebenen: begehbare Mauerkrone (1) bzw. Turmplattform (2). */
  walkway?: 1 | 2;
  /** Posten für Fernkämpfer: [x, y, Höhenstufe] in Tiles ab Grundrissmitte, Modellachsen (siehe assets/buildings/STIL/sheet.json). */
  posts?: [number, number, number][];
  /** Tor: am Boden für eigene Einheiten passierbar, oben Wehrgang. */
  gate?: boolean;
  /** Treppe: verbindet Boden (vorne) mit dem Wehrgang (hinten). */
  stairs?: boolean;
  /** Mit Ziehen bauen (Mauer). */
  drag?: boolean;
  hp: number;
}

export const BUILDINGS: Record<BuildingKey, BuildingDef> = {
  lager: {
    name: "Lagerplatz", desc: "Acht Stellplätze für Holz, Stein, Eisen und Waffen. Jede Ware liegt sichtbar auf ihrem Stapel.",
    category: "wirtschaft", footprint: [3, 3], cost: { holz: 10 }, buildSeconds: 15, sprite: "lager_boden",
    construction: { ground: "baustelle_lager", foundation: 0.3, piles: [[0, 0]] },
    storage: { slots: 8, perSlot: 20 }, hp: 300,
  },
  holzfaeller: {
    name: "Holzfällerhütte", desc: "Ein Holzfäller fällt Bäume in der Nähe, zerlegt sie und legt die Stämme auf seinen Hof.",
    category: "wirtschaft", footprint: [2, 2], cost: { holz: 6 }, buildSeconds: 12, sprite: "holzfaeller",
    construction: { ground: "baustelle_holzfaeller", scaffold: "geruest_holzfaeller", foundation: 0.15, piles: [[0.45, -0.35]] },
    placement: { nearTag: { tag: "tree", count: 4, radius: 10 } },
    workers: {
      unit: "holzfaeller", count: 1, cycle: [
        { do: "reserveNearest", tag: "tree", radius: 12 },
        { do: "walkTo", target: "reserved" },
        { do: "work", anim: "hacken", seconds: 6, effect: "fellTree" },
        { do: "work", anim: "hacken", seconds: 3, effect: "cutTree", produce: { holz: 1 }, carry: true },
        { do: "walkTo", target: "home" },
        { do: "deposit", into: "output" },
      ],
    },
    output: { good: "holz", capacity: 4 }, hp: 200,
  },
  steinbruch: {
    name: "Steinbruch", desc: "Zwei Steinmetze brechen Blöcke aus dem Fels. Muss an Fels grenzen.",
    category: "wirtschaft", footprint: [3, 3], cost: { holz: 12 }, buildSeconds: 18, sprite: "steinbruch",
    construction: { ground: "baustelle_steinbruch", foundation: 0.2, piles: [[-0.15, -0.7]] },
    placement: { adjacentTerrain: "fels", nearTag: { tag: "rock", count: 1, radius: 6 } },
    workers: {
      unit: "steinmetz", count: 2, cycle: [
        { do: "reserveNearest", tag: "rock", radius: 8 },
        { do: "walkTo", target: "reserved" },
        { do: "work", anim: "abbauen", seconds: 6, effect: "mineRock", produce: { stein: 1 }, carry: true },
        { do: "walkTo", target: "home" },
        { do: "deposit", into: "output" },
      ],
    },
    output: { good: "stein", capacity: 6 }, hp: 250,
  },
  kaserne: {
    name: "Kaserne", desc: "Bildet Soldaten aus. Ein Tagelöhner holt die Waffe aus dem Lager und tritt hier ein.",
    category: "militaer", footprint: [4, 3], cost: { holz: 15, stein: 20 }, buildSeconds: 25, sprite: "kaserne",
    construction: { ground: "baustelle_kaserne", scaffold: "geruest_kaserne", foundation: 0.12, piles: [[-0.55, -0.8], [0.55, -0.8]] },
    trains: ["speer", "schwert", "bogen"], hp: 500,
  },
  haus: {
    name: "Wohnhaus", desc: "Platz für vier Bewohner. Neue Tagelöhner ziehen nach und nach zu.",
    category: "wohnen", footprint: [2, 2], cost: { holz: 8 }, buildSeconds: 12, sprite: "haus",
    construction: { ground: "baustelle_haus", scaffold: "geruest_haus", foundation: 0.15, piles: [[0.35, -0.82]] }, housing: 4, hp: 150,
  },
  mauer: {
    name: "Steinmauer", desc: "Ziehen, um eine Mauer zu bauen. Der Wehrgang ist begehbar, Schützen stehen hinter den Zinnen.",
    category: "befestigung", footprint: [1, 1], cost: { stein: 3 }, buildSeconds: 4, sprite: "mauer",
    construction: { ground: "baustelle_mauer", foundation: 0.15, courses: 8, piles: [[0, 0]] },
    walkway: 1, posts: [[0, 0, 3]], drag: true, hp: 600,
  },
  tor: {
    name: "Tor", desc: "Öffnet sich für eigene Leute, oben läuft der Wehrgang weiter. Nur in ein gerades Mauerstück setzen.",
    category: "befestigung", footprint: [1, 1], cost: { holz: 4, stein: 4 }, buildSeconds: 8, sprite: "tor",
    construction: { ground: "baustelle_mauer", foundation: 0.15, courses: 8, piles: [[0, -0.18], [0, 0.18]] },
    walkway: 1, gate: true, hp: 500,
  },
  treppe: {
    name: "Mauertreppe", desc: "Führt vom Boden auf den Wehrgang. Mit der Rückseite an die Mauer setzen.",
    category: "befestigung", footprint: [1, 2], cost: { stein: 4 }, buildSeconds: 6, sprite: "treppe",
    construction: { ground: "baustelle_treppe", foundation: 0.15, courses: 10, piles: [[0, -0.5]] }, stairs: true, hp: 400,
  },
  turm: {
    name: "Mauerturm", desc: "Vier Posten für Schützen auf der Plattform, Zugang vom Wehrgang und durch die Tür (nur für eigene Leute).",
    category: "befestigung", footprint: [2, 2], cost: { stein: 16 }, buildSeconds: 20, sprite: "turm",
    construction: { ground: "baustelle_turm", scaffold: "geruest_turm", foundation: 0.12, courses: 14, piles: [[0.5, -0.5]] },
    walkway: 2, posts: [[-0.65, -0.65, 5], [0.65, -0.65, 5], [-0.65, 0.65, 5], [0.65, 0.65, 5]], hp: 1200,
  },
};

// ---------------------------------------------------------------- Einheiten
export type UnitKey = "tageloehner" | "holzfaeller" | "steinmetz" | "speer" | "schwert" | "bogen";

/** Animationen, die die Simulation meldet. Die Darstellung bildet sie auf Blatt-Animationen ab (mit Ersatz, falls eine fehlt). */
export type AnimKey = "stehen" | "gehen" | "hacken" | "abbauen" | "bauen" | "angriff" | "schiessen" | "sterben" | "tot";

export type DamageType = "stich" | "hieb" | "pfeil";

export interface UnitDef {
  name: string;
  /** Figur im Figurenblatt (assets/figures/<stil>/sheet.json). */
  sprite: string;
  role: "arbeiter" | "nahkampf" | "fernkampf";
  hp: number;
  /** Felder pro Sekunde. */
  speed: number;
  armor: number;
  damage?: number;
  damageType?: DamageType;
  /** Reichweite in Tiles (Nahkampf ~1). */
  range?: number;
  /** Sekunden zwischen zwei Angriffen. */
  cooldown?: number;
  /** Bonus gegen Einheitenrollen, z. B. Speer gegen Nahkampf-Ansturm. */
  bonus?: Partial<Record<"nahkampf" | "fernkampf", number>>;
  /** Kosten der Ausbildung (Gold) und Ausrüstung aus dem Lager. */
  train?: { gold: number; equipment: Good; seconds: number };
  /** Darf auf Mauerposten stehen. */
  canStation?: boolean;
}

export const UNITS: Record<UnitKey, UnitDef> = {
  tageloehner: { name: "Tagelöhner", sprite: "tageloehner", role: "arbeiter", hp: 30, speed: 1.6, armor: 0 },
  holzfaeller: { name: "Holzfäller", sprite: "holzfaeller", role: "arbeiter", hp: 35, speed: 1.5, armor: 0 },
  steinmetz: { name: "Steinmetz", sprite: "steinmetz", role: "arbeiter", hp: 35, speed: 1.4, armor: 0 },
  speer: {
    name: "Speerträger", sprite: "speer", role: "nahkampf", hp: 80, speed: 1.5, armor: 2, damage: 9, damageType: "stich",
    range: 1.3, cooldown: 1.2, bonus: { nahkampf: 1.2 }, train: { gold: 10, equipment: "speer", seconds: 8 }, canStation: true,
  },
  schwert: {
    name: "Schwertkämpfer", sprite: "schwert", role: "nahkampf", hp: 110, speed: 1.3, armor: 4, damage: 13, damageType: "hieb",
    range: 1.1, cooldown: 1.1, train: { gold: 20, equipment: "schwert", seconds: 10 }, canStation: true,
  },
  bogen: {
    name: "Bogenschütze", sprite: "bogen", role: "fernkampf", hp: 55, speed: 1.6, armor: 1, damage: 7, damageType: "pfeil",
    range: 7, cooldown: 1.8, train: { gold: 15, equipment: "bogen", seconds: 9 }, canStation: true,
  },
};

/**
 * Fernkämpfer auf Wehrgang/Turm: Reichweite + pro Höhenstufe, mehr Wucht beim Schuss nach unten (vor Abzug der Rüstung),
 * Deckung hinter den Zinnen gegen Schaden von unten.
 */
export const WALL_BONUS = { rangePerStep: 0.5, damageDealtFactor: 1.3, damageTakenFactor: 0.5 };

// ---------------------------------------------------------------- Partie
export const START = {
  mapSize: 64,
  gold: 150,
  peasants: 8,
  /** Startbestand im vorgebauten Lager. */
  stock: { holz: 40, stein: 36, speer: 3, schwert: 2, bogen: 4 } as Partial<Record<Good, number>>,
  /** Erster Überfall nach Sekunden, danach Abstand; Wellengröße baseSize + growth · (Welle − 1), Zusammensetzung reihum aus mix. */
  raid: { firstSeconds: 300, everySeconds: 240, baseSize: 4, growth: 2, mix: ["schwert", "speer", "bogen", "speer", "schwert", "bogen", "speer"] as UnitKey[] },
};

// ---------------------------------------------------------------- Einführung
/**
 * Zielkette für den Spielbeginn: Jeder Schritt erscheint als Meldung, sobald der vorige erreicht ist.
 * Sind mehrere Schritte schon erledigt, erscheint nur der erste offene. done null = letzter Schritt.
 */
export type TutorialGoal =
  /** Baustelle oder Gebäude dieser Art vorhanden. */
  | { placed: BuildingKey }
  /** Von jeder dieser Arten mindestens ein fertiges Gebäude. */
  | { built: BuildingKey[] }
  /** So viele eigene Soldaten. */
  | { soldiers: number }
  /** So viele Soldaten mit dem Befehl „Stationieren“. */
  | { stationed: number };

/** voice: optionale Sprecheransage (nur vorhandene Schlüssel aus audio.ts). */
export interface TutorialStep { text: string; done: TutorialGoal | null; voice?: VoiceKey }

export const TUTORIAL: TutorialStep[] = [
  { text: "Willkommen, Burgherr! Baue eine Holzfällerhütte am Waldrand und einen Steinbruch am Fels.", voice: "willkommen", done: { placed: "holzfaeller" } },
  { text: "Gut. Jetzt einen Steinbruch: Er muss an den Fels im Norden grenzen.", done: { placed: "steinbruch" } },
  { text: "Baue ein Wohnhaus. Mit mehr Wohnraum ziehen Tagelöhner zu, die tragen und bauen.", done: { placed: "haus" } },
  { text: "Baue eine Kaserne für deine Soldaten. Sie braucht Holz und viel Stein.", done: { built: ["kaserne"] } },
  { text: "Die Kaserne steht. Wähle sie und bilde Speerträger, Schwertkämpfer und Bogenschützen aus.", done: { soldiers: 1 } },
  { text: "Angreifer kommen von Osten über die Furt. Zieh dort eine Mauer, setz ein Tor hinein und innen eine Treppe an (mit R drehen).", done: { built: ["mauer", "tor", "treppe"] } },
  { text: "Wähle deine Soldaten und stelle sie mit T auf die Mauer.", done: { stationed: 1 } },
  { text: "Die Mauer ist besetzt. Schützen oben treffen härter, Nahkämpfer verteidigen Tor und Treppe. Ein Turm bietet vier weitere Posten.", done: null },
];

// ---------------------------------------------------------------- Simulationswerte (Balance)
/** Schadensarten: welcher Anteil der Rüstung wirkt und wie stark sie gegen Gebäude sind. */
export const DAMAGE_TYPES: Record<DamageType, { armor: number; building: number }> = {
  stich: { armor: 0.7, building: 0.35 },
  hieb: { armor: 1, building: 1 },
  pfeil: { armor: 1, building: 0.1 },
};

/** Stellschrauben der Simulation (Sekunden, Tiles, Gold). */
export const TUNING = {
  /** Wohnraum ohne Häuser. */
  baseHousing: 10,
  /** Abstand, in dem neue Tagelöhner zuziehen, solange Wohnraum frei ist. */
  immigrantSeconds: 20,
  /** Stämme pro gefälltem Baum. */
  treeLogs: 3,
  fallSeconds: 1.5,
  dyingSeconds: 1,
  corpseSeconds: 10,
  /** Sichtweite untätiger Soldaten und der Angreifer. */
  sight: 8,
  raiderSight: 7,
  /** Angreifer gehen auf Arbeiter nur los, wenn sie so nah sind (Felder); sonst ziehen sie zu den Gebäuden. */
  raiderWorkerReach: 3,
  /** Pfeilgeschwindigkeit in Tiles pro Sekunde. */
  projectileSpeed: 11,
  /** Gold je besiegtem Angreifer. */
  bounty: 4,
  /** Zufällige Streuung des Schadens (±). */
  damageSpread: 0.15,
  /** So lange (Sekunden) halten Soldaten ihr Kampfziel, bevor sie ein gefährlicheres wählen. */
  targetHoldSeconds: 2,
  /** Nahkämpfer auf dem Posten verteidigen Tor und Treppe bis zu diesem Abstand (Felder) und kehren dann zurück. */
  postLeash: 4,
  /** Nur Tore und Treppen bis zu diesem Abstand (Felder) vom Posten gehören zum Abschnitt eines Nahkämpfers. */
  postGuardRadius: 7,
  /** Angreifer ziehen sich unter diesem Anteil ihrer Lebenspunkte zurück (und wenn sie allein übrig sind). */
  retreatHp: 0.3,
  /** Wer als Letzter seiner Welle übrig ist, zieht erst unter diesem LP-Anteil ab (bei voller Kraft kämpft er weiter). */
  retreatLoneHp: 0.7,
};
