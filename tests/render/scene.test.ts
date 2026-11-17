import { describe, expect, it, vi } from "vitest";
import { BUILDINGS } from "../../src/data";
import { interiorTargets, INTERIOR_MS, stepInteriors } from "../../src/render/interior";
import { fillFrame, ObjectLayer, type SceneOptions } from "../../src/render/scene";
import { createGame } from "../../src/sim";
import { buildNow, spawn } from "../../src/sim/debug";
import type { SimState } from "../../src/sim/types";
import { fakeBuildingSheet, fakeFigureSheet } from "./fakes";

const VIEW = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
const OPT: SceneOptions = { selectedUnits: new Set(), danger: null, highlight: null, ghosts: [] };

describe("Objektebene ohne einzelne Sprites", () => {
  it("zeichnet weiter, wenn lagerhaus und lager fehlen: Stapel bleiben sichtbar, kein Ausnahmefehler", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = createGame({ seed: 1 });
    expect(g.state.buildings.some((b) => b.key === "lager")).toBe(true);
    const bs = fakeBuildingSheet({ without: ["lagerhaus", "lager"] });
    const layer = new ObjectLayer(bs, fakeFigureSheet());
    for (const r of [0, 1, 2, 3] as const) expect(() => layer.update(g.state, r, 0.5, VIEW, OPT)).not.toThrow();
    expect(layer.stats.items).toBeGreaterThan(100);
    expect(bs.calls.some((c) => c.startsWith("stapel_"))).toBe(true);
    expect(bs.calls.some((c) => c.startsWith("baum") || c.startsWith("tanne"))).toBe(true);
    warn.mockRestore();
  });

  it("nimmt das Ersatzbild lager (Füllstufen), wenn lagerhaus fehlt", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = createGame({ seed: 1 });
    const bs = fakeBuildingSheet({ without: ["lagerhaus"] });
    const layer = new ObjectLayer(bs, fakeFigureSheet());
    layer.update(g.state, 0, 0.5, VIEW, OPT);
    expect(bs.calls).toContain("lager:body");
    warn.mockRestore();
  });

  it("lässt ein Objekt aus, dessen Aufbau wirft, und meldet das nur einmal", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = createGame({ seed: 1 });
    const bs = fakeBuildingSheet({ throwOn: ["lagerhaus"] });
    const layer = new ObjectLayer(bs, fakeFigureSheet());
    for (let i = 0; i < 5; i++) expect(() => layer.update(g.state, 0, 0.5, VIEW, OPT)).not.toThrow();
    expect(layer.stats.items).toBeGreaterThan(100);
    const msgs = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("lager"));
    expect(msgs.length).toBe(1);
    // keine Treffer des ausgelassenen Lagers
    const lager = g.state.buildings.find((b) => b.key === "lager")!;
    expect(layer.hits.some((h) => h.id === lager.id && h.kind === "building")).toBe(false);
    warn.mockRestore();
  });
});

