/**
 * Militärwirtschaft (ADR 0014): Erzvorkommen und Erzmine, Kette Erz → Eisen → Waffe/Rüstung → Rekrut über echte Ticks,
 * Forschungssperren für Gebäude, Rezepte und Einheiten, Rekrutierung mit mehreren Ausrüstungsstücken (Abbruch,
 * Speichern/Laden), Werkstätten in allen vier Ausrichtungen, Schadensmatrix im Gefecht.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, RECIPES, RESOURCE_TAGS, TECHS, UNITS, trainCost, type BuildingKey, type Good, type TechKey, type UnitKey } from "../../src/data";
import { createGame, loadGame } from "../../src/sim";
import { expectedDamage } from "../../src/sim/combat";
import { buildNow, run, spawn, stockUp, worldOf } from "../../src/sim/debug";
import type { Simulation } from "../../src/sim/game";
import { rockTag } from "../../src/sim/jobs";
import { TPS, type SBuilding } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

const grant = (g: Simulation, ...keys: TechKey[]) => { for (const k of keys) worldOf(g).s.research.done.push(k); };
const stored = (g: Simulation, good: Good) => g.state.buildings.reduce((n, b) => n + b.slots.reduce((k, s) => k + (s.good === good ? s.amount : 0), 0), 0);
/** Menge einer Ware überall: Lager, Puffer, Ausgabestapel, laufende Arbeitsgänge (Eingänge), in Trägerhänden. */
function everywhere(g: Simulation, good: Good): number {
  let n = stored(g, good);
  for (const b of g.state.buildings) {
    const p = b.proc;
    if (!p) continue;
    n += (p.in[good] ?? 0) + (p.out[good] ?? 0);
    if (p.busy) n += RECIPES[p.recipe].inputs[good] ?? 0;
  }
  for (const u of g.state.units) if (!u.dead && u.carry === good) n++;
  return n;
}
function place(g: Simulation, key: BuildingKey, cx: number, cy: number, o = 0): SBuilding {
  const [x, y] = findSpot(g, key, cx, cy, o);
  return buildNow(g, key, x, y, o);
}
/** Zweites Lagerhaus: Das Startlager ist mit den Startwaren voll (acht Fächer), neue Waren brauchen Platz. */
const moreRoom = (g: Simulation) => place(g, "lager", lagerOf(g).x - 1, lagerOf(g).y + 9);
const ores = (g: Simulation) => g.state.rocks.filter((r) => rockTag(r) === "erz");
/** Erzmine am ersten Erzbrocken. */
function mineAtOre(g: Simulation, o = 0): SBuilding {
  const r = ores(g)[0];
  return place(g, "erzmine", r.x, r.y, o);
}

describe("Erzvorkommen", () => {
  it("jede Karte hat Erzbrocken auf Fels am Rand des Felsfelds, und eine Erzmine findet daneben Platz", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = createGame({ seed, raids: false });
      const e = ores(g);
      expect(e.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      for (const r of e) {
        expect(g.state.tiles[r.y * g.state.w + r.x].terrain, `seed ${seed}`).toBe("fels");
        expect(r.amount).toBeGreaterThanOrEqual(18);
      }
      // Steinbrocken gibt es weiterhin, getrennt vom Erz
      expect(g.state.rocks.filter((r) => rockTag(r) === "rock").length).toBeGreaterThanOrEqual(8);
      expect(() => mineAtOre(g)).not.toThrow();
    }
  });

  it("Erzmine nur am Erz: ohne Erzbrocken im Umkreis lehnt der Bauplan mit der Meldung aus den Daten ab", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const c = g.canPlace("erzmine", l.x + 4, l.y + 6, 0);
    expect(c.ok).toBe(false);
    expect(c.reason).toBe(RESOURCE_TAGS.erz.none);
  });

  it("der Steinbruch baut nie Erz ab, die Erzmine nie Stein", () => {
    const g = createGame({ seed: 1, raids: false });
    const before = new Map(g.state.rocks.map((r) => [r.id, r.amount]));
    const q = place(g, "steinbruch", 35, 16);
    const m = mineAtOre(g);
    const carried = new Set<string>();
    run(g, 200 * TPS, () => {
      for (const u of g.state.units) {
        if (u.key === "steinmetz" && u.carry) carried.add(`steinmetz:${u.carry}`);
        if (u.key === "bergmann" && u.carry) carried.add(`bergmann:${u.carry}`);
      }
    });
    expect([...carried].sort()).toEqual(["bergmann:erz", "steinmetz:stein"]);
    let stone = 0, ore = 0;
    for (const r of g.state.rocks) if (r.amount < before.get(r.id)!) { if (rockTag(r) === "erz") ore++; else stone++; }
    // abgebaute (ganz verschwundene) Brocken zählen mit
    const gone = [...before.keys()].filter((id) => !g.state.rocks.some((r) => r.id === id)).length;
    expect(ore + stone + gone).toBeGreaterThan(1);
    expect(ore).toBeGreaterThan(0);
    expect(q.built).toBe(1);
    expect(m.built).toBe(1);
  });
});

