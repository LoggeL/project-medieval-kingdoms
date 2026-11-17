/**
 * Vertrag zwischen Simulation, Darstellung und UI.
 * Die Simulation ist die einzige Stelle, die diesen Zustand verändert. Darstellung und UI lesen ihn nur
 * und schicken Befehle (Command). Alles hier ist in Welt-Koordinaten; Drehung kennt nur die Darstellung.
 */
import type { AnimKey, BuildingKey, DifficultyKey, Good, RecipeKey, ScenarioKey, StoreKey, TechKey, TerrainKey, UnitKey } from "../data";
import type { VoiceKey } from "../data/audio";

export type Team = 0 | 1; // 0 = Spieler (blau), 1 = Angreifer (rot)

export interface Tile {
  terrain: TerrainKey;
  /** Zufällige Variante für die Darstellung (stabil pro Tile). */
  variant: number;
  /** Gebäude-ID, die den Tile belegt, sonst 0. */
  building: number;
}

export type TreeState = "stehend" | "faellt" | "liegt" | "stumpf";

export interface Tree {
  id: number;
  x: number; y: number;               // Tile
  kind: "baum" | "tanne";
  variant: number;
  state: TreeState;
  /** Fortschritt des aktuellen Zustands 0..1 (Fallen, Zerlegen). */
  progress: number;
  /** Fallrichtung in Welt (Einheitsvektor), gesetzt ab "faellt". */
  fallX: number; fallY: number;
  /** Verbleibende Stämme, wenn liegend. */
  logs: number;
  reservedBy: number;                 // Einheiten-ID oder 0
}

export interface Rock {
  id: number;
  x: number; y: number;               // Tile
  amount: number; max: number;        // Blöcke, die noch im Fels stecken
  reservedBy: number;
}

export interface StorageSlot { good: Good | null; amount: number; reserved: number; incoming: number }

export interface Building {
  id: number;
  key: BuildingKey;
  team: Team;
  x: number; y: number;               // linke obere Ecke des Grundrisses (Welt)
  o: number;                          // Ausrichtung 0..3
  /** 0..1 Baufortschritt; 1 = fertig. */
  built: number;
  /** Noch anzuliefernde Baumaterialien (Baustelle). */
  needs: Partial<Record<Good, number>>;
  /** Auf der Baustelle liegendes, noch nicht verbautes Material (sichtbar auf dem Grundriss, siehe construction.piles). */
  site: Partial<Record<Good, number>>;
  /**
   * Baustelle: Material insgesamt (Stück), das in den Bau eingeht. Verbaut ist mat − needs − site; der Baufortschritt
   * kommt nie über verbaut / mat hinaus. Fehlt bei fertig gesetzten Gebäuden und in alten Spielständen.
   */
  mat?: number;
  hp: number;
  /** Hofstapel (output) oder null. */
  output: { good: Good; amount: number; reserved: number } | null;
  /** Fächer (nur Lager), Reihenfolge wie BuildingDef.storage.shelves. */
  slots: StorageSlot[];
  /** Arbeiter-IDs. */
  workers: number[];
  /** Nur Mauer, Tor, Turm: Nachbarschaft in Welt-Richtungen (Bit 0 N, 1 O, 2 S, 3 W, siehe geom.NEIGHBOURS) zu anderen Befestigungen. */
  wallMask: number;
  /** Ausbildung in der Kaserne. */
  training: { unit: UnitKey; recruit: number; t: number; dur: number } | null;
  queue: UnitKey[];
  /** Rekruten auf dem Weg: holen die Waffe im Lager bzw. tragen sie zur Kaserne (für die Anzeige). */
  recruits?: { unit: UnitKey; stage: "waffe" | "weg" }[];
  /** Nur Tor: offen, solange eigene Leute am Boden im Tor oder direkt davor stehen (Darstellung: Variante „offen“). */
  gateOpen?: boolean;
  /** Ausbaustufe (BuildingDef.levels), fehlt = 1. */
  level?: number;
  /**
   * Laufender Ausbau auf Stufe `level`: Waren kommen wie auf einer Baustelle (needs, site), dann baut ein Tagelöhner
   * (t 0..1). Das Gebäude bleibt dabei in Betrieb.
   */
  upgrade?: { level: number; t: number };
  /** Verarbeitung nach Rezept (nur Gebäude mit BuildingDef.production, ab Fertigstellung). */
  proc?: ProcState;
}

