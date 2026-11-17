/**
 * Belagerung und Befestigung (ADR 0017): Sturmleitern (anlegen, klettern, umstoßen), Rammbock gegen Tore, Breschen
 * (Trümmer öffnen den Weg), Reparatur durch Tagelöhner, Heilung, Palisade und Graben in der Wegfindung, Wellen mit
 * Belagerungswerkzeug, alle vier Ausrichtungen und Speichern/Laden mitten in der Belagerung. Alles über echte Ticks.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, HEAL, REPAIR, SIEGE, UNITS } from "../../src/data";
import { createGame, loadGame, stairEnds } from "../../src/sim";
import { damageStage, ladderDir, ladderOrientation, repairPlan } from "../../src/sim/belagerung";
import { removeBuilding } from "../../src/sim/build";
import { kill } from "../../src/sim/combat";
import { buildNow, run, spawn, stockUp, worldOf } from "../../src/sim/debug";
import type { Simulation } from "../../src/sim/game";
import { tileGoal } from "../../src/sim/move";
import { spawnWave } from "../../src/sim/raid";
import type { Ladder } from "../../src/sim/types";
import { TPS, type SBuilding, type SUnit } from "../../src/sim/world";

const unit = (g: Simulation, id: number) => g.state.units.find((u) => u.id === id) as SUnit | undefined;

/**
 * Leere Wiese 40 × 40, quer durch die ganze Karte eine Mauer auf x = 20 (bzw. Palisade, Graben), innen (Westen) eine
 * Treppe und ein Wohnhaus als Ziel der Angreifer. gate: Tor auf (20, 20).
 */
function walled(opts: { key?: "mauer" | "palisade" | "graben"; gate?: boolean; stairs?: boolean } = {}): { g: Simulation; house: SBuilding } {
  const g = createGame({ scenario: "leer", size: 40, raids: false });
  const key = opts.key ?? "mauer";
  for (let y = 0; y < 40; y++) if (!(opts.gate && y === 20)) buildNow(g, key, 20, y, 0);
  if (opts.gate) buildNow(g, "tor", 20, 20, 1);
  if (key === "mauer" && opts.stairs !== false) {
    // Treppe innen mit der Rückseite an der Mauer (20, 12)
    for (let o = 0; o < 4; o++) {
      const e = stairEnds(18, 12, o);
      if (e.wall[0] === 20 && e.wall[1] === 12) { buildNow(g, "treppe", 18, 12, o); break; }
      const f = stairEnds(19, 11, o);
      if (f.wall[0] === 20 && f.wall[1] === 12) { buildNow(g, "treppe", 19, 11, o); break; }
    }
    expect(g.state.buildings.some((b) => b.key === "treppe")).toBe(true);
  }
  const house = buildNow(g, "haus", 8, 19, 0);
  return { g, house };
}

/** Treppe innen an den Mauer-Tile `wall` (inside: Welt-Richtung nach innen), für jede Mauerrichtung. */
function stairsInside(g: Simulation, wall: [number, number], inside: [number, number]): SBuilding {
  for (let o = 0; o < 4; o++) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const x = wall[0] + dx, y = wall[1] + dy, e = stairEnds(x, y, o);
    const inner = (t: [number, number]) => (t[0] - wall[0]) * inside[0] + (t[1] - wall[1]) * inside[1] > 0;
    if (e.wall[0] === wall[0] && e.wall[1] === wall[1] && inner(e.top) && inner(e.bottom)) return buildNow(g, "treppe", x, y, o);
  }
  throw new Error("keine Treppe möglich");
}

function ladderRaider(g: Simulation, x: number, y: number): SUnit {
  const u = spawn(g, "sturmknecht", 1, x, y);
  u.gear = "leiter";
  return u;
}

