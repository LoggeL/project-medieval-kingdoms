/**
 * Sprecheransagen: Für jede VoiceKey aus src/data/audio.ts gibt es eine Spielsituation, in der die Simulation sie
 * an eine Meldung (Message.voice) oder an ein Befehlsergebnis (CommandResult.voice) hängt.
 */
import { describe, expect, it } from "vitest";
import { VOICE, type VoiceKey } from "../../src/data/audio";
import { createGame } from "../../src/sim";
import { damageBuilding } from "../../src/sim/combat";
import { buildNow, run, spawn, stockUp } from "../../src/sim/debug";
import type { Simulation } from "../../src/sim/game";
import type { CommandResult } from "../../src/sim/types";
import { TPS, type World } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

const worldOf = (g: Simulation): World => (g as unknown as { world: World }).world;

describe("Sprecheransagen", () => {
  it("jede Ansage kann in der Simulation entstehen", () => {
    const heard = new Set<VoiceKey>();
    const where = new Map<VoiceKey, string>();
    const listen = (g: Simulation, label: string) => {
      for (const m of g.state.messages) if (m.voice) { heard.add(m.voice); if (!where.has(m.voice)) where.set(m.voice, `${label}: ${m.text}`); }
    };
    const result = (r: CommandResult, label: string) => {
      if (r.voice) { heard.add(r.voice); if (!where.has(r.voice)) where.set(r.voice, `${label}: ${r.reason ?? "ok"}`); }
      return r;
    };

    // Spielbeginn, Zuzug, Bau fertig, Rekrut ausgebildet, Waffe fehlt, Kosten, Platz
    {
      const g = createGame({ seed: 2, raids: false });
      listen(g, "Start");
      const l = lagerOf(g);
      const [x, y] = findSpot(g, "haus", l.x + 6, l.y - 4);
      g.dispatch({ t: "bauen", key: "haus", x, y, o: 0 });
      const [kx, ky] = findSpot(g, "kaserne", l.x + 6, l.y - 9);
      const k = buildNow(g, "kaserne", kx, ky, 0);
      result(g.dispatch({ t: "rekrutieren", building: k.id, unit: "bogen" }), "Rekrut");
      run(g, 90 * TPS, () => { listen(g, "Aufbau"); });
      expect(result(g.dispatch({ t: "bauen", key: "haus", x: l.x, y: l.y, o: 0 }), "Bauen auf Lager").voice).toBe("kein_platz");
      g.state.gold = 0;
      expect(result(g.dispatch({ t: "rekrutieren", building: k.id, unit: "speer" }), "Rekrut ohne Gold").voice).toBe("zu_teuer");
      g.state.gold = 500;
      for (let i = 0; i < 2; i++) g.dispatch({ t: "rekrutieren", building: k.id, unit: "schwert" });
      expect(result(g.dispatch({ t: "rekrutieren", building: k.id, unit: "schwert" }), "Rekrut ohne Waffe").voice).toBe("keine_waffe");
      // Kaserne kostet 20 Stein; ohne Stein zu teuer
      const w = worldOf(g);
      for (const b of w.s.buildings) for (const s of b.slots) if (s.good === "stein") { s.amount = 0; s.reserved = 0; s.incoming = 0; s.good = null; }
      const [k2x, k2y] = findSpot(g, "haus", l.x - 8, l.y + 6);
      expect(result(g.dispatch({ t: "bauen", key: "kaserne", x: k2x, y: k2y, o: 0 }), "Kaserne ohne Stein").voice).toBe("zu_teuer");
    }

    // Wohnraum voll
    {
      const g = createGame({ seed: 3, raids: false });
      for (let i = 0; i < 4; i++) spawn(g, "tageloehner", 0, 30 + i, 30);
      run(g, 25 * TPS);
      listen(g, "Wohnraum");
    }

    // Lager voll, Hof voll
    {
      const g = createGame({ seed: 1, raids: false });
      const [x, y] = findSpot(g, "holzfaeller", 17, 30);
      buildNow(g, "holzfaeller", x, y, 0);
      stockUp(g, "eisen", 200); // alle freien Slots belegen
      for (const s of lagerOf(g).slots) if (s.good === "holz") s.amount = 20;
      run(g, 150 * TPS, () => { listen(g, "Lager"); return heard.has("lager_voll"); });
    }

    // Hof voll, weil kein Tagelöhner zum Abholen kommt (Lager hat Platz)
    {
      const g = createGame({ seed: 1, raids: false });
      worldOf(g).meta.immigration = false;
      const [x, y] = findSpot(g, "holzfaeller", 17, 30);
      const h = buildNow(g, "holzfaeller", x, y, 0);
      run(g, 30 * TPS, () => h.workers.length > 0);
      for (const u of worldOf(g).s.units) if (u.key === "tageloehner") u.ai.noJob = 1e9;
      run(g, 400 * TPS, () => { listen(g, "Hof"); return heard.has("hof_voll"); });
    }

    // Material fehlt, Rohstoff leer, Mauer steht
    {
      const g = createGame({ scenario: "leer", size: 32 });
      buildNow(g, "lager", 2, 2, 0);
      for (let i = 0; i < 4; i++) spawn(g, "tageloehner", 0, 6 + i, 8);
      stockUp(g, "holz", 8); stockUp(g, "stein", 9);
      g.dispatch({ t: "bauen", key: "haus", x: 12, y: 12, o: 0 });
      result(g.dispatch({ t: "mauer", x0: 20, y0: 4, x1: 22, y1: 4 }), "Mauer");
      for (const b of g.state.buildings) for (const s of b.slots) if (s.good === "holz") { s.amount = 0; s.reserved = 0; s.good = null; }
      buildNow(g, "holzfaeller", 24, 24, 0); // keine Bäume auf der Wiese
      run(g, 60 * TPS, () => { listen(g, "Wiese"); });
    }

    // Überfall: Vorwarnung, Welle, Angriffe, Mauer fällt, Gebäude zerstört, Soldat fällt, abgewehrt, Stationieren
    {
      const g = createGame({ scenario: "leer", size: 40, raids: true });
      const w = worldOf(g);
      w.s.raid.next = w.s.tick + 30 * TPS + 2;
      run(g, 3);
      listen(g, "Vorwarnung");
      for (let x = 10; x <= 14; x++) buildNow(g, "mauer", x, 10, 0);
      buildNow(g, "treppe", 11, 11, 0);
      const house = buildNow(g, "haus", 20, 20, 0);
      const peasant = spawn(g, "tageloehner", 0, 25, 25);
      const soldier = spawn(g, "speer", 0, 12, 14);
      expect(result(g.dispatch({ t: "stationieren", units: [soldier.id] }), "Stationieren").voice).toBe("stationiert");
      const archer = spawn(g, "bogen", 0, 12, 15);
      for (let x = 10; x <= 14; x++) if (x !== 11) g.dispatch({ t: "stationieren", units: [spawn(g, "bogen", 0, x, 16).id] });
      expect(result(g.dispatch({ t: "stationieren", units: [archer.id] }), "Kein Posten").voice).toBe("kein_posten");
      const ids = g.dispatch({ t: "ueberfall" }).ids!;
      listen(g, "Welle");
      const raider = g.state.units.find((u) => u.id === ids[0])!;
      damageBuilding(w, "schwert", house);
      raider.x = peasant.x + 0.6; raider.y = peasant.y;
      run(g, 3 * TPS);
      const wall = w.s.buildings.find((b) => b.key === "mauer")!;
      wall.hp = 1; damageBuilding(w, "schwert", wall);
      house.hp = 1; damageBuilding(w, "schwert", house);
      const victim = spawn(g, "schwert", 0, 30, 30);
      victim.hp = 1;
      raider.x = 30.9; raider.y = 30.5;
      run(g, 5 * TPS, () => victim.dead);
      for (const u of g.state.units) if (u.team === 1) { u.hp = 0; u.dead = true; }
      run(g, 2);
      listen(g, "Überfall");
    }

    const missing = (Object.keys(VOICE) as VoiceKey[]).filter((k) => !heard.has(k));
    if (missing.length) console.log("Fehlende Ansagen:", missing, [...where.entries()]);
    expect(missing).toEqual([]);
  });

  it("Vorwarnung 30 Sekunden vor der Welle mit Meldungstext und kind kampf", () => {
    const g = createGame({ seed: 1 });
    const due = g.state.raid.next;
    run(g, due - 30 * TPS - 1);
    expect(g.state.messages.some((m) => m.voice === "ueberfall_bald")).toBe(false);
    run(g, 1);
    const m = g.state.messages.find((x) => x.voice === "ueberfall_bald")!;
    expect(m.text).toBe("Späher melden Krieger auf dem Weg. In 30 Sekunden sind sie hier.");
    expect(m.kind).toBe("kampf");
    expect(m.tick).toBe(due - 30 * TPS);
    run(g, 30 * TPS);
    expect(g.state.raid.wave).toBe(1);
    expect(g.state.messages.some((x) => x.voice === "ueberfall")).toBe(true);
  });

  it("zum Spielbeginn nur die Begrüßung (das vorgebaute Lager meldet nichts)", () => {
    const g = createGame({ seed: 1, raids: false });
    expect(g.state.messages.map((m) => m.voice)).toEqual(["willkommen"]);
  });
});
