/**
 * Einheitenraster für die Oberfläche (BRIEF §8.3, Konzept 08 „Einheitenraster“).
 * Spielbare Einheiten kommen aus UNITS (src/data). Dazu kommen Einheiten aus dem Konzept (Kapitel 05/06),
 * die im Prototyp noch gesperrt sind: Sie stehen ausgegraut im Raster und nennen ihre Voraussetzung.
 * Sobald es Forschung gibt, wandern diese Einträge in die Datendefinitionen.
 */
import { UNITS, type UnitKey } from "../data";

export interface RosterEntry {
  /** UnitKey, wenn spielbar, sonst ein eigener Schlüssel. */
  key: string;
  name: string;
  /** Spielbare Einheit aus UNITS. */
  unit?: UnitKey;
  /** Figur im Figurenblatt, falls es schon eine gibt (für gesperrte Einheiten). */
  sprite?: string;
  /** Rolle in einem Satz (gesperrte Einheiten). */
  role?: string;
  /** Fehlende Forschung bzw. fehlendes Gebäude. */
  needs?: string[];
}

export interface RosterGroup { title: string; building: string; entries: RosterEntry[] }

const real = (k: UnitKey): RosterEntry => ({ key: k, name: UNITS[k].name, unit: k });
const locked = (key: string, name: string, role: string, needs: string[], sprite?: string): RosterEntry =>
  ({ key, name, role, needs, sprite });

export const ROSTER: RosterGroup[] = [
  {
    title: "Fußvolk", building: "Kaserne", entries: [
      real("speer"),
      real("schwert"),
      locked("hellebardier", "Hellebardier", "Stark gegen Reiter und Plattenrüstung.", ["Forschung: Stangenwaffen"]),
      locked("pikenier", "Pikenier", "Pikenblock, Rückgrat der späten Heere.", ["Forschung: Gewalthaufen"]),
      locked("fusssoldat", "Gepanzerter Fußsoldat", "Schwere Front, langsam, kaum verwundbar.", ["Forschung: Plattnerei"], "ritter"),
    ],
  },
  {
    title: "Schützen", building: "Kaserne / Schießplatz", entries: [
      real("bogen"),
      locked("langbogen", "Langbogenschütze", "Große Reichweite, schnelle Schussfolge.", ["Forschung: Doktrin Fernkampf", "Gebäude: Schießplatz"]),
      locked("armbrust", "Armbrustschütze", "Durchschlagend gegen Rüstung, lädt langsam.", ["Forschung: Armbrustbau", "Gebäude: Schießplatz"], "armbrust"),
      locked("schwere_armbrust", "Schwerer Armbrustschütze", "Windenarmbrust, knackt Plattenrüstung.", ["Forschung: Doktrin Fernkampf", "Gebäude: Schießplatz"]),
    ],
  },
  {
    title: "Reiterei", building: "Reitstall", entries: [
      locked("leichter_reiter", "Leichte Reiterei", "Späher, jagt Schützen und Belagerungsgerät.", ["Forschung: Gestüt", "Gebäude: Reitstall"]),
      locked("ritter", "Ritter", "Lanzenangriff, Elite zu Pferd.", ["Forschung: Gestüt", "Gebäude: Reitstall"]),
    ],
  },
  {
    title: "Pulver und Söldner", building: "Büchsenmeisterei / Söldnerlager", entries: [
      locked("arkebusier", "Arkebusier", "Hohe Durchschlagskraft, lädt sehr langsam.", ["Forschung: Luntenschloss", "Gebäude: Büchsenmeisterei"]),
      locked("landsknecht", "Landsknecht", "Vielseitiger Elite-Söldner, hoher Sold.", ["Gebäude: Söldnerlager"], "landsknecht"),
      locked("doppelsoeldner", "Doppelsöldner", "Zweihänder, bricht Pikenblöcke.", ["Gebäude: Söldnerlager"]),
    ],
  },
];

/** Anfangsbuchstaben für das Wappenschild, solange eine Einheit noch keine Figur hat. */
export const initials = (name: string): string =>
  name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

export const ROLE_NAME: Record<string, string> = { arbeiter: "Arbeiter", nahkampf: "Nahkampf", fernkampf: "Fernkampf" };
export const DAMAGE_NAME: Record<string, string> = { stich: "Stich", hieb: "Hieb", pfeil: "Pfeil" };
