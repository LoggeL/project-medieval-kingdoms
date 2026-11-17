/**
 * Abnahme der Mauerverteidigung und der ersten Welle (Befunde der Spielerprüfung r22/r23):
 * Eine vernünftige Verteidigung an der Furt gewinnt Welle 1 ohne weitere Befehle, ohne Verteidigung richtet sie
 * Schaden an, Restangreifer ziehen ab, und die Steinwirtschaft trägt Kaserne, Mauer, Tor, Treppe und einen Turm
 * vor der ersten Welle. Alles deterministisch, ohne Browser.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, START, TUTORIAL, type UnitKey } from "../../src/data";
import { createGame, stairEnds } from "../../src/sim";
import { kill } from "../../src/sim/combat";
import { buildNow, run, spawn, stockUp } from "../../src/sim/debug";
import type { Simulation } from "../../src/sim/game";
import { TPS, type SUnit, type World } from "../../src/sim/world";

const worldOf = (g: Simulation): World => (g as unknown as { world: World }).world;
const unit = (g: Simulation, id: number) => g.state.units.find((u) => u.id === id) as SUnit | undefined;
const alive = (g: Simulation, ids: number[]) => ids.filter((id) => { const u = unit(g, id); return u && !u.dead; });

/**
 * Standardkarte (Seed 1) mit dem Aufbau der Prüfer: Holzfäller, Steinbruch, Haus, Kaserne; an der Furt drei
 * Mauerfelder auf x = 48 quer über den Weg, Tor auf (48, 34), Treppe innen auf (46, 33). Soldaten stehen an der Kaserne.
 */
function ford(soldiers: UnitKey[], wall: boolean, rng: number): { g: Simulation; ids: number[] } {
  const g = createGame({ seed: 1 });
  worldOf(g).meta.rng = rng * 7919 + 13;
  buildNow(g, "holzfaeller", 17, 37, 0);
  buildNow(g, "steinbruch", 35, 16, 0);
  buildNow(g, "haus", 28, 39, 0);
  buildNow(g, "kaserne", 36, 41, 0);
  if (wall) {
    for (const y of [32, 33, 35]) buildNow(g, "mauer", 48, y, 0);
    buildNow(g, "tor", 48, 34, 1);
    buildNow(g, "treppe", 46, 33, 3);
  }
  const ids = soldiers.map((k, i) => spawn(g, k, 0, 37 + i, 45).id);
  return { g, ids };
}

/** Bis kurz vor der Welle laufen, dann wie mit Taste T stationieren und ohne weitere Befehle bis zum Ende der Welle 1. */
function defendWave1(soldiers: UnitKey[], rng: number) {
  const { g, ids } = ford(soldiers, true, rng);
  run(g, 290 * TPS);
  const r = g.dispatch({ t: "stationieren", units: ids }); // derselbe Befehl wie Taste T
  expect(r.ok).toBe(true);
  expect(r.ids).toHaveLength(ids.length);
  run(g, 240 * TPS, () => g.state.raid.wave === 1 && !g.state.raid.active && g.state.tick > 301 * TPS);
  return { g, ids };
}

function expectRepelled(g: Simulation): void {
  expect(g.state.raid.wave).toBe(1);
  expect(g.state.raid.active).toBe(false);
  expect(g.state.tick).toBeLessThan((START.raid.firstSeconds + START.raid.everySeconds) * TPS);
  const m = g.state.messages.find((x) => x.voice === "abgewehrt");
  expect(m?.text).toBe("Der Überfall ist abgewehrt!");
}