/**
 * Zustand eines Verarbeitungsgebäudes (src/sim/production.ts, ADR 0011). Alle Mengen in Stück; sichtbar sind Puffer
 * und Ausgabestapel als Lagerstapel am Gebäude (BuildingDef.production.inputPiles/outputPiles).
 */
export interface ProcState {
  /** Gewähltes Rezept. */
  recipe: RecipeKey;
  /** Eingangspuffer: angelieferte, noch nicht verarbeitete Waren. */
  in: Partial<Record<Good, number>>;
  /** Eingänge auf dem Weg: zugewiesen (Träger unterwegs) bzw. davon schon aus dem Lager genommen. */
  enroute: Partial<Record<Good, number>>;
  picked: Partial<Record<Good, number>>;
  /** Ausgabestapel und davon für Träger reserviert. */
  out: Partial<Record<Good, number>>;
  res: Partial<Record<Good, number>>;
  /** Ein Arbeitsgang läuft (Eingänge sind entnommen); t = Arbeitssekunden darin. */
  busy: boolean;
  t: number;
  /** Abgeschlossene Arbeitsgänge. */
  done: number;
  /** Vom Spieler angehalten: keine Anlieferung, keine Arbeit. */
  paused?: boolean;
  /** Warum gerade nicht gearbeitet wird (null = ein Arbeitsgang läuft); Text für die Oberfläche: procReason(). */
  why: ProcWhy | null;
}

export type ProcWhy =
  | { k: "angehalten" }
  /** Kein Arbeiter angestellt (keine freien Tagelöhner). */
  | { k: "kein_arbeiter" }
  /** Der Arbeiter ist auf dem Weg zum Arbeitsplatz. */
  | { k: "unterwegs" }
  /** Für einen Arbeitsgang fehlen diese Eingänge im Puffer. */
  | { k: "eingang"; goods: Good[] }
  /** Ausgabestapel voll; full = im Lager dieser Waren ist auch kein Platz mehr (sonst kommen die Träger nicht nach). */
  | { k: "ausgang"; goods: Good[]; full: boolean };

/** Bedarf einer Lieferung: noch fehlende Waren, davon zugewiesen (unterwegs) und schon aus dem Lager genommen. */
export interface Delivery {
  needs: Partial<Record<Good, number>>;
  enroute: Partial<Record<Good, number>>;
  picked: Partial<Record<Good, number>>;
}

/** Forschung im Bergfried: erforschte Techniken und die laufende (Waren werden angeliefert, dann läuft t bis dur). */
export interface ResearchState {
  done: TechKey[];
  cur: (Delivery & {
    key: TechKey;
    /** Fortschritt in Sekunden, läuft erst, wenn alle Waren angeliefert sind. */
    t: number;
    dur: number;
    /** Schon angelieferte Waren (gehen beim Abbrechen ins Lager zurück). */
    got: Partial<Record<Good, number>>;
  }) | null;
}

export type UnitOrder =
  | { t: "idle" }
  | { t: "move"; x: number; y: number; layer: number }
  | { t: "attack"; target: number; kind: "unit" | "building" }
  | { t: "station"; building: number; post: number }
  | { t: "hold" }
  | { t: "job" };

