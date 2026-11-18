/**
 * Innerer Zustand der Simulation.
 *
 * Der öffentliche Zustand (SimState aus types.ts) ist die einzige Wahrheit. Einheiten, Gebäude und Geschosse
 * tragen zusätzlich ein Feld `ai` mit ihrem Arbeits- und Wegzustand. Damit steckt alles, was für das
 * Speichern und für identische Folge-Ticks nötig ist, in einem JSON-Baum (state + meta).
 * Abgeleitete Strukturen (Laufraster, Pfad-Cache, Nachschlagetabellen, Raum-Raster) baut World neu auf.
 */
import { BUILDINGS, TICKS_PER_SECOND, UNITS, type AnimKey, type BuildingKey, type Good, type TechKey, type UnitKey } from "../data";
import type { VoiceKey } from "../data/audio";
import type { Building, Message, Projectile, SimState, Team, Unit } from "./types";
import type { LifeMeta } from "./animals";
import { nextRandom } from "./rng";
import { Nav } from "./nav";
import { Spatial } from "./spatial";

export const TPS = TICKS_PER_SECOND;
/** Pfadsuchen pro Tick (gestaffelt, damit 300 Einheiten nicht im selben Tick rechnen). */
export const PATH_BUDGET = 24;
/**
 * Version der Spielstände. 2: mit Bergfried (Sitz, Forschung, Niederlage) und der neuen Einführung. 3: mit Partie
 * (`state.match`: Szenario, Schwierigkeitsgrad, Statistik; ADR 0019). Ältere Stände hebt migrate.ts an, Version 1
 * (ohne Bergfried) wird abgelehnt.
 */
export const SAVE_VERSION = 3;

// ---------------------------------------------------------------- Aufträge der Arbeiter
export type Job =
  /**
   * Arbeitszyklus des Gebäudes u.home (Schritt im Datenzyklus, Zeit im Schritt in Ticks, reserviertes Ziel). ins nur
   * beim Verarbeiten: im Gebäude zurückgelegte Strecke von der Tür zum Arbeitsplatz (Tiles), fehlt = draußen. n nur beim
   * Feldbau: Stück der getragenen Ernte (u.carry), fehlt = 1.
   */
  | { k: "cycle"; step: number; t: number; tgt: number; wait: number; ins?: number; n?: number }
  /** Tagelöhner geht zur Werkstatt und wird dort Arbeiter. */
  | { k: "employ"; b: number }
  /** Hofstapel → Lager-Slot. ph 0 = zur Abholung, 1 = mit Ware zum Lager. */
  | { k: "haul"; from: number; to: number; slot: number; good: Good; ph: 0 | 1 }
  /**
   * Lager-Slot → Baustelle (bzw. mit rk: Forschung im Bergfried `site`; mit pk: Eingangspuffer des
   * Verarbeitungsgebäudes `site`).
   */
  | { k: "supply"; site: number; from: number; slot: number; good: Good; ph: 0 | 1; rk?: TechKey; pk?: true }
  /** Bauen auf einer Baustelle, deren Material vollständig ist. */
  /** Bauen: spot = Index des Standplatzes rund um den Grundriss (−1 = irgendwo daneben), t = Arbeitsticks dort. Fehlen in alten Spielständen. */
  | { k: "build"; site: number; spot?: number; t?: number }
  /**
   * Ausrüstung aus dem Lager holen und in der Kaserne ausbilden lassen: from/slot/good = erstes Stück (die getragene
   * Waffe), more = weitere Stücke (z. B. die Rüstung des Pikeniers, ADR 0014), n = schon aufgenommene Stücke. Alle
   * Stücke sind ab der Vergabe im Fach reserviert. Ohne Ausrüstung (Söldner) gleich ph 1, good fehlt.
   */
  | { k: "recruit"; b: number; from: number; slot: number; good?: Good; unit: UnitKey; ph: 0 | 1; more?: RecruitPiece[]; n?: number }
  /** Hungernder Tagelöhner verlässt die Siedlung (geht zum Kartenrand und verschwindet, food.ts). */
  | { k: "leave" }
  /**
   * Reparatur (ADR 0017): ein Stück Ware aus dem Lager holen (ph 0), an das beschädigte Gebäude b tragen (ph 1) und dort
   * t Ticks hämmern (ph 2), dann kommen Lebenspunkte zurück.
   */
  | { k: "repair"; b: number; from: number; slot: number; good: Good; ph: 0 | 1 | 2; t: number };

