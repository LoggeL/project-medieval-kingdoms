/**
 * Vertrag zwischen Simulation, Darstellung und UI.
 * Die Simulation ist die einzige Stelle, die diesen Zustand verändert. Darstellung und UI lesen ihn nur
 * und schicken Befehle (Command). Alles hier ist in Welt-Koordinaten; Drehung kennt nur die Darstellung.
 */
import type { AnimalAnim, AnimalKey, AnimKey, BuildingKey, CropKey, DifficultyKey, FormationKey, Good, RationKey, RecipeKey, ScenarioKey, StanceKey, StoreKey, TechKey, TerrainKey, UnitKey } from "../data";
import type { VoiceKey } from "../data/audio";

export type Team = 0 | 1; // 0 = Spieler (blau), 1 = Angreifer (rot)

export interface Tile {
  terrain: TerrainKey;
  /** Zufällige Variante für die Darstellung (stabil pro Tile). */
  variant: number;
  /** Gebäude-ID, die den Tile belegt, sonst 0. */
  building: number;
}

/** waechst: nachwachsender Baum (Setzling, Jungbaum, halbwüchsig; Tree.stage), noch nicht fällbar (ADR 0016). */
export type TreeState = "stehend" | "faellt" | "liegt" | "stumpf" | "waechst";

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
  /** Nachwachsen (ADR 0016): Wachstumsstufe 0..2 im Zustand "waechst"; Ticks seit Beginn der Stufe bzw. seit dem Fällen (Stumpf). Fehlt = 0. */
  stage?: number;
  age?: number;
}

/**
 * Tier (ADR 0016): eigene Objekte neben den Einheiten, kein Teil von Kampf und Wegnetz. Weidetiere ziehen um ihren
 * Weideplatz, Wild flieht vor Figuren, Krähen fliegen auf. Wild ist jagdbar (src/sim/animals.ts: findGame, killAnimal, takeMeat).
 */
export interface Animal {
  id: number;
  key: AnimalKey;
  /** Position in Welt (wie Unit), Höhe z in Höhenstufen (nur fliegende Vögel). */
  x: number; y: number; z: number;
  px: number; py: number; pz: number;
  fx: number; fy: number;
  anim: AnimalAnim;
  animT: number;
  /** Weideplatz (Mitte des Streifgebiets). */
  hx: number; hy: number;
  /** Aktuelles Ziel. */
  tx: number; ty: number;
  /** ruht/grast, zieht, flieht, fliegt; tot. Ticks im Zustand bis zum nächsten Wechsel. */
  mode: "ruht" | "zieht" | "flieht" | "fliegt" | "tot";
  t: number;
  hp: number;
  /** Erlegtes Wild: verbleibendes Fleisch; Jäger, der es reserviert hat (0 = niemand). */
  meat: number;
  reservedBy: number;
}

export interface Rock {
  id: number;
  x: number; y: number;               // Tile
  amount: number; max: number;        // Blöcke, die noch im Fels stecken
  reservedBy: number;
  /** Erzvorkommen statt Stein (Erzmine, Tag „erz“); fehlt = Stein für den Steinbruch. */
  kind?: "erz";
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
  /** Felder eines Hofs (nur Gebäude mit BuildingDef.fields, ab dem Setzen der Baustelle; ADR 0013). */
  farm?: FarmState;
  /** Automatische Reparatur vom Spieler abgeschaltet (fehlt = an; ADR 0017). */
  repairOff?: boolean;
}

/** Felder eines Hofs (src/sim/farm.ts): Beete mit Stufe der Feldfrucht (CROPS in src/data/landwirtschaft.ts). */
export interface FarmState {
  crop: CropKey;
  plots: Plot[];
  /** Geerntete Stück insgesamt, ab dem Pflücken (die Last des Bauern auf dem Weg zum Hof zählt mit). */
  harvested: number;
}

/** Ein Beet auf einer Feldkachel (Welt-Tile x, y). */
export interface Plot {
  x: number; y: number;
  /** Stufe der Feldfrucht (Index in CROPS[..].stages). */
  stage: number;
  /** Sekunden in der Stufe (Wachstum bzw. Arbeit des Bauern). */
  t: number;
  /** Bauer, der hier arbeitet oder auf dem Weg ist (0 = keiner). */
  by: number;
}

/**
 * Ernährung (src/sim/food.ts, ADR 0013): gewählte Ration, Verbrauch, Vorrat an Portionen in den Kornkammern und Hunger.
 */