describe("Sturmleitern", () => {
  it("ein Sturmknecht trägt die Leiter zur Mauer, richtet sie auf und klettert sichtbar auf den Wehrgang", () => {
    const { g } = walled();
    const u = ladderRaider(g, 30, 25);
    let climbZ = -1, top = false;
    run(g, 40 * TPS, () => {
      const v = unit(g, u.id)!;
      if (v.layer === 0 && v.z > 0.8 && v.z < 2.4) climbZ = v.z;
      if (v.layer === 1) top = true;
      return top;
    });
    const ls = g.state.ladders ?? [];
    expect(ls).toHaveLength(1);
    const l = ls[0];
    expect(l.state).toBe("steht");
    expect([l.wx, l.x]).toEqual([20, 21]); // Fuß außen (Osten), oberes Ende auf der Mauer
    expect(ladderDir(l.o)).toEqual([l.wx - l.x, l.wy - l.y]);
    expect(unit(g, u.id)!.gear).toBeUndefined();
    expect(climbZ).toBeGreaterThan(0.8); // Zwischenhöhe: er klettert, statt zu springen
    expect(top).toBe(true);
  });

  it("ohne Leiter kommt er nicht hinauf: die Mauer ist für Angreifer geschlossen", () => {
    const { g } = walled();
    const w = worldOf(g);
    const from = w.nav.node(0, 30, 25);
    expect(w.nav.route(1, false, from, tileGoal(10, 25))).toBeNull();
    expect(w.nav.route(1, false, from, tileGoal(20, 25, 1))).toBeNull();
  });

  it("ein Verteidiger am Leiterkopf stößt sie um; wer gerade klettert, stürzt und nimmt Schaden", () => {
    const { g } = walled();
    const w = worldOf(g);
    const l: Ladder = { id: w.newId(), x: 21, y: 30, wx: 20, wy: 30, o: ladderOrientation(21, 30, 20, 30), state: "steht", t: 0, push: 0 };
    w.s.ladders = [l];
    w.nav.rebuild();
    const climber = spawn(g, "sturmknecht", 1, 21, 30);
    climber.x = 20.9; climber.z = 1.6; // mitten auf der Leiter
    climber.ai.think = 999; // er bleibt, wo er ist
    const bow = spawn(g, "bogen", 0, 20, 30, 1);
    const hp0 = climber.hp;
    let fell = false;
    run(g, Math.ceil((SIEGE.ladderPushSeconds + 0.5) * TPS), () => { fell = (g.state.ladders ?? [])[0]?.state !== "steht"; return fell; });
    expect(fell).toBe(true);
    expect(g.state.ladders![0].state).toBe("faellt");
    expect(unit(g, bow.id)!.activity).toBe("stoesst_um");
    const c = unit(g, climber.id)!;
    expect(c.z).toBe(0);
    expect(c.hp).toBeLessThanOrEqual(hp0 - SIEGE.ladderFallDamage + 1e-9);
    expect(g.state.messages.some((m) => m.text === "Eine Sturmleiter ist umgestoßen!")).toBe(true);
    // ohne Leiter keine Verbindung mehr, nach dem Liegen verschwindet sie
    expect(w.nav.route(1, false, w.nav.node(0, 21, 30), tileGoal(20, 30, 1))).toBeNull();
    run(g, Math.ceil((SIEGE.ladderFallSeconds + SIEGE.ladderLieSeconds + 0.5) * TPS));
    expect(g.state.ladders ?? []).toHaveLength(0);
  });

  it("ist kein Angreifer mehr am Leben, fallen die übrigen Leitern und verschwinden", () => {
    const { g } = walled();
    const w = worldOf(g);
    w.s.ladders = [{ id: w.newId(), x: 21, y: 30, wx: 20, wy: 30, o: ladderOrientation(21, 30, 20, 30), state: "steht", t: 0, push: 0 }];
    w.nav.rebuild();
    const foe = spawn(g, "sturmknecht", 1, 35, 5);
    foe.ai.think = 9999;
    run(g, 2 * TPS);
    expect(g.state.ladders![0].state).toBe("steht"); // solange einer lebt, bleibt sie
    kill(w, foe);
    run(g, 1);
    expect(g.state.ladders![0].state).toBe("faellt");
    expect(w.nav.route(1, false, w.nav.node(0, 21, 30), tileGoal(20, 30, 1))).toBeNull();
    run(g, Math.ceil((SIEGE.ladderFallSeconds + SIEGE.ladderLieSeconds + 0.5) * TPS));
    expect(g.state.ladders ?? []).toHaveLength(0);
  });

  it("ein Angreifer oben am Leiterkopf verhindert das Umstoßen", () => {
    const { g } = walled();
    const w = worldOf(g);
    w.s.ladders = [{ id: w.newId(), x: 21, y: 30, wx: 20, wy: 30, o: ladderOrientation(21, 30, 20, 30), state: "steht", t: 0, push: 0 }];
    w.nav.rebuild();
    const head = spawn(g, "sturmknecht", 1, 20, 30, 1);
    head.ai.think = 9999;
    head.hp = head.maxHp = 100000; // hält durch
    spawn(g, "bogen", 0, 20, 29, 1);
    run(g, (SIEGE.ladderPushSeconds + 2) * TPS);
    expect(g.state.ladders![0].state).toBe("steht");
  });

  it("ein Nahkämpfer auf dem Posten geht zur Leiter in seinem Abschnitt und stößt sie um", () => {
    const { g } = walled();
    const sp = spawn(g, "speer", 0, 20, 14, 1);
    expect(g.dispatch({ t: "stationieren", units: [sp.id] }).ok).toBe(true);
    run(g, 5 * TPS);
    const w = worldOf(g);
    w.s.ladders = [{ id: w.newId(), x: 21, y: 17, wx: 20, wy: 17, o: ladderOrientation(21, 17, 20, 17), state: "steht", t: 0, push: 0 }];
    w.nav.rebuild();
    let fell = false;
    run(g, 20 * TPS, () => { fell = g.state.ladders![0].state !== "steht"; return fell; });
    expect(fell).toBe(true);
    expect(unit(g, sp.id)!.order.t).toBe("station");
  });
});

