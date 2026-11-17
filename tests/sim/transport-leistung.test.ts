import { describe, expect, it } from "vitest";
import type { UnitKey } from "../../src/data";
import { createGame, type Simulation } from "../../src/sim/game";
import { buildNow, run, spawn, stockUp } from "../../src/sim/debug";
import { placeSite } from "../../src/sim/build";
import { TPS } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

// Lasttest der Wegfindung auf einer großen Karte (ADR 0015): lange Trägerwege zwischen weit verteilten Gebäuden, viele
// Baustellen (jede ändert das Laufraster), Soldaten mit Marschbefehlen. Zeitgrenzen wie in perf.test.ts abschaltbar.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const ZEITGRENZEN = env.MK_ZEITGRENZEN !== "aus";
const TIMEOUT = ZEITGRENZEN ? 60_000 : 300_000;

/** Großkarte 128 × 128 mit verteilter Wirtschaft, 250 Tagelöhnern und 80 Soldaten. */
export function grossKarte(): Simulation {
  const g = createGame({ seed: 3, size: 128, raids: false });
  const l = lagerOf(g);
  buildNow(g, "lager", ...findSpot(g, "lager", 34, 40), 0);
  buildNow(g, "lager", ...findSpot(g, "lager", 80, 92), 0);
  for (const [x, y] of [[30, 30], [30, 60], [30, 95]]) buildNow(g, "holzfaeller", ...findSpot(g, "holzfaeller", x, y), 0);
  for (const [x, y] of [[62, 24], [82, 24]]) buildNow(g, "steinbruch", ...findSpot(g, "steinbruch", x, y), 0);
  stockUp(g, "holz", 300);
  stockUp(g, "stein", 300);
  for (let i = 0; i < 242; i++) spawn(g, "tageloehner", 0, l.x - 10 + (i % 24), l.y + 6 + Math.floor(i / 24));
  const keys: UnitKey[] = ["speer", "schwert", "bogen"];
  for (let i = 0; i < 80; i++) spawn(g, keys[i % 3], 0, l.x - 6 + (i % 16), l.y - 8 - Math.floor(i / 16));
  return g;
}

/** Ablauf: alle 4 s eine neue Baustelle weit weg vom Lager (Laufraster ändert sich), Soldaten marschieren hin und her. */
export function lastLauf(g: Simulation, seconds: number, each?: () => void): void {
  const soldiers = g.state.units.filter((u) => u.key === "speer" || u.key === "schwert" || u.key === "bogen").map((u) => u.id);
  const sites: [number, number][] = [[20, 80], [45, 100], [70, 105], [90, 70], [85, 45], [50, 30], [40, 50], [65, 85], [25, 110], [95, 100], [60, 45], [75, 60], [45, 75], [35, 20], [90, 30]];
  const marsch: [number, number][] = [[90, 66], [40, 90], [60, 30], [30, 70]];
  let k = 0;
  for (let t = 0; t < seconds * TPS; t++) {
    if (t % (4 * TPS) === 0) {
      const [x, y] = sites[k % sites.length];
      try { const [sx, sy] = findSpot(g, k % 3 ? "haus" : "kaserne", x, y, k % 4, 12); g.dispatch({ t: "bauen", key: k % 3 ? "haus" : "kaserne", x: sx, y: sy, o: k % 4 }); } catch { /* kein Platz */ }
      k++;
    }
    if (t % (10 * TPS) === 0) { const [x, y] = marsch[(t / (10 * TPS)) % marsch.length]; g.dispatch({ t: "bewegen", units: soldiers, x, y }); }
    g.tick();
    each?.();
  }
}

describe("Leistung der Wegfindung (Großkarte)", () => {
  it("330 Figuren auf 128 × 128 mit langen Trägerwegen und häufigen Rasteränderungen", () => {
    const g = grossKarte();
    const w = g.world;
    run(g, TPS);
    const s0 = w.nav.searches, e0 = w.nav.expanded, h0 = w.nav.hits;
    const times: number[] = [];
    let last = performance.now();
    lastLauf(g, 60, () => { const now = performance.now(); times.push(now - last); last = now; });
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length, p99 = times[Math.floor(times.length * 0.99)];
    const busy = w.s.units.filter((u) => u.ai.job).length;
    const st = w.nav.stats;
    console.log(`Großkarte: ${avg.toFixed(3)} ms/Tick im Mittel, p99 ${p99.toFixed(2)} ms; ${w.nav.searches - s0} Suchen (${w.nav.expanded - e0} Knoten), ${w.nav.hits - h0} Treffer im Pfad-Cache; ${st.refreshes} Rasteränderungen mit ${st.tiles} Kacheln, ${st.kept}× Weg behalten, ${st.dropped}× verworfen; ${busy} Figuren mit Auftrag`);
    expect(busy).toBeGreaterThan(50);
    expect(w.nav.stats.rebuilds).toBe(1); // nur beim Start ganz aufgebaut, danach nur Teilstücke
    unter(avg, 4);
  }, TIMEOUT);

  for (const size of [128, 256]) it(`Rasteränderung auf ${size} × ${size}: nur die betroffenen Kacheln statt Neuaufbau`, () => {
    const g = createGame({ seed: 2, size, raids: false });
    const w = g.world;
    for (let k = 0; k < 4; k++) buildNow(g, "lager", ...findSpot(g, "lager", size / 2 + k * 5, size / 2 + 8, 0, 30), 0);
    stockUp(g, "holz", 300); stockUp(g, "stein", 400);
    const keys = ["haus", "kiesweg", "turm", "pflaster"] as const;
    const part: number[] = [], full: number[] = [];
    let n = 0;
    for (let y = 8; y < size - 8 && n < 40; y += 3) for (let x = 8; x < size - 8 && n < 40; x += 13) {
      const key = keys[n % 4];
      if (!g.canPlace(key, x, y, 0).ok) continue;
      placeSite(w, key, x, y, 0, true);
      let t = performance.now();
      w.nav.refresh(); void w.nav.comp; // Komponenten werden beim Lesen nachgezogen
      part.push(performance.now() - t);
      t = performance.now();
      w.nav.rebuild(false); void w.nav.comp;
      full.push(performance.now() - t);
      n++;
    }
    const mean = (a: number[]) => a.slice(5).reduce((p, q) => p + q, 0) / Math.max(1, a.length - 5);
    console.log(`Raster ${size} × ${size}: Änderung ${mean(part).toFixed(3)} ms (Teilstück + Komponenten), Neuaufbau ${mean(full).toFixed(3)} ms, ${n} Bauten, Komponenten ${w.nav.stats.patched}× örtlich nachgeführt`);
    expect(n).toBeGreaterThan(20);
    if (ZEITGRENZEN) expect(mean(part)).toBeLessThan(mean(full) / 5);
  }, TIMEOUT);
});

function unter(ms: number, grenze: number): void {
  if (ZEITGRENZEN) expect(ms).toBeLessThan(grenze);
}
