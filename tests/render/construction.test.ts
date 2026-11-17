import { describe, expect, it, vi } from "vitest";
import { BUILDINGS, GOODS, type BuildingKey } from "../../src/data";
import { CHIP_LIFE, IMPACT, RUBBLE_LIFE, STRIKE, rubbleParticles, strikeParticles } from "../../src/render/dust";
import { ObjectLayer, pileLevel, siteGrowth, type SceneOptions } from "../../src/render/scene";
import { createGame } from "../../src/sim";
import { buildNow, run, worldOf } from "../../src/sim/debug";
import BMETA from "../../assets/buildings/vorgerendert/sheet.json";
import { fakeBuildingSheet, fakeFigureSheet } from "./fakes";

const VIEW = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
const OPT: SceneOptions = { selectedUnits: new Set(), danger: null, highlight: null, ghosts: [] };
const SHEET = BMETA as unknown as { units: { key: string; frames: number; front?: boolean; footprint: [number, number] }[] };

describe("Baustellen-Daten und Sprites", () => {
  it("jedes Gebäude hat Baustelle, Fundament und Ablageplätze im Grundriss; die Sprites stehen im Gebäudeblatt", () => {
    const sheet = new Map(SHEET.units.map((u) => [u.key, u]));
    for (const key of Object.keys(BUILDINGS) as BuildingKey[]) {
      const def = BUILDINGS[key], con = def.construction;
      const g = sheet.get(con.ground);
      expect(g, con.ground).toBeTruthy();
      expect(g!.frames).toBeGreaterThanOrEqual(2); // abgesteckt, Fundament
      expect(g!.footprint).toEqual(def.footprint);
      if (con.scaffold) {
        expect(sheet.get(con.scaffold)?.front, con.scaffold).toBe(true); // Vorderteil vor dem wachsenden Bau
        expect(sheet.get(con.scaffold)!.footprint).toEqual(def.footprint);
      }
      expect(con.foundation).toBeGreaterThan(0);
      expect(con.foundation).toBeLessThan(0.5);
      const goods = Object.keys(def.cost).filter((k) => k !== "gold");
      expect(con.piles.length).toBeGreaterThanOrEqual(Math.min(goods.length, 1));
      const [w, d] = def.footprint;
      for (const [x, y] of con.piles) {
        expect(Math.abs(x)).toBeLessThanOrEqual(w / 2);
        expect(Math.abs(y)).toBeLessThanOrEqual(d / 2);
      }
    }
    for (const g of Object.values(GOODS)) if (g.sitePile) expect(sheet.get(g.sitePile)?.frames).toBe(5);
  });

  it("Bauphasen: erst Fundament, dann gleichmäßig wachsend, Mauern in Lagen", () => {
    expect(siteGrowth(0, 0.15)).toBe(0);
    expect(siteGrowth(0.1, 0.15)).toBe(0);
    expect(siteGrowth(1, 0.15)).toBe(1);
    expect(siteGrowth(0.575, 0.15)).toBeCloseTo(0.5, 1);
    let last = 0;
    for (let b = 0; b <= 1.0001; b += 0.01) { const g = siteGrowth(b, 0.15); expect(g).toBeGreaterThanOrEqual(last); last = g; }
    const levels = new Set<number>();
    for (let b = 0; b < 1; b += 0.001) levels.add(siteGrowth(b, 0.15, 8));
    expect(levels.size).toBe(8); // 0, 1/8 … 7/8
    expect(pileLevel(0, 8)).toBe(0);
    expect(pileLevel(1, 20)).toBe(1);
    expect(pileLevel(20, 20)).toBe(4);
    expect(pileLevel(3, 3)).toBe(4);
  });
});

