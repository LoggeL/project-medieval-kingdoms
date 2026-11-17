import { describe, expect, it } from "vitest";
import { createGame } from "../../src/sim";
import { buildNow, run, spawn, stockUp } from "../../src/sim/debug";
import { TPS, type SUnit } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

describe("Karte", () => {
  it("ist deterministisch aus dem Seed", () => {
    const a = createGame({ seed: 5 }), b = createGame({ seed: 5 }), c = createGame({ seed: 6 });
    const dump = (g: typeof a) => JSON.stringify([g.state.tiles, g.state.trees, g.state.rocks, g.state.buildings, g.state.units]);
    expect(dump(a)).toBe(dump(b));
    expect(dump(a)).not.toBe(dump(c));
    run(a, 200); run(b, 200);
    expect(a.save()).toBe(b.save());
  });

  it("hat Wald, Felsfeld, Wasser mit Furt, Wege und ein gefülltes Startlager", () => {
    for (const seed of [1, 2, 3]) {
      const g = createGame({ seed });
      const s = g.state;
      expect(s.w).toBe(64);
      expect(s.trees.length).toBeGreaterThan(150);
      expect(s.trees.some((t) => t.kind === "tanne") && s.trees.some((t) => t.kind === "baum")).toBe(true);
      expect(s.rocks.length).toBeGreaterThanOrEqual(8);
      for (const r of s.rocks) {
        // Steinbrocken 8–16 Blöcke, Erzbrocken (ADR 0014) 18–28 Erz
        const [lo, hi] = r.kind === "erz" ? [18, 28] : [8, 16];
        expect(r.amount).toBeGreaterThanOrEqual(lo); expect(r.amount).toBeLessThanOrEqual(hi);
        expect(s.tiles[r.y * s.w + r.x].terrain).toBe("fels");
      }
      const count = (t: string) => s.tiles.filter((x) => x.terrain === t).length;
      expect(count("wasser")).toBeGreaterThan(100);
      expect(count("erde")).toBeGreaterThan(64);
      // Furt: Angreifer vom Ostrand erreichen das Lager zu Fuß
      const w = (g as any).world;
      const [sx, sy] = w.meta.raidSpawn;
      const l = lagerOf(g);
      const [ex, ey] = [l.x + 1, l.y + 3];
      expect(w.nav.comp[1][w.nav.node(0, sx, sy)]).toBe(w.nav.comp[1][w.nav.node(0, ex, ey)]);
      // Startbestand, je Ware eigener Slot
      expect(s.stock).toMatchObject({ holz: 40, stein: 36, speer: 3, schwert: 2, bogen: 4 }); // Stein 30 → 36: Turm vor der ersten Welle bezahlbar
      for (const slot of l.slots) if (slot.good) expect(slot.amount).toBeGreaterThan(0);
      expect(s.units.filter((u) => u.key === "tageloehner")).toHaveLength(8);
      expect(s.gold).toBe(150);
    }
  });
});

describe("Holzfäller", () => {
  it("fällt Bäume, legt Stämme in den Hof, Träger bringen sie sichtbar ins Lager", () => {
    const g = createGame({ seed: 1, raids: false });
    const [x, y] = findSpot(g, "holzfaeller", 17, 30);
    const r = g.dispatch({ t: "bauen", key: "holzfaeller", x, y, o: 0 });
    expect(r.ok).toBe(true);
    const id = r.ids![0];
    const hut = () => g.state.buildings.find((b) => b.id === id)!;
    let sawFalling = false, sawLying = false, sawCutterCarry = false, sawHauler = false, maxYard = 0, built = -1;
    run(g, 240 * TPS, (t) => {
      const s = g.state;
      if (hut().built >= 1 && built < 0) built = t;
      sawFalling ||= s.trees.some((tr) => tr.state === "faellt");
      sawLying ||= s.trees.some((tr) => tr.state === "liegt");
      sawCutterCarry ||= s.units.some((u) => u.key === "holzfaeller" && u.carry === "holz");
      sawHauler ||= s.units.some((u) => u.key === "tageloehner" && u.carry === "holz" && (u as any).ai.job?.k === "haul");
      maxYard = Math.max(maxYard, hut().output!.amount);
    });
    expect(built).toBeGreaterThan(0);
    expect(sawFalling && sawLying).toBe(true);
    expect(sawCutterCarry).toBe(true);
    expect(maxYard).toBeGreaterThan(0);
    expect(sawHauler).toBe(true);
    expect(g.state.trees.some((tr) => tr.state === "stumpf")).toBe(true);
    // 40 Start − 6 Baukosten, danach muss Holz dazugekommen sein
    expect(g.state.stock.holz).toBeGreaterThan(34);
  });

  it("hört auf, wenn das Lager voll ist, und macht mit einem neuen Lager weiter", () => {
    const g = createGame({ seed: 1, raids: false });
    stockUp(g, "eisen", 20); // letzter freier Slot belegt
    stockUp(g, "holz", 100); // Holz-Slots randvoll (2 × 20)
    expect(g.state.stock.holz).toBe(40);
    const [x, y] = findSpot(g, "holzfaeller", 17, 30);
    const hut = buildNow(g, "holzfaeller", x, y, 0);
    run(g, 200 * TPS);
    expect(hut.output!.amount).toBe(4); // Hof voll
    expect(g.state.stock.holz).toBe(40);
    const cutter = g.state.units.find((u) => u.home === hut.id)! as SUnit;
    expect(cutter.carry).toBe("holz"); // wartet sichtbar mit dem nächsten Stamm
    const before = cutter.ai.job && JSON.stringify(cutter.ai.job);
    run(g, 20 * TPS);
    expect(JSON.stringify(cutter.ai.job)).toBe(before); // keine Arbeit mehr
    expect(g.state.messages.some((m) => m.text.includes("Lager ist voll"))).toBe(true);
    // Zweites Lager: Träger holen den Hof leer, der Holzfäller arbeitet weiter
    const l = lagerOf(g);
    const [lx, ly] = findSpot(g, "lager", l.x + 6, l.y);
    buildNow(g, "lager", lx, ly, 0);
    run(g, 120 * TPS);
    expect(g.state.stock.holz).toBeGreaterThan(44);
  });
});

