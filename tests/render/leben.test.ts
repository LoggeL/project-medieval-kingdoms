/** Darstellung der lebendigen Welt (ADR 0016): Wind, Setzlinge, Fahnen, Ruhebilder, Treffer, Gefallene, Tiere, Tageslicht. */
import { describe, expect, it } from "vitest";
import { ANIMALS, DAYLIGHT, LIFE, TICKS_PER_SECOND, TREE_ART, TUNING } from "../../src/data";
import { figureDir } from "../../src/render/iso";
import { animalFrame, corpseAlpha, daylightTint, dayName, flagArt, lifeFrame, treeArt, type SheetInfo } from "../../src/render/life";
import { ObjectLayer, type SceneOptions } from "../../src/render/scene";
import { createGame } from "../../src/sim";
import { buildNow, spawn } from "../../src/sim/debug";
import type { Rot } from "../../src/sim/geom";
import type { Animal, SimState, Tree, Unit } from "../../src/sim/types";
import BMETA from "../../assets/buildings/vorgerendert/sheet.json";
import FMETA from "../../assets/figures/vorgerendert/sheet.json";
import { fakeBuildingSheet, fakeFigureSheet } from "./fakes";

const VIEW = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
const OPT: SceneOptions = { selectedUnits: new Set(), danger: null, highlight: null, ghosts: [] };
const bmeta = new Map((BMETA as { units: { key: string; frames?: number }[] }).units.map((u) => [u.key, u.frames ?? 1]));
const fanims = new Map((FMETA as unknown as { units: { key: string; anims: Record<string, [number, number]> }[] }).units.map((u) => [u.key, u.anims]));
const SHEET: SheetInfo = { has: (k) => bmeta.has(k), frames: (k) => bmeta.get(k) ?? 1 };
const tree = (o: Partial<Tree> = {}): Tree => ({ id: 1, x: 0, y: 0, kind: "baum", variant: 1, state: "stehend", progress: 0, fallX: 0, fallY: 0, logs: 0, reservedBy: 0, ...o });
const unit = (o: Partial<Unit> = {}): Unit => ({
  id: 3, key: "tageloehner", team: 0, x: 0, y: 0, z: 0, layer: 0, px: 0, py: 0, pz: 0, fx: 1, fy: 0, anim: "stehen", animT: 0,
  carry: null, hp: 30, maxHp: 30, order: { t: "idle" }, home: 0, dead: false, ...o,
});

describe("Blätter der lebendigen Welt", () => {
  it("Wind-, Setzlings-, Fahnen-, Tier- und Lebensblätter stehen mit passenden Bildzahlen in den Blättern", () => {
    for (const k of ["baum", "tanne"]) {
      expect(bmeta.get(TREE_ART.wind[k])! % TREE_ART.phases).toBe(0);
      expect(bmeta.get(TREE_ART.young[k])).toBe(LIFE.forest.stageSeconds.length);
    }
    expect(bmeta.get("baum_wind")).toBe(bmeta.get("baum")! * TREE_ART.phases);
    for (const k of ["kaserne_fahne", "turm_fahne", "bergfried_holz_fahne", "bergfried_stein_fahne", "bergfried_burg_fahne"]) expect(bmeta.get(k)).toBe(6);
    for (const a of Object.values(ANIMALS)) {
      const an = fanims.get(a.sprite)!;
      expect(an, a.sprite).toBeDefined();
      for (const k of a.kind === "vogel" ? ["stehen", "gehen", "fliegen", "picken", "auffliegen"] : ["stehen", "gehen", "grasen", "rennen", "sterben", "tot"]) expect(an[k], `${a.sprite}.${k}`).toBeDefined();
    }
    for (const k of ["tageloehner_leben", "speer_leben", "schwert_leben", "bogen_leben"]) {
      for (const a of ["rennen", "treffer", "sitzen", "plaudern"]) expect(fanims.get(k)?.[a], `${k}.${a}`).toBeDefined();
    }
  });
});

