/**
 * Balance-Lauf (Befund der Gesamtprüfung): eine geskriptete Standardstrategie auf „Normal“, ohne Debug-Hilfen, nur mit
 * Befehlen wie im Spiel. Holzfäller, Steinbruch, Obstgarten, Getreidehof, Wohnhäuser, Kaserne, Bognerei; Soldaten aus
 * dem Startbestand und der Bognerei, eine Mauer mit Tor und Treppe an der Furt, vor jeder Welle stationieren. Die
 * Siedlung muss Welle 3 abwehren, ohne dass der Bergfried fällt, die Bevölkerung einbricht oder Baustellen verklemmen.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, type BuildingKey, type UnitKey } from "../../src/data";
import { createGame } from "../../src/sim";
import type { Simulation } from "../../src/sim/game";
import { TPS, type SUnit } from "../../src/sim/world";
import { lagerOf } from "./helpers";

const SOLDIERS = new Set<string>(["speer", "schwert", "bogen", "waffenknecht", "milizsoldat"]);

/** Nächster Platz um (cx, cy), an dem der Bauauftrag angenommen wird. */
function place(g: Simulation, key: BuildingKey, cx: number, cy: number, o = 0, maxR = 14): number {
  for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const res = g.dispatch({ t: "bauen", key, x: cx + dx, y: cy + dy, o });
    if (res.ok) return res.ids![0];
  }
  return 0;
}