describe("Abnahme: erste Welle an der Furt", () => {
  it("r22: Speerträger, Schwertkämpfer und Bogenschütze auf der Mauer wehren Welle 1 ohne weitere Befehle ab, das Tor steht", () => {
    for (const rng of [1, 2, 3]) {
      const { g, ids } = defendWave1(["speer", "schwert", "bogen"], rng);
      expectRepelled(g);
      expect(alive(g, ids).length).toBeGreaterThanOrEqual(2);
      expect(g.state.buildings.some((b) => b.key === "tor")).toBe(true);
      // Kein Angreifer kam bis zu den Wirtschaftsbauten
      for (const b of g.state.buildings) if (BUILDINGS[b.key].category !== "befestigung") expect(b.hp).toBe(BUILDINGS[b.key].hp);
    }
  });

  it("r23: drei Bogenschützen auf der Mauer wehren Welle 1 ab", () => {
    for (const rng of [1, 2, 3]) {
      const { g, ids } = defendWave1(["bogen", "bogen", "bogen"], rng);
      expectRepelled(g);
      expect(alive(g, ids).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("ohne Verteidiger und ohne Mauer richtet Welle 1 sichtbaren Schaden an", () => {
    const { g } = ford([], false, 1);
    const hp0 = new Map(g.state.buildings.map((b) => [b.id, b.hp]));
    run(g, (START.raid.firstSeconds + 120) * TPS);
    expect(g.state.raid.wave).toBe(1);
    const damaged = g.state.buildings.filter((b) => b.hp < hp0.get(b.id)!).length + [...hp0.keys()].filter((id) => !g.state.buildings.some((b) => b.id === id)).length;
    const deadWorkers = g.state.units.filter((u) => u.team === 0 && u.dead).length;
    expect(damaged + deadWorkers).toBeGreaterThan(0);
    expect(damaged).toBeGreaterThanOrEqual(1);
    expect(g.state.raid.active).toBe(true); // ohne Gegenwehr bleiben sie
  });
});

describe("Rückzug der Angreifer", () => {
  it("ein allein übrig gebliebener angeschlagener Angreifer zieht ab, die Welle endet in begrenzter Zeit", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    buildNow(g, "haus", 6, 19, 0);
    const ids = g.dispatch({ t: "ueberfall" }).ids!;
    expect(ids).toHaveLength(4);
    run(g, 5 * TPS);
    const w = worldOf(g);
    for (const id of ids.slice(0, 3)) kill(w, unit(g, id)!);
    const last = unit(g, ids[3])!;
    last.hp = last.maxHp * 0.6; // angeschlagen, aber über der Rückzugsschwelle: geht, weil er allein ist
    const x0 = last.x;
    let fled = false, maxX = x0;
    run(g, 60 * TPS, () => {
      fled ||= last.activity === "flieht";
      if (!last.dead) maxX = Math.max(maxX, last.x);
      return !g.state.raid.active;
    });
    expect(fled).toBe(true);
    expect(g.state.raid.active).toBe(false);
    expect(g.state.units.includes(last)).toBe(false); // hat die Karte verlassen
    expect(maxX).toBeGreaterThan(x0 + 5); // nach Osten zum Anmarschpunkt
    expect(g.state.messages.some((m) => m.voice === "abgewehrt")).toBe(true);
    expect(g.state.messages.some((m) => m.text === "Die Angreifer weichen zurück!")).toBe(true);
  });

  it("ein unverletzter Letzter der Welle zieht nicht ab, sondern kämpft weiter", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    buildNow(g, "haus", 6, 19, 0);
    const ids = g.dispatch({ t: "ueberfall" }).ids!;
    run(g, 5 * TPS);
    const w = worldOf(g);
    for (const id of ids.slice(0, 3)) kill(w, unit(g, id)!);
    const last = unit(g, ids[3])!;
    run(g, 10 * TPS);
    expect(last.ai.retreat).toBeFalsy();
    expect(g.state.raid.active).toBe(true);
  });

  it("ohne Rückweg stellt sich der Fliehende und kämpft weiter", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    buildNow(g, "haus", 6, 19, 0);
    const ids = g.dispatch({ t: "ueberfall" }).ids!;
    run(g, 2 * TPS);
    const hurt = unit(g, ids[0])!;
    hurt.hp = hurt.maxHp * 0.2;
    // Anmarschpunkt unerreichbar machen: mitten in einen Fels legen ist nicht nötig, ein Punkt außerhalb des Laufrasters genügt
    worldOf(g).meta.raidSpawn = [-50, -50];
    run(g, 5 * TPS);
    expect(hurt.ai.cornered).toBe(true);
    expect(hurt.ai.retreat).toBe(false);
  });

  it("schwer Verwundete weichen auch mitten in der Welle, der Rest kämpft weiter", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    buildNow(g, "haus", 6, 19, 0);
    const ids = g.dispatch({ t: "ueberfall" }).ids!;
    const hurt = unit(g, ids[0])!;
    hurt.hp = hurt.maxHp * 0.2;
    run(g, 3 * TPS);
    expect(hurt.ai.retreat).toBe(true);
    for (const id of ids.slice(1)) expect(unit(g, id)!.ai.retreat).toBeFalsy();
  });
});