describe("Bäume im Wind und nachwachsend", () => {
  it("stehende Bäume wiegen durch alle Phasen, jeder im eigenen Takt, Variante bleibt der Baum", () => {
    const seen = new Set<number>();
    for (let s = 0; s < 6; s += 0.1) seen.add(treeArt(tree(), s, SHEET, 2)!.frame);
    expect([...seen].sort()).toEqual([4, 5, 6, 7]); // Buche = Baum 1, Phasen 0..3
    expect(treeArt(tree({ kind: "tanne", variant: 1 }), 0, SHEET, 1)!.key).toBe("tanne_wind");
    expect(treeArt(tree({ kind: "tanne", variant: 1 }), 0, SHEET, 1)!.frame).toBeLessThan(4);
    const at = (id: number) => Array.from({ length: 30 }, (_, i) => treeArt(tree({ id }), i * 0.2, SHEET, 2)!.frame).join();
    expect(at(1)).not.toBe(at(2));
  });

  it("wachsende Bäume zeigen ihre Stufe; liegende, fallende und Stümpfe bleiben beim alten Bild", () => {
    for (const stage of [0, 1, 2]) expect(treeArt(tree({ state: "waechst", stage }), 0, SHEET, 2)).toEqual({ key: "baum_jung", frame: stage });
    for (const state of ["faellt", "liegt", "stumpf"] as const) expect(treeArt(tree({ state }), 0, SHEET, 2)).toBeNull();
    // ohne Windbild: stilles Bild (null)
    expect(treeArt(tree(), 0, { has: () => false, frames: () => 1 }, 2)).toBeNull();
  });
});

describe("Fahnen, Figuren, Gefallene", () => {
  it("Fahnen wehen in sechs Bildern, nur für Gebäude mit Fahnenbild", () => {
    const seen = new Set<number>();
    for (let s = 0; s < 2; s += 0.05) seen.add(flagArt("kaserne", 7, s, SHEET)!.frame);
    expect(seen.size).toBe(6);
    expect(flagArt("kaserne", 7, 0, SHEET)!.key).toBe("kaserne_fahne");
    expect(flagArt("haus", 7, 0, SHEET)).toBeNull();
    expect(flagArt("turm", 7, 0, { has: () => false, frames: () => 1 })).toBeNull();
  });

  it("Lebensblatt: Sitzen, Plaudern, Rennen (ohne Last), Zusammenzucken nach Treffer; Tote und Lastträger nicht", () => {
    const an = fanims.get("tageloehner_leben")!;
    expect(lifeFrame(unit({ anim: "sitzen" }), 0, "tageloehner", an)).toEqual({ key: "tageloehner_leben", frame: an.sitzen[0] });
    expect(lifeFrame(unit({ anim: "plaudern" }), 0, "tageloehner", an)!.frame).toBeGreaterThanOrEqual(an.plaudern[0]);
    const r = lifeFrame(unit({ anim: "gehen", run: true, animT: 0.3 }), 0, "tageloehner", an)!;
    expect(r.frame).toBeGreaterThanOrEqual(an.rennen[0]);
    expect(r.frame).toBeLessThan(an.rennen[0] + an.rennen[1]);
    expect(lifeFrame(unit({ anim: "gehen", run: true, carry: "holz" }), 0, "tageloehner", an)).toBeNull();
    expect(lifeFrame(unit({ anim: "gehen" }), 0, "tageloehner", an)).toBeNull();
    const hit = lifeFrame(unit({ anim: "angriff", hitT: 100 }), 101, "tageloehner", an)!;
    expect(hit.frame).toBeGreaterThanOrEqual(an.treffer[0]);
    expect(lifeFrame(unit({ anim: "angriff", hitT: 100 }), 100 + LIFE.hitSeconds * TICKS_PER_SECOND, "tageloehner", an)).toBeNull();
    expect(lifeFrame(unit({ anim: "sitzen", dead: true }), 0, "tageloehner", an)).toBeNull();
    expect(lifeFrame(unit({ anim: "sitzen" }), 0, "holzfaeller", an)).toBeNull();
  });

  it("Gefallene liegen erst voll da und blenden in den letzten Sekunden aus", () => {
    expect(corpseAlpha(unit({ dead: true, anim: "sterben" }))).toBe(1);
    expect(corpseAlpha(unit({ dead: true, anim: "tot", animT: 1 }))).toBe(1);
    const mid = corpseAlpha(unit({ dead: true, anim: "tot", animT: TUNING.corpseSeconds - LIFE.corpseFadeSeconds / 2 }));
    expect(mid).toBeCloseTo(0.5, 5);
    expect(corpseAlpha(unit({ dead: true, anim: "tot", animT: TUNING.corpseSeconds }))).toBe(0);
  });
});

