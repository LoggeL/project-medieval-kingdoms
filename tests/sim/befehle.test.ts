/**
 * Befehle und Steuerung (ADR 0018): Formationen (auch um Hindernisse und in allen vier Blickrichtungen),
 * Angriffsmarsch, Patrouille, Rückzug, Haltungen, Formationswechsel, Speichern und Laden.
 */
import { describe, expect, it } from "vitest";
import { COMMAND_TUNING, FORMATIONS, STANCES, TUNING, UNITS, type UnitKey } from "../../src/data";
import { createGame, loadGame } from "../../src/sim";
import { entrance, footprintTiles } from "../../src/sim/geom";
import { buildNow, run, spawn, worldOf } from "../../src/sim/debug";
import type { Simulation } from "../../src/sim/game";
import { seatOf } from "../../src/sim/research";
import type { Unit } from "../../src/sim/types";
import { TPS, type SUnit } from "../../src/sim/world";

const empty = (size = 40) => createGame({ scenario: "leer", size, raids: false });

/** Angreifer, der stehen bleibt und nichts tut (denkt nie nach). */
function dummy(g: Simulation, x: number, y: number, hp?: number): SUnit {
  const e = spawn(g, "speer", 1, x, y);
  e.ai.think = 1e9;
  if (hp) { e.hp = e.maxHp = hp; }
  return e;
}

function troop(g: Simulation, keys: UnitKey[], x0: number, y0: number): SUnit[] {
  return keys.map((k, i) => spawn(g, k, 0, x0 + (i % 6), y0 + Math.floor(i / 6)));
}

const tileOf = (u: Unit) => `${Math.floor(u.x)},${Math.floor(u.y)}`;
const idle = (us: Unit[]) => us.every((u) => u.order.t === "idle" && u.anim !== "gehen");

function runUntil(g: Simulation, seconds: number, done: () => boolean): void {
  run(g, seconds * TPS, () => done());
}