export interface FoodState {
  ration: RationKey;
  /** Verbrauch in Portionen je Minute bei der aktuellen Bevölkerung. */
  perMinute: number;
  /** Essbarer Vorrat in Portionen (alle Kornkammern). */
  stock: number;
  /** Vorrätige Nahrungsarten (Vielfalt). */
  kinds: number;
  /** Offene Portionen (Bruchteil, der beim nächsten Stück gegessen wird). */
  debt: number;
  /** Sekunden ohne Essen (0 = satt). */
  hunger: number;
  /** Sekunden seit dem letzten Fortgang eines Hungernden. */
  leave: number;
  /** Gegessene Portionen insgesamt. */
  eaten: number;
}

/**
 * Sturmleiter an einer Mauer (ADR 0017): Fuß auf dem Boden-Tile (x, y), oberes Ende auf dem Wehrgang-Tile (wx, wy).
 * o = Ausrichtung wie bei Gebäuden: Modell +y zeigt vom Fuß zur Mauer (Sprite „leiter“). Steht sie, verbindet sie für
 * Angreifer Boden und Wehrgang. push 0..1 = Fortschritt des Umstoßens; umgestoßen kippt sie (t Sekunden) und liegt.
 */
export interface Ladder {
  id: number;
  x: number; y: number;
  wx: number; wy: number;
  o: number;
  state: "steht" | "faellt" | "liegt";
  /** Sekunden im aktuellen Zustand. */
  t: number;
  push: number;
}

/** Trümmer einer zerstörten Befestigung bzw. ein zugeschütteter Graben: begehbar (langsamer), Sprite mit Variante v. */
export interface Rubble { x: number; y: number; sprite: string; v: number; o: number }

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

/** Wegpunkt eines Befehls: Tile und Laufebene. */
export type OrderPoint = [x: number, y: number, layer: number];

export type UnitOrder =
  | { t: "idle" }
  /**
   * Bewegen (ADR 0018): fx/fy = Blickrichtung am Ziel (Formation), pace = Höchsttempo der Gruppe (Felder/s), damit eine
   * Formation zusammen ankommt. Fehlen in alten Spielständen.
   */
  | { t: "move"; x: number; y: number; layer: number; fx?: number; fy?: number; pace?: number }
  /** Angriffsmarsch: zum Ziel gehen, unterwegs Gegner angreifen, danach weiter. */
  | { t: "amove"; x: number; y: number; layer: number; fx?: number; fy?: number; pace?: number }
  /** Patrouille: Wegmarken der Reihe nach (i = nächste), danach wieder von vorn; unterwegs Gegner angreifen. */
  | { t: "patrol"; pts: OrderPoint[]; i: number; pace?: number }
  /** Rückzug zum Bergfried bzw. Sammelplatz: schneller, ohne zu kämpfen. */
  | { t: "retreat"; x: number; y: number }
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
  /** Tick des letzten erlittenen Treffers (Zusammenzucken in der Darstellung, ADR 0016). Fehlt = nie. */
  hitT?: number;
  /** Rennt (fliehender Tagelöhner): schneller, Rennbilder. Fehlt = geht. */
  run?: boolean;
  /** Getragenes Gerät (Sturmleiter des Sturmknechts), fehlt = keins. */
  gear?: "leiter";
  /** Soldaten: Haltung (STANCES), fehlt = DEFAULT_STANCE. */
  stance?: StanceKey;
  /** Soldaten: Formation beim Bewegen (FORMATIONS), fehlt = DEFAULT_FORMATION. */
  formation?: FormationKey;
}

