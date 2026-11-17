import { describe, expect, it } from "vitest";
import type { UnitKey } from "../../src/data";
import { createGame, loadGame } from "../../src/sim";
import { run, spawn } from "../../src/sim/debug";
import { TPS } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

describe("Speichern und Laden", () => {
  it("ergibt identische Folge-Ticks", () => {
    const g = createGame({ seed: 3 });
    const l = lagerOf(g);
    const [hx, hy] = findSpot(g, "holzfaeller", 17, 30);
    expect(g.dispatch({ t: "bauen", key: "holzfaeller", x: hx, y: hy, o: 0 }).ok).toBe(true);
    const [qx, qy] = findSpot(g, "steinbruch", 36, 17);
    expect(g.dispatch({ t: "bauen", key: "steinbruch", x: qx, y: qy, o: 1 }).ok).toBe(true);
    const [kx, ky] = findSpot(g, "kaserne", l.x + 6, l.y - 5);
    const k = g.dispatch({ t: "bauen", key: "kaserne", x: kx, y: ky, o: 2 });
    expect(k.ok).toBe(true);
    run(g, 100 * TPS);
    g.dispatch({ t: "rekrutieren", building: k.ids![0], unit: "bogen" });
    g.dispatch({ t: "mauer", x0: l.x + 10, y0: l.y - 2, x1: l.x + 10, y1: l.y + 6 });
    run(g, 30 * TPS);
    g.dispatch({ t: "ueberfall" });
    run(g, 15 * TPS);
    expect(g.state.raid.active).toBe(true);

    const json = g.save();
    const h = loadGame(json);
    expect(h.save()).toBe(json);
    for (let i = 0; i < 12; i++) {
      run(g, 50); run(h, 50);
      expect(h.save()).toBe(g.save());
    }
    expect(g.state.tick).toBe(h.state.tick);
  });

  it("lädt mitten im Gefecht mit Geschossen und Toten", () => {
    const g = createGame({ scenario: "leer", size: 32, seed: 9 });
    const keys: UnitKey[] = ["bogen", "speer", "schwert"];
    for (let i = 0; i < 9; i++) { spawn(g, keys[i % 3], 0, 8, 8 + i); spawn(g, keys[(i + 1) % 3], 1, 14, 8 + i); }
    run(g, 30 * TPS, () => g.state.units.some((u) => u.dead) && g.state.projectiles.length > 0);
    expect(g.state.units.some((u) => u.dead)).toBe(true);
    expect(g.state.projectiles.length).toBeGreaterThan(0);
    const h = loadGame(g.save());
    run(g, 20 * TPS); run(h, 20 * TPS);
    expect(h.save()).toBe(g.save());
  });
});