/** Ein Ausrüstungsstück des Rekruten: Lager, Fach, Ware. */
export interface RecruitPiece { from: number; slot: number; good: Good }

export interface UnitAI {
  /** Knoten (Laufebene · W · H + y · W + x) bis zum Ziel. */
  path: number[] | null;
  pi: number;
  /** Schlüssel des Ziels, zu dem path führt. */
  goal: string;
  navV: number;
  hasEnd: boolean; endX: number; endY: number;
  /** Ticks bis zur nächsten erlaubten Pfadsuche (nach Fehlschlag). */
  wait: number;
  job: Job | null;
  /** Abklingzeit des Angriffs in Ticks. */
  cd: number;
  /** Kampfziel: Einheit oder Gebäude (0 = keins). */
  target: number;
  targetB: number;
  /** Ziel-Tile beim Verfolgen. */
  cx: number; cy: number;
  /** Ticks bis zum nächsten Nachdenken (Zielwahl). */
  think: number;
  /** Ticks seit dem Tod. */
  deadT: number;
  /** Tagelöhner auf der Flucht (Ticks). */
  flee: number;
  /** Tick, bis zu dem der Disponent diesem Tagelöhner keinen Auftrag gibt (nach einem unerreichbaren Ziel). Fehlt in alten Spielständen. */
  noJob?: number;
  /** Frisch zugezogen: läuft vom Kartenrand zum Sammelplatz (Anzeige „zieht zu“). */
  fresh?: boolean;
  /** Tick des letzten Schlags gegen ein Gebäude (Zielwahl der Verteidiger: wer Tor oder Mauer angreift, ist gefährlich). */
  hitB?: number;
  /** Tick, bis zu dem das aktuelle Kampfziel gehalten wird (kein Flackern zwischen Zielen). */
  lock?: number;
  /** Angreifer auf dem Rückzug zum Kartenrand. */
  retreat?: boolean;
  /** Rückzug unmöglich, kämpft bis zuletzt. */
  cornered?: boolean;
  /**
   * Gang durchs Lagerhaus: Gebäude, Fach, zurückgelegte Strecke auf storeWalk (Tiles), Wartezeit am Fach (Ticks),
   * done = Ware getauscht, die Figur geht wieder hinaus. Fehlt in alten Spielständen.
   */
  visit?: { b: number; k: number; s: number; wait: number; done: boolean };
  /** Nahkämpfer auf dem Posten: hat den Posten verlassen, um Tor, Treppe oder Wehrgang zu verteidigen. */
  sortie?: boolean;
  /** Wache auf dem Posten tritt bis zu diesem Tick von einem Fuß auf den anderen (ADR 0016). Fehlt = steht. */
  step?: number;
  /** Tick des letzten erlittenen Treffers (Heilung erst nach Ruhe). */
  hurtT?: number;
  /** Sturmknecht mit Leiter: gewählter Fuß (fx, fy) an der Mauer (wx, wy), t = Ticks beim Aufrichten. */
  ladder?: { fx: number; fy: number; wx: number; wy: number; t: number };
  /** Mannschaft: ID des Rammbocks, den dieser Sturmknecht schiebt (0/fehlt = keiner). */
  ram?: number;
  /** Rammbock: Gebäude, das er nicht erreicht hat (bei der nächsten Zielwahl zuletzt). */
  skipB?: number;
  /** Haltung defensiv bzw. Stellung halten: Standplatz (x, y, Ebene), zu dem der Soldat nach dem Kampf zurückkehrt; beim
   *  Angriffsmarsch und auf Patrouille der Punkt, an dem der Kampf begann (Verfolgungsgrenze, ADR 0018). */
  anchor?: [number, number, number];
  /** Patrouille: unerreichbare Wegmarken in Folge. */
  pfail?: number;
}
export type SUnit = Unit & { ai: UnitAI };