describe("Forschungssperren", () => {
  it("Schmelzhütte und Rüstungsschmiede erst nach Forschung; die Meldung nennt die Technik", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const [x, y] = findSpot(g, "waffenschmiede", l.x + 6, l.y - 6);
    for (const key of ["schmelzhuette", "ruestungsschmiede"] as BuildingKey[]) {
      const tech = BUILDINGS[key].tech!;
      expect(tech).toBeDefined();
      const r = g.dispatch({ t: "bauen", key, x, y, o: 0 });
      expect(r.ok, key).toBe(false);
      expect(r.reason, key).toContain(TECHS[tech].name);
    }
    expect(g.dispatch({ t: "bauen", key: "waffenschmiede", x, y, o: 0 }).ok).toBe(true);
    grant(g, "rennofen");
    const [sx, sy] = findSpot(g, "schmelzhuette", l.x + 2, l.y - 6);
    expect(g.dispatch({ t: "bauen", key: "schmelzhuette", x: sx, y: sy, o: 0 }).ok).toBe(true);
  });

  it("Pikenschmieden und Armbrustbau erst nach Forschung; Schwert, Bogen und Speer sofort", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const ws = place(g, "waffenschmiede", l.x + 6, l.y - 6);
    const bg = place(g, "bognerei", l.x + 2, l.y - 6);
    const r1 = g.dispatch({ t: "rezept", building: ws.id, recipe: "pike_schmieden" });
    expect(r1.ok).toBe(false);
    expect(r1.reason).toBe(`Erst erforschen: ${TECHS.gewalthaufen.name}`);
    expect(g.dispatch({ t: "rezept", building: bg.id, recipe: "armbrust_bauen" }).reason).toBe(`Erst erforschen: ${TECHS.armbrustbau.name}`);
    for (const [b, k] of [[ws, "schwert_schmieden"], [bg, "bogen_bauen"], [bg, "speer_bauen"]] as const) {
      expect(g.dispatch({ t: "rezept", building: b.id, recipe: k }).ok, k).toBe(true);
    }
    grant(g, "gewalthaufen", "armbrustbau");
    expect(g.dispatch({ t: "rezept", building: ws.id, recipe: "pike_schmieden" }).ok).toBe(true);
    expect(g.dispatch({ t: "rezept", building: bg.id, recipe: "armbrust_bauen" }).ok).toBe(true);
  });

  it("Pikenier und Armbrustschütze erst nach Forschung, dann mit Gold und Ausrüstung aus dem Lager", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const k = place(g, "kaserne", l.x + 6, l.y - 5);
    moreRoom(g);
    stockUp(g, "pike", 3); stockUp(g, "ruestung", 1); stockUp(g, "armbrust", 2);
    for (const u of ["pikenier", "armbrustschuetze"] as UnitKey[]) {
      const r = g.dispatch({ t: "rekrutieren", building: k.id, unit: u });
      expect(r.ok, u).toBe(false);
      expect(r.reason, u).toContain(TECHS[UNITS[u].tech!].name);
    }
    grant(g, "gewalthaufen", "armbrustbau");
    const gold = g.state.gold;
    expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: "pikenier" }).ok).toBe(true);
    expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: "armbrustschuetze" }).ok).toBe(true);
    expect(g.state.gold).toBe(gold - UNITS.pikenier.train!.gold - UNITS.armbrustschuetze.train!.gold);
    // Piken sind noch da, aber die einzige Rüstung ist vergeben: kein zweiter Pikenier, die Kosten zählen alle Stücke
    expect(trainCost(UNITS.pikenier)).toEqual({ gold: UNITS.pikenier.train!.gold, pike: 1, ruestung: 1 });
    const r = g.dispatch({ t: "rekrutieren", building: k.id, unit: "pikenier" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("Keine Rüstungen im Lager");
  });

  it("gesperrte Konzepteinheiten (UnitDef.planned) lassen sich nirgends ausbilden", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const k = place(g, "kaserne", l.x + 6, l.y - 5);
    grant(g, ...(Object.keys(TECHS) as TechKey[]));
    for (const [key, def] of Object.entries(UNITS) as [UnitKey, (typeof UNITS)[UnitKey]][]) {
      if (!def.planned?.length) continue;
      expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: key }).ok, key).toBe(false);
    }
  });
});

