/**
 * Darstellung der Verarbeitung (ADR 0011): Mühlenflügel laufen nur bei laufendem Arbeitsgang, die Bäckerei raucht nur
 * beim Backen, Eingangspuffer und Ausgabestapel stehen als Warenstapel am Gebäude.
 */
import { describe, expect, it } from "vitest";
import { ObjectLayer } from "../../src/render/scene";
import { createGame } from "../../src/sim";
import { buildNow, run } from "../../src/sim/debug";
import { fakeBuildingSheet, fakeFigureSheet } from "./fakes";

const ALL = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
const opt = () => ({ selectedUnits: new Set<number>(), danger: null, highlight: null, ghosts: [] });

describe("Verarbeitung in der Darstellung", () => {
  it("die Mühlenflügel drehen sich nur, solange gemahlen wird", () => {
    const g = createGame({ scenario: "leer", size: 32, seed: 2 });
    const m = buildNow(g, "muehle", 12, 12, 0);
    const layer = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
    const frame = () => layer.hits.find((h) => h.kind === "building" && h.id === m.id)!.frame;
    const frames: number[] = [];
    for (let i = 0; i < 6; i++) { run(g, 7); layer.update(g.state, 0, 1, ALL, opt()); frames.push(frame()); }
    expect(new Set(frames).size).toBe(1); // steht still
    m.proc!.busy = true; // ohne Müller bleibt der Arbeitsgang stehen, wie er ist
    const turning: number[] = [];
    // 6 Bilder je Sekunde, eine Probe alle 3 Ticks (0,15 s): fast jede Probe zeigt die nächste Flügelstellung
    for (let i = 0; i < 8; i++) { run(g, 3); layer.update(g.state, 0, 1, ALL, opt()); turning.push(frame()); }
    expect(new Set(turning).size).toBeGreaterThan(3);
    m.proc!.busy = false;
    const after: number[] = [];
    for (let i = 0; i < 4; i++) { run(g, 7); layer.update(g.state, 0, 1, ALL, opt()); after.push(frame()); }
    expect(new Set(after).size).toBe(1);
    expect(after[0]).toBe(turning[turning.length - 1]); // bleibt stehen, wo er war, kein Sprung
  });

  it("die Bäckerei raucht nur beim Backen", () => {
    const g = createGame({ scenario: "leer", size: 32, seed: 2 });
    const b = buildNow(g, "baeckerei", 12, 12, 1);
    const layer = new ObjectLayer(fakeBuildingSheet(), fakeFigureSheet());
    layer.update(g.state, 0, 1, ALL, opt());
    expect(layer.emitters.length).toBe(0);
    b.proc!.busy = true;
    layer.update(g.state, 0, 1, ALL, opt());
    expect(layer.emitters.length).toBe(1);
    expect(layer.emitters[0].seed).toBe(b.id * 7);
  });

  it("Eingangspuffer und Ausgabestapel stehen als Warenstapel am Gebäude", () => {
    const g = createGame({ scenario: "leer", size: 32, seed: 2 });
    const m = buildNow(g, "muehle", 12, 12, 2);
    const sheet = fakeBuildingSheet();
    const layer = new ObjectLayer(sheet, fakeFigureSheet());
    layer.update(g.state, 0, 1, ALL, opt());
    expect(sheet.calls.some((c) => c.startsWith("stapel_getreide") || c.startsWith("stapel_mehl"))).toBe(false);
    m.proc!.in.getreide = 4;
    m.proc!.out.mehl = 2;
    sheet.calls.length = 0;
    layer.update(g.state, 0, 1, ALL, opt());
    expect(sheet.calls).toContain("stapel_getreide:body");
    expect(sheet.calls).toContain("stapel_mehl:body");
  });
});
