/**
 * Verarbeitung nach Rezept und Lagertypen (ADR 0011): Kette Getreide → Mehl → Brot über echte Ticks, Drosselung bei
 * vollem Lager, fehlende Eingänge, Abriss mit Rückgabe, Speichern/Laden mitten im Arbeitsgang, alle vier Ausrichtungen.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, GOODS, RECIPES, RECIPE_KEYS, START, STORES, recipesOf, storeOf, type BuildingKey, type Good } from "../../src/data";
import { createGame, loadGame } from "../../src/sim";
import { buildNow, run, spawn, stockUp, worldOf } from "../../src/sim/debug";
import { interleave } from "../../src/sim/economy";
import { entrance, footprintTiles, inFootprint, modelWorld } from "../../src/sim/geom";
import type { Simulation } from "../../src/sim/game";
import { atWorkplace, inputCap, procReason } from "../../src/sim/production";
import { storeKind } from "../../src/sim/storage";
import type { Building } from "../../src/sim/types";
import { TPS, type SBuilding } from "../../src/sim/world";
import BUILD_DEFS from "../../tools/blender/buildings/buildings.json";
import { findSpot, lagerOf } from "./helpers";

const kornOf = (g: Simulation) => g.state.buildings.find((b) => b.key === "kornkammer")!;
/** Menge einer Ware in allen Lagern. */
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

describe("Daten: Waren, Lagertypen, Rezepte", () => {
  it("jede Ware hat einen Lagertyp, für jeden Lagertyp gibt es ein baubares Lager", () => {
    for (const [g, def] of Object.entries(GOODS)) expect(STORES[def.store], g).toBeDefined();
    for (const k of Object.keys(STORES)) {
      expect(Object.values(BUILDINGS).some((b) => b.storage && (b.storage.kind ?? "material") === k && !b.seat), k).toBe(true);
    }
    expect(storeOf("getreide")).toBe("nahrung");
    expect(storeOf("holz")).toBe("material");
    expect(storeKind("kornkammer")).toBe("nahrung");
    expect(storeKind("lager")).toBe("material");
  });

  it("jedes Rezept gehört zu einem Verarbeitungsgebäude mit Arbeiter, Puffer und Stapelplätzen", () => {
    for (const k of RECIPE_KEYS) {
      const r = RECIPES[k], def = BUILDINGS[r.building];
      expect(def.production, k).toBeDefined();
      expect(def.workers?.cycle.some((s) => s.do === "process"), k).toBe(true);
      expect(def.production!.inputPiles.length, k).toBeGreaterThanOrEqual(Object.keys(r.inputs).length);
      expect(def.production!.outputPiles.length, k).toBeGreaterThanOrEqual(Object.keys(r.outputs).length);
      expect(r.seconds).toBeGreaterThan(0);
      for (const g of [...Object.keys(r.inputs), ...Object.keys(r.outputs)]) expect(GOODS[g as Good], `${k}: ${g}`).toBeDefined();
    }
    for (const [key, def] of Object.entries(BUILDINGS)) if (def.production) expect(recipesOf(key as BuildingKey).length, key).toBeGreaterThan(0);
  });

  it("Arbeitsplatz und Stapel liegen im Grundriss, in allen vier Ausrichtungen; die Tür davor", () => {
    for (const [key, def] of Object.entries(BUILDINGS) as [BuildingKey, (typeof BUILDINGS)[BuildingKey]][]) {
      const pd = def.production;
      if (!pd) continue;
      for (const o of [0, 1, 2, 3]) {
        for (const m of [pd.spot, ...pd.inputPiles, ...pd.outputPiles]) {
          const [x, y] = modelWorld(key, 10, 10, o, m);
          expect(inFootprint(key, 10, 10, o, Math.floor(x), Math.floor(y)), `${key} o=${o} ${m}`).toBe(true);
        }
        const [ex, ey] = entrance(key, 10, 10, o);
        expect(inFootprint(key, 10, 10, o, ex, ey), `${key} o=${o} Tür`).toBe(false);
      }
    }
  });

  it("Fächer der Kornkammer im Schnittbild (Blender) und in den Spieldaten liegen an derselben Stelle", () => {
    const defs = BUILD_DEFS as unknown as Record<string, { shelves?: number[][] }>;
    expect(defs.kornkammer_innen.shelves).toEqual(BUILDINGS.kornkammer.storage!.shelves);
    expect(BUILDINGS.kornkammer.storage!.shelves).toHaveLength(BUILDINGS.kornkammer.storage!.slots);
  });

  it("interleave wechselt reihum zwischen den Listen", () => {
    expect(interleave([[1, 2, 3], [], [10], [20, 21]])).toEqual([1, 10, 20, 2, 21, 3]);
  });
});

