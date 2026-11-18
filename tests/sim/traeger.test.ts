/**
 * Träger-Reserve und Notzuzug (ADR 0020): Wer alle Tagelöhner zu Soldaten macht, legt Bau und Transport nicht für immer
 * still. Die Kaserne lässt die letzten Träger in Ruhe, Hunger vertreibt sie nicht, und fehlen sie doch (gefallen,
 * Werkstätten), zieht trotz vollem Wohnraum jemand zu.
 */
import { describe, expect, it } from "vitest";
import { CARRIERS } from "../../src/data";
import { createGame } from "../../src/sim";
import { buildNow, run, spawn, stockUp } from "../../src/sim/debug";
import { carrierCount } from "../../src/sim/economy";
import { kill } from "../../src/sim/combat";
import { TPS } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

const peasants = (g: ReturnType<typeof createGame>) => g.state.units.filter((u) => u.team === 0 && !u.dead && u.key === "tageloehner").length;

describe("Träger-Reserve", () => {
  it("die Kaserne bildet die letzten Träger nicht aus; danach wird ein Wohnhaus fertig", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const [x, y] = findSpot(g, "kaserne", l.x + 3, l.y - 8, 0, 20);
    const k = buildNow(g, "kaserne", x, y, 0);
    g.state.gold = 2000;
    stockUp(g, "speer", 20);
    let minCarriers = Infinity;
    // die Warteschlange immer wieder auffüllen: mehr Rekruten, als es Leute gibt
    for (let t = 0; t < 300; t++) {
      while (k.queue.length < 3) if (!g.dispatch({ t: "rekrutieren", building: k.id, unit: "speer" }).ok) break;
      run(g, TPS);
      minCarriers = Math.min(minCarriers, carrierCount(g.world));
    }
    expect(minCarriers).toBeGreaterThanOrEqual(CARRIERS.reserve);
    expect(g.state.messages.some((m) => m.text.startsWith("Ausbildung wartet"))).toBe(true);
    // Wohnhaus: wird trotz voller Kaserne gebaut
    const [hx, hy] = findSpot(g, "haus", l.x - 4, l.y + 6, 0, 20);
    const r = g.dispatch({ t: "bauen", key: "haus", x: hx, y: hy, o: 0 });
    expect(r.ok).toBe(true);
    const h = g.world.buildings.get(r.ids![0])!;
    run(g, 240 * TPS, () => h.built >= 1);
    expect(h.built).toBe(1);
  });

  it("Hunger vertreibt die letzten Träger nicht", () => {
    const g = createGame({ seed: 1, raids: false });
    for (const b of g.state.buildings) for (const s of b.slots) if (s.good === "brot") { s.amount = 0; s.good = null; }
    g.world.meta.immigration = false;
    run(g, 600 * TPS);
    expect(g.state.food!.hunger).toBeGreaterThan(0);
    expect(peasants(g)).toBe(CARRIERS.reserve);
  });

  it("Notzuzug: Sind alle Träger gefallen, zieht trotz vollem Wohnraum jemand zu", () => {
    const g = createGame({ seed: 1, raids: false });
    run(g, 2);
    // Wohnraum künstlich voll: alle Tagelöhner fallen, Soldaten belegen den Platz
    for (const u of [...g.state.units]) if (u.team === 0 && u.key === "tageloehner") kill(g.world, g.world.units.get(u.id)!);
    const l = lagerOf(g);
    for (let i = 0; i < g.state.housing; i++) spawn(g, "speer", 0, l.x + 2 + (i % 5), l.y + 4 + Math.floor(i / 5));
    run(g, 2);
    expect(g.state.population).toBeGreaterThanOrEqual(g.state.housing);
    expect(carrierCount(g.world)).toBe(0);
    run(g, 90 * TPS);
    expect(carrierCount(g.world)).toBe(CARRIERS.reserve);
    expect(g.state.messages.some((m) => m.text.startsWith("Kein Tagelöhner als Träger frei"))).toBe(false); // keine Baustelle offen
  });
});

describe("Meldungen bei vollem Hof und vollem Lager", () => {
  it("voller Hof ohne Träger: Die Meldung nennt fehlende Träger, nicht das Lager", () => {
    const g = createGame({ seed: 1, raids: false });
    g.world.meta.immigration = false;
    const h = buildNow(g, "holzfaeller", ...findSpot(g, "holzfaeller", 17, 30), 0);
    run(g, 30 * TPS, () => h.workers.length > 0);
    // alle übrigen Tagelöhner sind dauerhaft beschäftigt (kein Abholen)
    for (const u of g.world.s.units) if (u.key === "tageloehner") u.ai.noJob = 1e9;
    run(g, 400 * TPS, () => g.state.messages.some((m) => m.text.includes("Der Hof ist voll")));
    const m = g.state.messages.find((x) => x.text.includes("Der Hof ist voll"));
    expect(m?.text).toContain("Kein Tagelöhner kommt zum Abholen nach");
    expect(m?.text).not.toContain("Lagerhaus");
  });

  it("alle Fächer belegt, aber Stück frei: Die Meldung nennt Ware und Grund", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const q = buildNow(g, "steinbruch", ...findSpot(g, "steinbruch", 36, 17), 0);
    const goods = ["holz", "eisen", "speer", "schwert", "bogen", "erz", "pike", "ruestung"] as const;
    l.slots.forEach((s, i) => { s.good = goods[i % goods.length]; s.amount = 1; s.reserved = 0; s.incoming = 0; });
    for (const b of g.state.buildings) if (b !== l && b.key === "lager") b.slots.forEach((s) => { s.good = "holz"; s.amount = 20; });
    q.output!.amount = 1;
    run(g, 5 * TPS);
    const m = g.state.messages.find((x) => x.text.startsWith("Kein freies Fach für Stein"));
    expect(m?.text).toMatch(/\d+ von \d+ Stück/);
  });
});