export type UnitActivity =
  | "wartet" | "unterwegs" | "baut" | "traegt" | "faellt" | "zerlegt" | "baut_ab" | "holt_waffe" | "flieht"
  | "kaempft" | "wache" | "haelt" | "zieht_zu" | "verarbeitet" | "bestellt" | "zieht_fort"
  /** Belagerung (ADR 0017): Leiter anlegen, klettern, Leiter umstoßen, Rammbock schieben, reparieren, sich erholen. */
  | "legt_an" | "klettert" | "stoesst_um" | "schiebt" | "repariert" | "erholt"
  /** Befehle der Soldaten (ADR 0018). */
  | "marschiert" | "patrouilliert" | "zieht_zurueck";

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
  /** Ernährung (ADR 0013); fehlt in alten Spielständen bis zum ersten Tick. */
  food?: FoodState;
  /** Forschung (seit Spielstand-Version 2 immer vorhanden). */
  research: ResearchState;
  /** Ausgang der Partie: Niederlage, wenn der Bergfried fällt; Sieg, wenn alle Ziele des Szenarios erreicht sind. */
  outcome?: "niederlage" | "sieg";
  /** Szenario, Schwierigkeitsgrad, Einführung und Statistik der Partie (src/sim/match.ts, ADR 0019). */
  match: MatchState;
  /** Tiere (ADR 0016); fehlt in Spielständen ohne Tiere und im leeren Szenario. */
  animals?: Animal[];
  /** Sturmleitern an den Mauern (fehlt in alten Spielständen = keine). */
  ladders?: Ladder[];
  /** Trümmer zerstörter Befestigungen (Breschen) und zugeschüttete Gräben. */
  rubble?: Rubble[];
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
  /** Mauer (bzw. key: Palisade, Graben) von (x0, y0) bis (x1, y1) ziehen: gerade oder L-förmig, Tile für Tile. */
  | { t: "mauer"; x0: number; y0: number; x1: number; y1: number; key?: BuildingKey }
  /** Weg oder Brücke (BuildingDef.road) von (x0, y0) bis (x1, y1) ziehen; Wege gerade oder L-förmig, Brücken gerade. */
  | { t: "weg"; key: BuildingKey; x0: number; y0: number; x1: number; y1: number }
  | { t: "abreissen"; id: number }
  | { t: "rekrutieren"; building: number; unit: UnitKey }
  /**
   * Ziel-Tile; ist er Teil eines Wehrgangs, gehen die Einheiten hinauf (wenn erreichbar). Am Boden stellen sie sich in
   * ihrer Formation auf; fx/fy = Blickrichtung (Rechtsziehen), sonst die Marschrichtung.
   */
  | { t: "bewegen"; units: number[]; x: number; y: number; fx?: number; fy?: number }
  /** Angriffsmarsch zum Tile (Formation wie bewegen). */
  | { t: "angriffsbewegung"; units: number[]; x: number; y: number; fx?: number; fy?: number }
  /** Patrouille vom Standort über die Wegmarken (Tiles) und zurück. */
  | { t: "patrouille"; units: number[]; pts: { x: number; y: number }[] }
  /** Rückzug zum Bergfried (ohne Bergfried zum Sammelplatz). */
  | { t: "rueckzug"; units: number[] }
  /** Haltung setzen. */
  | { t: "haltung"; units: number[]; stance: StanceKey }
  /** Formation setzen; stehende Soldaten stellen sich sofort am Ort neu auf. */
  | { t: "formation"; units: number[]; formation: FormationKey }
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
  /** Ration der Siedlung wählen (RATIONS in src/data/nahrung.ts). */
  | { t: "rationen"; ration: RationKey }
  /** Automatische Reparatur eines Gebäudes an- oder abschalten. */
  | { t: "reparatur"; building: number; an: boolean }
  /**
   * Ausbildung abbrechen: index = Platz in der Warteschlange (Building.queue), −1 = laufende Ausbildung. Gold kommt
   * zurück, eine schon geholte Waffe trägt der Tagelöhner ins Lager zurück.
   */
  | { t: "ausbildung_abbrechen"; building: number; index: number };

/** voice: optionale Sprecheransage zum Ergebnis (z. B. zu_teuer, kein_platz, stationiert, kein_posten, keine_waffe). */
export interface CommandResult { ok: boolean; reason?: string; ids?: number[]; voice?: VoiceKey }

/** Platz einer Einheit in einer Formation (Tile, Laufebene, Höhe für die Darstellung). */
export interface FormationSlot { id: number; x: number; y: number; layer: number; z: number }

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
  /** Mauer-Vorschau (key: Palisade, Graben; Standard Mauer). */
  wallPath(x0: number, y0: number, x1: number, y1: number, key?: BuildingKey): PlacementCheck;
  /** Weg- bzw. Brücken-Vorschau (dieselben Regeln wie "weg"). */
  roadPath(key: BuildingKey, x0: number, y0: number, x1: number, y1: number): PlacementCheck;
  /** Laufebene am Tile, falls dort ein Wehrgang ist (für Zielwahl der Maus), sonst 0. */
  walkLayerAt(x: number, y: number): number;
  /** Formationsplätze für einen Bewegungsbefehl (Vorschau beim Rechtsziehen): dieselbe Rechnung wie „bewegen“. */
  planFormation?(units: number[], x: number, y: number, fx?: number, fy?: number): FormationSlot[];
  /** Spielstand als JSON (Speichern) und Laden. */
  save(): string;
}