describe("Baustelle in der Objektebene", () => {
  /** Kaserne als Baustelle mit Material, in einem gegebenen Baufortschritt. */
  function site(built: number, o = 0) {
    const g = createGame({ scenario: "leer", size: 40 });
    buildNow(g, "lager", 2, 2, 0);
    const w = worldOf(g);
    const b = w.addBuilding("kaserne", 0, 15, 15, o);
    b.needs = { holz: 5 }; b.site = { holz: 4, stein: 6 }; b.mat = 35; b.built = built;
    return { g, b };
  }

  it("abgesteckt, Fundament, Gerüst mit Vorderteil und Stapel in allen vier Drehungen", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const o of [0, 1, 2, 3]) for (const r of [0, 1, 2, 3] as const) {
      const fresh = site(0, o);
      let bs = fakeBuildingSheet();
      let layer = new ObjectLayer(bs, fakeFigureSheet());
      layer.update(fresh.g.state, r, 0.5, VIEW, OPT);
      expect(bs.calls).toContain("baustelle_kaserne:body");
      expect(bs.calls.filter((c) => c.startsWith("geruest_"))).toHaveLength(0);
      expect(bs.calls).toContain("baustoff_holz:body");
      expect(bs.calls).toContain("baustoff_stein:body");
      const half = site(0.6, o);
      bs = fakeBuildingSheet();
      layer = new ObjectLayer(bs, fakeFigureSheet());
      layer.update(half.g.state, r, 0.5, VIEW, OPT);
      expect(bs.calls).toContain("geruest_kaserne:body");
      expect(bs.calls).toContain("geruest_kaserne:front");
      expect(bs.calls).toContain("kaserne:body");
      // die Baustelle ist anklickbar
      expect(layer.hits.some((h) => h.kind === "building" && h.id === half.b.id)).toBe(true);
    }
    warn.mockRestore();
  });

  it("ohne Baustellen-Sprites bleibt der blasse Umriss mit Treffer (kein Abbruch)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { g, b } = site(0.5);
    const bs = fakeBuildingSheet({ without: ["baustelle_kaserne", "geruest_kaserne", "baustoff_holz", "baustoff_stein"] });
    const layer = new ObjectLayer(bs, fakeFigureSheet());
    expect(() => layer.update(g.state, 0, 0.5, VIEW, OPT)).not.toThrow();
    expect(layer.hits.some((h) => h.id === b.id)).toBe(true);
    expect(bs.calls).toContain("stapel_holz:body"); // Ersatz: Lagerstapel
    warn.mockRestore();
  });

  it("hämmernde Bauarbeiter werfen Späne, ein Abriss hinterlässt kurz Staub und Grundmauern", () => {
    const g = createGame({ seed: 2, raids: false });
    const l = g.state.buildings.find((b) => b.key === "lager")!;
    const id = g.dispatch({ t: "bauen", key: "haus", x: l.x + 6, y: l.y - 4, o: 0 }).ids?.[0];
    expect(id).toBeTruthy();
    const layer = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
    let strikes = 0;
    run(g, 120 * 20, () => {
      if (g.state.tick % 10 === 0) { layer.update(g.state, 0, 0, VIEW, OPT); strikes = Math.max(strikes, layer.strikes.length); }
      return g.state.units.some((u) => u.anim === "bauen");
    });
    layer.update(g.state, 0, 0, VIEW, OPT);
    expect(layer.strikes.length).toBeGreaterThan(0);
    g.dispatch({ t: "abreissen", id: id! });
    run(g, 2);
    layer.update(g.state, 0, 0, VIEW, OPT);
    expect(layer.rubble.length).toBe(1);
    run(g, 6 * 20);
    layer.update(g.state, 0, 0, VIEW, OPT);
    expect(layer.rubble.length).toBe(0);
  });
});

describe("Staub und Späne", () => {
  it("Späne erst nach dem Treffer, fliegen und vergehen; gleiche Zeit = gleiches Bild", () => {
    expect(strikeParticles(0, 0, IMPACT - 0.01, 1, 1, 1)).toHaveLength(0);
    const a = strikeParticles(100, 100, IMPACT + 0.1, 7, 2, 1).map((p) => ({ ...p }));
    const b = strikeParticles(100, 100, IMPACT + 0.1, 7, 2, 1);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(3);
    expect(a.some((p) => p.tex === 2 || p.tex === 3)).toBe(true); // Stein: graue Splitter
    for (let t = 0; t < 5; t += 0.05) for (const p of strikeParticles(0, 0, t, 3, 3, -1)) {
      expect(Math.abs(p.x)).toBeLessThan(40);
      expect(p.y).toBeGreaterThan(-40);
      expect(p.y).toBeLessThan(25);
    }
    // nach dem letzten Schlag ist nichts mehr in der Luft (pro Schlag höchstens CHIP_LIFE)
    expect(CHIP_LIFE).toBeLessThan(2 * STRIKE);
    expect(rubbleParticles(0, 0, 30, RUBBLE_LIFE + 0.1, 1)).toHaveLength(0);
    expect(rubbleParticles(0, 0, 30, 0.5, 1).length).toBeGreaterThan(5);
  });
});
