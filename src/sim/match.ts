/**
 * Partie (ADR 0019): Szenario und Schwierigkeitsgrad aus den Daten (src/data/spielziel.ts), Sieg, Statistik.
 *
 * - Sieg: Alle Teilziele des Szenarios sind erfüllt und kein Angreifer steht mehr auf der Karte. Dann ist
 *   `outcome` = "sieg", es kommen keine Wellen mehr (raid.ts), der Zuzug läuft weiter, man kann weiterbauen.
 * - Niederlage: Der Bergfried fällt (build.ts). Beide Ausgänge setzen `match.endTick`.
 * - Statistik (`match.stats`): Die Simulation zählt an den Stellen mit, an denen etwas geschieht (Tod in combat.kill,
 *   Einlagern eines Erzeugnisses in jobs.runHaul, Fertigstellung, Ausbildung, Zerstörung, abgewehrte Welle).
 *
 * goalProgress und scenarioGoals sind reine Funktionen auf dem öffentlichen Zustand, die Oberfläche nutzt sie auch.
 */
import {
  BUILDINGS, DEFAULT_DIFFICULTY, DIFFICULTIES, SCENARIOS, START, UNITS,
  type DifficultyKey, type Good, type ScenarioKey, type VictoryGoal,
} from "../data";
import type { MatchState, MatchStats, SimState } from "./types";
import type { SBuilding, SUnit, World } from "./world";

export function newStats(): MatchStats {
  return { waves: 0, kills: 0, lostSoldiers: 0, lostWorkers: 0, lostBuildings: 0, built: 0, trained: 0, produced: {} };
}

export function newMatch(scenario: ScenarioKey | null, difficulty: DifficultyKey = DEFAULT_DIFFICULTY): MatchState {
  return { scenario, difficulty, tutorial: null, endTick: null, stats: newStats() };
}

/** Überfall-Werte der Partie: START.raid mit den Abweichungen des Schwierigkeitsgrads. */
export function raidParams(s: SimState): typeof START.raid {
  const d = DIFFICULTIES[s.match.difficulty] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
  return { ...START.raid, ...d.raid };
}

/** Startgold der Partie. */
export function startGold(difficulty: DifficultyKey): number {
  return DIFFICULTIES[difficulty].gold ?? START.gold;
}

/** Angreifer frisch aus der Welle: Lebenspunkte nach Schwierigkeitsgrad. */
export function toughen(s: SimState, u: SUnit): void {
  const f = DIFFICULTIES[s.match.difficulty]?.raiderHp ?? 1;
  if (f === 1) return;
  u.maxHp = u.hp = Math.max(1, Math.round(UNITS[u.key].hp * f));
}

// ---------------------------------------------------------------- Statistik
export function noteDeath(w: World, u: SUnit): void {
  const st = w.s.match.stats;
  if (u.team === 1) st.kills++;
  else if (UNITS[u.key].role !== "arbeiter") st.lostSoldiers++;
  else st.lostWorkers++;
}

export function noteProduced(w: World, good: Good, n = 1): void {
  const p = w.s.match.stats.produced;
  p[good] = (p[good] ?? 0) + n;
}

export function noteBuilt(w: World, b: SBuilding): void {
  if (b.team === 0) w.s.match.stats.built++;
}

export function noteTrained(w: World): void { w.s.match.stats.trained++; }

export function noteDestroyed(w: World, b: SBuilding): void {
  if (b.team === 0) w.s.match.stats.lostBuildings++;
}

/** Alle Angreifer sind fort: Jede bis jetzt gekommene Welle gilt als abgewehrt (auch wenn sich zwei überlappt haben). */
export function noteWaveRepelled(w: World): void {
  const st = w.s.match.stats;
  st.waves = Math.max(st.waves, w.s.raid.wave);
}

// ---------------------------------------------------------------- Ziele
export interface GoalProgress {
  /** Erreicht und benötigt (Zähler für die Anzeige). */
  have: number;
  need: number;
  done: boolean;
  /** Spielertext, z. B. „Überfälle abgewehrt“. */
  label: string;
}

/** Fortschritt eines Teilziels auf dem öffentlichen Zustand. */
export function goalProgress(s: SimState, g: VictoryGoal): GoalProgress {
  if ("wellen" in g) {
    const have = Math.min(g.wellen, s.match.stats.waves);
    return { have, need: g.wellen, done: have >= g.wellen, label: "Überfälle abgewehrt" };
  }
  const seat = s.buildings.find((b) => b.team === 0 && BUILDINGS[b.key].seat);
  const have = Math.min(g.stufe, seat?.level ?? (seat ? 1 : 0));
  return { have, need: g.stufe, done: have >= g.stufe, label: "Ausbaustufe des Bergfrieds" };
}

/** Teilziele des Szenarios der Partie mit Fortschritt (leer im freien Spiel). */
export function scenarioGoals(s: SimState): GoalProgress[] {
  const sc = s.match.scenario ? SCENARIOS[s.match.scenario] : null;
  return sc ? sc.sieg.map((g) => goalProgress(s, g)) : [];
}

/** Sieg prüfen (jeden Tick nach den Überfällen). */
export function updateMatch(w: World): void {
  const s = w.s;
  if (s.outcome || !s.match.scenario) return;
  const goals = scenarioGoals(s);
  if (!goals.length || !goals.every((g) => g.done)) return;
  if (s.units.some((u) => u.team === 1 && !u.dead)) return;
  s.outcome = "sieg";
  s.match.endTick = s.tick;
  w.msg("Das Tal ist sicher! Die Angreifer kommen nicht wieder.", "info");
}

/** Niederlage festhalten (build.ts, Bergfried gefallen). */
export function noteDefeat(w: World): void {
  w.s.outcome = "niederlage";
  w.s.match.endTick = w.s.tick;
}
