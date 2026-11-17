import { describe, expect, it } from "vitest";
import { BUILDINGS, type BuildingKey, type UnitKey } from "../../src/data";
import { createGame } from "../../src/sim";
import type { Simulation } from "../../src/sim/game";
import { TPS, type SUnit } from "../../src/sim/world";
import { lagerOf } from "./helpers";

/** Prüft Grundregeln des Zustands: keine negativen Bestände, nichts außerhalb der Karte, keine NaN. */
function checkInvariants(g: Simulation): void {
  const s = g.state;
  for (const b of s.buildings) {
    const per = BUILDINGS[b.key].storage?.perSlot ?? 0;
    for (const sl of b.slots) {
      expect(sl.amount).toBeGreaterThanOrEqual(0);
      expect(sl.reserved).toBeGreaterThanOrEqual(0);
      expect(sl.incoming).toBeGreaterThanOrEqual(0);
      expect(sl.amount + sl.incoming).toBeLessThanOrEqual(per);
      expect(sl.reserved).toBeLessThanOrEqual(sl.amount);
      if (!sl.good) expect(sl.amount + sl.reserved + sl.incoming).toBe(0);
    }
    if (b.output) {
      expect(b.output.amount).toBeGreaterThanOrEqual(0);
      expect(b.output.reserved).toBeGreaterThanOrEqual(0);
      expect(b.output.reserved).toBeLessThanOrEqual(b.output.amount);
      expect(b.output.amount).toBeLessThanOrEqual(BUILDINGS[b.key].output!.capacity);
    }
    for (const n of Object.values(b.needs)) expect(n).toBeGreaterThan(0);
  }
  const ids = new Set<number>();
  for (const u of s.units) {
    expect(ids.has(u.id)).toBe(false);
    ids.add(u.id);
    for (const v of [u.x, u.y, u.z, u.px, u.py, u.fx, u.fy, u.hp]) expect(Number.isFinite(v)).toBe(true);
    expect(u.x).toBeGreaterThanOrEqual(0); expect(u.x).toBeLessThanOrEqual(s.w);
    expect(u.y).toBeGreaterThanOrEqual(0); expect(u.y).toBeLessThanOrEqual(s.h);
  }
  for (const k of Object.values(s.stock)) expect(k).toBeGreaterThanOrEqual(0);
}

describe("Dauerlauf", () => {
  it.each([true, false])("20 Spielminuten mit Bauaufträgen und Rekruten (Überfälle: %s) ohne Fehler und mit gültigem Zustand", (raids) => {
    const g = createGame({ seed: 11, raids });
    const l = lagerOf(g);
    let r = 12345;
    const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const keys: BuildingKey[] = ["holzfaeller", "steinbruch", "haus", "kaserne", "lager", "turm", "treppe"];
    const units: UnitKey[] = ["speer", "schwert", "bogen"];
    let placed = 0;
    // Hänger: Tagelöhner mit Trage-, Bau- oder Rekrutenauftrag, der sich 60 s nicht vom Fleck rührt
    const still = new Map<number, { x: number; y: number; sec: number; job: string }>();
    const stuck: string[] = [];
    for (let sec = 0; sec < 20 * 60; sec++) {
      for (let t = 0; t < TPS; t++) g.tick();
      for (const u of g.state.units as SUnit[]) {
        const j = u.ai.job;
        if (u.dead || u.team !== 0 || !j || j.k === "cycle") { still.delete(u.id); continue; }
        const key = `${j.k}${"ph" in j ? j.ph : ""}`;
        const p = still.get(u.id);
        if (!p || p.job !== key || Math.hypot(p.x - u.x, p.y - u.y) > 0.3) { still.set(u.id, { x: u.x, y: u.y, sec, job: key }); continue; }
        if (sec - p.sec > 60 && u.anim !== "bauen") stuck.push(`${u.id} ${key} bei ${u.x.toFixed(1)},${u.y.toFixed(1)} seit ${sec - p.sec}s`);
      }
      if (sec % 10 === 0) {
        // zufälliger Bauauftrag in der Nähe des Lagers
        const key = keys[Math.floor(rnd() * keys.length)];
        let x = 0, y = 0;
        for (let k = 0; k < 40; k++) {
          x = l.x - 14 + Math.floor(rnd() * 28); y = l.y - 18 + Math.floor(rnd() * 26);
          if (g.dispatch({ t: "bauen", key, x, y, o: Math.floor(rnd() * 4) }).ok) { placed++; break; }
        }
        if (sec % 60 === 0) g.dispatch({ t: "mauer", x0: x, y0: y, x1: x + Math.floor(rnd() * 6), y1: y + Math.floor(rnd() * 6) });
        const k = g.state.buildings.find((b) => b.key === "kaserne" && b.built >= 1);
        if (k) g.dispatch({ t: "rekrutieren", building: k.id, unit: units[Math.floor(rnd() * 3)] });
        const soldiers = g.state.units.filter((u) => u.team === 0 && !u.dead && ["speer", "schwert", "bogen"].includes(u.key)).map((u) => u.id);
        if (soldiers.length && sec % 30 === 0) g.dispatch({ t: rnd() < 0.5 ? "stationieren" : "halten", units: soldiers } as never);
      }
      if (sec % 30 === 0) checkInvariants(g);
    }
    checkInvariants(g);
    expect(stuck.slice(0, 5)).toEqual([]);
    expect(placed).toBeGreaterThan(3);
    // Nach dem Fall des Bergfrieds kommen keine Wellen mehr; dieser Lauf baut keine Verteidigung auf
    if (raids) expect(g.state.raid.wave).toBeGreaterThanOrEqual(g.state.outcome === "niederlage" ? 1 : 4);
    else expect(g.state.buildings.filter((b) => b.built >= 1).length).toBeGreaterThan(5);
    console.log(`Dauerlauf (Überfälle ${raids}): ${placed} Bauaufträge, ${g.state.buildings.length} Gebäude, ${g.state.units.length} Einheiten, Welle ${g.state.raid.wave}, Bestand ${JSON.stringify(g.state.stock)}`);
  });
});
