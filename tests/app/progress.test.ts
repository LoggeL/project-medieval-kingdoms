import { describe, expect, it } from "vitest";
import { LoadProgress, PHASE_CAP, TipRotation, phaseOfAsset, tipDuration } from "../../src/app/progress";

const PHASES = [
  { id: "a", label: "A lädt", weight: 1 },
  { id: "b", label: "B lädt", weight: 3 },
];

describe("Ladefortschritt", () => {
  it("beginnt bei 0 und endet bei 1, wenn alle Abschnitte fertig sind", () => {
    const p = new LoadProgress(PHASES);
    expect(p.fraction()).toBe(0);
    expect(p.complete()).toBe(false);
    p.finish("a");
    expect(p.fraction()).toBeCloseTo(0.25);
    p.finish("b");
    expect(p.fraction()).toBe(1);
    expect(p.complete()).toBe(true);
    expect(p.label()).toBe("Bereit");
  });

  it("zählt nur geladene Dateien, gewichtet, und bleibt vor dem Abschluss unter 100 %", () => {
    const p = new LoadProgress(PHASES);
    p.add("b", 4);
    expect(p.fraction()).toBe(0); // angemeldet ist nicht geladen: kein Scheinfortschritt
    p.tick("b", 2);
    expect(p.fraction()).toBeCloseTo((3 * 0.5) / 4);
    p.tick("b", 2);
    expect(p.phaseFraction("b")).toBe(PHASE_CAP);
    p.finish("b");
    expect(p.phaseFraction("b")).toBe(1);
  });

  it("läuft nie rückwärts, auch wenn ein Abschnitt neue Dateien entdeckt", () => {
    const p = new LoadProgress(PHASES);
    p.add("b", 1);
    p.tick("b", 1); // sheet.json gelesen
    const f1 = p.fraction();
    p.add("b", 20); // jetzt erst die Bilder bekannt
    expect(p.fraction()).toBe(f1);
    p.tick("b", 20);
    expect(p.fraction()).toBeGreaterThanOrEqual(f1);
  });

  it("zählt nicht mehr fertige als angemeldete Dateien", () => {
    const p = new LoadProgress(PHASES);
    p.add("a", 1);
    p.tick("a", 5);
    expect(p.phaseFraction("a")).toBe(PHASE_CAP);
  });

  it("zeigt den Text des laufenden Abschnitts", () => {
    const p = new LoadProgress(PHASES);
    expect(p.label()).toBe("A lädt");
    p.begin("b");
    p.finish("a");
    expect(p.label()).toBe("B lädt");
  });

  it("merkt sich einen Fehler", () => {
    const p = new LoadProgress(PHASES);
    expect(p.error).toBeNull();
    p.fail("WebGL fehlt");
    expect(p.error).toBe("WebGL fehlt");
  });

  it("lehnt unbekannte Abschnitte ab", () => {
    const p = new LoadProgress(PHASES);
    expect(() => p.finish("x")).toThrow();
  });

  it("ordnet Dateien der Sprite-Blätter ihren Abschnitten zu", () => {
    expect(phaseOfAsset("buildings/vorgerendert/sheet.json")).toBe("gebaeude");
    expect(phaseOfAsset("figures/vorgerendert/atlas.png")).toBe("figuren");
    expect(phaseOfAsset("terrain/vorgerendert/terrain.png")).toBe("gelaende");
    expect(phaseOfAsset("ui/holz_kachel.png")).toBeNull();
  });
});

describe("Tippwechsel", () => {
  it("zeigt jeden Tipp einmal, bevor sich einer wiederholt", () => {
    const r = new TipRotation(7, () => 0.42);
    const first = Array.from({ length: 7 }, () => r.next());
    expect(new Set(first).size).toBe(7);
  });

  it("zeigt nie zweimal denselben Tipp hintereinander, auch über Durchgänge hinweg", () => {
    let seed = 1;
    const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (const n of [2, 3, 5, 25]) {
      const r = new TipRotation(n, rand);
      let last = -1;
      for (let i = 0; i < 500; i++) {
        const k = r.next();
        expect(k).not.toBe(last);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThan(n);
        last = k;
      }
    }
  });

  it("kommt mit einem einzigen Tipp aus und lehnt null Tipps ab", () => {
    const r = new TipRotation(1);
    expect(r.next()).toBe(0);
    expect(r.next()).toBe(0);
    expect(() => new TipRotation(0)).toThrow();
  });

  it("wechselt alle 6–8 Sekunden", () => {
    expect(tipDuration("kurz")).toBe(6000);
    expect(tipDuration("x".repeat(500))).toBe(8000);
    const mid = tipDuration("x".repeat(100));
    expect(mid).toBeGreaterThanOrEqual(6000);
    expect(mid).toBeLessThanOrEqual(8000);
  });
});
