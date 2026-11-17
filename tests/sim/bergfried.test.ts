/**
 * Bergfried (Stadtzentrum, Sitz des Burgherrn), Ausbaustufen und Forschung: Voraussetzungen, Kosten aus dem Lager
 * (Träger bringen die Waren), Abschluss, Effekte, Abbrechen, Determinismus, Ausbau mit Baustelle, Stationieren auf der
 * Wehrplattform und die Niederlage, wenn der Bergfried fällt.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, START, TECHS, TECH_KEYS, TUTORIAL, UNITS, levelDef, type TechKey } from "../../src/data";
import { createGame, loadGame, entrance, footprintTiles } from "../../src/sim";
import { damageBuilding } from "../../src/sim/combat";
import { buildNow, run, spawn, stockUp } from "../../src/sim/debug";
import type { Simulation } from "../../src/sim/game";
import { incomeOf, techMissing, techStatus, unlocksOf, upgradeMissing } from "../../src/sim/research";
import type { Building } from "../../src/sim/types";
import { TPS, type SBuilding, type SUnit, type World } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";
import BUILD_DEFS from "../../tools/blender/buildings/buildings.json";
import SHEET from "../../assets/buildings/vorgerendert/sheet.json";

const worldOf = (g: Simulation): World => (g as unknown as { world: World }).world;
const seat = (g: Simulation) => g.state.buildings.find((b) => b.key === "bergfried") as SBuilding;
const finish = (g: Simulation, max = 240) => run(g, max * TPS, () => !g.state.research.cur);
/** Forschung als erledigt eintragen (für Tests, die nur die Folge brauchen). */
const grant = (g: Simulation, ...keys: TechKey[]) => { for (const k of keys) worldOf(g).s.research.done.push(k); };

describe("Bergfried als Stadtzentrum", () => {
  it("steht ab Beginn neben dem Lagerhaus, mit Tür zur Straße, und ist das einzige seiner Art", () => {
    expect(START.buildings.some((b) => b.key === "bergfried")).toBe(true);
    const g = createGame({ seed: 1 });
    const k = seat(g), l = lagerOf(g);
    expect(k.built).toBe(1);
    expect(k.level ?? 1).toBe(1);
    expect(k.hp).toBe(BUILDINGS.bergfried.hp);
    // daneben: höchstens zwei Felder Abstand zwischen den Grundrissen
    const gap = Math.max(l.x - (k.x + 3), k.x - (l.x + 3));
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(2);
    const [ex, ey] = entrance("bergfried", k.x, k.y, k.o);
    expect(g.state.tiles[ey * g.state.w + ex].terrain).toBe("erde");
    // Wohnraum kommt aus dem Bergfried
    expect(g.state.housing).toBe(BUILDINGS.bergfried.housing);
    // kein zweiter Bergfried, kein Abriss
    const [x, y] = [k.x, k.y + 8];
    expect(g.canPlace("bergfried", x, y, 0).ok).toBe(false);
    expect(g.dispatch({ t: "abreissen", id: k.id }).ok).toBe(false);
  });

  it("Stufen werden größer und stärker: Trefferpunkte, Wohnraum, Steuern, ab Stufe 2 Posten", () => {
    const lv = BUILDINGS.bergfried.levels!;
    expect(lv).toHaveLength(3);
    for (let i = 1; i < lv.length; i++) {
      expect(lv[i].hp).toBeGreaterThan(lv[i - 1].hp);
      expect(lv[i].housing!).toBeGreaterThan(lv[i - 1].housing!);
      expect(lv[i].income!).toBeGreaterThan(lv[i - 1].income!);
      expect(lv[i].upgrade?.tech).toBeDefined();
      expect(new Set(lv.map((l) => l.sprite)).size).toBe(lv.length);
    }
    expect(lv[0].posts ?? []).toHaveLength(0);
    expect(lv[1].posts!.length).toBeGreaterThanOrEqual(4);
    expect(lv[2].posts!.length).toBeGreaterThan(lv[1].posts!.length);
    expect(levelDef("bergfried", 2).walkway).toBe(2);
  });

  it("bringt Steuern: Gold wächst mit der Zeit, auf höherer Stufe schneller", () => {
    const g = createGame({ seed: 1, raids: false });
    const g0 = g.state.gold;
    run(g, 60 * TPS);
    expect(g.state.gold - g0).toBe(BUILDINGS.bergfried.levels![0].income);
    const per1 = incomeOf(g.state);
    seat(g).level = 2;
    expect(incomeOf(g.state)).toBeGreaterThan(per1);
  });
});