describe("Tiere in der Objektebene", () => {
  it("Tierbilder: Animation aus dem Blatt, Sterben einmal durch, Rennen ohne eigene Bilder fällt auf Gehen zurück", () => {
    const an = fanims.get("reh")!;
    const a = { id: 9, key: "reh", anim: "sterben", animT: 5 } as Animal;
    expect(animalFrame(a, an)).toBe(an.sterben[0] + an.sterben[1] - 1);
    const g = animalFrame({ ...a, anim: "grasen", animT: 0.7 } as Animal, an);
    expect(g).toBeGreaterThanOrEqual(an.grasen[0]);
    expect(g).toBeLessThan(an.grasen[0] + an.grasen[1]);
    const noRun = { ...an, rennen: undefined } as unknown as Record<string, [number, number]>;
    const r = animalFrame({ ...a, anim: "rennen", animT: 0.2 } as Animal, noRun);
    expect(r).toBeGreaterThanOrEqual(an.gehen[0]);
  });

  it("in allen vier Drehungen: jedes Tier ein Objekt, Blickrichtung dreht mit, Bäume im Wind, Kaserne mit Fahnen", () => {
    const g = createGame({ seed: 1, raids: false });
    buildNow(g, "kaserne", 40, 40, 0);
    const n = g.state.animals!.length;
    for (const r of [0, 1, 2, 3] as Rot[]) {
      const bs = fakeBuildingSheet();
      const layer = new ObjectLayer(bs, fakeFigureSheet());
      layer.update(g.state, r, 1, VIEW, OPT);
      const without = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
      without.update({ ...g.state, animals: [] } as SimState, r, 1, VIEW, OPT);
      expect(layer.stats.items - without.stats.items).toBe(n);
      expect(bs.calls).toContain("baum_wind:body");
      expect(bs.calls).toContain("kaserne_fahne:body");
      expect(bs.calls).not.toContain("kaserne:body");
    }
    // ein Tier, das nach Welt-Osten schaut, zeigt in jeder Drehung eine andere der acht Ansichten
    const dirs = [0, 1, 2, 3].map((r) => figureDir(1, 0, r));
    expect(new Set(dirs).size).toBe(4);
    // jede Vierteldrehung verschiebt die Blickrichtung um zwei der acht Richtungen, immer in dieselbe Richtung
    const step = (dirs[1] - dirs[0] + 8) % 8;
    expect([2, 6]).toContain(step);
    for (let r = 1; r < 4; r++) expect((dirs[r] - dirs[r - 1] + 8) % 8).toBe(step);
  });

  it("ohne Tierbilder im Blatt: Tiere fehlen, alles andere wird gezeichnet (kein Ausnahmefehler)", () => {
    const g = createGame({ seed: 1, raids: false });
    spawn(g, "speer", 0, 30, 30);
    const fs = fakeFigureSheet();
    const has = fs.has.bind(fs);
    (fs as unknown as { has: (k: string) => boolean }).has = (k: string) => !Object.values(ANIMALS).some((a) => a.sprite === k) && has(k);
    const layer = new ObjectLayer(fakeBuildingSheet(), fs);
    expect(() => layer.update(g.state, 0, 1, VIEW, OPT)).not.toThrow();
    expect(layer.units.length).toBeGreaterThan(0);
  });
});

describe("Tageslicht", () => {
  it("Mittag ungefärbt, Nacht gedämpft bläulich, Morgen und Abend warm; Übergänge stetig", () => {
    const D = DAYLIGHT.daySeconds * TICKS_PER_SECOND;
    const at = (f: number) => Math.round((((f - DAYLIGHT.start + 1) % 1) * D));
    expect(daylightTint(at(0.5))).toBe(0xffffff);
    const night = daylightTint(at(0.05));
    expect(night & 255).toBeGreaterThan((night >> 16) & 255); // blau > rot
    expect((night >> 16) & 255).toBeGreaterThanOrEqual(0x90); // hell genug zum Spielen
    const eve = daylightTint(at(0.76));
    expect((eve >> 16) & 255).toBeGreaterThan(eve & 255); // rot > blau
    let prev = daylightTint(0);
    for (let t = 1; t < D; t += 37) {
      const c = daylightTint(t);
      for (const sh of [0, 8, 16]) expect(Math.abs(((c >> sh) & 255) - ((prev >> sh) & 255))).toBeLessThanOrEqual(6);
      prev = c;
    }
    expect(dayName(at(0.5))).toBe("Mittag");
    expect(dayName(at(0.05))).toBe("Nacht");
  });
});