describe("Formationen", () => {
  const facings: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

  it.each(facings)("Linie mit Blick (%i, %i): Nahkämpfer vorn in einer Reihe, Schützen dahinter, Blickrichtung am Ziel", (fx, fy) => {
    const g = empty();
    const us = troop(g, ["speer", "schwert", "speer", "bogen", "bogen", "bogen"], 6, 6);
    us.forEach((u) => { u.formation = "linie"; });
    const ids = us.map((u) => u.id);
    const plan = g.planFormation(ids, 20, 20, fx, fy);
    const r = g.dispatch({ t: "bewegen", units: ids, x: 20, y: 20, fx, fy });
    expect(r.ok).toBe(true);
    // Vorschau und Befehl rechnen dasselbe
    for (const p of plan) {
      const u = us.find((q) => q.id === p.id)!;
      expect(u.order).toMatchObject({ t: "move", x: p.x, y: p.y, layer: 0 });
    }
    runUntil(g, 40, () => idle(us));
    expect(idle(us)).toBe(true);
    const along = (u: Unit) => Math.floor(u.x) * fx + Math.floor(u.y) * fy;
    const side = (u: Unit) => Math.floor(u.x) * -fy + Math.floor(u.y) * fx;
    const melee = us.filter((u) => UNITS[u.key].role === "nahkampf"), ranged = us.filter((u) => UNITS[u.key].role === "fernkampf");
    // eine Reihe je Gruppe, Schützen genau eine Reihe hinter den Nahkämpfern
    expect(new Set(melee.map(along)).size).toBe(1);
    expect(new Set(ranged.map(along)).size).toBe(1);
    expect(along(ranged[0])).toBe(along(melee[0]) - FORMATIONS.linie.spacing);
    // Reihen nebeneinander ohne Lücke, um das Ziel
    const ms = melee.map(side).sort((a, b) => a - b);
    expect(ms[2] - ms[0]).toBe(2);
    expect(new Set(us.map(tileOf)).size).toBe(us.length);
    for (const u of us) {
      expect(Math.hypot(u.x - 20.5, u.y - 20.5)).toBeLessThan(2.5);
      // Blick in die befohlene Richtung
      const l = Math.hypot(u.fx, u.fy);
      expect(u.fx / l).toBeCloseTo(fx, 2);
      expect(u.fy / l).toBeCloseTo(fy, 2);
    }
  });

  it("Block ist ein Viereck, locker hält zwei Felder Abstand", () => {
    const g = empty();
    const nine = troop(g, Array(9).fill("speer"), 4, 4);
    nine.forEach((u) => { u.formation = "block"; });
    g.dispatch({ t: "bewegen", units: nine.map((u) => u.id), x: 20, y: 12, fx: 0, fy: 1 });
    const loose = troop(g, Array(6).fill("schwert"), 4, 30);
    loose.forEach((u) => { u.formation = "locker"; });
    g.dispatch({ t: "bewegen", units: loose.map((u) => u.id), x: 20, y: 28, fx: 0, fy: 1 });
    runUntil(g, 40, () => idle([...nine, ...loose]));
    const xs = nine.map((u) => Math.floor(u.x)), ys = nine.map((u) => Math.floor(u.y));
    expect(Math.max(...xs) - Math.min(...xs)).toBe(2);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(2);
    expect(new Set(nine.map(tileOf)).size).toBe(9);
    for (const a of loose) for (const b of loose) if (a !== b) {
      expect(Math.hypot(Math.floor(a.x) - Math.floor(b.x), Math.floor(a.y) - Math.floor(b.y))).toBeGreaterThanOrEqual(FORMATIONS.locker.spacing - 1e-9);
    }
  });

  it("weicht Hindernissen aus: kein Platz in Gebäude, Mauer oder Wasser, jeder Platz einmal, alle kommen an", () => {
    const g = empty();
    const w = worldOf(g);
    const haus = buildNow(g, "haus", 19, 19, 0); // mitten im Ziel
    for (let x = 14; x <= 26; x++) buildNow(g, "mauer", x, 23, 0); // Mauer quer durch die hinteren Reihen
    for (let y = 15; y <= 18; y++) for (let x = 15; x <= 17; x++) w.s.tiles[w.idx(x, y)].terrain = "wasser";
    w.nav.rebuild(true);
    const us = troop(g, ["speer", "speer", "schwert", "schwert", "speer", "schwert", "bogen", "bogen", "bogen", "bogen", "bogen", "bogen"], 4, 4);
    const ids = us.map((u) => u.id);
    const plan = g.planFormation(ids, 20, 20, 0, 1);
    expect(plan).toHaveLength(12);
    const blocked = new Set(footprintTiles("haus", haus.x, haus.y, haus.o).map(([x, y]) => `${x},${y}`));
    for (let x = 14; x <= 26; x++) blocked.add(`${x},23`);
    for (let y = 15; y <= 18; y++) for (let x = 15; x <= 17; x++) blocked.add(`${x},${y}`);
    for (const p of plan) expect(blocked.has(`${p.x},${p.y}`), `${p.x},${p.y}`).toBe(false);
    expect(new Set(plan.map((p) => `${p.x},${p.y}`)).size).toBe(12);
    expect(g.dispatch({ t: "bewegen", units: ids, x: 20, y: 20, fx: 0, fy: 1 }).ok).toBe(true);
    runUntil(g, 60, () => idle(us));
    expect(idle(us)).toBe(true);
    for (const u of us) {
      expect(blocked.has(tileOf(u)), tileOf(u)).toBe(false);
      expect(Math.hypot(u.x - 20.5, u.y - 20.5)).toBeLessThan(COMMAND_TUNING.slotSearch + 2);
    }
    expect(new Set(us.map(tileOf)).size).toBe(12);
    // hinter der Mauer (y > 23) ist von hier aus nicht erreichbar, also bleibt alles davor
    for (const u of us) expect(Math.floor(u.y)).toBeLessThan(23);
  });

  it("die Gruppe läuft im Tempo des Langsamsten", () => {
    const g = empty();
    const us = troop(g, ["bogen", "schwert", "speer"], 5, 10);
    g.dispatch({ t: "bewegen", units: us.map((u) => u.id), x: 30, y: 10 });
    for (const u of us) expect(u.order).toMatchObject({ pace: UNITS.schwert.speed });
    const x0 = us.map((u) => u.x);
    run(g, 2 * TPS);
    // auf Gras (Kosten 1) höchstens Schwertkämpfer-Tempo
    us.forEach((u, i) => expect(u.x - x0[i]).toBeLessThanOrEqual(UNITS.schwert.speed * 2 + 0.05));
  });

  it("Formation wechseln stellt stehende Soldaten am Ort neu auf", () => {
    const g = empty();
    const us = troop(g, ["speer", "speer", "speer", "speer", "bogen", "bogen", "bogen", "bogen"], 15, 15);
    const ids = us.map((u) => u.id);
    expect(g.dispatch({ t: "formation", units: ids, formation: "linie" }).ok).toBe(true);
    for (const u of us) { expect(u.formation).toBe("linie"); expect(u.order.t).toBe("move"); }
    runUntil(g, 30, () => idle(us));
    // Blick wie zuvor nach (0, 1): Nahkämpfer in einer Reihe, Schützen eine Reihe dahinter (kleineres y)
    const my = new Set(us.filter((u) => u.key === "speer").map((u) => Math.floor(u.y)));
    const by = new Set(us.filter((u) => u.key === "bogen").map((u) => Math.floor(u.y)));
    expect(my.size).toBe(1);
    expect(by.size).toBe(1);
    expect([...by][0]).toBe([...my][0] - 1);
  });

  it("auf den Wehrgang geht es weiterhin der Reihe nach (keine Formation auf dem schmalen Gang)", () => {
    const g = empty();
    for (let x = 10; x <= 19; x++) buildNow(g, "mauer", x, 20, 0);
    buildNow(g, "treppe", 12, 21, 0);
    const us = troop(g, ["bogen", "bogen", "bogen"], 12, 26);
    const r = g.dispatch({ t: "bewegen", units: us.map((u) => u.id), x: 15, y: 20 });
    expect(r.ok).toBe(true);
    for (const u of us) expect(u.order).toMatchObject({ t: "move", layer: 1, y: 20 });
    runUntil(g, 40, () => idle(us));
    for (const u of us) expect(u.layer).toBe(1);
  });
});