describe("Innenansicht", () => {
  function setup() {
    const g = createGame({ seed: 1 });
    const lager = g.state.buildings.find((b) => b.key === "lager")!;
    return { g, lager };
  }

  it("Füllstand vor dem Tor: leer = Variante 0, sonst 1..4 nach Gesamtmenge", () => {
    const { lager } = setup();
    const b = { ...lager, slots: lager.slots.map((s) => ({ ...s, amount: 0 })) };
    expect(fillFrame(b, 5)).toBe(0);
    b.slots[0].amount = 1;
    expect(fillFrame(b, 5)).toBe(1);
    const cap = BUILDINGS.lager.storage!.slots * BUILDINGS.lager.storage!.perSlot;
    b.slots.forEach((s) => (s.amount = cap / b.slots.length));
    expect(fillFrame(b, 5)).toBe(4);
  });

  it("zu: nur das Außenbild; offen: Schnittbild, Fächer mit Stapeln und Vorderwände, Treffer bleibt beim Gebäude", () => {
    const { g, lager } = setup();
    expect(lager.slots.some((s) => s.good && s.amount > 0)).toBe(true);
    for (const r of [0, 1, 2, 3] as const) {
      const bs = fakeBuildingSheet();
      const layer = new ObjectLayer(bs, fakeFigureSheet());
      layer.update(g.state, r, 1, VIEW, OPT);
      expect(bs.calls).not.toContain("lagerhaus_innen:body");
      const bs2 = fakeBuildingSheet();
      const open = new ObjectLayer(bs2, fakeFigureSheet());
      open.update(g.state, r, 1, VIEW, { ...OPT, interiors: new Map([[lager.id, 1]]) });
      expect(bs2.calls).toContain("lagerhaus_innen:body");
      expect(bs2.calls).toContain("lagerhaus_innen:front");
      expect(bs2.calls.some((c) => c.startsWith("stapel_"))).toBe(true);
      expect(open.hits.some((h) => h.id === lager.id && h.kind === "building")).toBe(true);
    }
  });

  it("Figuren im Gebäude sind nur in der offenen Innenansicht zu sehen", () => {
    const { g, lager } = setup();
    const u = spawn(g, "tageloehner", 0, lager.x + 1, lager.y + 1);
    u.inside = lager.id;
    const shut = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
    shut.update(g.state, 0, 1, VIEW, OPT);
    expect(shut.units.some((q) => q.id === u.id)).toBe(false);
    const open = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
    open.update(g.state, 0, 1, VIEW, { ...OPT, interiors: new Map([[lager.id, 1]]) });
    expect(open.units.some((q) => q.id === u.id)).toBe(true);
  });

  it("Bewohner werden der Reihe nach auf fertige Wohnhäuser verteilt", () => {
    const { g } = setup();
    const a = buildNow(g, "haus", 4, 4), b = buildNow(g, "haus", 8, 4);
    const state = { ...g.state, population: 6 } as SimState;
    const layer = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
    layer.update(state, 0, 1, VIEW, OPT);
    expect(layer.residents.get(a.id)).toBe(4);
    expect(layer.residents.get(b.id)).toBe(2);
  });

  it("blendet weich auf und zu und vergisst geschlossene Gebäude", () => {
    const fade = new Map<number, number>();
    stepInteriors(fade, new Set([7]), INTERIOR_MS / 2);
    expect(fade.get(7)).toBeCloseTo(0.5);
    stepInteriors(fade, new Set([7]), INTERIOR_MS);
    expect(fade.get(7)).toBe(1);
    stepInteriors(fade, new Set(), INTERIOR_MS / 4);
    expect(fade.get(7)).toBeCloseTo(0.75);
    stepInteriors(fade, new Set(), INTERIOR_MS);
    expect(fade.has(7)).toBe(false);
    stepInteriors(fade, new Set([3]), 0, true);
    expect(fade.get(3)).toBe(1);
  });

  it("öffnet nur fertige Gebäude mit Schnittbild", () => {
    const { g, lager } = setup();
    const site = g.state.buildings.find((b) => b.built < 1);
    const t = interiorTargets(g.state, [lager.id, null, site?.id ?? null, 999999]);
    expect([...t]).toEqual([lager.id]);
  });
});

describe("Silhouetten und Treffer", () => {
  /** Ein Baum bei (10, 10) und eine Figur knapp dahinter (Ansicht r = 0), sonst nichts. */
  function scene(treeAlpha: number) {
    const g = createGame({ seed: 1 });
    const u = spawn(g, "schwert", 0, 10, 9);
    u.x = u.px = 10.5; u.y = u.py = 9.4;
    const tree = { ...g.state.trees[0], id: 9999, x: 10, y: 10, state: "stehend" as const, kind: "baum" as const };
    const state = { ...g.state, units: [u], buildings: [], trees: [tree], rocks: [], projectiles: [] } as SimState;
    const bs = fakeBuildingSheet({ alpha: (k) => (k === "baum" ? treeAlpha : 0) });
    const layer = new ObjectLayer(bs, fakeFigureSheet());
    layer.update(state, 0, 1, VIEW, OPT);
    return { layer, u };
  }

  it("ein eingebackener Schlagschatten (Alpha 105) verdeckt nicht: keine Silhouette, Klick trifft die Figur", () => {
    const { layer, u } = scene(105);
    expect(layer.stats.silhouettes).toBe(0);
    const os = layer.units.find((q) => q.id === u.id)!;
    expect(layer.pick(os.x, os.y - 12)?.kind).toBe("unit");
  });

  it("deckende Körperpixel (Alpha 255) verdecken weiterhin: Silhouette, Klick trifft die Figur über der Silhouette", () => {
    const { layer, u } = scene(255);
    expect(layer.stats.silhouettes).toBe(1);
    const os = layer.units.find((q) => q.id === u.id)!;
    expect(layer.pick(os.x, os.y - 12)?.kind).toBe("unit");
  });
});
