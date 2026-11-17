import { describe, expect, it } from "vitest";
import { DepthSorter, relation, type DepthItem } from "../../src/render/depth";
import { toView, type Rot } from "../../src/sim/geom";
import { worldToScreen } from "../../src/render/iso";

// MK_ZEITGRENZEN=aus (Docker-Build) prüft nur die Funktion, nicht die Millisekunden, siehe tests/sim/perf.test.ts.
const zeitgrenzen = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MK_ZEITGRENZEN !== "aus";

const W = 32, H = 32;

/** Objekt aus Welt-Rechteck (Tiles) mit einem hohen Bildrechteck darüber. */
function item(x: number, y: number, w: number, h: number, r: Rot, opts: Partial<DepthItem> = {}): DepthItem {
  const [a, b] = toView(x, y, r, W, H), [c, d] = toView(x + w, y + h, r, W, H);
  const u0 = Math.min(a, c), u1 = Math.max(a, c), v0 = Math.min(b, d), v1 = Math.max(b, d);
  const [X, Y] = worldToScreen(x + w / 2, y + h / 2, 0, r, W, H);
  const half = (w + h) * 32;
  return { u0, u1, v0, v1, x0: X - half, x1: X + half, y0: Y - 160, y1: Y + (w + h) * 16, flat: false, fig: false, bias: 0, ...opts };
}

describe("Tiefensortierung", () => {
  it("zeichnet hintere Objekte zuerst, in jeder Drehung", () => {
    for (const r of [0, 1, 2, 3] as Rot[]) {
      // langes Gebäude (4 × 1) und eine Figur direkt davor (in Welt +y bei r = 0)
      const house = item(10, 10, 4, 1, r);
      const front = item(13, 12, 0.4, 0.4, r, { fig: true });
      const back = item(11, 8, 0.4, 0.4, r, { fig: true });
      const order = new DepthSorter().sort([front, house, back]);
      const pos = (i: number) => order.indexOf(i);
      // was hinten liegt, hängt von der Drehung ab: über die Ansichtsboxen prüfen
      const behind = (p: DepthItem, q: DepthItem) => p.u1 <= q.u0 || p.v1 <= q.v0;
      if (behind(house, front)) expect(pos(1)).toBeLessThan(pos(0)); else expect(pos(0)).toBeLessThan(pos(1));
      if (behind(back, house)) expect(pos(2)).toBeLessThan(pos(1)); else expect(pos(1)).toBeLessThan(pos(2));
    }
  });

  it("großes Gebäude gegen kleine Objekte entlang seiner Länge (klassischer Iso-Fehler)", () => {
    // Bei r = 0 liegt ein Baum rechts vom Ende eines langen Gebäudes, aber mit größerem u + v als dessen Mitte.
    const hall = item(4, 4, 8, 2, 0);
    const tree = item(10, 7, 1, 1, 0); // vor dem Gebäude
    const tree2 = item(13, 3, 1, 1, 0); // rechts hinter dem Ende: u0 ≥ hall.u1 → Gebäude zuerst
    const order = new DepthSorter().sort([tree, tree2, hall]);
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(0));
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(1));
  });

  it("Lagerboden kommt vor den Stapeln und Figuren darauf", () => {
    const floor = item(5, 5, 3, 3, 0, { flat: true });
    const stack = item(6, 6, 1, 1, 0);
    const fig = item(7.3, 5.2, 0.4, 0.4, 0, { fig: true });
    const order = new DepthSorter().sort([stack, fig, floor]);
    expect(order[0]).toBe(2);
    expect(relation(floor, stack)).toBe(1);
  });

  it("vorderer Lagerzaun (cover) kommt nach Boden, Stapeln und Figuren im Hof, aber vor Objekten davor", () => {
    for (const r of [0, 1, 2, 3] as Rot[]) {
      const floor = item(5, 5, 3, 3, r, { flat: true });
      const stack = item(7, 7, 1, 1, r);
      const fig = item(7.3, 7.6, 0.4, 0.4, r, { fig: true });
      const front = item(5, 5, 3, 3, r, { cover: true });
      const before = item(5, 9, 1, 1, r); // ganz außerhalb des Lagers
      const order = new DepthSorter().sort([front, stack, fig, floor, before]);
      const pos = (i: number) => order.indexOf(i);
      expect(pos(3)).toBeLessThan(pos(1));
      expect(pos(1)).toBeLessThan(pos(0));
      expect(pos(2)).toBeLessThan(pos(0));
      const behind = (p: DepthItem, q: DepthItem) => p.u1 <= q.u0 || p.v1 <= q.v0;
      if (behind(front, before)) expect(pos(0)).toBeLessThan(pos(4)); else expect(pos(4)).toBeLessThan(pos(0));
    }
  });

  it("bleibt bei vielen Objekten schnell und vollständig", () => {
    const items: DepthItem[] = [];
    for (let i = 0; i < 600; i++) items.push(item((i * 7) % 30, (i * 13) % 30, 0.4, 0.4, 0, { fig: i % 2 === 0 }));
    const t0 = performance.now();
    const order = new DepthSorter().sort(items);
    expect(new Set(order).size).toBe(600);
    if (zeitgrenzen) expect(performance.now() - t0).toBeLessThan(200);
  });
});
