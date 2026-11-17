/**
 * Spielziel (ADR 0019): Schwierigkeitsgrade als Daten, Sieg nach abgewehrten Wellen, Niederlage, Statistik,
 * freie Bestände für die Kopfleiste und abbrechbare Ausbildung.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, DIFFICULTIES, SCENARIOS, START, TUTORIAL, UNITS } from "../../src/data";
import { createGame } from "../../src/sim";
import { buildNow, run, spawn, stockUp, worldOf } from "../../src/sim/debug";
import { kill } from "../../src/sim/combat";
import { goalProgress, raidParams, scenarioGoals } from "../../src/sim/match";
import { TPS, type SUnit } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

const raiders = (g: ReturnType<typeof createGame>) => g.state.units.filter((u) => u.team === 1 && !u.dead) as SUnit[];
/** Alle Angreifer fallen (wie im Kampf, mit Kopfgeld und Statistik). */
const killRaiders = (g: ReturnType<typeof createGame>) => { for (const u of raiders(g)) kill(worldOf(g), u); };

describe("Schwierigkeitsgrade als Daten", () => {
  it("normal entspricht genau START (Startgold, erster Überfall, Wellengröße, LP der Angreifer)", () => {
    const g = createGame({ seed: 1 });
    expect(g.state.match.difficulty).toBe("normal");
    expect(g.state.gold).toBe(START.gold);
    expect(g.state.raid.next).toBe(START.raid.firstSeconds * TPS);
    expect(raidParams(g.state)).toEqual(START.raid);
    const ids = g.dispatch({ t: "ueberfall" }).ids!;
    expect(ids.length).toBe(START.raid.baseSize);
    for (const u of raiders(g)) expect(u.maxHp).toBe(UNITS[u.key].hp);
  });

  it("leicht und schwer ändern Gold, Zeitplan, Wellengröße und Lebenspunkte nach den Daten", () => {
    for (const d of ["leicht", "schwer"] as const) {
      const def = DIFFICULTIES[d];
      const g = createGame({ seed: 1, difficulty: d });
      expect(g.state.gold).toBe(def.gold);
      expect(g.state.raid.next).toBe(def.raid.firstSeconds! * TPS);
      g.dispatch({ t: "ueberfall" });
      expect(raiders(g).length).toBe(def.raid.baseSize);
      for (const u of raiders(g)) expect(u.maxHp).toBe(Math.round(UNITS[u.key].hp * def.raiderHp));
      killRaiders(g);
      run(g, 30 * TPS);
      g.dispatch({ t: "ueberfall" });
      expect(raiders(g).length).toBe(def.raid.baseSize! + def.raid.growth!);
    }
    // schwer ist schwerer als normal, leicht leichter
    expect(DIFFICULTIES.schwer.raid.firstSeconds!).toBeLessThan(START.raid.firstSeconds);
    expect(DIFFICULTIES.leicht.raid.firstSeconds!).toBeGreaterThan(START.raid.firstSeconds);
  });

  it("der reguläre Abstand der Wellen folgt dem Schwierigkeitsgrad", () => {
    const g = createGame({ seed: 1, difficulty: "schwer" });
    const p = raidParams(g.state);
    run(g, p.firstSeconds * TPS + 1);
    expect(g.state.raid.wave).toBe(1);
    expect(g.state.raid.next - g.state.tick).toBe(p.everySeconds * TPS - 1);
  });
});