export interface Unit {
  id: number;
  key: UnitKey;
  team: Team;
  /** Position in Welt (Tile-Einheiten, Tile-Mitte = x + 0.5). */
  x: number; y: number;
  /** Höhe in Höhenstufen (0 Boden, 3 Wehrgang, 5 Turm; Treppen dazwischen). */
  z: number;
  /** Laufebene 0 Boden, 1 Wehrgang, 2 Turmplattform. */
  layer: number;
  /** Position im vorigen Tick (Darstellung interpoliert). */
  px: number; py: number; pz: number;
  /** Blickrichtung als Welt-Vektor (nicht normiert nötig). */
  fx: number; fy: number;
  anim: AnimKey;
  /** Sekunden seit Beginn der aktuellen Animation. */
  animT: number;
  /** Getragene Ware (bestimmt die Figur des Trägers). */
  carry: Good | null;
  hp: number; maxHp: number;
  order: UnitOrder;
  /** Arbeitgeber (Gebäude-ID) oder 0. */
  home: number;
  /** Tot: bleibt kurz liegen (anim "tot"), dann entfernt. */
  dead: boolean;
  /**
   * Im Inneren dieses Gebäudes (Träger im Lagerhaus zwischen Tor und Fach): von außen verdeckt, in der Innenansicht
   * sichtbar, für Angreifer nicht erreichbar. Fehlt = draußen.
   */
  inside?: number;
  /** Was die Figur gerade tut (für Auswahl-Panel und Darstellung); von der Simulation gepflegt. */
  activity?: UnitActivity;
  /** Boni aus der Forschung (Reichweite in Feldern, Rüstung), fehlt = keine. */
  boost?: { range?: number; armor?: number };
}

export type UnitActivity =
  | "wartet" | "unterwegs" | "baut" | "traegt" | "faellt" | "zerlegt" | "baut_ab" | "holt_waffe" | "flieht"
  | "kaempft" | "wache" | "haelt" | "zieht_zu" | "verarbeitet";

export interface Projectile {
  id: number;
  team: Team;
  /** Start und Ziel in Welt (x, y, z in Höhenstufen). */
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  /** 0..1 Flugfortschritt. */
  t: number;
}

/** voice: optionale Sprecheransage (Schlüssel aus VOICE in src/data/audio.ts). */
export interface Message { tick: number; text: string; kind: "info" | "warnung" | "kampf"; voice?: VoiceKey }

export interface SimState {
  tick: number;
  seed: number;
  w: number; h: number;
  tiles: Tile[];                      // Index y * w + x
  trees: Tree[];
  rocks: Rock[];
  buildings: Building[];
  units: Unit[];
  projectiles: Projectile[];
  gold: number;
  /** Bevölkerung und Grenze (Wohnraum). */
  population: number; housing: number;
  /** Summe über alle Lager, nur zur Anzeige. */
  stock: Record<Good, number>;
  /**
   * Davon frei verfügbar: Bestand minus verplante Waren (Baustellen, Forschung, Verarbeitung, wartende Rekruten), nie
   * unter 0. Fehlt vor dem ersten Tick alter Spielstände.
   */
  free?: Record<Good, number>;
  /** Lagerkapazität gesamt. */
  capacity: number;
  /** Bestand und Kapazität je Lagertyp (Lagerhaus, Kornkammer); fehlt vor dem ersten Tick alter Spielstände. */
  stores?: Record<StoreKey, { used: number; cap: number }>;
  raid: { next: number; wave: number; active: boolean };
  messages: Message[];
  /** Forschung (seit Spielstand-Version 2 immer vorhanden). */
  research: ResearchState;
  /** Ausgang der Partie: Niederlage, wenn der Bergfried fällt; Sieg, wenn alle Ziele des Szenarios erreicht sind. */
  outcome?: "niederlage" | "sieg";
  /** Szenario, Schwierigkeitsgrad, Einführung und Statistik der Partie (src/sim/match.ts, ADR 0019). */
  match: MatchState;
}

/** Partie: was gespielt wird und was bisher geschah. */
export interface MatchState {
  /** Szenario aus SCENARIOS (null = freies Spiel ohne Siegbedingung, z. B. die leere Testwiese). */
  scenario: ScenarioKey | null;
  difficulty: DifficultyKey;
  /** Aktueller Schritt der Einführung (Index in TUTORIAL), null = keine Einführung. */
  tutorial: number | null;
  /** Tick, an dem die Partie entschieden wurde (Sieg oder Niederlage), sonst null. */
  endTick: number | null;
  stats: MatchStats;
}