describe("Steinbruch", () => {
  it("baut Fels ab und bringt Stein ins Lager", () => {
    const g = createGame({ seed: 1, raids: false });
    const w = (g as any).world;
    // Platz am Südrand des Felsfelds
    const [qx, qy] = findSpot(g, "steinbruch", Math.round(w.s.w * 0.56), Math.round(w.s.h * 0.27));
    const q = buildNow(g, "steinbruch", qx, qy, 0);
    const rockSum = () => g.state.rocks.reduce((a, r) => a + r.amount, 0);
    const before = rockSum();
    let sawMason = false;
    run(g, 240 * TPS, () => { sawMason ||= g.state.units.some((u) => u.key === "steinmetz" && u.carry === "stein" && u.anim === "gehen"); });
    expect(g.state.units.filter((u) => u.home === q.id)).toHaveLength(2);
    expect(sawMason).toBe(true);
    expect(rockSum()).toBeLessThan(before - 4);
    expect(g.state.stock.stein).toBeGreaterThan(36);
  });
});

describe("Baustelle", () => {
  it("wird durch einzelne Materiallieferungen fertig", () => {
    const g = createGame({ seed: 2, raids: false });
    const l = lagerOf(g);
    const [x, y] = findSpot(g, "haus", l.x + 6, l.y - 4);
    const r = g.dispatch({ t: "bauen", key: "haus", x, y, o: 0 });
    expect(r.ok).toBe(true);
    const site = g.state.buildings.find((b) => b.id === r.ids![0])!;
    expect(site.built).toBe(0);
    expect(site.needs).toEqual({ holz: 8 });
    expect(g.canPlace("kaserne", 0, 0, 0).ok).toBe(false);
    let maxCarriers = 0, sawPartial = false;
    run(g, 120 * TPS, () => {
      maxCarriers = Math.max(maxCarriers, g.state.units.filter((u) => u.carry === "holz" && (u as any).ai.job?.k === "supply").length);
      if ((site.site.holz ?? 0) > 0 && (site.needs.holz ?? 0) > 0) sawPartial = true;
      return site.built >= 1;
    });
    expect(sawPartial).toBe(true);
    expect(maxCarriers).toBeGreaterThan(0);
    expect(site.built).toBe(1);
    expect(g.state.stock.holz).toBe(32);
    run(g, 2);
    expect(g.state.housing).toBe(14);
  });

  it("prüft Platzierungsregeln", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    expect(g.canPlace("haus", l.x, l.y, 0).reason).toBe("Hier steht schon etwas");
    const water = g.state.tiles.findIndex((t) => t.terrain === "wasser");
    expect(g.canPlace("haus", water % 64, Math.floor(water / 64), 0).ok).toBe(false);
    // Steinbruch nur am Fels, Holzfäller nur am Wald
    expect(g.canPlace("steinbruch", l.x + 6, l.y + 6, 0).ok).toBe(false);
    expect(g.canPlace("holzfaeller", l.x + 6, l.y + 6, 0).reason).toBe("Zu wenige Bäume in der Nähe");
    // Treppe nur an einer Mauer
    expect(g.canPlace("treppe", l.x + 8, l.y + 6, 0).ok).toBe(false);
  });

  it("zieht Mauern als Linie, jedes Stück eine Baustelle, Tor ersetzt ein Mauerstück", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    const w = (g as any).world;
    buildNow(g, "lager", 4, 4, 0);
    for (let i = 0; i < 6; i++) spawn(g, "tageloehner", 0, 6 + i, 9);
    stockUp(g, "stein", 100); stockUp(g, "holz", 40);
    const p = g.wallPath(10, 10, 15, 13);
    expect(p.tiles).toHaveLength(9); // L-Form: 6 entlang x, 3 entlang y
    expect(p.ok).toBe(true);
    const r = g.dispatch({ t: "mauer", x0: 10, y0: 10, x1: 15, y1: 13 });
    expect(r.ids).toHaveLength(9);
    const walls = g.state.buildings.filter((b) => b.key === "mauer");
    const at = (x: number, y: number) => walls.find((b) => b.x === x && b.y === y)!;
    expect(at(12, 10).wallMask).toBe(0b1010); // O + W
    expect(at(15, 10).wallMask).toBe(0b1100); // W + S (Ecke)
    const gate = g.dispatch({ t: "bauen", key: "tor", x: 12, y: 10, o: 0 });
    expect(gate.ok).toBe(true);
    expect(g.state.buildings.filter((b) => b.key === "mauer")).toHaveLength(8);
    const tor = g.state.buildings.find((b) => b.key === "tor")!;
    expect(tor.wallMask).toBe(0b1010);
    run(g, 240 * TPS, () => g.state.buildings.every((b) => b.built >= 1));
    expect(g.state.buildings.every((b) => b.built >= 1)).toBe(true);
    expect(g.walkLayerAt(12, 10)).toBe(1);
    expect(w.nav.walk[0][10 * 40 + 12]).toBe(2); // Tor: am Boden nur für Team 0 offen
    // Abriss gibt die Hälfte zurück
    const stone = g.state.stock.stein;
    g.dispatch({ t: "abreissen", id: at(10, 10).id });
    run(g, 1);
    expect(g.state.stock.stein).toBe(stone + 1);
  });
});