describe("Sieg", () => {
  it("nach N abgewehrten Wellen (Daten) ist das Tal sicher: Sieg, keine Wellen mehr, Zuzug läuft weiter", () => {
    const g = createGame({ seed: 1 });
    const need = (SCENARIOS.tal.sieg.find((x) => "wellen" in x) as { wellen: number }).wellen;
    expect(scenarioGoals(g.state)).toEqual([{ have: 0, need, done: false, label: "Überfälle abgewehrt" }]);
    for (let wave = 1; wave <= need; wave++) {
      g.dispatch({ t: "ueberfall" });
      run(g, 3 * TPS);
      expect(g.state.outcome).toBeUndefined();
      killRaiders(g);
      run(g, 2);
      expect(g.state.match.stats.waves).toBe(wave);
    }
    expect(g.state.outcome).toBe("sieg");
    expect(g.state.match.endTick).toBe(g.state.tick - 1);
    expect(g.state.messages.some((m) => m.text.startsWith("Das Tal ist sicher"))).toBe(true);
    expect(scenarioGoals(g.state).every((x) => x.done)).toBe(true);
    // keine reguläre Welle mehr, der Zuzug geht weiter
    const pop = g.state.population;
    run(g, START.raid.firstSeconds * TPS + 10 * TPS);
    expect(g.state.raid.wave).toBe(need);
    expect(raiders(g).length).toBe(0);
    expect(g.state.population).toBeGreaterThan(pop);
    expect(g.state.outcome).toBe("sieg");
  });

  it("kein Sieg, solange noch Angreifer auf der Karte sind oder Wellen fehlen", () => {
    const g = createGame({ seed: 1 });
    g.state.match.stats.waves = 4;
    run(g, 3);
    expect(g.state.outcome).toBeUndefined();
    g.state.match.stats.waves = 5;
    g.dispatch({ t: "ueberfall" });
    run(g, 3);
    expect(g.state.outcome).toBeUndefined();
    killRaiders(g);
    run(g, 2);
    expect(g.state.outcome).toBe("sieg");
  });

  it("überlappende Wellen zählen beide, sobald alle Angreifer fort sind", () => {
    const g = createGame({ seed: 1 });
    g.dispatch({ t: "ueberfall" });
    run(g, 2);
    g.dispatch({ t: "ueberfall" });
    run(g, 2);
    expect(g.state.match.stats.waves).toBe(0);
    killRaiders(g);
    run(g, 2);
    expect(g.state.match.stats.waves).toBe(2);
  });

  it("die leere Testwiese hat kein Ziel und endet nie mit einem Sieg", () => {
    const g = createGame({ scenario: "leer", size: 32 });
    expect(g.state.match.scenario).toBeNull();
    g.state.match.stats.waves = 99;
    run(g, 5);
    expect(g.state.outcome).toBeUndefined();
    expect(scenarioGoals(g.state)).toEqual([]);
  });

  it("Ausbaustufe als Teilziel (Daten): Fortschritt aus dem Bergfried", () => {
    const g = createGame({ seed: 1 });
    expect(goalProgress(g.state, { stufe: 2 })).toMatchObject({ have: 1, need: 2, done: false });
    const seat = g.state.buildings.find((b) => BUILDINGS[b.key].seat)!;
    seat.level = 3;
    expect(goalProgress(g.state, { stufe: 2 })).toMatchObject({ have: 2, need: 2, done: true });
  });
});

describe("Niederlage", () => {
  it("fällt der Bergfried, ist die Partie verloren (Ende festgehalten), danach kein Sieg mehr", () => {
    const g = createGame({ seed: 1 });
    const seat = g.state.buildings.find((b) => BUILDINGS[b.key].seat)!;
    g.dispatch({ t: "ueberfall" });
    seat.hp = 1;
    run(g, 180 * TPS, () => g.state.outcome === "niederlage");
    expect(g.state.outcome).toBe("niederlage");
    expect(g.state.match.endTick).toBe(g.state.tick);
    expect(g.state.match.stats.lostBuildings).toBeGreaterThanOrEqual(1);
    g.state.match.stats.waves = 10;
    killRaiders(g);
    run(g, 5);
    expect(g.state.outcome).toBe("niederlage");
  });
});

describe("Statistik", () => {
  it("zählt besiegte Angreifer, gefallene Soldaten und Arbeiter (Rückzug zählt nicht als Sieg über ihn)", () => {
    const g = createGame({ scenario: "leer", size: 32 });
    const w = worldOf(g);
    const a = spawn(g, "speer", 0, 5, 5), b = spawn(g, "tageloehner", 0, 6, 5), c = spawn(g, "schwert", 1, 20, 20);
    kill(w, a); kill(w, b); kill(w, c);
    expect(g.state.match.stats).toMatchObject({ kills: 1, lostSoldiers: 1, lostWorkers: 1 });
    kill(w, a);
    expect(g.state.match.stats.lostSoldiers).toBe(1); // zweimal töten zählt einmal
  });

  it("zählt fertige Baustellen und ausgebildete Soldaten, Startgebäude nicht", () => {
    const g = createGame({ seed: 1, raids: false });
    expect(g.state.match.stats.built).toBe(0);
    const l = lagerOf(g);
    const [hx, hy] = findSpot(g, "haus", l.x + 2, l.y + 5);
    expect(g.dispatch({ t: "bauen", key: "haus", x: hx, y: hy, o: 0 }).ok).toBe(true);
    const [kx, ky] = findSpot(g, "kaserne", l.x + 6, l.y - 5);
    const k = buildNow(g, "kaserne", kx, ky, 0);
    g.dispatch({ t: "rekrutieren", building: k.id, unit: "speer" });
    run(g, 120 * TPS, () => g.state.match.stats.built >= 1 && g.state.match.stats.trained >= 1);
    expect(g.state.match.stats.built).toBe(1);
    expect(g.state.match.stats.trained).toBe(1);
  });

  it("zählt erzeugte Waren erst, wenn sie vom Hof- bzw. Ausgabestapel im Lager ankommen; Startbestand zählt nicht", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const [hx, hy] = findSpot(g, "holzfaeller", l.x - 4, l.y - 8);
    buildNow(g, "holzfaeller", hx, hy, 0);
    const [mx, my] = findSpot(g, "muehle", l.x + 4, l.y + 4);
    buildNow(g, "muehle", mx, my, 0);
    expect(g.state.match.stats.produced).toEqual({});
    const holz0 = g.state.stock.holz;
    run(g, 150 * TPS, () => (g.state.match.stats.produced.holz ?? 0) >= 2 && (g.state.match.stats.produced.mehl ?? 0) >= 1);
    const p = g.state.match.stats.produced;
    expect(p.holz).toBeGreaterThanOrEqual(2);
    expect(p.mehl).toBeGreaterThanOrEqual(1);
    expect(g.state.stock.holz).toBeGreaterThan(holz0 - 1);
    expect(p.getreide).toBeUndefined(); // nur verbraucht, nicht erzeugt
  });

  it("Abriss zählt nicht als Verlust", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const [hx, hy] = findSpot(g, "haus", l.x + 2, l.y + 5);
    const b = buildNow(g, "haus", hx, hy, 0);
    g.dispatch({ t: "abreissen", id: b.id });
    expect(g.state.match.stats.lostBuildings).toBe(0);
  });
});