describe("Forschung", () => {
  it("jede Technik hat Kosten, Dauer, Ikone und deutsche Texte; Voraussetzungen zeigen auf vorhandene Techniken", () => {
    expect(TECH_KEYS.length).toBeGreaterThanOrEqual(5);
    const icons = new Set<number>();
    for (const k of TECH_KEYS) {
      const t = TECHS[k];
      expect(t.seconds).toBeGreaterThan(0);
      expect(Object.values(t.cost).some((n) => (n ?? 0) > 0)).toBe(true);
      expect(t.desc.length).toBeGreaterThan(20);
      icons.add(t.icon);
      for (const r of t.requires?.techs ?? []) expect(TECH_KEYS).toContain(r);
    }
    expect(icons.size).toBe(TECH_KEYS.length);
    // Die Stufen des Bergfrieds hängen an zwei Techniken
    expect(unlocksOf("steinbau").join()).toContain("Stufe 2");
    expect(unlocksOf("festungsbau").join()).toContain("Stufe 3");
  });

  it("Voraussetzungen: Festungsbau braucht Steinbaukunst, eine Kaserne und Bergfried Stufe 2", () => {
    const g = createGame({ seed: 1, raids: false });
    expect(techStatus(g.state, "steinbau")).toBe("verfuegbar");
    expect(techStatus(g.state, "festungsbau")).toBe("gesperrt");
    expect(techMissing(g.state, "festungsbau")).toEqual(["Forschung: Steinbaukunst", "Gebäude: Kaserne", "Bergfried Stufe 2 (Steinerner Bergfried)"]);
    const r = g.dispatch({ t: "forschen", tech: "festungsbau" });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Steinbaukunst");
    grant(g, "steinbau");
    buildNow(g, "kaserne", 36, 41, 0);
    seat(g).level = 2;
    expect(techMissing(g.state, "festungsbau")).toEqual([]);
    expect(techStatus(g.state, "festungsbau")).toBe("verfuegbar");
  });

  it("Kosten: Gold sofort, die Waren tragen Tagelöhner aus dem Lager in den Bergfried, erst dann läuft die Zeit", () => {
    const g = createGame({ seed: 1, raids: false });
    const s = g.state;
    const gold0 = s.gold, stone0 = s.stock.stein;
    expect(g.dispatch({ t: "forschen", tech: "steinbau" }).ok).toBe(true);
    expect(s.gold).toBe(gold0 - TECHS.steinbau.cost.gold!);
    expect(s.stock.stein).toBe(stone0); // noch im Lager
    expect(techStatus(s, "steinbau")).toBe("laeuft");
    // zweite Forschung gleichzeitig geht nicht
    expect(g.dispatch({ t: "forschen", tech: "werkzeuge" }).ok).toBe(false);
    // Träger mit Stein zum Bergfried
    let carried = false, timeBeforeDelivery = 0;
    run(g, 120 * TPS, () => {
      const cur = s.research.cur!;
      if (s.units.some((u) => { const j = (u as SUnit).ai.job; return j?.k === "supply" && j.rk === "steinbau" && u.carry === "stein"; })) carried = true;
      if (Object.keys(cur.needs).length) timeBeforeDelivery = Math.max(timeBeforeDelivery, cur.t);
      return Object.keys(cur.needs).length === 0;
    });
    expect(carried).toBe(true);
    expect(timeBeforeDelivery).toBe(0);
    expect(s.research.cur!.got.stein).toBe(TECHS.steinbau.cost.stein);
    expect(s.stock.stein).toBe(stone0 - TECHS.steinbau.cost.stein!);
    finish(g);
    expect(techStatus(s, "steinbau")).toBe("erforscht");
    expect(s.messages.some((m) => m.text.startsWith("Forschung abgeschlossen: Steinbaukunst"))).toBe(true);
  });

  it("Abbrechen gibt Gold und schon angelieferte Waren zurück", () => {
    const g = createGame({ seed: 1, raids: false });
    const s = g.state;
    const gold0 = s.gold, holz0 = s.stock.holz;
    g.dispatch({ t: "forschen", tech: "werkzeuge" });
    run(g, 60 * TPS, () => (s.research.cur!.got.holz ?? 0) >= 3);
    expect(g.dispatch({ t: "forschung_abbrechen" }).ok).toBe(true);
    expect(s.research.cur).toBeNull();
    run(g, 40 * TPS); // Träger mit Holz in der Hand bringen es zurück
    expect(s.gold).toBeGreaterThanOrEqual(gold0); // plus Steuern
    expect(s.stock.holz).toBe(holz0);
    expect(s.units.some((u) => (u as SUnit).ai.job?.k === "supply")).toBe(false);
  });

  it("Gehärtete Werkzeuge: Holzfäller arbeiten ein Viertel schneller", () => {
    const work = (tech: boolean) => {
      const g = createGame({ seed: 1, raids: false });
      if (tech) grant(g, "werkzeuge");
      const [x, y] = findSpot(g, "holzfaeller", 17, 30);
      const h = buildNow(g, "holzfaeller", x, y, 0);
      let ticks = 0;
      run(g, 200 * TPS, () => { if (g.state.units.some((u) => u.home === h.id && u.anim === "hacken")) ticks++; return false; });
      return ticks;
    };
    const slow = work(false), fast = work(true);
    expect(fast).toBeLessThan(slow * 0.95);
  });

  it("Langbogen und Schwere Rüstung wirken auf vorhandene und neu ausgebildete Soldaten, nicht auf Angreifer", () => {
    const g = createGame({ seed: 1, raids: false });
    const w = worldOf(g);
    const archer = spawn(g, "bogen", 0, 30, 40), spear = spawn(g, "speer", 0, 31, 40), foe = spawn(g, "bogen", 1, 50, 40);
    stockUp(g, "holz", 20);
    buildNow(g, "kaserne", 36, 41, 0);
    g.dispatch({ t: "forschen", tech: "langbogen" });
    finish(g);
    expect(archer.boost?.range).toBe(1.5);
    expect(foe.boost).toBeUndefined();
    grant(g, "steinbau"); seat(g).level = 2;
    stockUp(g, "stein", 10);
    expect(g.dispatch({ t: "forschen", tech: "ruestung" }).ok).toBe(true);
    finish(g);
    expect(spear.boost?.armor).toBe(2);
    // Neu ausgebildeter Speerträger bekommt den Bonus ebenfalls
    const k = g.state.buildings.find((b) => b.key === "kaserne")!;
    expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: "speer" }).ok).toBe(true);
    run(g, 90 * TPS, () => g.state.units.filter((u) => u.key === "speer" && u.team === 0).length === 2);
    const fresh = g.state.units.filter((u) => u.key === "speer" && u.team === 0).find((u) => u.id !== spear.id)!;
    expect(fresh.boost?.armor).toBe(2);
    expect(w.s.research.done).toEqual(expect.arrayContaining(["langbogen", "ruestung"]));
  });

  it("Tragjoch: Träger mit Last gehen schneller", async () => {
    const { speedOf } = await import("../../src/sim/move");
    const g = createGame({ scenario: "leer", size: 30 });
    const u = spawn(g, "tageloehner", 0, 10, 10);
    u.carry = "holz";
    const v0 = speedOf(worldOf(g), u);
    grant(g, "tragjoch");
    expect(speedOf(worldOf(g), u)).toBeCloseTo(v0 * 1.2);
  });

  it("ist deterministisch und übersteht Speichern und Laden mitten in der Forschung", () => {
    const play = () => {
      const g = createGame({ seed: 5, raids: false });
      g.dispatch({ t: "forschen", tech: "werkzeuge" });
      run(g, 25 * TPS);
      return g;
    };
    const a = play(), b = play();
    expect(a.save()).toBe(b.save());
    const c = loadGame(a.save());
    run(a, 60 * TPS); run(c, 60 * TPS);
    expect(c.save()).toBe(a.save());
    expect(a.state.research.done).toContain("werkzeuge");
  });

  it("Gebäude und Einheiten mit Forschungssperre (BuildingDef.tech, UnitDef.tech) sind bis zum Abschluss gesperrt", () => {
    const g = createGame({ seed: 1, raids: false });
    const k = buildNow(g, "kaserne", 36, 41, 0);
    const oldB = BUILDINGS.turm.tech, oldU = UNITS.schwert.tech;
    try {
      BUILDINGS.turm.tech = "festungsbau";
      UNITS.schwert.tech = "ruestung";
      const [x, y] = findSpot(g, "haus", 40, 30);
      const r = g.canPlace("turm", x, y, 0);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("Erst erforschen: Festungsbau");
      expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: "schwert" }).reason).toBe("Erst erforschen: Schwere Rüstung");
      expect(unlocksOf("festungsbau")).toContain("Mauerturm");
      grant(g, "festungsbau", "ruestung");
      expect(g.canPlace("turm", x, y, 0).ok).toBe(true);
      expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: "schwert" }).ok).toBe(true);
    } finally {
      if (oldB) BUILDINGS.turm.tech = oldB; else delete BUILDINGS.turm.tech;
      if (oldU) UNITS.schwert.tech = oldU; else delete UNITS.schwert.tech;
    }
  });
});

