import { describe, expect, it, vi } from "vitest";
import { BUILDINGS } from "../../src/data";
import { completeBuilding, roadPath } from "../../src/sim/build";
import { createGame, loadGame, type Simulation } from "../../src/sim/game";
import { buildNow, run, spawn, stockUp } from "../../src/sim/debug";
import { wallPiece } from "../../src/sim/geom";
import { speedOf } from "../../src/sim/move";
import { MIN_COST } from "../../src/sim/nav";
import { TPS } from "../../src/sim/world";
import { ObjectLayer, type SceneOptions } from "../../src/render/scene";
import { fakeBuildingSheet, fakeFigureSheet } from "../render/fakes";

// Wege und Brücken (BRIEF §5.3, ADR 0015): gezogen wie Mauern, von Tagelöhnern gebaut, schneller begehbar,
// von der Wegfindung bevorzugt; eine Brücke macht Wasser erst begehbar, wenn sie fertig ist.

const VIEW = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
const OPT: SceneOptions = { selectedUnits: new Set(), danger: null, highlight: null, ghosts: [] };

/** Leere Karte mit Lagerhaus, Stein und Holz, optional einem Fluss entlang x = rx (Breite 3). */
function karte(river?: number): Simulation {
  const g = createGame({ scenario: "leer", size: 48 });
  buildNow(g, "lager", 4, 4, 0);
  stockUp(g, "stein", 60); stockUp(g, "holz", 60);
  g.state.gold = 1000;
  if (river !== undefined) {
    for (let y = 0; y < g.state.h; y++) for (let x = river; x < river + 3; x++) g.state.tiles[y * g.state.w + x].terrain = "wasser";
    g.world.nav.refresh();
  }
  return g;
}

/** Alle Baustellen sofort fertig (Simulation der Bauarbeit wird eigens getestet). */
function fertig(g: Simulation, ids: number[]): void {
  for (const id of ids) completeBuilding(g.world, g.world.buildings.get(id)!);
}

/** Ticks, bis eine Einheit (Speerträger) mit einem Marschbefehl von a nach b gelaufen ist. */
function marsch(g: Simulation, a: [number, number], b: [number, number]): number {
  const u = spawn(g, "speer", 0, a[0], a[1]);
  g.dispatch({ t: "bewegen", units: [u.id], x: b[0] + 0.5, y: b[1] + 0.5 });
  let n = 0;
  run(g, 120 * TPS, () => { n++; return Math.hypot(u.x - b[0] - 0.5, u.y - b[1] - 0.5) < 0.6 && u.order.t === "idle"; });
  return n;
}

