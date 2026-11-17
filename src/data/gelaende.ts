/**
 * Landschaft nach BRIEF §3 (ADR 0012): weitere Geländearten, Regeln für Felder und Steinvorkommen, Aufbau der Karte.
 * Die Arten werden in TERRAIN (index.ts) eingehängt. Alles hier ist Daten; der Kartengenerator (src/sim/mapgen.ts) und
 * das Nachrutschen am Gebirgsfuß (src/sim/gelaende.ts) lesen nur diese Werte.
 */
import type { TerrainDef, TerrainKey } from "./index";

export type GelaendeKey = "huegel" | "gebirge" | "sumpf" | "sand" | "fruchtbar";

/**
 * cost ist zugleich Wegkosten und Gangart: Die Figuren gehen mit 1 / cost der Grundgeschwindigkeit (begrenzt auf
 * 0,55–1,45, src/sim/move.ts speedOf), der Weg sucht sich daher den Bogen um Sumpf und Hügel, wenn er sich lohnt.
 */
export const GELAENDE: Record<GelaendeKey, TerrainDef> = {
  /** Begehbare Hügel: Zwischenschritt ohne echte Höhenstufe (ADR 0012), langsamer, bebaubar. */
  huegel: { name: "Hügel", walkable: true, buildable: true, cost: 1.5 },
  /** Felsmassiv: nicht begehbar, nicht bebaubar, ein festes Hindernis wie Wasser. */
  gebirge: { name: "Gebirge", walkable: false, buildable: false, cost: 99 },
  /** Sumpf: begehbar, aber sehr langsam, nicht bebaubar. */
  sumpf: { name: "Sumpf", walkable: true, buildable: false, cost: 2.2 },
  /** Strand und Sandufer an See und Küste. */
  sand: { name: "Sand", walkable: true, buildable: true, cost: 1.15 },
  /** Fruchtbarer Auenboden: bester Ackerboden (siehe FELD_BODEN). */
  fruchtbar: { name: "Fruchtbarer Boden", walkable: true, buildable: true, cost: 1 },
};

// ---------------------------------------------------------------- Ackerbau
/**
 * Böden, auf denen Felder angelegt werden dürfen, mit ihrem Ertragsfaktor (1 = voller Ertrag). Fehlt ein Boden, ist dort
 * kein Feld möglich. Ein Bauernhof fragt das je Feldkachel mit feldErlaubt() bzw. fruchtbarkeit() ab.
 */
export const FELD_BODEN: Partial<Record<TerrainKey, number>> = { fruchtbar: 1, wiese: 0.7 };

/** Darf auf diesem Boden ein Feld liegen? */
export function feldErlaubt(t: TerrainKey): boolean {
  return (FELD_BODEN[t] ?? 0) > 0;
}

/** Ertragsfaktor eines Bodens für Felder (0 = kein Feld möglich). */
export function fruchtbarkeit(t: TerrainKey): number {
  return FELD_BODEN[t] ?? 0;
}

// ---------------------------------------------------------------- Stein
export const STEIN = {
  /**
   * Blöcke je Brocken im Felsfeld an der Startsiedlung (wie vorher, damit der Spielbeginn gleich bleibt) und je Brocken
   * der neuen Vorkommen auf den Hügelkuppen und der Geröllhalde: die reichen Lagerstätten liegen weiter draußen.
   */
  field: [8, 16] as [number, number],
  amount: [20, 36] as [number, number],
  /**
   * Nachrutschen am Gebirgsfuß: Felskacheln bis `reach` Felder vom Gebirge entfernt bilden die Geröllhalde. Alle
   * `slideSeconds` rutscht dort ein neuer Brocken mit `slideAmount` Blöcken nach, solange weniger als `slideMax` Brocken
   * auf der Halde liegen. Nie neben einen anderen Brocken, eine Figur, einen Baum, ein Gebäude oder vor eine Tür.
   */
  reach: 2,
  slideSeconds: 40,
  slideAmount: [10, 16] as [number, number],
  slideMax: 6,
};

// ---------------------------------------------------------------- Kartenaufbau
/**
 * Lage der Landschaftsteile auf der Standardkarte, als Anteil der Kartengröße (x nach Osten, y nach Süden), damit
 * größere Karten dieselbe Gliederung haben. Rauschen und Lage im Einzelnen kommen deterministisch aus dem Seed.
 */
export const LANDSCHAFT = {
  /** Felsmassiv im Nordwesten über dem Waldrand, an das das Felsfeld des Steinbruchs grenzt. */
  massiv: { cx: 0.24, cy: 0.0, rx: 0.17, ry: 0.12 },
  /** Breite der Geröllhalde (Fels) und des Hügelsaums um das Massiv, in Einheiten des Ellipsenmaßes. */
  halde: 0.22, huegelsaum: 0.75,
  /** Hügelkuppen mit Felskopf (zusätzliches Steinvorkommen): Mitte, Halbachsen, Anteil des Felskopfs. */
  kuppen: [
    { cx: 0.6, cy: 0.79, rx: 0.08, ry: 0.07, kopf: 0.45 },
    { cx: 0.92, cy: 0.22, rx: 0.065, ry: 0.075, kopf: 0.42 },
  ],
  /** See im Südwesten am Waldrand mit Sandufer (Breite in Ellipsenmaß). */
  see: { cx: 0.33, cy: 0.85, rx: 0.085, ry: 0.07, ufer: 0.4 },
  /** Küste im Süden östlich der Mitte: Meerestiefe und Strandbreite in Anteilen der Kartenhöhe, Beginn in x. */
  kueste: { x0: 0.55, tiefe: 0.06, strand: 0.035 },
  /** Sumpf an der Flussmündung: ab dieser Höhe, bis zu diesem Abstand vom Fluss (Anteil der Breite), Rauschschwelle. */
  sumpf: { y0: 0.68, breite: 0.15, schwelle: 0.44 },
  /** Fruchtbarer Boden: Rauschschwelle in Flussnähe (Auen) und auf freiem Grasland. */
  fruchtbar: { aue: 0.63, auenbreite: 0.12, feld: 0.76 },
  /** Um die Startsiedlung bleibt das Gelände wie es ist (Felder Abstand vom Siedlungsanker, Chebyshev). */
  schutz: 9,
};