describe("Kampfverhalten an der Mauer", () => {
  /** Leere Wiese, Mauer quer (x = 20), Tor bei y = 20, Treppe innen (westlich). */
  function wallLine(): Simulation {
    const g = createGame({ scenario: "leer", size: 40 });
    for (let y = 10; y <= 30; y++) buildNow(g, y === 20 ? "tor" : "mauer", 20, y, 1);
    buildNow(g, "treppe", 18, 22, 3); // oben an (20, 22)
    return g;
  }

  it("Schützen auf der Mauer nehmen zuerst den feindlichen Schützen, nicht den näheren Gepanzerten", () => {
    const g = wallLine();
    const archer = spawn(g, "bogen", 0, 15, 22);
    g.dispatch({ t: "stationieren", units: [archer.id] });
    run(g, 20 * TPS);
    expect(archer.layer).toBe(1);
    const sword = spawn(g, "schwert", 1, Math.floor(archer.x) + 2, Math.floor(archer.y));
    const enemyArcher = spawn(g, "bogen", 1, Math.floor(archer.x) + 6, Math.floor(archer.y) + 1);
    sword.order = { t: "hold" }; enemyArcher.order = { t: "hold" };
    let firstShot = 0;
    run(g, 5 * TPS, () => {
      const p = g.state.projectiles.find((x) => x.team === 0) as { target: number } | undefined;
      if (p && !firstShot) firstShot = p.target;
      return !!firstShot;
    });
    expect(firstShot).toBe(enemyArcher.id);
  });

  it("Nahkampf trifft kein Gebäude durch die Mauer hindurch", () => {
    const g = wallLine();
    const stairs = g.state.buildings.find((b) => b.key === "treppe")!;
    const spear = spawn(g, "speer", 1, 21, 22); // östlich der Mauer, die Treppe liegt dahinter
    spear.ai.targetB = stairs.id; spear.ai.think = 999;
    const hp = stairs.hp;
    run(g, 10 * TPS);
    expect(stairs.hp).toBe(hp);
  });

  it("Nahkämpfer auf dem Posten verteidigen das Tor und kehren danach zurück", () => {
    const g = wallLine();
    const sword = spawn(g, "schwert", 0, 15, 22);
    g.dispatch({ t: "stationieren", units: [sword.id] });
    run(g, 25 * TPS);
    expect(sword.layer).toBe(1);
    const post = { x: sword.x, y: sword.y };
    const gate = g.state.buildings.find((b) => b.key === "tor")!;
    const raider = spawn(g, "speer", 1, 22, 20);
    raider.ai.targetB = gate.id;
    let left = false;
    run(g, 40 * TPS, () => { left ||= sword.layer === 0; return raider.dead || !!raider.ai.retreat; });
    expect(left).toBe(true); // über die Treppe hinunter
    expect(raider.dead || raider.ai.retreat).toBe(true);
    run(g, 40 * TPS);
    expect(sword.dead).toBe(false);
    expect(sword.order.t).toBe("station");
    expect(sword.layer).toBe(1);
    expect(Math.hypot(sword.x - post.x, sword.y - post.y)).toBeLessThan(0.01);
  });

  it("Angreifer auf der Treppe greifen sie an und bleiben nicht hängen", () => {
    const g = wallLine();
    const stairs = g.state.buildings.find((b) => b.key === "treppe")!;
    // Auf dem oberen Treppenfeld am Boden (im Belagerungsmodus betreten), also hoch über dem Boden
    const top = stairEnds(stairs.x, stairs.y, stairs.o).top;
    const sword = spawn(g, "schwert", 1, top[0], top[1]);
    sword.z = sword.pz = worldOf(g).nav.stairZ(sword.x, sword.y); // Höhe auf den Stufen, wie nach dem Hinaufgehen
    expect(sword.z).toBeGreaterThan(1.2);
    sword.ai.targetB = stairs.id; sword.ai.think = 999;
    const hp = stairs.hp;
    run(g, 5 * TPS);
    expect(stairs.hp).toBeLessThan(hp);
  });
});

