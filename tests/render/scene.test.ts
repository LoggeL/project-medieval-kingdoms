import { describe, expect, it, vi } from "vitest";
import { ObjectLayer, type SceneOptions } from "../../src/render/scene";
import { createGame } from "../../src/sim";
import { spawn } from "../../src/sim/debug";
import type { SimState } from "../../src/sim/types";
import { fakeBuildingSheet, fakeFigureSheet } from "./fakes";

const VIEW = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
const OPT: SceneOptions = { selectedUnits: new Set(), danger: null, highlight: null, ghosts: [] };

describe("Objektebene ohne einzelne Sprites", () => {
  it("zeichnet weiter, wenn lager und lager_boden fehlen: Stapel bleiben sichtbar, kein Ausnahmefehler", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = createGame({ seed: 1 });
    expect(g.state.buildings.some((b) => b.key === "lager")).toBe(true);
    const bs = fakeBuildingSheet({ without: ["lager", "lager_boden"] });
    const layer = new ObjectLayer(bs, fakeFigureSheet());
    for (const r of [0, 1, 2, 3] as const) expect(() => layer.update(g.state, r, 0.5, VIEW, OPT)).not.toThrow();
    expect(layer.stats.items).toBeGreaterThan(100);
    expect(bs.calls.some((c) => c.startsWith("stapel_"))).toBe(true);
    expect(bs.calls.some((c) => c.startsWith("baum") || c.startsWith("tanne"))).toBe(true);
    warn.mockRestore();
  });

  it("nimmt das Ersatzbild lager (Füllstufen), wenn nur lager_boden fehlt", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = createGame({ seed: 1 });
    const bs = fakeBuildingSheet({ without: ["lager_boden"] });
    const layer = new ObjectLayer(bs, fakeFigureSheet());
    layer.update(g.state, 0, 0.5, VIEW, OPT);
    expect(bs.calls).toContain("lager:body");
    warn.mockRestore();
  });

  it("lässt ein Objekt aus, dessen Aufbau wirft, und meldet das nur einmal", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = createGame({ seed: 1 });
    const bs = fakeBuildingSheet({ throwOn: ["lager_boden"] });
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
