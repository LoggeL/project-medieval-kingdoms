import { describe, expect, it } from "vitest";
import type { UnitKey } from "../../src/data";
import { createGame } from "../../src/sim";
import { buildNow, run, spawn } from "../../src/sim/debug";
import { TPS } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

// Zeitgrenzen hängen von der Maschine ab. Mit MK_ZEITGRENZEN=aus (gesetzt im Dockerfile, weil der Build-Server
// langsam oder ausgelastet sein kann) laufen beide Lasttests vollständig mit allen Funktionsprüfungen, nur die
// Millisekunden-Schwellen werden nicht geprüft, sondern nur ausgegeben.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const ZEITGRENZEN = env.MK_ZEITGRENZEN !== "aus";
// Auch die Vitest-Zeitgrenze je Test (Standard 5 s) großzügiger, damit ein langsamer Server nicht daran scheitert
const TIMEOUT = ZEITGRENZEN ? undefined : 120_000;
function unter(ms: number, grenze: number): void {
  if (ZEITGRENZEN) expect(ms).toBeLessThan(grenze);
}

describe("Leistung", () => {
  it("300 Einheiten bei 20 Ticks pro Sekunde", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    // Wirtschaft läuft mit: Holzfäller, Steinbruch, Kaserne
    buildNow(g, "holzfaeller", ...findSpot(g, "holzfaeller", 17, 30), 0);
    buildNow(g, "steinbruch", ...findSpot(g, "steinbruch", 36, 17), 0);
    buildNow(g, "kaserne", ...findSpot(g, "kaserne", l.x + 6, l.y - 5), 0);
    const keys: UnitKey[] = ["speer", "schwert", "bogen"];
    const s = g.state;
    // 100 Tagelöhner, 100 eigene Soldaten, 100 Angreifer (auf beiden Seiten des Flusses)
    for (let i = 0; i < 92; i++) spawn(g, "tageloehner", 0, 20 + (i % 20), 36 + Math.floor(i / 20));
    const own: number[] = [];
    for (let i = 0; i < 100; i++) own.push(spawn(g, keys[i % 3], 0, 22 + (i % 20), 40 + Math.floor(i / 20)).id);
    for (let i = 0; i < 100; i++) spawn(g, keys[i % 3], 1, 55 + (i % 8), 20 + Math.floor(i / 8) * 2);
    expect(s.units.filter((u) => !u.dead)).toHaveLength(300);
    g.dispatch({ t: "bewegen", units: own, x: 45, y: 34 });
    run(g, 2 * TPS); // aufwärmen
    // Drei Durchgänge zu je 20 s Spielzeit; geprüft wird der Median der Durchgänge, damit eine kurze Störung der
    // Maschine (andere Prozesse, Speicherbereinigung) nicht allein über das Ergebnis entscheidet. Die Grenzen bleiben.
    const rounds: { avg: number; p99: number; max: number }[] = [];
    for (let k = 0; k < 3; k++) {
      const times: number[] = [];
      for (let i = 0; i < 20 * TPS; i++) {
        const t0 = performance.now();
        g.tick();
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      rounds.push({ avg: times.reduce((a, b) => a + b, 0) / times.length, p99: times[Math.floor(times.length * 0.99)], max: times[times.length - 1] });
    }
    const med = (f: (r: (typeof rounds)[number]) => number) => rounds.map(f).sort((a, b) => a - b)[1];
    const avg = med((r) => r.avg), p99 = med((r) => r.p99), max = Math.max(...rounds.map((r) => r.max));
    const searches = (g as any).world.nav.searches;
    console.log(`Lasttest 300 Einheiten (Median aus 3 Durchgängen): ${avg.toFixed(3)} ms/Tick im Mittel, p99 ${p99.toFixed(2)} ms, max ${max.toFixed(2)} ms (Budget 50 ms${ZEITGRENZEN ? "" : ", Zeitgrenzen aus"}), ${searches} A*-Suchen, ${s.units.filter((u) => u.dead).length} Tote`);
    unter(avg, 8);
    unter(p99, 25);
    run(g, 1);
  }, TIMEOUT ?? 60_000);

  it("300 Soldaten mit wiederholten Marschbefehlen quer über die Karte", () => {
    const g = createGame({ seed: 1, raids: false });
    const keys: UnitKey[] = ["speer", "schwert", "bogen"];
    const own: number[] = [];
    for (let i = 0; i < 300; i++) own.push(spawn(g, keys[i % 3], 0, 18 + (i % 25), 36 + Math.floor(i / 25)).id);
    const targets = [[45, 34], [20, 20], [40, 50], [16, 40]];
    const times: number[] = [];
    let cmdMax = 0;
    for (let k = 0; k < 8; k++) {
      const [x, y] = targets[k % 4];
      const t0 = performance.now();
      expect(g.dispatch({ t: "bewegen", units: own, x, y }).ids).toHaveLength(300);
      cmdMax = Math.max(cmdMax, performance.now() - t0);
      for (let i = 0; i < 5 * TPS; i++) { const a = performance.now(); g.tick(); times.push(performance.now() - a); }
    }
    expect(g.state.units.filter((u) => u.anim === "gehen").length).toBeGreaterThan(250);
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length, p99 = times[Math.floor(times.length * 0.99)];
    console.log(`Marschtest 300 Soldaten: ${avg.toFixed(3)} ms/Tick im Mittel, p99 ${p99.toFixed(2)} ms, max ${times[times.length - 1].toFixed(2)} ms, Befehl bis ${cmdMax.toFixed(1)} ms${ZEITGRENZEN ? "" : " (Zeitgrenzen aus)"}`);
    unter(avg, 8);
  }, TIMEOUT);
});