describe("Angriffsmarsch", () => {
  it("greift Gegner unterwegs an und marschiert danach weiter; einfaches Bewegen läuft vorbei", () => {
    const g = empty();
    const us = troop(g, ["schwert", "schwert"], 4, 20);
    const e = dummy(g, 17, 21);
    expect(g.dispatch({ t: "angriffsbewegung", units: us.map((u) => u.id), x: 32, y: 20 }).ok).toBe(true);
    for (const u of us) expect(u.order.t).toBe("amove");
    let fought = false;
    runUntil(g, 60, () => { fought ||= us.some((u) => u.activity === "kaempft"); return e.dead && idle(us); });
    expect(fought).toBe(true);
    expect(e.dead).toBe(true);
    for (const u of us) expect(Math.hypot(u.x - 32.5, u.y - 20.5)).toBeLessThan(2.5);

    const h = empty();
    const vs = troop(h, ["schwert", "schwert"], 4, 20);
    const f = dummy(h, 17, 21);
    h.dispatch({ t: "bewegen", units: vs.map((u) => u.id), x: 32, y: 20 });
    runUntil(h, 60, () => idle(vs));
    expect(f.dead).toBe(false);
    expect(f.hp).toBe(f.maxHp);
  });

  it("ein fliehender Gegner zieht den Trupp höchstens marchLeash vom Kampfbeginn weg, danach geht der Marsch weiter", () => {
    const g = empty();
    const us = troop(g, ["schwert", "speer"], 4, 10);
    const e = dummy(g, 14, 10, 100000);
    g.dispatch({ t: "angriffsbewegung", units: us.map((u) => u.id), x: 32, y: 10 });
    let off = 0, fought = false;
    runUntil(g, 90, () => {
      fought ||= us.some((u) => u.ai.target === e.id);
      // der Gegner flieht quer zum Marschweg, bis an den Kartenrand
      if (fought && e.y < 37) { e.y = e.py = Math.min(37, e.y + 0.08); }
      off = Math.max(off, ...us.map((u) => Math.abs(u.y - 10.5)));
      return idle(us);
    });
    expect(fought).toBe(true);
    expect(e.dead).toBe(false);
    expect(off).toBeLessThan(COMMAND_TUNING.marchLeash + 1.5);
    for (const u of us) expect(Math.hypot(u.x - 32.5, u.y - 10.5)).toBeLessThan(2.5);
    for (const u of us) expect(u.ai.anchor).toBeUndefined();
  });

  it("Schützen schießen unterwegs aus der Reichweite", () => {
    const g = empty();
    const us = troop(g, ["bogen", "bogen"], 4, 20);
    const e = dummy(g, 16, 25);
    g.dispatch({ t: "angriffsbewegung", units: us.map((u) => u.id), x: 32, y: 20 });
    runUntil(g, 60, () => e.dead);
    expect(e.dead).toBe(true);
  });
});

