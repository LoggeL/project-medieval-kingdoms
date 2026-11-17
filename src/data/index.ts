/**
 * Datendefinitionen des Prototyps: Gelände, Waren, Gebäude, Einheiten.
 * Neue Inhalte sind Einträge hier (plus Grafik), kein neuer Code. Spielertexte auf Deutsch.
 * Zeiten in Sekunden, die Simulation rechnet sie in Ticks um (TICKS_PER_SECOND).
 */
import type { VoiceKey } from "./audio";
import type { Good, StoreKey } from "./goods";
import type { ProductionDef } from "./recipes";
import type { TechKey } from "./research";
import { VERARBEITUNG, type VerarbeitungKey } from "./verarbeitung";

export * from "./research";

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

// ---------------------------------------------------------------- Waren, Lagertypen, Rezepte (eigene Dateien)
export * from "./goods";
export * from "./recipes";

export type Cost = Partial<Record<Good | "gold", number>>;

// ---------------------------------------------------------------- Arbeitszyklen (siehe docs/concept/09-technik.md §6)
export type CycleStep =
  | { do: "reserveNearest"; tag: "tree" | "rock"; radius: number }
  | { do: "walkTo"; target: "reserved" | "home" }
  /** Arbeit am Ziel: anim sagt der Darstellung, was gezeigt wird; effect ändert die Welt. */
  | { do: "work"; anim: AnimKey; seconds: number; effect?: "fellTree" | "cutTree" | "mineRock"; produce?: Partial<Record<Good, number>>; carry?: boolean }
  /** Getragene Ware im eigenen Hof ablegen (output). Wartet, solange der Hof voll ist. */
  | { do: "deposit"; into: "output" }
  /**
   * Verarbeiten nach Rezept (BuildingDef.production, src/data/recipes.ts): zum Arbeitsplatz im Gebäude gehen, Eingänge
   * aus dem Puffer nehmen, sichtbar arbeiten, Ausgänge auf den Ausgabestapel legen. Ein Zyklus aus nur diesem Schritt.
   */
  | { do: "process" };

// ---------------------------------------------------------------- Gebäude
export type BuildingKey =
  | "bergfried" | "lager" | "holzfaeller" | "steinbruch" | "kaserne" | "haus"
  | "mauer" | "tor" | "treppe" | "turm"
  | VerarbeitungKey;

/**
 * Ausbaustufe eines Gebäudes (bisher nur der Bergfried). levels[0] ist Stufe 1 mit den Grundwerten des Gebäudes,
 * jede weitere Stufe überschreibt die genannten Werte. Ausbau: Gold sofort, Waren bringen Träger, dann baut ein
 * Tagelöhner wie auf einer Baustelle; das Gebäude bleibt dabei in Betrieb.
 */
export interface BuildingLevel {
  name: string;
  desc: string;
  sprite: string;
  hp: number;
  housing?: number;
  /** Steuern des Bergfrieds: Gold je Spielminute. */
  income?: number;
  walkway?: 1 | 2;
  posts?: [number, number, number][];
  /** Höhe der Plattform (Laufebene 2) in Höhenstufen, Standard 5 wie beim Mauerturm. */
  deck?: number;
  interior?: { sprite: string; spots?: [number, number][] };
  /** Voraussetzung und Kosten des Ausbaus auf diese Stufe. */
  upgrade?: { cost: Cost; seconds: number; tech: TechKey };
}