/** Statistik für die Tafel am Ende (zählt die Simulation mit, src/sim/match.ts). */
export interface MatchStats {
  /** Abgewehrte Überfallwellen: alle Angreifer der Welle gefallen oder abgezogen. */
  waves: number;
  /** Besiegte Angreifer (gefallen, nicht abgezogen). */
  kills: number;
  /** Eigene Verluste: gefallene Soldaten und gefallene Arbeiter (Tagelöhner, Handwerker). */
  lostSoldiers: number;
  lostWorkers: number;
  /** Zerstörte eigene Gebäude (Abriss zählt nicht). */
  lostBuildings: number;
  /** Fertiggestellte Gebäude (ohne Startaufstellung) und ausgebildete Soldaten. */
  built: number;
  trained: number;
  /** Erzeugte Waren: von Hofstapel oder Ausgabestapel ins Lager getragen (Startbestand und Rückgaben zählen nicht). */
  produced: Partial<Record<Good, number>>;
}

export type Command =
  | { t: "bauen"; key: BuildingKey; x: number; y: number; o: number }
  /** Mauer von (x0, y0) bis (x1, y1) ziehen: gerade oder L-förmig, Tile für Tile. */
  | { t: "mauer"; x0: number; y0: number; x1: number; y1: number }
  | { t: "abreissen"; id: number }
  | { t: "rekrutieren"; building: number; unit: UnitKey }
  /** Ziel-Tile; ist er Teil eines Wehrgangs, gehen die Einheiten hinauf (wenn erreichbar). */
  | { t: "bewegen"; units: number[]; x: number; y: number }
  | { t: "angreifen"; units: number[]; target: number }
  /** Automatisch auf freie Posten verteilen (zuerst Wehrgang, dann Türme). */
  | { t: "stationieren"; units: number[] }
  | { t: "halten"; units: number[] }
  | { t: "ueberfall" }
  /** Forschung im Bergfried beginnen (Gold sofort, Waren bringen Träger). */
  | { t: "forschen"; tech: TechKey }
  /** Laufende Forschung abbrechen: Gold und angelieferte Waren kommen zurück. */
  | { t: "forschung_abbrechen" }
  /** Gebäude (Bergfried) auf die nächste Stufe ausbauen. */
  | { t: "ausbauen"; building: number }
  /** Rezept eines Verarbeitungsgebäudes wählen (nicht passende Puffer-Waren gehen ins Lager zurück). */
  | { t: "rezept"; building: number; recipe: RecipeKey }
  /** Verarbeitung anhalten (an = false) oder fortsetzen. */
  | { t: "produktion"; building: number; an: boolean }
  /**
   * Ausbildung abbrechen: index = Platz in der Warteschlange (Building.queue), −1 = laufende Ausbildung. Gold kommt
   * zurück, eine schon geholte Waffe trägt der Tagelöhner ins Lager zurück.
   */
  | { t: "ausbildung_abbrechen"; building: number; index: number };

/** voice: optionale Sprecheransage zum Ergebnis (z. B. zu_teuer, kein_platz, stationiert, kein_posten, keine_waffe). */
export interface CommandResult { ok: boolean; reason?: string; ids?: number[]; voice?: VoiceKey }

export interface PlacementCheck {
  ok: boolean;
  reason?: string;
  tiles: { x: number; y: number; ok: boolean }[];
}

/** Öffentliche Schnittstelle der Simulation. */
export interface Game {
  readonly state: SimState;
  /** Einen Simulationsschritt (1 / TICKS_PER_SECOND s) ausführen. */
  tick(): void;
  dispatch(cmd: Command): CommandResult;
  /** Bauvorschau: dieselben Regeln wie "bauen". */
  canPlace(key: BuildingKey, x: number, y: number, o: number): PlacementCheck;
  /** Mauer-Vorschau. */
  wallPath(x0: number, y0: number, x1: number, y1: number): PlacementCheck;
  /** Laufebene am Tile, falls dort ein Wehrgang ist (für Zielwahl der Maus), sonst 0. */
  walkLayerAt(x: number, y: number): number;
  /** Spielstand als JSON (Speichern) und Laden. */
  save(): string;
}