describe("Kornkammer und Lagertypen", () => {
  it("beim Start steht die Kornkammer neben Lagerhaus und Bergfried, das Getreide liegt dort, nicht im Lagerhaus", () => {
    const g = createGame({ seed: 1, raids: false });
    const k = kornOf(g), l = lagerOf(g);
    expect(k.built).toBe(1);
    expect(Math.abs(k.x - l.x) + Math.abs(k.y - l.y)).toBeLessThan(12);
    expect(k.slots.some((s) => s.good === "getreide")).toBe(true);
    expect(k.slots.every((s) => !s.good || storeOf(s.good) === "nahrung")).toBe(true);
    expect(l.slots.every((s) => !s.good || storeOf(s.good) === "material")).toBe(true);
    expect(g.state.stock.getreide).toBe(START.stock.getreide);
    const st = BUILDINGS.kornkammer.storage!;
    // dazu das Startbrot (ADR 0013: die Siedlung isst ab Beginn)
    expect(g.state.stock.brot).toBe(START.stock.brot);
    expect(g.state.stores?.nahrung).toEqual({ used: START.stock.getreide! + START.stock.brot!, cap: st.slots * st.perSlot });
    expect(g.state.stores?.material.cap).toBe(BUILDINGS.lager.storage!.slots * BUILDINGS.lager.storage!.perSlot);
  });

  it("Träger lagern jede Ware nur im Lager ihres Typs ein (Holz nie in die Kornkammer, Brot nie ins Lagerhaus)", () => {
    const g = createGame({ seed: 1, raids: false });
    place(g, "holzfaeller", 17, 37);
    const l = lagerOf(g);
    place(g, "muehle", l.x + 6, l.y - 6);
    place(g, "baeckerei", l.x + 2, l.y - 6);
    run(g, 240 * TPS, () => {
      for (const b of g.state.buildings) for (const s of b.slots) if (s.good) expect(storeOf(s.good), `${b.key}: ${s.good}`).toBe(storeKind(b.key));
    });
    expect(stored(g, "holz")).toBeGreaterThan(START.stock.holz!);
    expect(stored(g, "brot")).toBeGreaterThan(0);
  });
});