/**
 * Baustelle (Darstellung, siehe docs/decisions/0009-baustellen.md): Ein gesetzter Bau ist erst abgesteckt (Pflöcke und
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
  category: "zentrum" | "wirtschaft" | "nahrung" | "wohnen" | "militaer" | "befestigung";
  /** Grundriss in Tiles bei Ausrichtung o = 0 (Breite entlang x, Tiefe entlang y). */
  footprint: [number, number];
  cost: Cost;
  /** Reine Arbeitszeit eines Bauarbeiters in Sekunden (er baut nur, solange verbaubares Material auf der Baustelle liegt). */
  buildSeconds: number;
  /** Bauphasen und Materialablage der Baustelle. */
  construction: ConstructionDef;
  /** Sprite-Schlüssel im Gebäudeblatt (assets/buildings/<stil>/sheet.json). Mauerteile wählt die Darstellung selbst. */
  sprite: string;
  /**
   * Tür bzw. Zugang (ADR 0010): Mitte der Zugangskachel in Modellachsen ab Grundrissmitte (Tiles, Modell −y =
   * Vorderseite), dreht mit der Ausrichtung und gilt für alle Ausbaustufen. Figuren betreten und verlassen das Gebäude
   * nur hier, Waren werden hier abgegeben und abgeholt (beim Lagerhaus geht es von hier durchs Tor zum Fach). Meist
   * liegt die Kachel vor der Tür, außerhalb des Grundrisses. Läge sie im Grundriss (offene Einfahrt), bliebe nur sie
   * begehbar und würde von der Vorderseite her betreten. Fehlt der Eintrag, liegt die Tür mittig vor der Vorderkante.
   */
  door?: [number, number];
  /** Platzierungsregeln. */
  placement?: { nearTag?: { tag: "tree" | "rock"; count: number; radius: number }; adjacentTerrain?: TerrainKey };
  workers?: { unit: UnitKey; count: number; cycle: CycleStep[] };
  /** Hofstapel (Ausgang) mit Kapazität; Träger holen von hier ab. */
  output?: { good: Good; capacity: number };
  /**
   * Lager: Fächer mit eigenem Stapel. shelves = Mitte jedes Fachs in Tiles ab Grundrissmitte (Modellachsen), in der
   * Reihenfolge, in der leere Fächer belegt werden; dieselben Werte stehen in tools/blender/buildings/buildings.json
   * (lagerhaus_innen). Träger gehen durch die Tür den Mittelgang entlang bis vor ihr Fach. kind = Lagertyp (STORES in
   * goods.ts): Das Lager nimmt nur Waren dieses Typs auf, fehlt = Materiallager.
   */
  storage?: { kind?: StoreKey; slots: number; perSlot: number; shelves: [number, number][] };
  /**
   * Verarbeitung nach Rezept (src/data/recipes.ts, ADR 0011): Eingangspuffer, Ausgabestapel und Arbeitsplatz. Die
   * Arbeiter kommen aus `workers` (Zyklus [{ do: "process" }]), die Rezepte nennen das Gebäude in RecipeDef.building.
   */
  production?: ProductionDef;
  /**
   * Arbeitsanimation des Gebäudes (nur Darstellung): Die Varianten des Sprites laufen mit fps, solange ein Arbeitsgang
   * läuft (z. B. die Mühlenflügel), sonst bleibt das zuletzt gezeigte Bild stehen.
   */
  workAnim?: { fps: number };
  /**
   * Geschlossenes Gebäude mit Innenansicht (nur Darstellung): Schnittbild ohne Dach im Gebäudeblatt, eingeblendet beim
   * Überfahren und in der Auswahl. spots = Stellen für Figuren im Inneren (Tiles ab Grundrissmitte, Modellachsen),
   * z. B. der Rekrut in der Ausbildung.
   */
  interior?: { sprite: string; spots?: [number, number][] };
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
  /** Höhe der Plattform (Laufebene 2) in Höhenstufen, Standard 5. */
  deck?: number;
  /** Steuern: Gold je Spielminute. */
  income?: number;
  /** Ausbaustufen (siehe BuildingLevel). */
  levels?: BuildingLevel[];
  /**
   * Sitz des Burgherrn (Bergfried): Ort der Forschung, nur einer je Spieler, wird nicht gebaut, sondern steht ab Beginn.
   * Fällt er, ist das Spiel verloren.
   */
  seat?: boolean;
  /** Gesperrt, bis diese Forschung abgeschlossen ist. */
  tech?: TechKey;
  hp: number;
}