describe("Ausbau des Bergfrieds", () => {
  it("Stufe 2 braucht Steinbaukunst; Träger liefern das Material an, ein Tagelöhner baut, danach mehr Trefferpunkte und eine Wehrplattform", () => {
    const g = createGame({ seed: 1, raids: false });
    const s = g.state, k = seat(g);
    expect(upgradeMissing(s, k)).toEqual(["Forschung: Steinbaukunst"]);
    expect(g.dispatch({ t: "ausbauen", building: k.id }).ok).toBe(false);
    grant(g, "steinbau");
    stockUp(g, "stein", 20);
    const gold0 = s.gold;
    const up = BUILDINGS.bergfried.levels![1].upgrade!;
    expect(g.dispatch({ t: "ausbauen", building: k.id }).ok).toBe(true);
    expect(s.gold).toBe(gold0 - up.cost.gold!);
    expect(k.upgrade).toEqual({ level: 2, t: 0 });
    expect(k.needs).toEqual({ stein: up.cost.stein, holz: up.cost.holz });
    expect(g.dispatch({ t: "ausbauen", building: k.id }).ok).toBe(false); // läuft schon
    let built = false, siteSeen = false;
    run(g, 200 * TPS, () => {
      if ((k.site.stein ?? 0) > 0) siteSeen = true;
      if (s.units.some((u) => (u as SUnit).ai.job?.k === "build" && (u as SUnit).ai.job!.k === "build" && u.anim === "bauen")) built = true;
      return (k.level ?? 1) === 2;
    });
    expect(siteSeen).toBe(true);
    expect(built).toBe(true);
    expect(k.level).toBe(2);
    expect(k.upgrade).toBeUndefined();
    expect(k.hp).toBe(levelDef("bergfried", 2).hp);
    run(g, 1);
    expect(s.housing).toBe(levelDef("bergfried", 2).housing);
    // Wehrplattform: alle Grundriss-Tiles auf Laufebene 2, Höhe = deck
    const w = worldOf(g);
    for (const [x, y] of footprintTiles("bergfried", k.x, k.y, k.o)) {
      expect(g.walkLayerAt(x, y)).toBe(2);
      expect(w.nav.z[w.nav.node(2, x, y)]).toBe(levelDef("bergfried", 2).deck);
    }
  });

  it("auf Stufe 2 stellt T Bogenschützen auf die Plattform, sie schießen mit Höhenbonus", () => {
    const g = createGame({ seed: 1, raids: false });
    const k = seat(g);
    k.level = 2;
    worldOf(g).nav.rebuild();
    const ids = [0, 1, 2, 3].map((i) => spawn(g, "bogen", 0, 30 + i, 37).id);
    const r = g.dispatch({ t: "stationieren", units: ids });
    expect(r.ok).toBe(true);
    expect(r.ids).toHaveLength(4);
    run(g, 40 * TPS);
    for (const id of ids) {
      const u = g.state.units.find((q) => q.id === id)!;
      expect(u.order.t).toBe("station");
      expect(u.order.t === "station" && u.order.building).toBe(k.id);
      expect(u.layer).toBe(2);
      expect(u.z).toBe(5);
    }
    // Ein Angreifer am Fuß des Turms wird von oben getroffen
    const foe = spawn(g, "speer", 1, k.x + 5, k.y + 1);
    const hp0 = foe.hp;
    run(g, 6 * TPS);
    expect(foe.hp).toBeLessThan(hp0);
  });

  it("Angreifer kommen nicht durch die Tür auf die Plattform", () => {
    const g = createGame({ seed: 1, raids: false });
    const k = seat(g);
    k.level = 2;
    const w = worldOf(g);
    w.nav.rebuild();
    const [ex, ey] = entrance("bergfried", k.x, k.y, k.o);
    const own = w.nav.comp[0], foe = w.nav.comp[1];
    const plat = w.nav.node(2, k.x + 1, k.y + 1), door = w.nav.node(0, ex, ey);
    expect(own[plat]).toBe(own[door]);
    expect(foe[plat]).not.toBe(foe[door]);
  });

  it("Stufe 3 (Burgfried) braucht Festungsbau und hat sechs Posten auf höherer Plattform", () => {
    const g = createGame({ seed: 1, raids: false });
    const k = seat(g);
    k.level = 2;
    expect(upgradeMissing(g.state, k)).toEqual(["Forschung: Festungsbau"]);
    grant(g, "festungsbau");
    stockUp(g, "stein", 60); stockUp(g, "holz", 20);
    expect(g.dispatch({ t: "ausbauen", building: k.id }).ok).toBe(true);
    run(g, 300 * TPS, () => k.level === 3);
    expect(k.level).toBe(3);
    expect(levelDef("bergfried", 3).posts).toHaveLength(6);
    expect(worldOf(g).nav.z[worldOf(g).nav.node(2, k.x + 1, k.y + 1)]).toBe(6);
    expect(upgradeMissing(g.state, k)).toEqual(["Höchste Stufe erreicht"]);
  });
});