describe("Kampf auf dem Wehrgang", () => {
  it("ein Angreifer auf dem Wehrgang wird vom Nahkämpfer auf dem Posten auf gleicher Ebene bekämpft", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    for (let y = 10; y <= 30; y++) buildNow(g, "mauer", 20, y, 1);
    buildNow(g, "treppe", 18, 22, 3);
    const sword = spawn(g, "schwert", 0, 15, 22);
    g.dispatch({ t: "stationieren", units: [sword.id] });
    run(g, 25 * TPS);
    expect(sword.layer).toBe(1);
    const raider = spawn(g, "speer", 1, 20, Math.floor(sword.y) + 4, 1); // oben auf dem Wehrgang
    const y0 = sword.y;
    let moved = 0;
    run(g, 30 * TPS, () => { moved = Math.max(moved, Math.abs(sword.y - y0)); return raider.dead || !!raider.ai.retreat; });
    expect(raider.dead || raider.ai.retreat).toBe(true);
    expect(raider.hp).toBeLessThan(raider.maxHp);
    expect(moved).toBeGreaterThan(0.5); // ist ihm auf dem Wehrgang entgegengegangen
    expect(sword.layer).toBe(1);
  });
});

describe("Steinwirtschaft vor der ersten Welle", () => {
  it("ein Tor in einem fertigen Mauerstück übernimmt dessen Steine", () => {
    const g = createGame({ scenario: "leer", size: 30 });
    buildNow(g, "lager", 4, 4, 0);
    for (let x = 10; x <= 14; x++) buildNow(g, "mauer", x, 15, 0);
    stockUp(g, "holz", 4); stockUp(g, "stein", 1);
    expect(g.canPlace("tor", 12, 15, 0).ok).toBe(true); // 4 Stein, davon 3 aus der Mauer
    const r = g.dispatch({ t: "bauen", key: "tor", x: 12, y: 15, o: 0 });
    expect(r.ok).toBe(true);
    const gate = g.state.buildings.find((b) => b.id === r.ids![0])!;
    expect(gate.needs).toEqual({ holz: 4, stein: 1 });
    expect(g.canPlace("tor", 16, 15, 0).ok).toBe(false); // freies Feld neben der Mauer: volle Kosten, nicht gerade
  });

  it("Bauordnung Holzfäller, Steinbruch, Haus, Kaserne, 3 Soldaten, Mauer mit Tor und Treppe: der Turm ist vor 5:00 bezahlbar, aber knapp", () => {
    const g = createGame({ seed: 1 });
    const s = g.state;
    let step = 0, kas = 0, fortAt = 0, towerAt = 0;
    const build = (key: Parameters<Simulation["canPlace"]>[0], x: number, y: number, o = 0) => g.dispatch({ t: "bauen", key, x, y, o });
    run(g, START.raid.firstSeconds * TPS - 1, (t) => {
      if (step === 0 && t >= 2 * TPS) { expect(build("holzfaeller", 17, 37).ok).toBe(true); expect(build("steinbruch", 35, 16).ok).toBe(true); step++; }
      else if (step === 1 && t >= 40 * TPS) { if (build("haus", 28, 39).ok) step++; }
      else if (step === 2 && t >= 60 * TPS) { const r = build("kaserne", 36, 41); if (r.ok) { kas = r.ids![0]; step++; } }
      else if (step === 3 && s.buildings.find((b) => b.id === kas)!.built >= 1) {
        for (const u of ["speer", "schwert", "bogen"] as const) expect(g.dispatch({ t: "rekrutieren", building: kas, unit: u }).ok).toBe(true);
        step++;
      } else if (step === 4 && t % TPS === 0 && s.stock.stein >= 17) {
        expect(g.dispatch({ t: "mauer", x0: 48, y0: 32, x1: 48, y1: 33 }).ok).toBe(true);
        expect(g.dispatch({ t: "mauer", x0: 48, y0: 35, x1: 48, y1: 35 }).ok).toBe(true);
        expect(build("tor", 48, 34, 1).ok).toBe(true);
        expect(build("treppe", 46, 33, 3).ok).toBe(true);
        fortAt = t; step++;
      } else if (step === 5 && t % TPS === 0 && g.canPlace("turm", 46, 30, 0).ok) {
        expect(build("turm", 46, 30, 0).ok).toBe(true);
        towerAt = t; step++;
      }
    });
    expect(fortAt).toBeGreaterThan(0);
    expect(towerAt).toBeGreaterThan(fortAt);
    expect(towerAt).toBeLessThan(START.raid.firstSeconds * TPS);
    expect(towerAt).toBeGreaterThan(180 * TPS); // knapp: nicht schon zu Beginn
    expect(s.units.filter((u) => u.team === 0 && ["speer", "schwert", "bogen"].includes(u.key)).length).toBe(3);
    console.log(`Bauordnung: Befestigung bei ${fortAt / TPS} s, Turm bezahlt bei ${towerAt / TPS} s`);
  });
});

