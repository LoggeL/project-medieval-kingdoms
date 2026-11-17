/**
 * Darstellung der Belagerung (ADR 0017): Sprites im Blatt, Schadensstufen an Mauer, Palisade und anderen Bauten,
 * Leitern, Trümmer, Rammbock aus dem Gebäudeblatt, Leiterträger, Rauch schwer beschädigter Bauten.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, DAMAGE_STAGES, RUINS, UNITS, type BuildingKey } from "../../src/data";
import { ObjectLayer, ladderFrame, vehicleFrame, vehicleOrientation } from "../../src/render/scene";
import { createGame } from "../../src/sim";
import { buildNow, spawn, worldOf } from "../../src/sim/debug";
import { modelToWorld } from "../../src/sim/geom";
import { fakeBuildingSheet, fakeFigureSheet } from "./fakes";
import BMETA from "../../assets/buildings/vorgerendert/sheet.json";
import FMETA from "../../assets/figures/vorgerendert/sheet.json";

const ALL = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
const opt = () => ({ selectedUnits: new Set<number>(), danger: null, highlight: null, ghosts: [] });
const units = (BMETA as unknown as { units: { key: string; frames: number; footprint: [number, number]; front: boolean }[] }).units;
const byKey = new Map(units.map((u) => [u.key, u]));
const PIECES = ["gerade", "ende", "ecke", "t", "kreuz", "einzel"];

describe("Belagerungssprites im Blatt", () => {
  it("Palisade und Graben haben alle sechs Stücke, die Palisade mit den drei Schadensstufen", () => {
    for (const p of PIECES) {
      expect(byKey.get(`palisade_${p}`)?.frames).toBe(4);
      expect(byKey.get(`graben_${p}`)?.frames).toBe(1);
      expect(byKey.get(`mauer_${p}_schaden`)?.frames).toBe(3);
      expect(byKey.get(`mauer_${p}_schaden`)?.front).toBe(true);
    }
    for (const k of ["tor_schaden", "tor_offen_schaden", "turm_schaden", "treppe_schaden"]) expect(byKey.get(k)?.frames).toBe(3);
    expect(byKey.get("turm_schaden")?.footprint).toEqual(byKey.get("turm")?.footprint);
    expect(byKey.get("leiter")?.frames).toBe(3);
    expect(byKey.get("rammbock")?.frames).toBe(4);
    for (const r of Object.values(RUINS)) expect(byKey.get(r!.sprite)?.frames).toBe(r!.variants);
  });

  it("jeder Bau ohne eigenes Schadensblatt hat eine Schadensüberlagerung für seinen Grundriss", () => {
    for (const k of Object.keys(BUILDINGS) as BuildingKey[]) {
      const def = BUILDINGS[k];
      // Wege und Brücken (ADR 0015) greift niemand an (raid.ts, belagerung.ts): sie nehmen keinen Schaden
      if (def.road || def.pieces || def.ditch || k === "mauer" || k === "tor" || byKey.has(`${def.sprite}_schaden`)) continue;
      expect(byKey.get(`schaden_${def.footprint[0]}x${def.footprint[1]}`)?.frames, k).toBe(3);
    }
  });

  it("Sturmknecht und Leiterträger stehen im Figurenblatt", () => {
    const f = (FMETA as unknown as { units: { key: string; anims: Record<string, [number, number]> }[] }).units;
    const sk = f.find((u) => u.key === UNITS.sturmknecht.sprite)!;
    expect(sk.anims.angriff).toEqual([9, 4]);
    expect(f.find((u) => u.key === UNITS.sturmknecht.gearSprite!.leiter)!.anims.gehen).toEqual([1, 8]);
  });
});

describe("Ausrichtung von Fahrzeug und Leiter", () => {
  it("die Fahrtrichtung wählt die Ausrichtung, deren Modell-Vorne in diese Richtung zeigt", () => {
    for (let o = 0; o < 4; o++) {
      const [fx, fy] = modelToWorld(0, 1, o);
      expect(vehicleOrientation(fx, fy)).toBe(o);
      expect(vehicleOrientation(fx * 0.9 + fy * 0.2, fy * 0.9 + fx * 0.2)).toBe(o);
    }
  });

  it("Varianten: Rammbock Ruhe, ausgeholt, Stoß, Wrack; Leiter steht, kippt, liegt", () => {
    expect(vehicleFrame({ dead: false, anim: "gehen", animT: 1 }, 3)).toBe(0);
    expect(vehicleFrame({ dead: false, anim: "angriff", animT: 0.5 }, 3)).toBe(1);
    expect(vehicleFrame({ dead: false, anim: "angriff", animT: 2 }, 3)).toBe(2);
    expect(vehicleFrame({ dead: true, anim: "tot", animT: 2 }, 3)).toBe(3);
    expect([ladderFrame("steht"), ladderFrame("faellt"), ladderFrame("liegt")]).toEqual([0, 1, 2]);
  });
});

describe("Belagerung in der Szene", () => {
  it("eine beschädigte Mauer zeigt ihr Schadensblatt in der passenden Stufe, die Palisade ihre Variante", () => {
    const g = createGame({ scenario: "leer", size: 32, raids: false });
    for (let x = 10; x < 14; x++) buildNow(g, "mauer", x, 10, 0);
    const p = [12, 13, 14].map((x) => buildNow(g, "palisade", x, 16, 0));
    const wall = worldOf(g).buildingAt(11, 10)!;
    const layer = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
    const hitOf = (id: number) => layer.hits.find((h) => h.kind === "building" && h.id === id)!;
    for (let k = 0; k < 4; k++) {
      const f = k === 0 ? 1 : (DAMAGE_STAGES[k - 1] - 0.05);
      wall.hp = BUILDINGS.mauer.hp * f;
      p[1].hp = BUILDINGS.palisade.hp * f;
      layer.update(g.state, 0, 1, ALL, opt());
      expect(hitOf(wall.id).key).toBe(k === 0 ? "mauer_gerade" : "mauer_gerade_schaden");
      if (k) expect(hitOf(wall.id).frame).toBe(k - 1);
      expect(hitOf(p[1].id).key).toBe("palisade_gerade");
      expect(hitOf(p[1].id).frame).toBe(k);
      expect(hitOf(p[0].id).key).toBe("palisade_ende");
    }
  });

  it("andere Bauten bekommen die Schadensüberlagerung, ab Stufe 2 steigt Rauch auf", () => {
    const g = createGame({ scenario: "leer", size: 32, raids: false });
    const k = buildNow(g, "kaserne", 10, 10, 0);
    const sheet = fakeBuildingSheet();
    const layer = new ObjectLayer(sheet, fakeFigureSheet());
    layer.update(g.state, 0, 1, ALL, opt());
    expect(sheet.calls).not.toContain("schaden_4x3:body");
    const n0 = layer.emitters.length;
    k.hp = BUILDINGS.kaserne.hp * 0.6;
    layer.update(g.state, 0, 1, ALL, opt());
    expect(sheet.calls).toContain("schaden_4x3:body");
    expect(layer.emitters.length).toBe(n0);
    k.hp = BUILDINGS.kaserne.hp * 0.1;
    layer.update(g.state, 0, 1, ALL, opt());
    expect(layer.emitters.length).toBe(n0 + 2);
  });

  it("Leitern, Trümmer, Rammbock und Leiterträger werden gezeichnet", () => {
    const g = createGame({ scenario: "leer", size: 32, raids: false });
    const w = worldOf(g);
    w.s.ladders = [{ id: w.newId(), x: 11, y: 10, wx: 10, wy: 10, o: 1, state: "steht", t: 0, push: 0 }];
    w.s.rubble = [{ x: 5, y: 5, sprite: "truemmer_stein", v: 2, o: 0 }];
    const ram = spawn(g, "rammbock", 1, 20, 20);
    const sk = spawn(g, "sturmknecht", 1, 22, 22);
    sk.gear = "leiter";
    const sheet = fakeBuildingSheet();
    const layer = new ObjectLayer(sheet, fakeFigureSheet());
    for (let r = 0; r < 4; r++) {
      sheet.calls.length = 0;
      layer.update(g.state, r as 0 | 1 | 2 | 3, 1, ALL, opt());
      expect(sheet.calls).toContain("leiter:body");
      expect(sheet.calls).toContain("truemmer_stein:body");
      expect(sheet.calls).toContain("rammbock:body");
      const h = layer.hits.find((x) => x.kind === "unit" && x.id === ram.id)!;
      expect(h.src).toBe("b");
      expect(h.key).toBe("rammbock");
      expect(layer.hits.find((x) => x.kind === "unit" && x.id === sk.id)!.key).toBe("leitertraeger");
      expect(layer.units.some((u) => u.id === ram.id)).toBe(true);
    }
  });
});