describe("Patrouille", () => {
  it("läuft zwischen Standort und Wegmarke hin und her, kämpft unterwegs und patrouilliert weiter", () => {
    const g = empty();
    const us = troop(g, ["speer", "bogen"], 8, 20);
    const r = g.dispatch({ t: "patrouille", units: us.map((u) => u.id), pts: [{ x: 26, y: 20 }] });
    expect(r.ok).toBe(true);
    const o = us[0].order;
    expect(o.t).toBe("patrol");
    if (o.t !== "patrol") return;
    expect(o.pts).toHaveLength(2);
    let lo = 0, hi = 0, side: "lo" | "hi" | "" = "";
    run(g, 60 * TPS, () => {
      const u = us[0];
      if (u.x < 11 && side !== "lo") { side = "lo"; lo++; }
      if (u.x > 24 && side !== "hi") { side = "hi"; hi++; }
    });
    expect(hi).toBeGreaterThanOrEqual(2);
    expect(lo).toBeGreaterThanOrEqual(2);
    expect(us.every((u) => u.activity === "patrouilliert")).toBe(true);
    // Gegner am Weg
    const e = dummy(g, 17, 22);
    runUntil(g, 40, () => e.dead);
    expect(e.dead).toBe(true);
    run(g, 2 * TPS);
    for (const u of us) expect(u.order.t).toBe("patrol");
  });

  it("mehrere Wegmarken der Reihe nach, im Kreis", () => {
    const g = empty();
    const [u] = troop(g, ["schwert"], 10, 10);
    g.dispatch({ t: "patrouille", units: [u.id], pts: [{ x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }] });
    const seen: string[] = [];
    run(g, 80 * TPS, () => {
      const k = tileOf(u);
      if (["10,10", "20,10", "20,20", "10,20"].includes(k) && seen[seen.length - 1] !== k) seen.push(k);
    });
    expect(seen.slice(0, 6)).toEqual(["10,10", "20,10", "20,20", "10,20", "10,10", "20,10"]);
  });

  it("lehnt ohne Soldaten oder außerhalb der Karte ab", () => {
    const g = empty();
    const [u] = troop(g, ["speer"], 5, 5);
    const p = spawn(g, "tageloehner", 0, 6, 6);
    expect(g.dispatch({ t: "patrouille", units: [p.id], pts: [{ x: 10, y: 10 }] }).ok).toBe(false);
    expect(g.dispatch({ t: "patrouille", units: [u.id], pts: [{ x: -5, y: 10 }] }).ok).toBe(false);
  });
});