describe("Rammbock", () => {
  function ramAt(g: Simulation, x: number, y: number): { ram: SUnit; crew: SUnit[] } {
    const ram = spawn(g, "rammbock", 1, x, y);
    const crew = [0, 1, 2].map((i) => { const c = spawn(g, "sturmknecht", 1, x + 1, y - 1 + i); c.ai.ram = ram.id; return c; });
    return { ram, crew };
  }

  it("fährt mit seiner Mannschaft zum Tor, stößt es ein und bleibt dabei am Boden", () => {
    const { g } = walled({ gate: true });
    const gate = g.state.buildings.find((b) => b.key === "tor")!;
    const { ram } = ramAt(g, 32, 20);
    const hp0 = gate.hp;
    let maxLayer = 0, hit = false, gone = false;
    run(g, 120 * TPS, () => {
      const r = unit(g, ram.id)!;
      maxLayer = Math.max(maxLayer, r.layer, r.z);
      if (!g.state.buildings.includes(gate)) { gone = true; return true; }
      if (gate.hp < hp0) hit = true;
    });
    expect(hit).toBe(true);
    expect(gone).toBe(true);
    expect(maxLayer).toBe(0);
    expect(g.state.rubble?.some((r) => r.x === 20 && r.y === 20)).toBe(true); // Bresche im Tor
    // Wucht: ein Stoß trifft das Tor mit dem vollen Schaden
    expect(UNITS.rammbock.damage).toBeGreaterThan(UNITS.schwert.damage!);
  });

  it("ohne Mannschaft in der Nähe bewegt er sich nicht; fällt die ganze Mannschaft, ist er aufgegeben", () => {
    const { g } = walled({ gate: true });
    const { ram, crew } = ramAt(g, 32, 20);
    for (const c of crew) { c.x = 36.5; c.y = 36.5; c.ai.think = 9999; }
    const w = worldOf(g);
    for (const c of crew) c.ai.ram = ram.id;
    run(g, 2 * TPS);
    // Mannschaft geht zu ihm zurück; so lange steht er
    const r0 = unit(g, ram.id)!;
    expect(Math.hypot(r0.x - 32.5, r0.y - 20.5)).toBeLessThan(0.05);
    for (const c of crew) { c.hp = 0; c.dead = true; }
    run(g, 2);
    expect(unit(g, ram.id)!.dead).toBe(true);
    expect(g.state.messages.some((m) => m.text.startsWith("Der Rammbock ist aufgegeben"))).toBe(true);
    expect(w.s.gold).toBeGreaterThan(0);
  });
});