describe("Einführung", () => {
  it("führt Schritt für Schritt von der Holzfällerhütte bis zur besetzten Mauer, erledigte Schritte werden übersprungen", () => {
    const g = createGame({ seed: 1, raids: false });
    const texts = () => g.state.messages.filter((m) => TUTORIAL.some((t) => t.text === m.text)).map((m) => TUTORIAL.findIndex((t) => t.text === m.text));
    expect(texts()).toEqual([0]);
    run(g, 3 * TPS);
    expect(texts()).toEqual([0]);
    g.dispatch({ t: "bauen", key: "holzfaeller", x: 17, y: 37, o: 0 });
    run(g, TPS);
    expect(texts()).toEqual([0, 1]);
    // Steinbruch und Haus auf einmal: nur der nächste offene Schritt erscheint
    g.dispatch({ t: "bauen", key: "steinbruch", x: 35, y: 16, o: 0 });
    g.dispatch({ t: "bauen", key: "haus", x: 28, y: 39, o: 0 });
    run(g, TPS);
    expect(texts()).toEqual([0, 1, 3]);
    const k = buildNow(g, "kaserne", 36, 41, 0);
    run(g, TPS);
    expect(texts()).toEqual([0, 1, 3, 4]);
    g.dispatch({ t: "rekrutieren", building: k.id, unit: "bogen" });
    run(g, 60 * TPS, () => texts().length === 5);
    expect(texts()).toEqual([0, 1, 3, 4, 5]);
    expect(g.state.messages.at(-1)!.text).toContain("mit R drehen");
    for (const y of [32, 33, 35]) buildNow(g, "mauer", 48, y, 0);
    buildNow(g, "tor", 48, 34, 1);
    run(g, TPS);
    expect(texts()).toHaveLength(5); // Treppe fehlt noch
    buildNow(g, "treppe", 46, 33, 3);
    run(g, TPS);
    expect(texts()).toEqual([0, 1, 3, 4, 5, 6]);
    expect(g.state.messages.at(-1)!.text).toContain("mit T");
    const archer = g.state.units.find((u) => u.key === "bogen")!;
    g.dispatch({ t: "stationieren", units: [archer.id] });
    run(g, TPS);
    expect(texts()).toEqual([0, 1, 3, 4, 5, 6, 7]);
    run(g, 30 * TPS);
    expect(texts()).toHaveLength(7);
    for (const m of g.state.messages) if (TUTORIAL.some((t) => t.text === m.text)) expect(m.kind).toBe("info");
  });
});