describe("Rückzug", () => {
  it("läuft schneller zum Bergfried, kämpft nicht und steht dann vor der Tür", () => {
    const mk = () => {
      const g = createGame({ seed: 1, raids: false });
      const seat = seatOf(g.state)!;
      const [ex, ey] = entrance(seat.key, seat.x, seat.y, seat.o);
      const us = troop(g, ["speer", "speer", "schwert"], ex + 12, ey + 1);
      const e = spawn(g, "schwert", 1, ex + 13, ey + 2);
      e.hp = e.maxHp = 5000;
      return { g, us, e, ex, ey };
    };
    const a = mk();
    expect(a.g.dispatch({ t: "rueckzug", units: a.us.map((u) => u.id) }).ok).toBe(true);
    for (const u of a.us) expect(u.order.t).toBe("retreat");
    const targets = a.us.map((u) => (u.order.t === "retreat" ? [u.order.x, u.order.y] : [0, 0]));
    let ta = 0, struck = false, hpDuring = a.e.hp, chased = false;
    runUntil(a.g, 60, () => {
      ta++;
      // solange sie sich zurückziehen: kein Schlag, kein Ziel, obwohl der Angreifer sie verfolgt
      const back = a.us.filter((u) => u.order.t === "retreat");
      struck ||= back.some((u) => u.anim === "angriff" || u.ai.target !== 0);
      chased ||= a.e.ai.target !== 0 && back.length > 0;
      if (back.length === a.us.length) hpDuring = a.e.hp;
      return !back.length;
    });
    expect(chased).toBe(true);
    expect(struck).toBe(false);
    expect(hpDuring).toBe(a.e.maxHp);
    // angekommen vor der Tür des Bergfrieds (danach wehren sie sich wieder, Haltung aggressiv)
    for (const u of a.us) {
      expect(u.order.t).toBe("idle");
      expect(Math.hypot(u.x - (a.ex + 0.5), u.y - (a.ey + 0.5))).toBeLessThan(4);
    }
    // dieselben Wege als normaler Marsch dauern länger (Faktor COMMAND_TUNING.retreatSpeed)
    const b = mk();
    let tb = 0;
    b.us.forEach((u, i) => b.g.dispatch({ t: "bewegen", units: [u.id], x: targets[i][0], y: targets[i][1] }));
    runUntil(b.g, 60, () => { tb++; return b.us.every((u) => u.order.t !== "move"); });
    expect(ta).toBeLessThan(tb / COMMAND_TUNING.retreatSpeed + 10);
    expect(ta).toBeLessThan(tb * 0.85);
  });

  it("verlässt auch Posten und Patrouille", () => {
    const g = createGame({ seed: 1, raids: false });
    const seat = seatOf(g.state)!;
    const [ex, ey] = entrance(seat.key, seat.x, seat.y, seat.o);
    const us = troop(g, ["bogen", "speer"], ex + 8, ey + 4);
    g.dispatch({ t: "patrouille", units: us.map((u) => u.id), pts: [{ x: ex + 14, y: ey + 4 }] });
    run(g, 3 * TPS);
    g.dispatch({ t: "rueckzug", units: us.map((u) => u.id) });
    for (const u of us) expect(u.activity === "zieht_zurueck" || u.order.t === "retreat").toBe(true);
    runUntil(g, 60, () => idle(us));
    for (const u of us) expect(Math.hypot(u.x - (ex + 0.5), u.y - (ey + 0.5))).toBeLessThan(4);
  });
});