describe("Niederlage", () => {
  it("fällt der Bergfried, ist die Partie verloren (Meldung, outcome)", () => {
    const g = createGame({ seed: 1, raids: false });
    const w = worldOf(g), k = seat(g);
    expect(g.state.outcome).toBeUndefined();
    let n = 0;
    while (g.state.buildings.includes(k) && n++ < 10000) damageBuilding(w, "schwert", k);
    expect(g.state.buildings.includes(k)).toBe(false);
    expect(g.state.outcome).toBe("niederlage");
    expect(g.state.messages.at(-1)!.text).toBe("Der Bergfried ist gefallen! Die Burg ist verloren.");
    // ohne Bergfried keine Forschung mehr
    expect(g.dispatch({ t: "forschen", tech: "werkzeuge" }).ok).toBe(false);
  });

  it("die Angreifer kennen den Bergfried als Ziel: ohne jede Verteidigung reißen spätere Wellen ihn ein", () => {
    const g = createGame({ seed: 1 });
    // Bauten weg, damit die Angreifer gleich zum Bergfried ziehen (nur das Lager bleibt)
    run(g, (START.raid.firstSeconds + START.raid.everySeconds * 3) * TPS, () => g.state.outcome === "niederlage");
    expect(g.state.outcome).toBe("niederlage");
  });

  it("ohne Verteidigung, aber mit Wirtschaft: Welle 1 kommt erst nach den Werkstätten an den Bergfried und braucht dort über zwei Minuten", () => {
    for (const rng of [1, 2, 3]) {
      const g = createGame({ seed: 1 });
      worldOf(g).meta.rng = rng * 7919 + 13;
      buildNow(g, "holzfaeller", 17, 37, 0);
      buildNow(g, "steinbruch", 35, 16, 0);
      buildNow(g, "haus", 28, 39, 0);
      buildNow(g, "kaserne", 36, 41, 0);
      const k = seat(g);
      let hit = 0;
      run(g, 900 * TPS, (t) => { if (!hit && k.hp < BUILDINGS.bergfried.hp) hit = t; return g.state.outcome === "niederlage"; });
      expect(hit).toBeGreaterThan((START.raid.firstSeconds + 60) * TPS);
      // Zeit zum Gegensteuern: die Meldung „Bergfried wird angegriffen!“ kommt lange vor dem Fall
      expect(g.state.tick - hit).toBeGreaterThan(120 * TPS);
      expect(g.state.messages.some((m) => m.text === "Bergfried wird angegriffen!")).toBe(true);
    }
  });
});