export function standardStrategy(seed: number, log = false) {
  const g = createGame({ seed });
  const s = g.state;
  const l = lagerOf(g);
  const ids: Partial<Record<string, number>> = {};
  const built = (k: string) => { const b = ids[k] ? s.buildings.find((x) => x.id === ids[k]) : undefined; return !!b && b.built >= 1; };
  const soldiers = () => s.units.filter((u) => u.team === 0 && !u.dead && SOLDIERS.has(u.key));
  let minPeasants = Infinity, bowRecipe = false;
  const trace: string[] = [];
  for (let sec = 0; sec < 1500; sec++) {
    for (let t = 0; t < TPS; t++) g.tick();
    if (s.outcome) break;
    const st = s.stock;
    // Bauordnung: ab der genannten Sekunde, bis der Auftrag angenommen ist (fehlt Material, später erneut)
    const order: [number, string, BuildingKey | "furt", number, number][] = [
      [2, "hf", "holzfaeller", 17, 37], [2, "sb", "steinbruch", 35, 16], [10, "hf2", "holzfaeller", 20, 34],
      [20, "kas", "kaserne", 36, 41], [30, "haus", "haus", 28, 39], [40, "furt", "furt", 0, 0],
      [60, "og", "obstgarten", l.x - 6, l.y + 5], [90, "hof", "bauernhof", l.x - 10, l.y + 6],
      [120, "haus2", "haus", l.x - 2, l.y + 6], [140, "muehle", "muehle", l.x - 6, l.y - 6],
      [160, "baeckerei", "baeckerei", l.x - 2, l.y - 7], [200, "bog", "bognerei", l.x + 4, l.y + 6],
      [220, "og2", "obstgarten", l.x - 12, l.y + 1], [260, "haus3", "haus", l.x + 1, l.y + 9],
    ];
    for (const [at, id, key, x, y] of order) {
      if (sec < at || ids[id] !== undefined) continue;
      if (key === "furt") {
        // Befestigung an der Furt (wie in defense.test.ts): Stück für Stück, jedes, sobald das Material dafür reicht
        const at = (x: number, y: number) => s.buildings.some((b) => b.x === x && b.y === y);
        const parts: [() => boolean, number, number][] = [
          [() => g.dispatch({ t: "mauer", x0: 48, y0: 32, x1: 48, y1: 33 }).ok, 48, 32],
          [() => g.dispatch({ t: "mauer", x0: 48, y0: 35, x1: 48, y1: 35 }).ok, 48, 35],
          [() => g.dispatch({ t: "bauen", key: "tor", x: 48, y: 34, o: 1 }).ok, 48, 34],
          [() => g.dispatch({ t: "bauen", key: "treppe", x: 46, y: 33, o: 3 }).ok, 46, 33],
        ];
        let all = true;
        for (const [go, px, py] of parts) if (!at(px, py) && !go()) { all = false; break; }
        if (all) ids[id] = -1;
        break;
      }
      const got = place(g, key, x, y);
      if (got) ids[id] = got;
      break; // einer nach dem anderen, in dieser Reihenfolge
    }
    if (!bowRecipe && built("bog")) bowRecipe = g.dispatch({ t: "rezept", building: ids.bog!, recipe: "bogen_bauen" }).ok;
    // Rekruten: was im Lager liegt, solange Gold da ist (eine kurze Schlange)
    if (built("kas") && sec % 5 === 0) {
      const k = s.buildings.find((b) => b.id === ids.kas)!;
      const want: UnitKey[] = ["bogen", "speer", "schwert"];
      // nicht alle Leute zu Soldaten: drei vor der ersten Welle, danach je abgewehrter Welle zwei mehr
      const cap = 3 + 2 * s.match.stats.waves;
      for (const u of want) if (soldiers().length + k.queue.length < cap && k.queue.length < 2 && ((st as Record<string, number>)[u] ?? 0) > k.queue.filter((q) => q === u).length) g.dispatch({ t: "rekrutieren", building: k.id, unit: u });
    }
    // ab kurz vor jeder Welle und während der Welle alle 10 s: wer noch keinen Posten hat, wird stationiert (Taste T);
    // wer keinen freien Posten bekommt, greift den Angreifer an, der dem Bergfried am nächsten ist (Rechtsklick)
    const toRaid = s.raid.next / TPS - sec;
    if (((toRaid > 0 && toRaid <= 25) || s.raid.active) && sec % 10 === 0) {
      const loose = soldiers().filter((u) => u.order.t !== "station").map((u) => u.id);
      if (loose.length) g.dispatch({ t: "stationieren", units: loose });
      const free = soldiers().filter((u) => u.order.t !== "station");
      const foes = s.units.filter((u) => u.team === 1 && !u.dead);
      if (s.raid.active && free.length && foes.length) {
        const k = s.buildings.find((b) => BUILDINGS[b.key].seat)!;
        const near = foes.reduce((a, b) => (Math.hypot(a.x - k.x, a.y - k.y) <= Math.hypot(b.x - k.x, b.y - k.y) ? a : b));
        g.dispatch({ t: "angreifen", units: free.map((u) => u.id), target: near.id });
      }
    }
    const peasants = s.units.filter((u) => u.team === 0 && !u.dead && u.key === "tageloehner").length;
    if (sec > 120) minPeasants = Math.min(minPeasants, peasants);
    if (sec % 60 === 0 || (log && s.raid.active && sec % 20 === 0)) {
      const fortDone = s.buildings.filter((b) => (b.key === "mauer" || b.key === "tor" || b.key === "treppe") && b.built >= 1).length;
      if (log && s.raid.active) console.log("  Angreifer", (s.units as SUnit[]).filter((u) => u.team === 1 && !u.dead).map((u) => `${u.key}${u.gear ? "+" + u.gear : ""}@${u.x.toFixed(1)},${u.y.toFixed(1)},L${u.layer} ${u.anim} hp${u.hp.toFixed(0)} tB${u.ai.targetB} t${u.ai.target} ram${u.ai.ram ?? ""} ret${u.ai.retreat ?? ""} skip${u.ai.skipB ?? ""}`).join(" | "));
      if (log && s.raid.active) console.log("  Soldaten", soldiers().map((u) => `${u.key}@${u.x.toFixed(0)},${u.y.toFixed(0)},L${u.layer} ${u.order.t} hp${u.hp.toFixed(0)}`).join(" | "));
      const line = `${sec}s Befestigung ${fortDone}/5 Welle ${s.raid.wave} (abgewehrt ${s.match.stats.waves}${s.raid.active ? ", läuft" : ""}) Leute ${s.population}/${s.housing} Tagelöhner ${peasants} Soldaten ${soldiers().length} Holz ${st.holz} Stein ${st.stein} Brot ${st.brot} Äpfel ${st.apfel} Getreide ${st.getreide} Gold ${s.gold} Hunger ${s.food?.hunger.toFixed(0)} Bergfried ${s.buildings.find((b) => BUILDINGS[b.key].seat)?.hp}`;
      trace.push(line);
      if (log) console.log(line, JSON.stringify(Object.fromEntries(Object.entries(ids).map(([k, id]) => { const b = s.buildings.find((x) => x.id === id); return [k, b ? +b.built.toFixed(2) : id ? "weg" : 0]; }))));
    }
    if (s.match.stats.waves >= 3 && !s.raid.active) break;
  }
  return { g, minPeasants, trace };
}

describe("Balance auf Normal", () => {
  it("Standardstrategie (Seed 1) wehrt drei Wellen ab, ohne dass die Siedlung verhungert oder verklemmt", () => {
    const { g, minPeasants, trace } = standardStrategy(1);
    const s = g.state;
    expect(s.outcome, trace.join("\n")).not.toBe("niederlage");
    expect(s.match.stats.waves, trace.join("\n")).toBeGreaterThanOrEqual(3);
    expect(minPeasants).toBeGreaterThanOrEqual(2);
    expect(s.population, trace.join("\n")).toBeGreaterThanOrEqual(BUILDINGS.bergfried.housing!); // nicht verhungert oder ausgeblutet
    const keep = s.buildings.find((b) => BUILDINGS[b.key].seat)!;
    expect(keep.hp).toBeGreaterThan(BUILDINGS.bergfried.hp / 2);
  }, 240_000);
});