describe("Haltungen", () => {
  it("Werte: aggressiv entspricht dem bisherigen Verhalten (Sichtweite, 1,5-fach verfolgen)", () => {
    expect(STANCES.aggressiv.engage).toBe(TUNING.sight);
    expect(STANCES.aggressiv.leash).toBe(TUNING.sight * 1.5);
    expect(STANCES.defensiv.engage!).toBeLessThan(TUNING.sight);
  });

  it("aggressiv greift in Sichtweite an, defensiv erst aus der Nähe", () => {
    for (const [stance, expectFight] of [["aggressiv", true], ["defensiv", false]] as const) {
      const g = empty();
      const [u] = troop(g, ["speer"], 10, 10);
      g.dispatch({ t: "haltung", units: [u.id], stance });
      dummy(g, 16, 10);
      run(g, 3 * TPS);
      expect(u.ai.target !== 0, stance).toBe(expectFight);
    }
  });

  it("defensiv verfolgt nur kurz und kehrt an seinen Platz zurück, aggressiv verfolgt weit", () => {
    const maxX: Record<string, number> = {};
    for (const stance of ["defensiv", "aggressiv"] as const) {
      const g = empty(48);
      worldOf(g).meta.raidSpawn = [47, 10];
      const [u] = troop(g, ["speer"], 10, 10);
      g.dispatch({ t: "haltung", units: [u.id], stance });
      const e = dummy(g, 13, 10, 5000);
      runUntil(g, 5, () => u.ai.target === e.id);
      expect(u.ai.target).toBe(e.id);
      e.ai.retreat = true; // flieht zum Kartenrand
      let mx = 0;
      run(g, 25 * TPS, () => { mx = Math.max(mx, u.x); });
      maxX[stance] = mx;
      if (stance === "defensiv") {
        expect(mx).toBeLessThanOrEqual(10.5 + STANCES.defensiv.leash + 1.5);
        expect(Math.hypot(u.x - 10.5, u.y - 10.5)).toBeLessThan(1);
      }
    }
    expect(maxX.aggressiv).toBeGreaterThan(maxX.defensiv + 4);
  });

  it("Stellung halten: bleibt stehen, Schützen schießen in Reichweite, Nahkämpfer nur, wer heran kommt", () => {
    const g = empty();
    const [s, b] = troop(g, ["speer", "bogen"], 10, 10);
    g.dispatch({ t: "haltung", units: [s.id, b.id], stance: "stellung" });
    const e = dummy(g, 10, 15, 5000);
    const at = [s.x, s.y, b.x, b.y];
    let shots = 0;
    run(g, 10 * TPS, () => { shots += g.state.projectiles.filter((p) => p.team === 0).length > 0 ? 1 : 0; });
    expect(shots).toBeGreaterThan(0);
    expect(e.hp).toBeLessThan(e.maxHp);
    expect(Math.hypot(s.x - at[0], s.y - at[1])).toBeLessThan(0.3);
    expect(Math.hypot(b.x - at[2], b.y - at[3])).toBeLessThan(0.3);
    expect(s.activity).toBe("haelt");
  });

  it("Halten (H) ist „Stellung halten“; eine andere Haltung hebt es auf", () => {
    const g = empty();
    const [u] = troop(g, ["schwert"], 10, 10);
    g.dispatch({ t: "halten", units: [u.id] });
    expect(u.order.t).toBe("hold");
    expect(u.stance).toBe("stellung");
    g.dispatch({ t: "haltung", units: [u.id], stance: "defensiv" });
    expect(u.order.t).toBe("idle");
    expect(u.stance).toBe("defensiv");
    expect(g.dispatch({ t: "haltung", units: [u.id], stance: "unsinn" as never }).ok).toBe(false);
  });
});

describe("Befehle speichern und laden", () => {
  it("Patrouille, Rückzug, Angriffsmarsch, Haltung und Formation laufen nach dem Laden identisch weiter", () => {
    const g = createGame({ seed: 2, raids: false });
    const seat = seatOf(g.state)!;
    const a = troop(g, ["speer", "bogen", "schwert"], seat.x + 8, seat.y + 6);
    const b = troop(g, ["speer", "speer"], seat.x - 8, seat.y + 6);
    const c = troop(g, ["bogen", "schwert"], seat.x + 2, seat.y + 10);
    dummy(g, seat.x + 14, seat.y + 6);
    g.dispatch({ t: "formation", units: a.map((u) => u.id), formation: "locker" });
    g.dispatch({ t: "patrouille", units: a.map((u) => u.id), pts: [{ x: seat.x + 16, y: seat.y + 6 }, { x: seat.x + 16, y: seat.y + 12 }] });
    g.dispatch({ t: "haltung", units: b.map((u) => u.id), stance: "defensiv" });
    g.dispatch({ t: "angriffsbewegung", units: b.map((u) => u.id), x: seat.x - 2, y: seat.y + 14, fx: 1, fy: 0 });
    run(g, 4 * TPS);
    g.dispatch({ t: "rueckzug", units: c.map((u) => u.id) });
    run(g, 1 * TPS);
    const json = g.save();
    const h = loadGame(json);
    expect(h.save()).toBe(json);
    for (let i = 0; i < 6; i++) { run(g, 2 * TPS); run(h, 2 * TPS); expect(h.save()).toBe(g.save()); }
    const ua = h.state.units.find((u) => u.id === a[0].id)!;
    expect(ua.formation).toBe("locker");
    expect(ua.order.t).toBe("patrol");
    expect(h.state.units.find((u) => u.id === b[0].id)!.stance).toBe("defensiv");
  });
});
