/**
 * Ernährung der Siedlung (BRIEF §5.1, §8.2; ADR 0013): Rationen, essbare Waren, Hunger.
 *
 * Alle Bewohner (Tagelöhner, Arbeiter, Soldaten) essen aus der Kornkammer: je Bewohner `perMinute` Portionen in der
 * Minute nach der gewählten Ration. Gegessen wird Stück für Stück aus den Fächern (der Vorrat schrumpft sichtbar), zuerst
 * die Ware, von der am meisten da ist. Liegt nichts Essbares mehr in der Kornkammer, hungert die Siedlung: Es zieht
 * niemand mehr zu, und nach `graceSeconds` verlässt alle `leaveSeconds` ein untätiger Tagelöhner die Siedlung.
 */
import type { Good } from "./goods";

export type RationKey = "knapp" | "normal" | "reichlich";

export interface RationDef {
  name: string;
  /** Portionen je Bewohner und Minute. */
  perMinute: number;
  /** Faktor auf den Abstand des Zuzugs (TUNING.immigrantSeconds): kleiner = schneller. */
  immigration: number;
  desc: string;
}

export const RATIONS: Record<RationKey, RationDef> = {
  knapp: { name: "Knapp", perMinute: 0.2, immigration: 1.6, desc: "Halbe Portionen: Der Vorrat reicht doppelt so lange, aber es ziehen kaum Leute zu." },
  normal: { name: "Normal", perMinute: 0.4, immigration: 1, desc: "Satt, aber nicht üppig." },
  reichlich: { name: "Reichlich", perMinute: 0.6, immigration: 0.7, desc: "Volle Teller locken neue Leute schneller an." },
};

export const RATION_KEYS = Object.keys(RATIONS) as RationKey[];

export const FOOD = {
  /** Essbare Waren und ihr Nährwert in Portionen je Stück (Getreide und Mehl muss man erst verarbeiten). */
  goods: { brot: 1, apfel: 1 } as Partial<Record<Good, number>>,
  /** Ration zu Spielbeginn. */
  start: "normal" as RationKey,
  /** So lange (Sekunden) hält die Siedlung ohne Essen aus, bevor die ersten gehen. */
  graceSeconds: 30,
  /** Danach geht alle so viele Sekunden ein untätiger Tagelöhner. */
  leaveSeconds: 30,
  /** Vielfalt: Faktor auf den Zuzugsabstand je weiterer vorrätiger Nahrungsart (zwei Arten = 0,85-mal so lange). */
  variety: 0.85,
};

/** Ist die Ware essbar? */
export const isFood = (g: Good): boolean => (FOOD.goods[g] ?? 0) > 0;