export const BUILDINGS: Record<BuildingKey, BuildingDef> = {
  bergfried: {
    name: "Bergfried", desc: "Wohnturm des Burgherrn und Herz der Siedlung: Hier wird geforscht, hier wohnen die ersten Leute, von hier kommen die Steuern. Fällt er, ist die Burg verloren.",
    category: "zentrum", footprint: [3, 3], cost: {}, buildSeconds: 1, sprite: "bergfried_holz", door: [0, -2], seat: true,
    housing: 10, income: 4, interior: { sprite: "bergfried_holz_innen" }, hp: 2500,
    // wird nie als Baustelle gesetzt (steht ab Beginn); das Fundament bleibt nach der Zerstörung als Grundmauer stehen
    construction: { ground: "baustelle_bergfried", foundation: 0.15, piles: [] },
    levels: [
      { name: "Hölzerner Bergfried", desc: "Fachwerkturm auf Steinsockel mit Palisade. Noch ohne Wehrplattform.", sprite: "bergfried_holz", hp: 2500, housing: 10, income: 4, interior: { sprite: "bergfried_holz_innen" } },
      {
        name: "Steinerner Bergfried", desc: "Wohnturm aus Quadern mit Zinnen und Wehrplattform: vier Posten für Schützen (Taste T).",
        sprite: "bergfried_stein", hp: 5000, housing: 14, income: 8, walkway: 2, deck: 5,
        posts: [[-0.8, -0.8, 5], [0.8, -0.8, 5], [-0.8, 0.8, 5], [0.8, 0.8, 5]],
        interior: { sprite: "bergfried_stein_innen" },
        upgrade: { cost: { gold: 20, stein: 30, holz: 10 }, seconds: 40, tech: "steinbau" },
      },
      {
        name: "Burgfried", desc: "Hoher Turm mit Zinnenkranz, Ecktürmchen und Banner: sechs Posten hoch über dem Land.",
        sprite: "bergfried_burg", hp: 8000, housing: 18, income: 12, walkway: 2, deck: 6,
        posts: [[-0.8, -0.8, 6], [0.8, -0.8, 6], [-0.8, 0.8, 6], [0.8, 0.8, 6], [0, -0.85, 6], [0, 0.85, 6]],
        interior: { sprite: "bergfried_burg_innen" },
        upgrade: { cost: { gold: 40, stein: 50, holz: 15 }, seconds: 60, tech: "festungsbau" },
      },
    ],
  },
  lager: {
    name: "Lagerhaus", desc: "Geschlossenes Lagerhaus mit acht Fächern für Holz, Stein, Eisen und Waffen. Träger kommen nur durch das Tor. Maus darüber zeigt die Fächer.",
    category: "wirtschaft", footprint: [3, 3], cost: { holz: 10 }, buildSeconds: 15, sprite: "lagerhaus", door: [0, -2],
    construction: { ground: "baustelle_lagerhaus", scaffold: "geruest_lagerhaus", foundation: 0.15, piles: [[0.62, -1.32]] },
    storage: {
      slots: 8, perSlot: 20,
      shelves: [[-0.95, -0.78], [0.95, -0.78], [-0.95, -0.18], [0.95, -0.18], [-0.95, 0.42], [0.95, 0.42], [-0.95, 1.02], [0.95, 1.02]],
    },
    interior: { sprite: "lagerhaus_innen" }, hp: 300,
  },
  holzfaeller: {
    name: "Holzfällerhütte", desc: "Ein Holzfäller fällt Bäume in der Nähe, zerlegt sie und legt die Stämme auf seinen Hof.",
    category: "wirtschaft", footprint: [2, 2], cost: { holz: 6 }, buildSeconds: 12, sprite: "holzfaeller", door: [0, -1.5],
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
    output: { good: "holz", capacity: 4 }, interior: { sprite: "holzfaeller_innen" }, hp: 200,
  },
  steinbruch: {
    name: "Steinbruch", desc: "Zwei Steinmetze brechen Blöcke aus dem Fels. Muss an Fels grenzen.",
    category: "wirtschaft", footprint: [3, 3], cost: { holz: 12 }, buildSeconds: 18, sprite: "steinbruch", door: [0, -2],
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
    category: "militaer", footprint: [4, 3], cost: { holz: 15, stein: 20 }, buildSeconds: 25, sprite: "kaserne", door: [0, -2],
    construction: { ground: "baustelle_kaserne", scaffold: "geruest_kaserne", foundation: 0.12, piles: [[-0.55, -0.8], [0.55, -0.8]] },
    trains: ["speer", "schwert", "bogen"], interior: { sprite: "kaserne_innen", spots: [[0.24, 0.51]] }, hp: 500,
  },
  // Verarbeitung und Kornkammer (src/data/verarbeitung.ts)
  ...VERARBEITUNG,
  haus: {
    name: "Wohnhaus", desc: "Platz für vier Bewohner. Neue Tagelöhner ziehen nach und nach zu.",
    category: "wohnen", footprint: [2, 2], cost: { holz: 8 }, buildSeconds: 12, sprite: "haus", door: [0, -1.5],
    construction: { ground: "baustelle_haus", scaffold: "geruest_haus", foundation: 0.15, piles: [[0.35, -0.82]] }, housing: 4,
    interior: { sprite: "haus_innen" }, hp: 150,
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
    category: "befestigung", footprint: [2, 2], cost: { stein: 16 }, buildSeconds: 20, sprite: "turm", door: [0, -1.5],
    construction: { ground: "baustelle_turm", scaffold: "geruest_turm", foundation: 0.12, courses: 14, piles: [[0.5, -0.5]] },
    walkway: 2, posts: [[-0.65, -0.65, 5], [0.65, -0.65, 5], [-0.65, 0.65, 5], [0.65, 0.65, 5]], hp: 1200,
  },
};