describe("Kette Erz → Eisen → Pike und Rüstung → Pikenier", () => {
  it("läuft über echte Ticks: Bergleute hauen Erz, der Schmelzer macht Eisen, Schmiede Piken und Rüstung, ein Tagelöhner holt beides und wird Pikenier", () => {
    const g = createGame({ seed: 1, raids: false });
    grant(g, "rennofen", "kettenschmiede", "gewalthaufen");
    const l = lagerOf(g);
    expect(stored(g, "eisen")).toBe(0); // kein Eisen zu Beginn: alles kommt aus dem Erz
    moreRoom(g);
    const k = place(g, "kaserne", l.x + 6, l.y - 5);
    const mine = mineAtOre(g);
    const sm = place(g, "schmelzhuette", l.x + 6, l.y - 6);
    const ws = place(g, "waffenschmiede", l.x + 1, l.y - 6);
    const rs = place(g, "ruestungsschmiede", l.x + 11, l.y - 3);
    expect(g.dispatch({ t: "rezept", building: ws.id, recipe: "pike_schmieden" }).ok).toBe(true);
    const seen = new Set<string>();
    let glowing = 0;
    run(g, 900 * TPS, () => {
      for (const u of g.state.units) if (u.carry) seen.add(`${u.key}:${u.carry}`);
      if (sm.proc?.busy) glowing++;
      return stored(g, "pike") >= 1 && stored(g, "ruestung") >= 1;
    });
    expect(stored(g, "pike")).toBeGreaterThanOrEqual(1);
    expect(stored(g, "ruestung")).toBeGreaterThanOrEqual(1);
    // sichtbar getragen: Erz vom Bergmann und vom Träger, Eisen zu den Schmieden, Pike und Rüstung ins Lager
    expect([...seen]).toEqual(expect.arrayContaining(["bergmann:erz", "tageloehner:erz", "tageloehner:eisen", "tageloehner:pike", "tageloehner:ruestung"]));
    expect(glowing).toBeGreaterThan(RECIPES.schmelzen.seconds * TPS);
    expect(mine.built).toBe(1);
    // Mengen nach Rezept: Eisen = Schmelzgänge − verschmiedet
    expect(everywhere(g, "eisen")).toBe(sm.proc!.done - ws.proc!.done * RECIPES.pike_schmieden.inputs.eisen! - rs.proc!.done * RECIPES.ruestung_schmieden.inputs.eisen!);

    // Werkstätten anhalten, damit sich die Bestände nur noch durch die Ausbildung ändern
    for (const b of [mine, sm, ws, rs]) g.dispatch({ t: "produktion", building: b.id, an: false });
    run(g, 120 * TPS, () => !ws.proc!.busy && !rs.proc!.busy && !g.state.units.some((u) => u.carry === "pike" || u.carry === "ruestung"));
    const pike = everywhere(g, "pike"), ruestung = everywhere(g, "ruestung");
    expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: "pikenier" }).ok).toBe(true);
    run(g, 120 * TPS, () => g.state.units.some((u) => u.key === "pikenier"));
    const p = g.state.units.find((u) => u.key === "pikenier")!;
    expect(p).toBeDefined();
    expect(p.hp).toBe(UNITS.pikenier.hp);
    expect(everywhere(g, "pike")).toBe(pike - 1);
    expect(everywhere(g, "ruestung")).toBe(ruestung - 1);
  });
});

