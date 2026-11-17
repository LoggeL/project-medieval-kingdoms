/**
 * Zusammenführung der Befehle (ADR 0018) mit der lebendigen Welt (ADR 0016) und der Militärwirtschaft (ADR 0014):
 * - Rückzug = Rennen: Soldaten auf dem Rückzug tragen dieselbe Markierung `run` wie fliehende Tagelöhner und zeigen damit
 *   die Rennbilder des Lebensblatts; danach (am Ziel oder bei einem anderen Befehl) gehen sie wieder.
 * - Tasten: Die Befehle der Soldaten behalten J K L, die Kaserne bildet auf U I O Ü Ä # aus.
 */
import { describe, expect, it } from "vitest";
import { LIFE_FIGURES } from "../../src/data";
import { BUTTON_KEYS, TRAIN_KEYS, keyLabel } from "../../src/data/hotkeys";
import { createGame, loadGame } from "../../src/sim";
import { entrance } from "../../src/sim/geom";
import { run, spawn } from "../../src/sim/debug";
import { seatOf } from "../../src/sim/research";
import { TPS } from "../../src/sim/world";
import { lifeFrame } from "../../src/render/life";

const RUN_ANIMS: Record<string, [number, number]> = { stehen: [0, 1], rennen: [1, 8], treffer: [9, 2] };

describe("Rückzug rennt (ADR 0016 + 0018)", () => {
  it("Rennbilder während des Rückzugs, gespeichert, und wieder Gehen am Ziel bzw. bei neuem Befehl", () => {
    const g = createGame({ seed: 1, raids: false });
    const seat = seatOf(g.state)!;
    const [ex, ey] = entrance(seat.key, seat.x, seat.y, seat.o);
    const us = [spawn(g, "speer", 0, ex + 10, ey + 1), spawn(g, "schwert", 0, ex + 11, ey + 1)];
    expect(g.dispatch({ t: "rueckzug", units: us.map((u) => u.id) }).ok).toBe(true);
    run(g, 1 * TPS);
    for (const u of us) {
      expect(u.order.t).toBe("retreat");
      expect(u.run).toBe(true);
      expect(u.anim).toBe("gehen");
      // Darstellung: Rennbilder des Lebensblatts statt der Gehbilder
      const f = lifeFrame(u, g.state.tick, u.key, RUN_ANIMS);
      expect(f?.key).toBe(LIFE_FIGURES[u.key]);
      expect(f!.frame).toBeGreaterThanOrEqual(RUN_ANIMS.rennen[0]);
      expect(f!.frame).toBeLessThan(RUN_ANIMS.rennen[0] + RUN_ANIMS.rennen[1]);
    }
    // Speichern mitten im Rückzug: die Markierung bleibt
    const g2 = loadGame(g.save());
    for (const u of us) expect(g2.state.units.find((x) => x.id === u.id)!.run).toBe(true);
    // neuer Befehl beendet das Rennen
    g.dispatch({ t: "bewegen", units: [us[1].id], x: ex + 12, y: ey + 3 });
    run(g, 2);
    expect(us[1].run).toBeUndefined();
    // am Ziel angekommen: wieder normal
    run(g, 60 * TPS, () => us[0].order.t !== "retreat");
    run(g, 2);
    expect(us[0].order.t).toBe("idle");
    expect(us[0].run).toBeUndefined();
  });
});

describe("Tasten nach der Zusammenführung", () => {
  it("Befehle J K L, Ausbilden U I O Ü Ä # ohne Überschneidung", () => {
    const cmd = [...BUTTON_KEYS.patrouille, ...BUTTON_KEYS.angriffsbewegung, ...BUTTON_KEYS.formation, ...BUTTON_KEYS.haltung, ...BUTTON_KEYS.rueckzug];
    for (const c of TRAIN_KEYS) expect(cmd).not.toContain(c);
    expect(TRAIN_KEYS.map((c) => keyLabel(c)).join(" ")).toBe("U I O Ü Ä #");
  });
});
