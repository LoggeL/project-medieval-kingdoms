/**
 * Regressionstests zu den Befunden aus der Prüfung des zusammengeführten Stands (Lagerhaus, Bergfried, Startroute,
 * Baustellen, Wegfindung): Niederlage beendet Wellen, Zuzug und Forschung; Mauerturm-Tür ist Teil des Türmodells;
 * Tor auf einer belieferten Mauer-Baustelle verliert keine Steine; Figuren auf der Bergfried-Plattform wachsen beim
 * Ausbau mit; Forschung bekommt Träger, auch wenn Baustellen Material brauchen; alte Spielstände werden abgelehnt.
 */
import { describe, expect, it } from "vitest";
import { START } from "../../src/data";
import { approach, createGame, entrance, loadGame } from "../../src/sim";
import { damageBuilding } from "../../src/sim/combat";
import { buildNow, run, spawn, stockUp } from "../../src/sim/debug";
import type { Simulation } from "../../src/sim/game";
import { available } from "../../src/sim/storage";
import { SAVE_VERSION, TPS, type SBuilding, type SUnit, type World } from "../../src/sim/world";
import { findSpot } from "./helpers";

const worldOf = (g: Simulation): World => (g as unknown as { world: World }).world;
const seat = (g: Simulation) => g.state.buildings.find((b) => b.key === "bergfried") as SBuilding;
const fall = (g: Simulation) => {
  const w = worldOf(g), k = seat(g);
  let n = 0;
  while (g.state.buildings.includes(k) && n++ < 10000) damageBuilding(w, "schwert", k);
  expect(g.state.outcome).toBe("niederlage");
};

describe("Nach der Niederlage", () => {
  it("kommen keine Wellen und keine Leute mehr", () => {
    const g = createGame({ seed: 1 });
    for (const [x, y] of [[20, 40], [24, 40], [28, 44]]) buildNow(g, "haus", ...findSpot(g, "haus", x, y));
    fall(g);
    const pop0 = g.state.population;
    run(g, (START.raid.firstSeconds + 5) * TPS);
    expect(g.state.raid.wave).toBe(0);
    expect(g.state.units.filter((u) => u.team === 1 && !u.dead)).toHaveLength(0);
    expect(g.state.population).toBeLessThanOrEqual(pop0);
    expect(g.state.messages.some((m) => m.text.startsWith("Späher melden"))).toBe(false);
  });

  it("verfällt eine laufende Forschung und hält keine Waren mehr fest", () => {
    const g = createGame({ seed: 1, raids: false });
    const holz0 = available(worldOf(g), "holz");
    expect(g.dispatch({ t: "forschen", tech: "werkzeuge" }).ok).toBe(true);
    expect(available(worldOf(g), "holz")).toBeLessThan(holz0);
    fall(g);
    expect(g.state.research.cur).toBeNull();
    run(g, 60 * TPS);
    expect(available(worldOf(g), "holz")).toBe(holz0);
  });
});