describe("Rekrutierung mit mehreren Stücken", () => {
  function recruitStarted(g: Simulation) {
    grant(g, "gewalthaufen");
    const l = lagerOf(g);
    const k = place(g, "kaserne", l.x + 6, l.y - 5);
    moreRoom(g);
    expect(stockUp(g, "pike", 2) + stockUp(g, "ruestung", 2)).toBe(4);
    expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: "pikenier" }).ok).toBe(true);
    // bis der Tagelöhner die Pike in der Hand hat (erstes Stück geholt)
    run(g, 60 * TPS, () => g.state.units.some((u) => u.key === "tageloehner" && u.carry === "pike"));
    expect(g.state.units.some((u) => u.carry === "pike")).toBe(true);
    return k;
  }

  it("Abriss der Kaserne mitten im Holen: Pike und Rüstung kommen vollständig ins Lager zurück", () => {
    const g = createGame({ seed: 1, raids: false });
    const k = recruitStarted(g);
    run(g, 60 * TPS, () => (k.ai?.recruitGot ?? 0) >= 2);
    expect(g.dispatch({ t: "abreissen", id: k.id }).ok).toBe(true);
    run(g, 60 * TPS, () => !g.state.units.some((u) => u.carry === "pike" || u.carry === "ruestung"));
    expect(stored(g, "pike")).toBe(2);
    expect(stored(g, "ruestung")).toBe(2);
    expect(g.state.units.some((u) => u.key === "pikenier")).toBe(false);
  });

  it("Speichern und Laden mitten im Holen ergibt identische Folge-Ticks und am Ende denselben Pikenier", () => {
    const g = createGame({ seed: 1, raids: false });
    recruitStarted(g);
    const json = g.save();
    const h = loadGame(json);
    expect(h.save()).toBe(json);
    for (let i = 0; i < 10; i++) {
      run(g, 60); run(h, 60);
      expect(h.save()).toBe(g.save());
    }
    run(g, 60 * TPS, () => g.state.units.some((u) => u.key === "pikenier"));
    run(h, 60 * TPS, () => h.state.units.some((u) => u.key === "pikenier"));
    expect(h.state.units.find((u) => u.key === "pikenier")?.id).toBe(g.state.units.find((u) => u.key === "pikenier")?.id);
  });
});

describe("Knappes Eisen für drei Werkstätten", () => {
  it("Waffenschmiede, Bognerei und Rüstungsschmiede kommen alle dran, auch wenn Eisen nur tröpfelt", () => {
    const g = createGame({ seed: 1, raids: false });
    grant(g, "kettenschmiede", "armbrustbau");
    const l = lagerOf(g);
    moreRoom(g);
    const ws = place(g, "waffenschmiede", l.x + 1, l.y - 6);
    const bg = place(g, "bognerei", l.x - 4, l.y - 6);
    const rs = place(g, "ruestungsschmiede", l.x + 6, l.y - 6);
    expect(g.dispatch({ t: "rezept", building: bg.id, recipe: "armbrust_bauen" }).ok).toBe(true);
    // ein Eisen alle 8 Sekunden, wie aus einer Schmelzhütte mit kurzem Weg
    run(g, 600 * TPS, (t) => { if (t % (8 * TPS) === 0) stockUp(g, "eisen", 1); });
    for (const b of [ws, bg, rs]) expect(b.proc!.done, b.key).toBeGreaterThanOrEqual(2);
  });
});

