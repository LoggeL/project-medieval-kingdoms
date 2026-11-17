import { describe, expect, it } from "vitest";
import type { UnitKey } from "../../src/data";
import { createGame } from "../../src/sim";
import { buildNow, run, spawn } from "../../src/sim/debug";
import { TPS } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

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
    const times: number[] = [];
    for (let i = 0; i < 30 * TPS; i++) {
      const t0 = performance.now();
      g.tick();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p99 = times[Math.floor(times.length * 0.99)], max = times[times.length - 1];
    const searches = (g as any).world.nav.searches;
    console.log(`Lasttest 300 Einheiten: ${avg.toFixed(3)} ms/Tick im Mittel, p99 ${p99.toFixed(2)} ms, max ${max.toFixed(2)} ms (Budget 50 ms), ${searches} A*-Suchen, ${s.units.filter((u) => u.dead).length} Tote`);
    expect(avg).toBeLessThan(8);
    expect(p99).toBeLessThan(25);
    run(g, 1);
  });

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
    console.log(`Marschtest 300 Soldaten: ${avg.toFixed(3)} ms/Tick im Mittel, p99 ${p99.toFixed(2)} ms, max ${times[times.length - 1].toFixed(2)} ms, Befehl bis ${cmdMax.toFixed(1)} ms`);
    expect(avg).toBeLessThan(8);
  });
});