export interface BuildingAI {
  /** Baustelle: zugewiesene Lieferungen je Ware (unterwegs oder noch abzuholen). */
  enroute: Partial<Record<Good, number>>;
  /** Davon schon aus dem Lager genommen (in den Händen eines Trägers). */
  picked: Partial<Record<Good, number>>;
  builder: number;
  /**
   * Baustelle: Standplatz, an dem der nächste Bauarbeiter anfängt. Wer nach getaner Arbeit geht (Material alle),
   * rückt ihn eine Seite weiter, damit auch bei stockendem Nachschub rund um den Bau gearbeitet wird.
   */
  nextSpot?: number;
  /** Kaserne: Tagelöhner, der gerade die Waffe holt, und ob er sie schon trägt (alle Stücke). */
  recruit: number;
  recruitPicked: boolean;
  /** Kaserne: so viele Ausrüstungsstücke hat der Rekrut schon aus dem Lager genommen (storage.committed). */
  recruitGot?: number;
  /** Kaserne: Rekrut in Ausbildung (aus der Welt genommen). */
  inside: SUnit | null;
  /** Tagelöhner, der gerade repariert (0/fehlt = keiner), und Tick des letzten Treffers (Reparatur erst nach Ruhe). */
  repairer?: number;
  hitT?: number;
}
export type SBuilding = Building & { ai: BuildingAI };

export type SProjectile = Projectile & {
  target: number;
  /** Schütze (Werte zum Zeitpunkt des Schusses). */
  akey: UnitKey; az: number;
  /** Flugdauer in Ticks. */
  dur: number;
  kind: "unit" | "building";
  /** ID des Schützen (für Gegenwehr). */
  from: number;
};

export type SState = Omit<SimState, "units" | "buildings" | "projectiles"> & {
  units: SUnit[]; buildings: SBuilding[]; projectiles: SProjectile[];
};

export interface Meta {
  version: number;
  rng: number;
  nextId: number;
  navVersion: number;
  nextImmigrant: number;
  /** Letzter Tick je Meldungsschlüssel (Meldungen nicht wiederholen). */
  throttle: Record<string, number>;
  /** Sammelplatz untätiger Tagelöhner, Zuzug vom Kartenrand, Anmarsch der Angreifer. */
  camp: [number, number];
  entry: [number, number];
  raidSpawn: [number, number];
  raidsEnabled: boolean;
  /** Zuzug neuer Tagelöhner (aus im leeren Szenario). */
  immigration: boolean;
  /** Bei Kampfbeginn einer Welle gesetzt, für die Meldung „abgewehrt“. */
  raidRunning: boolean;
  /** Verluste der laufenden Welle (gefallen oder abgezogen); ein allein übrig gebliebener Angreifer zieht ab. */
  raidLosses?: number;
  /** Nächster Schritt der Einführung (Index in TUTORIAL), fehlt = keine Einführung. */
  tutorial?: number;
  /** Kein Essen (leeres Szenario der Tests): Niemand isst, niemand hungert. Fehlt = es wird gegessen. */
  hungerOff?: boolean;
  /** Angesammelte Steuern in Gold · Ticks je Minute (60 · TPS ergeben ein Gold), fehlt = 0. */
  tax?: number;
  /** Lebendige Welt (Tiere, nachwachsender Wald; ADR 0016): eigener Zufallsstrom und ID-Bereich. Fehlt = aus (alte Stände). */
  life?: LifeMeta;
}

export class World {
  readonly s: SState;
  readonly meta: Meta;
  readonly nav: Nav;
  readonly grid: Spatial;
  readonly units = new Map<number, SUnit>();
  readonly buildings = new Map<number, SBuilding>();
  /** Restliche Pfadsuchen in diesem Tick. */
  budget = PATH_BUDGET;

  constructor(s: SState, meta: Meta, rebuildNav = true) {
    this.s = s;
    this.meta = meta;
    this.nav = new Nav(this);
    this.grid = new Spatial(s.w, s.h);
    this.reindex();
    this.nav.rebuild(rebuildNav);
  }

  reindex(): void {
    this.units.clear();
    for (const u of this.s.units) this.units.set(u.id, u);
    this.buildings.clear();
    for (const b of this.s.buildings) this.buildings.set(b.id, b);
  }

  rand(): number { return nextRandom(this.meta); }
  newId(): number { return this.meta.nextId++; }