describe("Werkstätten in allen vier Ausrichtungen", () => {
  const CASES: [BuildingKey, Good[], TechKey[]][] = [
    ["schmelzhuette", ["erz"], ["rennofen"]],
    ["waffenschmiede", ["eisen"], []],
    ["bognerei", [], []],
    ["ruestungsschmiede", ["eisen"], ["kettenschmiede"]],
  ];
  for (const [key, goods, techs] of CASES) {
    it(`${BUILDINGS[key].name} arbeitet in jeder Ausrichtung`, () => {
      for (const o of [0, 1, 2, 3]) {
        const g = createGame({ seed: 1, raids: false });
        grant(g, ...techs);
        for (const good of goods) stockUp(g, good, 10);
        const l = lagerOf(g);
        const b = place(g, key, l.x + 6, l.y - 6, o);
        let inside = false;
        run(g, 120 * TPS, () => {
          inside ||= g.state.units.some((u) => u.inside === b.id && u.key === BUILDINGS[key].workers!.unit);
          return b.proc!.done >= 1;
        });
        expect(b.proc!.done, `${key} o=${o}`).toBeGreaterThanOrEqual(1);
        expect(inside, `${key} o=${o}`).toBe(true);
      }
    });
  }

  it("Erzmine fördert in jeder Ausrichtung", () => {
    for (const o of [0, 1, 2, 3]) {
      const g = createGame({ seed: 1, raids: false });
      const m = mineAtOre(g, o);
      run(g, 240 * TPS, () => stored(g, "erz") >= 1);
      expect(stored(g, "erz"), `o=${o}`).toBeGreaterThanOrEqual(1);
      expect(m.o).toBe(o);
    }
  });
});

describe("Schadensmatrix im Gefecht", () => {
  it("Pike gegen Reiter, Bolzen gegen Platte, Pfeil prallt an Platte ab", () => {
    const g = createGame({ scenario: "leer", size: 32, seed: 4 });
    const pike = spawn(g, "pikenier", 0, 8, 8), sword = spawn(g, "schwert", 0, 8, 10);
    const xbow = spawn(g, "armbrustschuetze", 0, 8, 12), bow = spawn(g, "bogen", 0, 8, 14);
    const rider = spawn(g, "ritter_pferd", 1, 20, 8), plate = spawn(g, "fusssoldat", 1, 20, 12);
    // Pike gegen Reiter mehr als doppelt so stark wie das Schwert
    expect(expectedDamage(pike, rider)).toBeGreaterThan(2 * expectedDamage(sword, rider));
    // Bolzen schlagen Platte, Pfeile kaum
    expect(expectedDamage(xbow, plate)).toBeGreaterThan(4 * expectedDamage(bow, plate));
    // gegen Ungepanzerte ist der Pfeil nicht schlechter gestellt
    const peasant = spawn(g, "tageloehner", 1, 20, 16);
    expect(expectedDamage(bow, peasant)).toBeGreaterThanOrEqual(UNITS.bogen.damage!);
  });

  it("Zweikampf gegen einen Ritter zu Pferd: der Pikenier gewinnt, der Schwertkämpfer verliert", () => {
    const duel = (a: UnitKey, seed: number) => {
      const g = createGame({ scenario: "leer", size: 32, seed });
      const me = spawn(g, a, 0, 10, 10), foe = spawn(g, "ritter_pferd", 1, 14, 10);
      g.dispatch({ t: "angreifen", units: [me.id], target: foe.id });
      run(g, 90 * TPS, () => me.dead || foe.dead);
      return !me.dead && foe.dead;
    };
    for (const seed of [6, 7, 8]) {
      expect(duel("pikenier", seed), `seed ${seed}`).toBe(true);
      expect(duel("schwert", seed), `seed ${seed}`).toBe(false);
    }
  });

  it("vier Armbrustschützen fällen einen Fußknecht in Platte, vier Bogenschützen nicht", () => {
    const volley = (a: UnitKey, seed: number) => {
      const g = createGame({ scenario: "leer", size: 32, seed });
      const mine = [0, 1, 2, 3].map((i) => spawn(g, a, 0, 6, 8 + i));
      const foe = spawn(g, "fusssoldat", 1, 14, 9);
      g.dispatch({ t: "angreifen", units: mine.map((u) => u.id), target: foe.id });
      run(g, 120 * TPS, () => mine.every((u) => u.dead) || foe.dead);
      return foe.dead;
    };
    for (const seed of [6, 7, 8]) {
      expect(volley("armbrustschuetze", seed), `seed ${seed}`).toBe(true);
      expect(volley("bogen", seed), `seed ${seed}`).toBe(false);
    }
  });
});