describe("Kette Getreide → Mehl → Brot", () => {
  it("läuft über echte Ticks: Träger bringen Getreide, der Müller mahlt, Mehl kommt in die Kornkammer, der Bäcker backt Brot", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const m = place(g, "muehle", l.x + 6, l.y - 6);
    const b = place(g, "baeckerei", l.x + 2, l.y - 6);
    const getreide0 = everywhere(g, "getreide");
    const seen = new Set<string>();
    let millerInside = false, sailsTurning = 0;
    run(g, 300 * TPS, () => {
      for (const u of g.state.units) if (u.carry) seen.add(u.carry);
      const miller = g.state.units.find((u) => u.key === "mueller");
      if (miller?.inside === m.id) millerInside = true;
      if (m.proc?.busy) sailsTurning++;
    });
    // sichtbar getragen: Getreide hin, Mehl in die Kornkammer, Mehl zur Bäckerei, Brot zurück
    expect([...seen]).toEqual(expect.arrayContaining(["getreide", "mehl", "brot"]));
    expect(millerInside).toBe(true);
    expect(sailsTurning).toBeGreaterThan(30 * TPS);
    expect(m.proc!.done).toBeGreaterThan(5);
    expect(b.proc!.done).toBeGreaterThan(3);
    expect(stored(g, "brot")).toBeGreaterThan(0);
    // Mengen nach Rezept: verbrauchtes Getreide = 2 × Mahlgänge, Mehl = Mahlgänge − Backgänge,
    // Brot = Startbrot + 2 × Backgänge − gegessen (ADR 0013: Brot ist die einzige essbare Ware im Spiel, 1 Portion je Stück)
    expect(getreide0 - everywhere(g, "getreide")).toBe(m.proc!.done * RECIPES.mahlen.inputs.getreide!);
    expect(everywhere(g, "mehl")).toBe(m.proc!.done * RECIPES.mahlen.outputs.mehl! - b.proc!.done * RECIPES.backen.inputs.mehl!);
    expect(g.state.food!.eaten).toBeGreaterThan(0);
    expect(everywhere(g, "brot")).toBe(START.stock.brot! + b.proc!.done * RECIPES.backen.outputs.brot! - g.state.food!.eaten);
    // Puffer nie über die Datengrenze
    expect(m.proc!.in.getreide ?? 0).toBeLessThanOrEqual(inputCap(m, "getreide"));
  });

  it("die Ware wechselt nur am Ort: Der Eingangspuffer wächst nur, wenn ein Träger vor der Tür steht", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const m = place(g, "muehle", l.x + 6, l.y - 6);
    const [ex, ey] = entrance(m.key, m.x, m.y, m.o);
    let prev = 0, ups = 0;
    run(g, 60 * TPS, () => {
      const now = (m.proc!.in.getreide ?? 0) + (m.proc!.busy ? 2 : 0) + m.proc!.done * 2;
      if (now > prev) {
        ups++;
        const at = g.state.units.some((u) => !u.dead && Math.hypot(u.x - (ex + 0.5), u.y - (ey + 0.5)) < 1.1 && u.key === "tageloehner");
        expect(at).toBe(true);
      }
      prev = now;
    });
    expect(ups).toBeGreaterThan(2);
  });
});

describe("Drosseln und Stillstand", () => {
  it("volle Kornkammer: der Mehlstapel läuft voll, die Mühle ruht mit Grund; eine zweite Kornkammer löst den Stau", () => {
    const g = createGame({ seed: 1, raids: false });
    const k = kornOf(g), l = lagerOf(g);
    // Kornkammer randvoll: ein Fach Getreide (wird nie ganz leer), der Rest Brot
    for (const s of k.slots) { s.good = null; s.amount = 0; }
    k.slots[0].good = "getreide"; k.slots[0].amount = 20;
    for (let i = 1; i < k.slots.length; i++) { k.slots[i].good = "brot"; k.slots[i].amount = 20; }
    const m = place(g, "muehle", l.x + 6, l.y - 6);
    // Getreide nachfüllen, damit das Fach nie leer wird (es bleibt belegt, für Mehl ist kein Fach frei)
    run(g, 200 * TPS, () => { if (k.slots[0].amount < 12) k.slots[0].amount = 12; });
    const cap = RECIPES.mahlen.outputs.mehl! * BUILDINGS.muehle.production!.stock;
    expect(m.proc!.out.mehl).toBe(cap);
    expect(m.proc!.why).toEqual({ k: "ausgang", goods: ["mehl"], full: true });
    expect(procReason(g.state, m)).toContain("kein Platz mehr im Lager");
    expect(g.state.messages.some((x) => x.text === STORES.nahrung.full)).toBe(true);
    const done = m.proc!.done;
    run(g, 60 * TPS, () => { if (k.slots[0].amount < 12) k.slots[0].amount = 12; });
    expect(m.proc!.done).toBe(done); // steht wirklich
    // zweite Kornkammer: Mehl wird abgeholt, die Mühle läuft wieder
    place(g, "kornkammer", l.x - 2, l.y - 7);
    run(g, 90 * TPS, () => { if (k.slots[0].amount < 12) k.slots[0].amount = 12; });
    expect(m.proc!.done).toBeGreaterThan(done);
    expect(stored(g, "mehl")).toBeGreaterThan(0);
  });

  it("fehlt Getreide, wartet die Mühle mit Grund und Meldung; mit neuem Getreide läuft sie an", () => {
    const g = createGame({ seed: 1, raids: false });
    const k = kornOf(g), l = lagerOf(g);
    for (const s of k.slots) { s.good = null; s.amount = 0; }
    const m = place(g, "muehle", l.x + 6, l.y - 6);
    run(g, 40 * TPS);
    expect(m.proc!.why).toEqual({ k: "eingang", goods: ["getreide"] });
    expect(procReason(g.state, m)).toContain("Getreide");
    expect(g.state.messages.some((x) => x.text.includes("Es fehlt Getreide im Lager"))).toBe(true);
    expect(m.proc!.done).toBe(0);
    stockUp(g, "getreide", 10);
    run(g, 60 * TPS);
    expect(m.proc!.done).toBeGreaterThan(0);
  });

  it("ohne freie Tagelöhner kein Müller: Grund „kein_arbeiter“", () => {
    const g = createGame({ scenario: "leer", size: 32, seed: 2 });
    buildNow(g, "kornkammer", 4, 4, 0);
    stockUp(g, "getreide", 20);
    const m = buildNow(g, "muehle", 12, 4, 0);
    run(g, 5 * TPS);
    expect(m.proc!.why).toEqual({ k: "kein_arbeiter" });
    expect(procReason(g.state, m)).toContain("Müller");
    spawn(g, "tageloehner", 0, 10, 12);
    spawn(g, "tageloehner", 0, 11, 12);
    run(g, 60 * TPS);
    expect(m.proc!.done).toBeGreaterThan(0);
  });

  it("anhalten: keine Anlieferung, keine Arbeit; fortsetzen läuft weiter", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const m = place(g, "muehle", l.x + 6, l.y - 6);
    expect(g.dispatch({ t: "produktion", building: m.id, an: false }).ok).toBe(true);
    run(g, 40 * TPS);
    expect(m.proc!.why).toEqual({ k: "angehalten" });
    expect(m.proc!.done).toBe(0);
    expect(m.proc!.in.getreide ?? 0).toBe(0);
    expect(m.proc!.enroute.getreide ?? 0).toBe(0);
    expect(g.dispatch({ t: "produktion", building: m.id, an: true }).ok).toBe(true);
    run(g, 60 * TPS);
    expect(m.proc!.done).toBeGreaterThan(0);
  });

  it("Rezeptwahl: nur Rezepte des Gebäudes", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const m = place(g, "muehle", l.x + 6, l.y - 6);
    expect(g.dispatch({ t: "rezept", building: m.id, recipe: "backen" }).ok).toBe(false);
    expect(g.dispatch({ t: "rezept", building: m.id, recipe: "mahlen" }).ok).toBe(true);
    expect(g.dispatch({ t: "rezept", building: lagerOf(g).id, recipe: "mahlen" }).ok).toBe(false);
  });
});