describe("Mauerturm-Tür", () => {
  it("nichts vor die Turmtür bauen: Mauer, Mauerlinie und Turm mit versperrtem Vorplatz werden abgelehnt", () => {
    const g = createGame({ scenario: "leer", size: 32, raids: false });
    buildNow(g, "lager", 2, 2, 0);
    stockUp(g, "stein", 100);
    const t = buildNow(g, "turm", 10, 10, 0);
    const [ax, ay] = approach("turm", t.x, t.y, t.o);
    const r = g.canPlace("mauer", ax, ay, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("Versperrt den Eingang: Mauerturm");
    expect(g.wallPath(ax - 2, ay, ax + 2, ay).ok).toBe(false);
    // Plattform bleibt vom Boden aus erreichbar
    const w = worldOf(g);
    const [ex, ey] = entrance("turm", t.x, t.y, t.o);
    expect(w.nav.comp[0][w.nav.node(2, t.x, t.y)]).toBe(w.nav.comp[0][w.nav.node(0, ex, ey)]);
    // Turm, dessen Vorplatz belegt ist
    expect(g.canPlace("turm", 20, 20, 0).ok).toBe(true);
    buildNow(g, "mauer", ...approach("turm", 20, 20, 0));
    expect(g.canPlace("turm", 20, 20, 0).ok).toBe(false);
    expect(g.canPlace("turm", 20, 20, 0).reason).toBe("Der Eingang ist versperrt");
  });
});

describe("Tor in eine Mauer setzen", () => {
  const stoneLeft = (finishFirst: boolean): number => {
    const g = createGame({ scenario: "leer", size: 32, raids: false });
    buildNow(g, "lager", 2, 2, 0);
    stockUp(g, "stein", 40); stockUp(g, "holz", 10);
    for (let i = 0; i < 4; i++) spawn(g, "tageloehner", 0, 6 + i, 8);
    expect(g.dispatch({ t: "mauer", x0: 10, y0: 16, x1: 14, y1: 16 }).ok).toBe(true);
    const w = worldOf(g);
    const mid = () => w.buildingAt(12, 16)!;
    if (finishFirst) run(g, 300 * TPS, () => g.state.buildings.filter((b) => b.key === "mauer").every((b) => b.built >= 1));
    else run(g, 300 * TPS, () => mid().key === "mauer" && Object.keys(mid().needs).length === 0);
    expect(mid().key).toBe("mauer");
    if (!finishFirst) expect(mid().built).toBeLessThan(1);
    expect(g.dispatch({ t: "bauen", key: "tor", x: 12, y: 16, o: 0 }).ok).toBe(true);
    run(g, 400 * TPS, () => g.state.buildings.every((b) => b.built >= 1));
    expect(g.state.buildings.every((b) => b.built >= 1)).toBe(true);
    return g.state.stock.stein;
  };

  it("die schon gelieferten Steine einer Mauer-Baustelle zählen für das Tor wie bei einer fertigen Mauer", () => {
    const done = stoneLeft(true);
    expect(done).toBe(40 - 5 * 3 - 1);
    expect(stoneLeft(false)).toBe(done);
  });
});

describe("Ausbau des Bergfrieds mit Figuren auf der Plattform", () => {
  it("alle Figuren auf der Plattform stehen danach auf der neuen Höhe", () => {
    const g = createGame({ seed: 1, raids: false });
    const k = seat(g), w = worldOf(g);
    k.level = 2;
    w.nav.rebuild();
    const a = spawn(g, "bogen", 0, 30, 37), b = spawn(g, "speer", 0, 31, 37), c = spawn(g, "bogen", 0, 32, 37);
    expect(g.dispatch({ t: "bewegen", units: [a.id], x: k.x, y: k.y }).ok).toBe(true);
    expect(g.dispatch({ t: "bewegen", units: [b.id], x: k.x + 2, y: k.y + 2 }).ok).toBe(true);
    expect(g.dispatch({ t: "stationieren", units: [c.id] }).ok).toBe(true);
    run(g, 40 * TPS);
    g.dispatch({ t: "halten", units: [a.id] });
    run(g, TPS);
    for (const u of [a, b, c]) { expect(u.layer).toBe(2); expect(u.z).toBe(5); }
    w.s.research.done.push("festungsbau");
    stockUp(g, "stein", 60); stockUp(g, "holz", 20);
    expect(g.dispatch({ t: "ausbauen", building: k.id }).ok).toBe(true);
    run(g, 300 * TPS, () => k.level === 3);
    expect(k.level).toBe(3);
    run(g, 2);
    for (const u of [a, b, c] as SUnit[]) { expect(u.layer).toBe(2); expect(u.z).toBe(6); }
  });
});

describe("Träger für die Forschung", () => {
  it("kommen auch, wenn gleichzeitig Baustellen Material brauchen", () => {
    const g = createGame({ seed: 1, raids: false });
    stockUp(g, "holz", 120);
    for (const [x, y] of [[20, 40], [24, 40], [28, 44], [18, 44], [22, 46], [26, 48]]) {
      const [hx, hy] = findSpot(g, "haus", x, y);
      expect(g.dispatch({ t: "bauen", key: "haus", x: hx, y: hy, o: 0 }).ok).toBe(true);
    }
    expect(g.dispatch({ t: "forschen", tech: "werkzeuge" }).ok).toBe(true);
    let first = 0;
    run(g, 60 * TPS, (t) => {
      const cur = g.state.research.cur!;
      if (Object.keys(cur.enroute).length || Object.keys(cur.got).length) { first = t; return true; }
    });
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(10 * TPS);
  });
});

describe("Spielstände", () => {
  it("lehnt Stände einer älteren Version (ohne Bergfried) mit klarer Meldung ab", () => {
    const g = createGame({ seed: 1 });
    const d = JSON.parse(g.save());
    expect(d.v).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(2);
    d.v = 1;
    expect(() => loadGame(JSON.stringify(d))).toThrow(/älteren Version/);
    expect(loadGame(g.save()).save()).toBe(g.save());
  });
});