describe("Bresche", () => {
  it("eine zerstörte Mauer wird zu Trümmern: begehbar, langsamer, der Weg ist offen", () => {
    const { g } = walled({ stairs: false });
    const w = worldOf(g);
    const from = w.nav.node(0, 30, 20);
    expect(w.nav.route(1, false, from, tileGoal(10, 20))).toBeNull();
    const b = w.buildingAt(20, 20)!;
    removeBuilding(w, b, "zerstoert");
    expect(g.state.rubble).toEqual([expect.objectContaining({ x: 20, y: 20, sprite: "truemmer_stein" })]);
    const p = w.nav.route(1, false, from, tileGoal(10, 20));
    expect(p).not.toBeNull();
    expect(p!.some((n) => w.nav.tileX(n) === 20 && w.nav.tileY(n) === 20)).toBe(true);
    expect(w.nav.cost[20 * 40 + 20]).toBeCloseTo(SIEGE.rubbleCost);
    // Neubau räumt die Trümmer
    stockUp(g, "stein", 0);
    buildNow(g, "mauer", 20, 20, 0);
    expect(g.state.rubble).toEqual([]);
    expect(w.nav.route(1, false, from, tileGoal(10, 20))).toBeNull();
  });

  it("Angreifer reißen ein Mauerstück ein und laufen durch die Bresche", () => {
    const { g, house } = walled({ stairs: false });
    const ids = [spawn(g, "schwert", 1, 30, 20).id, spawn(g, "schwert", 1, 30, 21).id];
    let through = false;
    run(g, 240 * TPS, () => { through = ids.some((id) => { const u = unit(g, id); return !!u && !u.dead && u.x < 20; }); return through; });
    expect(through).toBe(true);
    expect(g.state.rubble?.length).toBeGreaterThan(0);
    expect(house.hp).toBeGreaterThan(0);
  });
});

describe("Schadensstufen und Reparatur", () => {
  it("Schadensstufen folgen den Lebenspunkten", () => {
    const { g } = walled({ stairs: false });
    const b = worldOf(g).buildingAt(20, 5)!;
    const max = BUILDINGS.mauer.hp;
    expect(damageStage(b)).toBe(0);
    b.hp = max * 0.7; expect(damageStage(b)).toBe(1);
    b.hp = max * 0.4; expect(damageStage(b)).toBe(2);
    b.hp = max * 0.1; expect(damageStage(b)).toBe(3);
  });

  it("ein Tagelöhner holt Stein, trägt ihn zur beschädigten Mauer und repariert sie sichtbar", () => {
    const g = createGame({ scenario: "leer", size: 32, raids: false });
    buildNow(g, "lager", 4, 4, 0);
    stockUp(g, "stein", 10);
    const wall = buildNow(g, "mauer", 16, 16, 0);
    const p = spawn(g, "tageloehner", 0, 10, 10);
    wall.hp = 150;
    const plan = repairPlan(wall);
    expect(plan.good).toBe("stein");
    let carried = false, hammered = false;
    run(g, 60 * TPS, () => {
      const u = unit(g, p.id)!;
      if (u.ai.job?.k === "repair" && u.carry === "stein") carried = true;
      if (u.activity === "repariert" && u.anim === "bauen") hammered = true;
    });
    expect(carried).toBe(true);
    expect(hammered).toBe(true);
    // repariert wird, solange ein ganzes Stück sich lohnt (mehr als ein halbes Stück fehlt)
    expect(wall.hp).toBe(150 + 2 * plan.hp);
    expect(BUILDINGS.mauer.hp - wall.hp).toBeLessThan(plan.hp * 0.5);
    expect(g.state.stock.stein).toBe(10 - 2);
  });

  it("abgeschaltete Reparatur und Kampf in der Nähe halten die Arbeiter fern", () => {
    const g = createGame({ scenario: "leer", size: 32, raids: false });
    buildNow(g, "lager", 4, 4, 0);
    stockUp(g, "stein", 10);
    const wall = buildNow(g, "mauer", 16, 16, 0);
    spawn(g, "tageloehner", 0, 10, 10);
    wall.hp = 150;
    expect(g.dispatch({ t: "reparatur", building: wall.id, an: false }).ok).toBe(true);
    run(g, 20 * TPS);
    expect(wall.hp).toBe(150);
    expect(g.dispatch({ t: "reparatur", building: wall.id, an: true }).ok).toBe(true);
    // ein Angreifer steht daneben: keine Reparatur
    const foe = spawn(g, "speer", 1, 18, 16);
    foe.ai.think = 99999;
    run(g, 20 * TPS);
    expect(wall.hp).toBe(150);
    foe.dead = true; foe.hp = 0;
    run(g, (REPAIR.calmSeconds + 30) * TPS);
    expect(wall.hp).toBeGreaterThan(150);
  });
});