describe("Einführung im Zustand (Aufgabenleiste)", () => {
  it("match.tutorial folgt der Zielkette und steht ab Beginn auf dem ersten Schritt", () => {
    const g = createGame({ seed: 1, raids: false });
    expect(g.state.match.tutorial).toBe(0);
    const l = lagerOf(g);
    const [hx, hy] = findSpot(g, "holzfaeller", l.x - 4, l.y - 8);
    g.dispatch({ t: "bauen", key: "holzfaeller", x: hx, y: hy, o: 0 });
    run(g, 2 * TPS);
    expect(g.state.match.tutorial).toBe(1);
    expect(TUTORIAL[g.state.match.tutorial!].text).toMatch(/Steinbruch/);
    expect(createGame({ scenario: "leer", size: 32 }).state.match.tutorial).toBeNull();
  });
});

describe("Kopfleiste: freie Bestände", () => {
  it("state.free = Bestand minus verplant (Baustelle), state.stock bleibt der volle Bestand", () => {
    const g = createGame({ seed: 1, raids: false });
    run(g, 1);
    expect(g.state.free).toEqual(g.state.stock);
    const l = lagerOf(g);
    const [kx, ky] = findSpot(g, "kaserne", l.x + 6, l.y - 5);
    const holz = g.state.stock.holz, stein = g.state.stock.stein;
    expect(g.dispatch({ t: "bauen", key: "kaserne", x: kx, y: ky, o: 0 }).ok).toBe(true);
    run(g, 1);
    const cost = BUILDINGS.kaserne.cost;
    expect(g.state.stock.holz).toBe(holz);
    expect(g.state.free!.holz).toBe(Math.max(0, holz - (cost.holz ?? 0)));
    expect(g.state.free!.stein).toBe(Math.max(0, stein - (cost.stein ?? 0)));
  });

  it("wartende Rekruten verplanen ihre Waffe", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const [kx, ky] = findSpot(g, "kaserne", l.x + 6, l.y - 5);
    const k = buildNow(g, "kaserne", kx, ky, 0);
    g.dispatch({ t: "rekrutieren", building: k.id, unit: "schwert" });
    g.dispatch({ t: "rekrutieren", building: k.id, unit: "schwert" });
    run(g, 1);
    expect(g.state.stock.schwert).toBe(2);
    expect(g.state.free!.schwert).toBe(0);
  });
});