  idx(x: number, y: number): number { return y * this.s.w + x; }
  inMap(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.s.w && y < this.s.h; }
  /** Gebäude auf dem Tile oder undefined. */
  buildingAt(x: number, y: number): SBuilding | undefined {
    if (!this.inMap(x, y)) return undefined;
    const id = this.s.tiles[this.idx(x, y)].building;
    return id ? this.buildings.get(id) : undefined;
  }

  /** Meldung; mit key höchstens alle `seconds` Sekunden. voice: Sprecheransage (VOICE in data/audio.ts). */
  msg(text: string, kind: Message["kind"] = "info", key?: string, seconds = 20, voice?: VoiceKey): void {
    if (key) {
      const last = this.meta.throttle[key];
      if (last !== undefined && this.s.tick - last < seconds * TPS) return;
      this.meta.throttle[key] = this.s.tick;
    }
    const m: Message = { tick: this.s.tick, text, kind };
    if (voice) m.voice = voice;
    this.s.messages.push(m);
    if (this.s.messages.length > 40) this.s.messages.splice(0, this.s.messages.length - 40);
  }

  addUnit(key: UnitKey, team: Team, x: number, y: number, layer = 0, z = 0): SUnit {
    const def = UNITS[key];
    const u: SUnit = {
      id: this.newId(), key, team, x, y, z, layer, px: x, py: y, pz: z, fx: 0, fy: 1,
      anim: "stehen", animT: 0, carry: null, hp: def.hp, maxHp: def.hp,
      order: { t: "idle" }, home: 0, dead: false, ai: newUnitAI(),
    };
    this.s.units.push(u);
    this.units.set(u.id, u);
    return u;
  }

  /** Einheit wieder in die Welt setzen (Rekrut nach der Ausbildung). */
  insertUnit(u: SUnit): void {
    this.s.units.push(u);
    this.units.set(u.id, u);
  }

  removeUnit(u: SUnit): void {
    const i = this.s.units.indexOf(u);
    if (i >= 0) this.s.units.splice(i, 1);
    this.units.delete(u.id);
  }

  addBuilding(key: BuildingKey, team: Team, x: number, y: number, o: number): SBuilding {
    const def = BUILDINGS[key];
    const b: SBuilding = {
      id: this.newId(), key, team, x, y, o, built: 0, needs: {}, site: {}, hp: def.hp,
      output: def.output ? { good: def.output.good, amount: 0, reserved: 0 } : null,
      slots: [], workers: [], wallMask: 0, training: null, queue: [],
      ai: { enroute: {}, picked: {}, builder: 0, recruit: 0, recruitPicked: false, inside: null },
    };
    this.s.buildings.push(b);
    this.buildings.set(b.id, b);
    return b;
  }

  removeBuildingRecord(b: SBuilding): void {
    const i = this.s.buildings.indexOf(b);
    if (i >= 0) this.s.buildings.splice(i, 1);
    this.buildings.delete(b.id);
  }

  aliveUnit(id: number): SUnit | undefined {
    const u = id ? this.units.get(id) : undefined;
    return u && !u.dead ? u : undefined;
  }
}

export function newUnitAI(): UnitAI {
  return {
    path: null, pi: 0, goal: "", navV: 0, hasEnd: false, endX: 0, endY: 0, wait: 0,
    job: null, cd: 0, target: 0, targetB: 0, cx: 0, cy: 0, think: 0, deadT: 0, flee: 0,
  };
}

/** Animation setzen; animT läuft weiter, solange sie gleich bleibt (restart erzwingt Neubeginn). */
export function setAnim(u: Unit, a: AnimKey, restart = false): void {
  if (u.anim !== a || restart) { u.anim = a; u.animT = 0; }
}

export function face(u: Unit, dx: number, dy: number): void {
  if (Math.abs(dx) + Math.abs(dy) > 1e-6) { u.fx = dx; u.fy = dy; }
}

export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);

/** Abstand eines Punkts zu einem Rechteck in Tile-Koordinaten (Kanten bei ganzen Zahlen). */
export function distToRect(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = Math.max(x0 - px, 0, px - x1), dy = Math.max(y0 - py, 0, py - y1);
  return Math.hypot(dx, dy);
}