describe("Heilung", () => {
  it("Verwundete heilen langsam in Ruhe, schneller bei der Kaserne, nicht direkt nach einem Treffer", () => {
    const g = createGame({ scenario: "leer", size: 40, raids: false });
    buildNow(g, "kaserne", 4, 4, 0);
    const far = spawn(g, "speer", 0, 30, 30);
    const near = spawn(g, "speer", 0, 6, 8);
    const hurt = spawn(g, "speer", 0, 30, 20);
    for (const u of [far, near, hurt]) u.hp = 20;
    hurt.ai.hurtT = 0;
    run(g, 10 * TPS);
    expect(unit(g, far.id)!.hp).toBeCloseTo(20 + 10 * HEAL.restPerSecond, 5);
    expect(unit(g, near.id)!.hp).toBeCloseTo(20 + 10 * HEAL.nearPerSecond, 5);
    // Heilung einmal je Sekunde, ab der Sekunde, in der die Ruhezeit erreicht ist
    expect(unit(g, hurt.id)!.hp).toBeCloseTo(20 + (10 - HEAL.calmSeconds + 1) * HEAL.restPerSecond, 5);
    expect(unit(g, far.id)!.activity).toBe("erholt");
    run(g, 60 * TPS);
    expect(unit(g, near.id)!.hp).toBe(UNITS.speer.hp);
  });
});

describe("Palisade und Graben", () => {
  it("die Palisade sperrt wie eine Mauer, trägt aber keinen Wehrgang; gebaut wird sie aus Holz als Linie", () => {
    const { g } = walled({ key: "palisade" });
    const w = worldOf(g);
    const from = w.nav.node(0, 30, 20);
    for (const team of [0, 1] as const) expect(w.nav.route(team, false, from, tileGoal(10, 20))).toBeNull();
    const br = w.nav.route(1, true, from, tileGoal(10, 20));
    expect(br).not.toBeNull();
    expect(g.walkLayerAt(20, 20)).toBe(0);
    // Linie ziehen
    const h = createGame({ scenario: "leer", size: 32, raids: false });
    buildNow(h, "lager", 2, 2, 0);
    stockUp(h, "holz", 20);
    const r = h.dispatch({ t: "mauer", key: "palisade", x0: 10, y0: 15, x1: 16, y1: 15 });
    expect(r.ok).toBe(true);
    expect(r.ids).toHaveLength(7);
    expect(h.state.buildings.filter((b) => b.key === "palisade").every((b) => b.needs.holz === BUILDINGS.palisade.cost.holz)).toBe(true);
    expect(h.wallPath(10, 16, 16, 16, "palisade").ok).toBe(true);
  });

  it("Graben: eigene Leute waten langsam hindurch, Angreifer nur, indem sie ihn zuschütten", () => {
    const { g, house } = walled({ key: "graben" });
    const w = worldOf(g);
    const from = w.nav.node(0, 30, 20);
    const own = w.nav.route(0, false, from, tileGoal(10, 20));
    expect(own).not.toBeNull();
    expect(w.nav.cost[20 * 40 + 20]).toBeCloseTo(BUILDINGS.graben.ditch!.ownCost);
    expect(w.nav.route(1, false, from, tileGoal(10, 20))).toBeNull();
    expect(w.nav.route(1, true, from, tileGoal(10, 20))).not.toBeNull();
    // Belagerungsgerät kommt auch im Belagerungsmodus nicht hindurch
    expect(w.nav.route(1, true, from, tileGoal(10, 20), true)).toBeNull();
    const id = spawn(g, "schwert", 1, 30, 20).id;
    let filled = false;
    run(g, 120 * TPS, () => { filled = !!g.state.rubble?.some((r) => r.sprite === "graben_verfuellt"); return filled && unit(g, id)!.x < 20; });
    expect(filled).toBe(true);
    expect(unit(g, id)!.x).toBeLessThan(20);
    expect(house.hp).toBeGreaterThan(0);
  });

  it("ein Graben kostet nur Arbeit: Tagelöhner heben ihn aus", () => {
    const g = createGame({ scenario: "leer", size: 32, raids: false });
    buildNow(g, "lager", 2, 2, 0);
    spawn(g, "tageloehner", 0, 8, 8);
    const r = g.dispatch({ t: "mauer", key: "graben", x0: 12, y0: 12, x1: 14, y1: 12 });
    expect(r.ok).toBe(true);
    run(g, 60 * TPS, () => g.state.buildings.filter((b) => b.key === "graben").every((b) => b.built >= 1));
    expect(g.state.buildings.filter((b) => b.key === "graben" && b.built >= 1)).toHaveLength(3);
    expect(g.state.buildings.find((b) => b.key === "graben")!.wallMask).not.toBe(0);
  });
});

