/**
 * Einheitenraster für die Oberfläche (BRIEF §8.3, Konzept 08 „Einheitenraster“).
 * Liest nur Daten (ADR 0014): alle Soldaten aus UNITS (ohne reine Angreifer, UnitDef.foeOnly), gruppiert nach UnitDef.group (UNIT_GROUPS, src/data/militaer.ts).
 * Spielbar ist eine Einheit, die ein Gebäude in BuildingDef.trains führt und nichts Geplantes braucht; ihre
 * Forschungssperre (UnitDef.tech) zeigt das Raster live. Die übrigen stehen ausgegraut mit ihren Voraussetzungen
 * (Forschung aus UnitDef.tech, dazu UnitDef.planned für Gebäude, Waren und Forschung, die es noch nicht gibt).
 */
import { BUILDINGS, TECHS, UNITS, UNIT_GROUPS, type UnitKey } from "../data";

export interface RosterEntry {
  key: UnitKey;
  name: string;
  /** Spielbare Einheit (ein Gebäude bildet sie aus); fehlt bei gesperrten Konzepteinheiten. */
  unit?: UnitKey;
  /** Daten der Einheit (Werte, Kosten), auch für gesperrte. */
  data: UnitKey;
  /** Figur im Figurenblatt, falls es schon eine gibt. */
  sprite?: string;
  /** Rolle in einem Satz. */
  role?: string;
  /** Fehlende Voraussetzungen (gesperrte Einheiten): Forschung, Gebäude, Waren. */
  needs?: string[];
}

export interface RosterGroup { title: string; building: string; entries: RosterEntry[] }

/** Einheiten, die ein Gebäude ausbildet (Datenreihenfolge der Gebäude und ihrer trains). */
const TRAINED = new Set(Object.values(BUILDINGS).flatMap((b) => b.trains ?? []));

/** Spielbar: ein Gebäude bildet sie aus und sie braucht nichts, was es noch nicht gibt. */
export const isPlayable = (k: UnitKey): boolean => TRAINED.has(k) && !UNITS[k].planned?.length;

function entry(k: UnitKey): RosterEntry {
  const def = UNITS[k];
  const playable = isPlayable(k);
  const needs = playable ? undefined : [...(def.tech ? [`Forschung: ${TECHS[def.tech].name}`] : []), ...(def.planned ?? [])];
  return { key: k, name: def.name, data: k, ...(playable ? { unit: k } : {}), ...(def.sprite ? { sprite: def.sprite } : {}), ...(def.desc ? { role: def.desc } : {}), ...(needs ? { needs } : {}) };
}

/** Soldaten in Datenreihenfolge, je Gruppe die spielbaren zuerst. */
export const ROSTER: RosterGroup[] = UNIT_GROUPS.map((g) => {
  const keys = (Object.keys(UNITS) as UnitKey[]).filter((k) => UNITS[k].role !== "arbeiter" && !UNITS[k].foeOnly
    && (UNITS[k].group ?? (UNITS[k].role === "fernkampf" ? "schuetzen" : "fussvolk")) === g.key);
  const sorted = [...keys.filter(isPlayable), ...keys.filter((k) => !isPlayable(k))];
  return { title: g.title, building: g.building, entries: sorted.map(entry) };
}).filter((g) => g.entries.length > 0);

/** Anfangsbuchstaben für das Wappenschild, solange eine Einheit noch keine Figur hat. */
export const initials = (name: string): string =>
  name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

export const ROLE_NAME: Record<string, string> = { arbeiter: "Arbeiter", nahkampf: "Nahkampf", fernkampf: "Fernkampf", belagerung: "Belagerungsgerät" };
export const DAMAGE_NAME: Record<string, string> = { stich: "Stich", hieb: "Hieb", pfeil: "Pfeil", wucht: "Wucht", bolzen: "Bolzen", kugel: "Kugel" };