describe("Wege ziehen und bauen", () => {
  it("Kiesweg und Pflaster: gerade oder L-förmig, vorhandene Wege übersprungen, Hindernis lehnt ab, Kosten je Feld", () => {
    const g = karte();
    const p = roadPath(g.world, "kiesweg", 10, 10, 16, 14);
    expect(p.ok).toBe(true);
    expect(p.build).toHaveLength(7 + 4); // 7 Felder entlang x, dann 4 entlang y
    const stein = g.state.stock.stein;
    const res = g.dispatch({ t: "weg", key: "kiesweg", x0: 10, y0: 10, x1: 16, y1: 14 });
    expect(res.ok).toBe(true);
    expect(res.ids).toHaveLength(11);
    // Material ist für die Baustellen verplant (frei verfügbar ist weniger)
    expect(roadPath(g.world, "kiesweg", 10, 10, 16, 10).reason).toBe("Hier liegt schon ein Weg");
    // Pflaster über den Kiesweg: nur die neuen Felder
    expect(roadPath(g.world, "pflaster", 8, 10, 12, 10).build).toHaveLength(2);
    // ein Haus mitten auf dem Weg lehnt ab, ein Weg durch ein Haus ebenso
    expect(g.canPlace("haus", 12, 10, 0).ok).toBe(false);
    buildNow(g, "haus", 30, 30, 0);
    const q = roadPath(g.world, "pflaster", 28, 31, 34, 31);
    expect(q.ok).toBe(false);
    expect(q.reason).toBe("Hier steht schon etwas");
    expect(stein).toBeGreaterThan(0);
  });

  it("nur bezahlbare Stücke vom Start aus; ohne Material nichts", () => {
    const g = createGame({ scenario: "leer", size: 48 });
    buildNow(g, "lager", 4, 4, 0);
    stockUp(g, "stein", 6);
    const p = roadPath(g.world, "pflaster", 10, 20, 20, 20); // 11 Felder zu je 2 Stein
    expect(p.ok).toBe(true);
    expect(p.build).toHaveLength(3);
    expect(p.reason).toContain("Nur 3 von 11");
    expect(p.build[0]).toEqual([10, 20, 0]);
    const g2 = createGame({ scenario: "leer", size: 48 });
    buildNow(g2, "lager", 4, 4, 0);
    const r = g2.dispatch({ t: "weg", key: "kiesweg", x0: 10, y0: 20, x1: 20, y1: 20 });
    expect(r.ok).toBe(false);
  });

  it("Tagelöhner bringen den Stein und legen den Weg Feld für Feld; danach ist das Lager um die Kosten leichter", () => {
    const g = karte();
    for (let i = 0; i < 4; i++) spawn(g, "tageloehner", 0, 8 + i, 8);
    const before = g.state.stock.stein;
    const res = g.dispatch({ t: "weg", key: "pflaster", x0: 12, y0: 12, x1: 18, y1: 12 });
    expect(res.ok).toBe(true);
    let carried = false;
    run(g, 240 * TPS, () => {
      if (g.state.units.some((u) => u.carry === "stein")) carried = true;
      return res.ids!.every((id) => g.world.buildings.get(id)!.built >= 1);
    });
    for (const id of res.ids!) expect(g.world.buildings.get(id)!.built).toBeGreaterThanOrEqual(1);
    expect(carried).toBe(true);
    expect(g.state.stock.stein).toBe(before - 7 * BUILDINGS.pflaster.cost.stein!);
    // fertig: im Laufraster gilt die Wegkosten
    const nav = g.world.nav;
    expect(nav.cost[12 * g.state.w + 15]).toBeCloseTo(BUILDINGS.pflaster.road!.cost, 5);
  });

  it("ein Weg darf vor eine Tür führen, ein Gebäude nicht", () => {
    const g = karte();
    // auf jedem Feld, auf dem eine Mauer den Eingang des Lagerhauses versperren würde, darf ein Weg liegen
    let n = 0;
    for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) {
      const r = roadPath(g.world, "kiesweg", x, y, x, y);
      const wall = g.wallPath(x, y, x, y);
      if (!wall.ok && wall.reason?.startsWith("Versperrt den Eingang")) { n++; expect(r.ok, `${x},${y}`).toBe(true); }
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe("Wege beschleunigen und werden bevorzugt", () => {
  it("Laufgeschwindigkeit: Pflaster × 1 / 0,55, Kies × 1 / 0,62, Gras × 1", () => {
    const g = karte();
    const ids = [
      ...g.dispatch({ t: "weg", key: "pflaster", x0: 10, y0: 20, x1: 12, y1: 20 }).ids!,
      ...g.dispatch({ t: "weg", key: "kiesweg", x0: 10, y0: 24, x1: 12, y1: 24 }).ids!,
    ];
    fertig(g, ids);
    const u = spawn(g, "speer", 0, 11, 20);
    const base = speedOf(g.world, u);
    u.x = 11.5; u.y = 30.5;
    const gras = speedOf(g.world, u);
    u.y = 24.5;
    const kies = speedOf(g.world, u);
    expect(base / gras).toBeCloseTo(1 / 0.55, 5);
    expect(kies / gras).toBeCloseTo(1 / 0.62, 5);
    expect(1 / MIN_COST).toBeGreaterThanOrEqual(1 / 0.55 - 1e-9); // die Obergrenze lässt den Bonus zu
  });

  it("die Wegfindung nimmt den Umweg über die Straße, und er ist schneller", () => {
    const g = karte();
    const nav = g.world.nav;
    const goal = { layer: 0, x0: 40, y0: 30, x1: 40, y1: 30, d: 0 };
    const direct = nav.route(0, false, nav.node(0, 8, 30), goal)!;
    expect(direct.every((n) => nav.tileY(n) === 30)).toBe(true); // ohne Straße: gerade
    const t0 = marsch(g, [8, 30], [40, 30]);
    // Straße zwei Felder daneben
    fertig(g, g.dispatch({ t: "weg", key: "pflaster", x0: 9, y0: 33, x1: 39, y1: 33 }).ids!);
    const via = nav.route(0, false, nav.node(0, 8, 30), goal)!;
    const onRoad = via.filter((n) => nav.tileY(n) === 33).length;
    expect(onRoad).toBeGreaterThan(20);
    const t1 = marsch(g, [8, 30], [40, 30]);
    expect(t1).toBeLessThan(t0 * 0.8);
  });

  it("Autotiling: Nachbarmasken der Wege in allen vier Ausrichtungen, Teile wie die Mauer", () => {
    const g = karte();
    // Kreuzung bei (20, 20), Ecke bei (30, 20)
    fertig(g, g.dispatch({ t: "weg", key: "kiesweg", x0: 16, y0: 20, x1: 30, y1: 20 }).ids!);
    fertig(g, g.dispatch({ t: "weg", key: "kiesweg", x0: 20, y0: 16, x1: 20, y1: 24 }).ids!);
    fertig(g, g.dispatch({ t: "weg", key: "pflaster", x0: 30, y0: 21, x1: 30, y1: 26 }).ids!);
    const at = (x: number, y: number) => g.world.buildingAt(x, y)!;
    expect(wallPiece(at(20, 20).wallMask).piece).toBe("mauer_kreuz");
    expect(wallPiece(at(30, 20).wallMask).piece).toBe("mauer_ecke"); // Kies trifft Pflaster: beide sind Wege
    expect(wallPiece(at(25, 20).wallMask).piece).toBe("mauer_gerade");
    expect(wallPiece(at(16, 20).wallMask).piece).toBe("mauer_ende");
    expect(wallPiece(at(20, 22).wallMask)).toEqual({ piece: "mauer_gerade", o: 1 });
    // Darstellung: in jeder Kameradrehung das passende Teil, flach (vor den Figuren gezeichnet)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const r of [0, 1, 2, 3] as const) {
      const bs = fakeBuildingSheet();
      const layer = new ObjectLayer(bs, fakeFigureSheet());
      layer.update(g.state, r, 0, VIEW, OPT);
      for (const k of ["kiesweg_kreuz", "kiesweg_ecke", "kiesweg_gerade", "kiesweg_ende", "pflaster_ende", "pflaster_gerade"]) expect(bs.calls, `${k} r${r}`).toContain(`${k}:body`);
      expect(layer.hits.some((h) => h.id === at(20, 20).id)).toBe(true); // anklickbar (Abriss)
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("Brücke", () => {
  it("nur über Wasser, an beiden Ufern angesetzt, gerade in Zugrichtung, höchstens MAX_BRIDGE Felder", () => {
    const g = karte(20);
    expect(roadPath(g.world, "bruecke", 10, 10, 14, 10).reason).toBe("Eine Brücke gehört über das Wasser");
    const p = roadPath(g.world, "bruecke", 18, 10, 24, 11); // Landfelder an den Enden übersprungen, gerade entlang x
    expect(p.ok).toBe(true);
    expect(p.build).toEqual([[20, 10, 0], [21, 10, 0], [22, 10, 0]]);
    expect(roadPath(g.world, "bruecke", 21, 4, 21, 9).reason).toContain("beiden Ufern"); // liegt im Fluss
    const q = roadPath(g.world, "bruecke", 21, 4, 23, 30);
    expect(q.ok).toBe(false);
    // Wege dürfen nicht aufs Wasser
    expect(roadPath(g.world, "kiesweg", 18, 12, 24, 12).ok).toBe(false);
  });

  it("erst die fertige Brücke ist begehbar; vom Ufer aus Joch für Joch von Tagelöhnern gebaut", () => {
    const g = karte(20);
    const nav = g.world.nav;
    const far = nav.node(0, 30, 10), near = nav.node(0, 10, 10);
    expect(nav.comp[0][far]).not.toBe(nav.comp[0][near]);
    for (let i = 0; i < 4; i++) spawn(g, "tageloehner", 0, 8 + i, 8);
    const res = g.dispatch({ t: "weg", key: "bruecke", x0: 19, y0: 10, x1: 23, y1: 10 });
    expect(res.ok).toBe(true);
    expect(res.ids).toHaveLength(3);
    // Baustelle allein macht das Wasser nicht begehbar
    expect(nav.open(nav.node(0, 20, 10), 0)).toBe(false);
    const order: number[] = [];
    run(g, 300 * TPS, () => {
      for (const id of res.ids!) if (g.world.buildings.get(id)!.built >= 1 && !order.includes(id)) order.push(id);
      return order.length === res.ids!.length;
    });
    expect(order).toHaveLength(3);
    expect(order[0]).toBe(res.ids![0]); // das Joch am Ufer zuerst
    expect(nav.comp[0][far]).toBe(nav.comp[0][near]);
    expect(g.state.messages.some((m) => m.text.includes("nicht erreichbar"))).toBe(false);
    // eine Einheit geht hinüber
    const t = marsch(g, [10, 10], [30, 10]);
    expect(t).toBeLessThan(120 * TPS);
  });

  it("Brücke quer zur y-Richtung hat Ausrichtung 1 und wird in jeder Kameradrehung mit ihrer Ansicht gezeichnet", () => {
    const g = createGame({ scenario: "leer", size: 48 });
    buildNow(g, "lager", 4, 4, 0);
    stockUp(g, "holz", 100);
    for (let x = 0; x < 48; x++) for (let y = 20; y < 22; y++) g.state.tiles[y * 48 + x].terrain = "wasser";
    g.world.nav.refresh();
    const res = g.dispatch({ t: "weg", key: "bruecke", x0: 30, y0: 18, x1: 30, y1: 24 });
    expect(res.ok).toBe(true);
    fertig(g, res.ids!);
    for (const id of res.ids!) expect(g.world.buildings.get(id)!.o).toBe(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const r of [0, 1, 2, 3] as const) {
      const bs = fakeBuildingSheet();
      new ObjectLayer(bs, fakeFigureSheet()).update(g.state, r, 0, VIEW, OPT);
      expect(bs.calls).toContain("bruecke:body");
    }
    warn.mockRestore();
  });
});

describe("Speichern und Laden", () => {
  it("Wege, Brücke und Baustellen überstehen Speichern und Laden; das Raster hat danach dieselben Kosten", () => {
    const g = karte(20);
    for (let i = 0; i < 3; i++) spawn(g, "tageloehner", 0, 8 + i, 8);
    g.dispatch({ t: "weg", key: "pflaster", x0: 10, y0: 10, x1: 18, y1: 10 });
    g.dispatch({ t: "weg", key: "bruecke", x0: 19, y0: 10, x1: 23, y1: 10 });
    run(g, 60 * TPS);
    const saved = g.save();
    const l = loadGame(saved);
    expect(Array.from(l.world.nav.cost)).toEqual(Array.from(g.world.nav.cost));
    run(g, 90 * TPS); run(l, 90 * TPS);
    expect(JSON.stringify(l.state)).toBe(JSON.stringify(g.state));
    expect(l.state.buildings.filter((b) => b.key === "pflaster" && b.built >= 1).length).toBeGreaterThan(0);
  }, 30_000);
});