describe("Überfälle mit Belagerungswerkzeug", () => {
  it("Welle 1 wie bisher, ab Welle 2 Sturmleitern, ab Welle 3 ein Rammbock mit Mannschaft", () => {
    const g = createGame({ seed: 1 });
    const w = worldOf(g);
    // Leitern bringen die Angreifer nur gegen eine Mauer mit Wehrgang (hasLadderWall, Zusammenführung mit ADR 0015)
    let wall = false;
    for (let y = 2; y < w.s.h - 2 && !wall; y++) for (let x = 2; x < w.s.w - 2 && !wall; x++) {
      if (g.canPlace("mauer", x, y, 0).ok) { buildNow(g, "mauer", x, y, 0); wall = true; }
    }
    const keys = (ids: number[]) => ids.map((id) => w.units.get(id)!);
    const w1 = keys(spawnWave(w));
    expect(w1.some((u) => u.key === "sturmknecht" || u.key === "rammbock")).toBe(false);
    const w2 = keys(spawnWave(w));
    expect(w2.filter((u) => u.gear === "leiter")).toHaveLength(2);
    expect(w2.filter((u) => !UNITS[u.key].vehicle)).toHaveLength(6);
    const w3 = keys(spawnWave(w));
    const ram = w3.find((u) => u.key === "rammbock")!;
    expect(ram).toBeTruthy();
    expect(w3.filter((u) => u.ai.ram === ram.id)).toHaveLength(UNITS.rammbock.vehicle!.crew);
    expect(w3.filter((u) => u.gear === "leiter")).toHaveLength(2);
  });
});

describe("Drehung", () => {
  it("Leitern in allen vier Ausrichtungen: angelegt von jeder Seite, Ausrichtung zeigt vom Fuß zur Mauer", () => {
    const sides: { wall: (i: number) => [number, number]; from: [number, number] }[] = [
      { wall: (i) => [20, i], from: [30, 20] }, // Mauer entlang y, Angreifer im Osten
      { wall: (i) => [20, i], from: [8, 20] },  // … im Westen
      { wall: (i) => [i, 20], from: [20, 30] }, // Mauer entlang x, Angreifer im Süden
      { wall: (i) => [i, 20], from: [20, 8] },  // … im Norden
    ];
    const seen = new Set<number>();
    for (const s of sides) {
      const g = createGame({ scenario: "leer", size: 40, raids: false });
      for (let i = 0; i < 40; i++) buildNow(g, "mauer", ...s.wall(i), 0);
      // Ziel auf der anderen Seite
      const tx = s.from[0] === 20 ? 20 : 40 - s.from[0], ty = s.from[1] === 20 ? 20 : 40 - s.from[1];
      buildNow(g, "haus", Math.min(36, tx - 1), Math.min(36, ty - 1), 0);
      stairsInside(g, s.wall(12), [Math.sign(tx - s.from[0]), Math.sign(ty - s.from[1])]);
      const u = ladderRaider(g, ...s.from);
      let up = false;
      run(g, 40 * TPS, () => { up = unit(g, u.id)!.layer === 1; return up; });
      const l = g.state.ladders![0];
      expect(ladderDir(l.o)).toEqual([l.wx - l.x, l.wy - l.y]);
      expect(up).toBe(true);
      seen.add(l.o);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("Speichern und Laden", () => {
  it("mitten in der Belagerung: Leitern, Trümmer, Mannschaft und Reparatur laufen nach dem Laden gleich weiter", () => {
    const { g } = walled({ gate: true });
    const w = worldOf(g);
    buildNow(g, "lager", 4, 30, 0);
    stockUp(g, "stein", 20);
    spawn(g, "tageloehner", 0, 8, 30);
    w.buildingAt(20, 5)!.hp = 200;
    removeBuilding(w, w.buildingAt(20, 35)!, "zerstoert");
    ladderRaider(g, 30, 10);
    const ram = spawn(g, "rammbock", 1, 32, 20);
    for (let i = 0; i < 3; i++) spawn(g, "sturmknecht", 1, 33, 19 + i).ai.ram = ram.id;
    run(g, 12 * TPS);
    expect(g.state.ladders?.length).toBe(1);
    const h = loadGame(g.save());
    expect(h.save()).toBe(g.save());
    for (let i = 0; i < 300; i++) { g.tick(); h.tick(); }
    expect(h.save()).toBe(g.save());
  });
});