// ---------------------------------------------------------------- Einheiten
export type UnitKey = "tageloehner" | "holzfaeller" | "steinmetz" | "mueller" | "baecker" | "speer" | "schwert" | "bogen";

/** Animationen, die die Simulation meldet. Die Darstellung bildet sie auf Blatt-Animationen ab (mit Ersatz, falls eine fehlt). */
export type AnimKey = "stehen" | "gehen" | "hacken" | "abbauen" | "bauen" | "mahlen" | "backen" | "angriff" | "schiessen" | "sterben" | "tot"
  // lebendige Welt (ADR 0016): Ruhebilder untätiger Tagelöhner
  | "sitzen" | "plaudern";

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
  /** Gesperrt, bis diese Forschung abgeschlossen ist. */
  tech?: TechKey;
}

export const UNITS: Record<UnitKey, UnitDef> = {
  tageloehner: { name: "Tagelöhner", sprite: "tageloehner", role: "arbeiter", hp: 30, speed: 1.6, armor: 0 },
  holzfaeller: { name: "Holzfäller", sprite: "holzfaeller", role: "arbeiter", hp: 35, speed: 1.5, armor: 0 },
  steinmetz: { name: "Steinmetz", sprite: "steinmetz", role: "arbeiter", hp: 35, speed: 1.4, armor: 0 },
  mueller: { name: "Müller", sprite: "mueller", role: "arbeiter", hp: 35, speed: 1.4, armor: 0 },
  baecker: { name: "Bäcker", sprite: "baecker", role: "arbeiter", hp: 35, speed: 1.4, armor: 0 },
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
  /**
   * Startaufstellung: fertige Gebäude, linke obere Ecke relativ zum Siedlungsanker der Karte (MapResult.lager,
   * Eingang zur Straße) und Ausrichtung. Weitere Startgebäude kommen als Einträge hinzu.
   */
  buildings: [{ key: "lager", at: [0, 0], o: 0 }, { key: "bergfried", at: [-4, 0], o: 0 }, { key: "kornkammer", at: [-8, 0], o: 0 }] as { key: BuildingKey; at: [number, number]; o: number }[],
  /**
   * Startbestand in den Lagern der Startaufstellung (jede Ware in ein Lager ihres Typs). Getreide liegt in der
   * Kornkammer, bis es einen Bauernhof gibt, damit die Kette Mühle → Bäckerei spielbar ist.
   */
  stock: { holz: 40, stein: 36, speer: 3, schwert: 2, bogen: 4, getreide: 40 } as Partial<Record<Good, number>>,
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
  | { stationed: number }
  /** Diese Forschung läuft oder ist abgeschlossen. */
  | { researched: TechKey }
  /** Der Bergfried hat diese Stufe erreicht oder wird gerade darauf ausgebaut. */
  | { level: number };

/** voice: optionale Sprecheransage (nur vorhandene Schlüssel aus audio.ts). */
export interface TutorialStep { text: string; done: TutorialGoal | null; voice?: VoiceKey }

export const TUTORIAL: TutorialStep[] = [
  { text: "Willkommen, Burgherr! Baue eine Holzfällerhütte am Waldrand und einen Steinbruch am Fels.", voice: "willkommen", done: { placed: "holzfaeller" } },
  { text: "Gut. Jetzt einen Steinbruch: Er muss an den Fels im Norden grenzen.", done: { placed: "steinbruch" } },
  { text: "Baue ein Wohnhaus. Mit mehr Wohnraum ziehen Tagelöhner zu, die tragen und bauen.", done: { placed: "haus" } },
  { text: "Im Bergfried wird geforscht. Wähle ihn (oder drücke F) und beginne „Gehärtete Werkzeuge“: Träger bringen das Holz hinein, dann arbeiten Holzfäller und Steinmetze schneller.", done: { researched: "werkzeuge" } },
  { text: "Baue eine Kaserne für deine Soldaten. Sie braucht Holz und viel Stein.", done: { built: ["kaserne"] } },
  { text: "Die Kaserne steht. Wähle sie und bilde Speerträger, Schwertkämpfer und Bogenschützen aus.", done: { soldiers: 1 } },
  { text: "Angreifer kommen von Osten über die Furt. Zieh dort eine Mauer, setz ein Tor hinein und innen eine Treppe an (mit R drehen).", done: { built: ["mauer", "tor", "treppe"] } },
  { text: "Wähle deine Soldaten und stelle sie mit T auf die Mauer.", done: { stationed: 1 } },
  { text: "Die Mauer ist besetzt. Schützen oben treffen härter, Nahkämpfer verteidigen Tor und Treppe. Erforsche „Steinbaukunst“ und baue den Bergfried aus: Seine Wehrplattform trägt vier weitere Posten.", done: { level: 2 } },
  { text: "Der Bergfried wird zu Stein. Mit „Festungsbau“ wächst er zum Burgfried mit sechs Posten. Du musst nicht alles erforschen: Wähle, was deine Burg braucht.", done: null },
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
  /** Wohnraum ohne Häuser und ohne Bergfried (der Bergfried bringt seinen eigenen, BUILDINGS.bergfried.housing). */
  baseHousing: 0,
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
  /** Träger halten so lange am Fach im Lagerhaus, um Ware abzulegen oder aufzunehmen (Sekunden). */
  shelfSeconds: 0.3,
  /** Wer als Letzter seiner Welle übrig ist, zieht erst unter diesem LP-Anteil ab (bei voller Kraft kämpft er weiter). */
  retreatLoneHp: 0.7,
};

// ---------------------------------------------------------------- Ausbaustufen
const levelCache = new Map<string, BuildingDef>();

/** Werte eines Gebäudes auf Stufe `level` (1 = Grundwerte); ohne Stufen immer die Grundwerte. */
export function levelDef(key: BuildingKey, level = 1): BuildingDef {
  const def = BUILDINGS[key];
  if (!def.levels) return def;
  const id = `${key}:${level}`;
  let out = levelCache.get(id);
  if (!out) {
    const lv = def.levels[Math.max(1, Math.min(level, def.levels.length)) - 1];
    out = { ...def, name: lv.name, sprite: lv.sprite, hp: lv.hp, housing: lv.housing, income: lv.income, walkway: lv.walkway, posts: lv.posts, deck: lv.deck, interior: lv.interior };
    levelCache.set(id, out);
  }
  return out;
}

/** Höchste Stufe eines Gebäudes (1 ohne Ausbaustufen). */
export const maxLevel = (key: BuildingKey): number => BUILDINGS[key].levels?.length ?? 1;

// ---------------------------------------------------------------- Lebendige Welt (Tiere, Wald, Fahnen, Tageslicht; ADR 0016)
export * from "./leben";