describe("Abriss, Speichern, Ausrichtungen, Disponent", () => {
  it("Abriss gibt Puffer, Ausgabestapel und den laufenden Arbeitsgang zurück; Träger bringen ihre Last zurück", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const m = place(g, "muehle", l.x + 6, l.y - 6);
    run(g, 400 * TPS, () => m.proc!.busy && (m.proc!.in.getreide ?? 0) > 0 && (m.proc!.out.mehl ?? 0) > 0);
    expect(m.proc!.busy).toBe(true);
    const getreide = everywhere(g, "getreide"), mehl = everywhere(g, "mehl");
    expect(g.dispatch({ t: "abreissen", id: m.id }).ok).toBe(true);
    expect(g.state.units.some((u) => u.key === "mueller")).toBe(false); // wieder Tagelöhner
    run(g, 40 * TPS, () => !g.state.units.some((u) => u.carry === "getreide" || u.carry === "mehl"));
    expect(stored(g, "getreide")).toBe(getreide);
    expect(stored(g, "mehl")).toBe(mehl);
  });

  it("Speichern und Laden mitten im Arbeitsgang ergibt identische Folge-Ticks", () => {
    const g = createGame({ seed: 4, raids: false });
    const l = lagerOf(g);
    const m = place(g, "muehle", l.x + 6, l.y - 6);
    place(g, "baeckerei", l.x + 2, l.y - 6);
    run(g, 400 * TPS, () => m.proc!.busy && m.proc!.t > 1 && g.state.units.some((u) => u.carry === "getreide"));
    expect(m.proc!.busy).toBe(true);
    const json = g.save();
    const h = loadGame(json);
    expect(h.save()).toBe(json);
    for (let i = 0; i < 10; i++) { run(g, 60); run(h, 60); expect(h.save()).toBe(g.save()); }
    const hm = h.state.buildings.find((b) => b.id === m.id)!;
    expect(hm.proc!.done).toBe(m.proc!.done);
  });

  it("in allen vier Ausrichtungen: Anlieferung an der gedrehten Tür, Arbeit drinnen am Platz, Abholung", () => {
    for (const key of ["muehle", "baeckerei"] as const) for (const o of [0, 1, 2, 3]) {
      const g = createGame({ seed: 1, raids: false });
      const l = lagerOf(g);
      if (key === "baeckerei") stockUp(g, "mehl", 10);
      const b = place(g, key, l.x + 6, l.y - 7, o);
      const [ex, ey] = entrance(b.key, b.x, b.y, b.o);
      const foot = new Set(footprintTiles(b.key, b.x, b.y, b.o).map(([x, y]) => `${x},${y}`));
      let atSpot = false, enteredAtDoor = false;
      const w = worldOf(g);
      let was = false;
      run(g, 150 * TPS, () => {
        const u = g.state.units.find((x) => x.home === b.id);
        if (!u) return;
        const now = u.inside === b.id;
        if (now && !was) enteredAtDoor = Math.hypot(u.x - (ex + 0.5), u.y - (ey + 0.5)) < 1.01;
        was = now;
        if (atWorkplace(w, w.units.get(u.id)!)) {
          atSpot = true;
          expect(foot.has(`${Math.floor(u.x)},${Math.floor(u.y)}`), `${key} o=${o}`).toBe(true);
        }
        // draußen nie im Grundriss
        for (const x of g.state.units) if (!x.inside && !x.dead && x.layer === 0) expect(foot.has(`${Math.floor(x.x)},${Math.floor(x.y)}`), `${key} o=${o}`).toBe(false);
      });
      expect(enteredAtDoor, `${key} o=${o}`).toBe(true);
      expect(atSpot, `${key} o=${o}`).toBe(true);
      expect(b.proc!.done, `${key} o=${o}`).toBeGreaterThan(1);
      const out = Object.keys(RECIPES[b.proc!.recipe].outputs)[0] as Good;
      expect(stored(g, out), `${key} o=${o}`).toBeGreaterThan(0);
    }
  }, 60_000); // acht Partien zu je 150 s Spielzeit: unter Last über der Vitest-Grenze von 5 s

  it("der Disponent verteilt Träger reihum auf Forschung, Baustelle und Verarbeitung", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    stockUp(g, "holz", 60);
    const m = place(g, "muehle", l.x + 6, l.y - 6);
    expect(g.dispatch({ t: "forschen", tech: "werkzeuge" }).ok).toBe(true);
    const [kx, ky] = findSpot(g, "kaserne", l.x + 2, l.y + 6);
    const site = g.dispatch({ t: "bauen", key: "kaserne", x: kx, y: ky, o: 0 });
    expect(site.ok).toBe(true);
    const k = g.state.buildings.find((b) => b.id === site.ids![0]) as Building & { ai: { enroute: Record<string, number> } };
    let got = { proc: false, study: false, build: false };
    run(g, 3 * TPS, () => {
      got = {
        proc: got.proc || (m.proc!.enroute.getreide ?? 0) > 0,
        study: got.study || Object.values(g.state.research.cur?.enroute ?? {}).some((n) => (n ?? 0) > 0),
        build: got.build || Object.values(k.ai.enroute).some((n) => n > 0),
      };
    });
    expect(got).toEqual({ proc: true, study: true, build: true });
  });

  it("Getreide für die Mühle nimmt der Disponent nur, wenn es frei ist (verplante Ware bleibt liegen)", () => {
    const g = createGame({ scenario: "leer", size: 32, seed: 2 });
    buildNow(g, "kornkammer", 4, 4, 0);
    stockUp(g, "getreide", 4);
    const m = buildNow(g, "muehle", 12, 4, 0);
    for (let i = 0; i < 6; i++) spawn(g, "tageloehner", 0, 8 + i, 12);
    run(g, 2 * TPS);
    // höchstens der Bestand ist verplant
    expect((m.proc!.enroute.getreide ?? 0) + (m.proc!.in.getreide ?? 0)).toBeLessThanOrEqual(4);
  });
});