describe("Ausbildung abbrechen", () => {
  function barracks() {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const [kx, ky] = findSpot(g, "kaserne", l.x + 6, l.y - 5);
    const k = buildNow(g, "kaserne", kx, ky, 0);
    return { g, k };
  }

  it("ein wartender Platz: Gold zurück, Platz frei, Waffe wieder frei", () => {
    const { g, k } = barracks();
    const gold = g.state.gold;
    g.dispatch({ t: "rekrutieren", building: k.id, unit: "speer" });
    g.dispatch({ t: "rekrutieren", building: k.id, unit: "bogen" });
    expect(k.queue).toEqual(["speer", "bogen"]);
    const r = g.dispatch({ t: "ausbildung_abbrechen", building: k.id, index: 1 });
    expect(r.ok).toBe(true);
    expect(k.queue).toEqual(["speer"]);
    expect(g.state.gold).toBe(gold - UNITS.speer.train!.gold);
    run(g, 1);
    expect(g.state.free!.bogen).toBe(g.state.stock.bogen);
  });

  it("während der Tagelöhner die Waffe holt: Reservierung fällt weg; trägt er sie schon, bringt er sie sichtbar zurück", () => {
    const { g, k } = barracks();
    const gold = g.state.gold;
    g.dispatch({ t: "rekrutieren", building: k.id, unit: "speer" });
    run(g, 20 * TPS, () => !!worldOf(g).buildings.get(k.id)!.ai.recruit);
    const rid = worldOf(g).buildings.get(k.id)!.ai.recruit;
    expect(rid).toBeGreaterThan(0);
    expect(g.dispatch({ t: "ausbildung_abbrechen", building: k.id, index: 0 }).ok).toBe(true);
    expect(k.queue).toEqual([]);
    expect(g.state.gold).toBe(gold);
    const u = worldOf(g).units.get(rid)!;
    expect(u.ai.job?.k).not.toBe("recruit");
    // Reservierungen im Lager sind wieder frei
    for (const b of g.state.buildings) for (const s of b.slots) if (s.good === "speer") expect(s.reserved).toBe(0);

    // zweiter Versuch: abbrechen, wenn er die Waffe schon trägt
    g.dispatch({ t: "rekrutieren", building: k.id, unit: "speer" });
    run(g, 60 * TPS, () => g.state.units.some((x) => x.carry === "speer"));
    const carrier = g.state.units.find((x) => x.carry === "speer")!;
    expect(carrier).toBeTruthy();
    g.dispatch({ t: "ausbildung_abbrechen", building: k.id, index: 0 });
    expect((carrier as SUnit).ai.job?.k).toBe("haul");
    run(g, 60 * TPS, () => !carrier.carry);
    expect(carrier.carry).toBeNull();
    run(g, 1);
    expect(g.state.stock.speer).toBe(START.stock.speer);
    expect(g.state.units.some((x) => x.key === "speer")).toBe(false);
  });

  it("laufende Ausbildung: Der Rekrut tritt als Tagelöhner heraus und trägt die Waffe ins Lager", () => {
    const { g, k } = barracks();
    const gold = g.state.gold;
    g.dispatch({ t: "rekrutieren", building: k.id, unit: "bogen" });
    run(g, 90 * TPS, () => !!k.training);
    expect(k.training).toBeTruthy();
    const n = g.state.units.length;
    expect(g.dispatch({ t: "ausbildung_abbrechen", building: k.id, index: -1 }).ok).toBe(true);
    expect(k.training).toBeNull();
    expect(g.state.gold).toBe(gold);
    expect(g.state.units.length).toBe(n + 1);
    const back = g.state.units.find((x) => x.carry === "bogen")!;
    expect(back.key).toBe("tageloehner");
    run(g, 60 * TPS, () => !back.carry);
    run(g, 1);
    expect(g.state.stock.bogen).toBe(START.stock.bogen);
    expect(g.state.units.some((x) => x.key === "bogen")).toBe(false);
    expect(g.state.match.stats.trained).toBe(0);
  });

  it("lehnt ungültige Plätze und fremde Gebäude ab", () => {
    const { g, k } = barracks();
    expect(g.dispatch({ t: "ausbildung_abbrechen", building: k.id, index: 0 }).ok).toBe(false);
    expect(g.dispatch({ t: "ausbildung_abbrechen", building: k.id, index: -1 }).ok).toBe(false);
    expect(g.dispatch({ t: "ausbildung_abbrechen", building: lagerOf(g).id, index: 0 }).ok).toBe(false);
  });

  it("nach dem Abbruch nimmt der nächste in der Schlange seinen Platz ein", () => {
    const { g, k } = barracks();
    stockUp(g, "speer", 2);
    g.dispatch({ t: "rekrutieren", building: k.id, unit: "speer" });
    g.dispatch({ t: "rekrutieren", building: k.id, unit: "schwert" });
    run(g, 20 * TPS, () => !!worldOf(g).buildings.get(k.id)!.ai.recruit);
    g.dispatch({ t: "ausbildung_abbrechen", building: k.id, index: 0 });
    expect(k.queue).toEqual(["schwert"]);
    run(g, 150 * TPS, () => g.state.units.some((x) => x.key === "schwert"));
    expect(g.state.units.some((x) => x.key === "schwert")).toBe(true);
    expect(g.state.units.some((x) => x.key === "speer")).toBe(false);
  });
});