describe("Bergfried-Grafik", () => {
  it("jede Stufe hat ihr Sprite und ihre Innenansicht im Gebäudeblatt, Posten wie im Blender-Modell", () => {
    const keys = new Set((SHEET as { units: { key: string }[] }).units.map((u) => u.key));
    const defs = BUILD_DEFS as Record<string, { posts?: number[][]; front?: boolean; cutaway?: boolean; variants: string[] }>;
    BUILDINGS.bergfried.levels!.forEach((_, i) => {
      const lv = levelDef("bergfried", i + 1);
      expect(keys.has(lv.sprite), lv.sprite).toBe(true);
      expect(keys.has(lv.interior!.sprite), lv.interior!.sprite).toBe(true);
      expect(defs[lv.sprite].posts ?? [], lv.sprite).toEqual(lv.posts ?? []);
      if (lv.posts?.length) expect(defs[lv.sprite].front).toBe(true);
      const inner = defs[lv.interior!.sprite];
      expect(inner.cutaway).toBe(true);
      expect(inner.variants).toHaveLength(2); // 0 Burgherr, 1 mit Gelehrtem (Forschung läuft)
    });
  });
});

describe("Einführung", () => {
  it("nennt Bergfried und Forschung", () => {
    const text = TUTORIAL.map((t) => t.text).join(" ");
    expect(text).toContain("Bergfried");
    expect(text).toContain("Steinbaukunst");
    expect(TUTORIAL.some((t) => t.done && "researched" in t.done)).toBe(true);
    expect(TUTORIAL.some((t) => t.done && "level" in t.done)).toBe(true);
  });
});

export type { Building };
