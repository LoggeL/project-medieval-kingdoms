/**
 * Landwirtschaft und Ernährung (ADR 0013): Felder mit sichtbarer Arbeit und Wachstum, Ernte über den Hof in die
 * Kornkammer, die ganze Kette Feld → Kornkammer → Mühle → Bäckerei → Kornkammer → Verbrauch, Rationen, Hunger mit
 * Zuzugsstopp und Fortgang, Abriss, Speichern/Laden und alle vier Ausrichtungen.
 */
import { describe, expect, it } from "vitest";
import { BUILDINGS, CROPS, FOOD, GOODS, RATIONS, RATION_KEYS, RECIPES, START, TUNING, UNITS, type BuildingKey, type CropKey, type Good } from "../../src/data";
import { createGame, loadGame } from "../../src/sim";
import { buildNow, run, spawn, stockUp, worldOf } from "../../src/sim/debug";
import { fieldRect, plotAt, stageCounts } from "../../src/sim/farm";
import { approach, footprintTiles, modelToWorld, center } from "../../src/sim/geom";
import type { Simulation } from "../../src/sim/game";
import type { Building } from "../../src/sim/types";
import { TPS, type SBuilding } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

const stored = (g: Simulation, good: Good) => g.state.buildings.reduce((n, b) => n + b.slots.reduce((k, s) => k + (s.good === good ? s.amount : 0), 0), 0);
const korn = (g: Simulation) => g.state.buildings.find((b) => b.key === "kornkammer")!;

/** Leere Wiese mit Kornkammer und Lagerhaus, n Tagelöhnern; Essen an (hungerOff aus). */
function meadow(n = 4, eat = false): Simulation {
  const g = createGame({ seed: 3, size: 40, scenario: "leer" });
  for (const t of g.state.tiles) t.terrain = "wiese";
  buildNow(g, "kornkammer", 4, 4);
  buildNow(g, "lager", 4, 10);
  stockUp(g, "holz", 60);
  for (let i = 0; i < n; i++) spawn(g, "tageloehner", 0, 9 + i, 9);
  if (eat) delete worldOf(g).meta.hungerOff;
  return g;
}

/** Beet-Stufen eines Hofs als Zeichenkette (zum Vergleichen). */
const stages = (b: Building) => b.farm!.plots.map((p) => p.stage).join("");

/** Kornkammer leeren (Startvorrat raus), damit nur noch gilt, was die Kette erzeugt. */
function emptyGranary(g: Simulation): void {
  for (const s of korn(g).slots) { s.good = null; s.amount = 0; s.reserved = 0; s.incoming = 0; }
  g.tick();
}

describe("Daten: Feldfrüchte, Höfe, Rationen", () => {
  it("jede Feldfrucht hat Arbeit, Wachstum und genau eine Ernte; Stufen und Sprite-Varianten passen", () => {
    for (const [k, c] of Object.entries(CROPS)) {
      const harvests = c.stages.filter((s) => s.harvest);
      expect(harvests, k).toHaveLength(1);
      expect(GOODS[harvests[0].harvest!.good].store, k).toBe("nahrung");
      expect(harvests[0].work, k).toBeDefined();
      expect(c.after).toBeGreaterThanOrEqual(0);
      expect(c.after).toBeLessThan(c.stages.length);
      expect(c.stages.some((s) => s.grow), k).toBe(true);
      for (const s of c.stages) expect(!!s.work !== (s.grow !== undefined), `${k}: ${s.name}`).toBe(true);
      expect(new Set(c.stages.map((s) => s.frame)).size, k).toBe(c.stages.length);
    }
  });

  it("jeder Hof hat Bauer mit Feldzyklus, Hofstapel der Ernteware und ein Feldrechteck außerhalb des Grundrisses (alle Ausrichtungen)", () => {
    for (const [key, def] of Object.entries(BUILDINGS) as [BuildingKey, (typeof BUILDINGS)[BuildingKey]][]) {
      const f = def.fields;
      if (!f) continue;
      expect(def.workers?.cycle.some((s) => s.do === "farm"), key).toBe(true);
      expect(UNITS[def.workers!.unit].role).toBe("arbeiter");
      const crop = CROPS[f.crop as CropKey];
      expect(def.output?.good, key).toBe(crop.stages.find((s) => s.harvest)!.harvest!.good);
      expect(f.min).toBeLessThanOrEqual(f.rect[2] * f.rect[3]);
      for (const o of [0, 1, 2, 3]) {
        const fp = new Set(footprintTiles(key, 20, 20, o).map(([x, y]) => `${x},${y}`));
        const rect = fieldRect(key, 20, 20, o);
        expect(new Set(rect.map(([x, y]) => `${x},${y}`)).size, `${key} o=${o}`).toBe(rect.length);
        for (const [x, y] of rect) expect(fp.has(`${x},${y}`), `${key} o=${o} ${x},${y}`).toBe(false);
        const [ax, ay] = approach(key, 20, 20, o);
        expect(rect.some(([x, y]) => x === ax && y === ay), `${key} o=${o} Tür`).toBe(false);
      }
    }
  });

  it("Rationen und essbare Waren", () => {
    expect(RATION_KEYS).toContain(FOOD.start);
    for (const k of RATION_KEYS) expect(RATIONS[k].perMinute).toBeGreaterThan(0);
    expect(RATIONS.knapp.perMinute).toBeLessThan(RATIONS.normal.perMinute);
    expect(RATIONS.reichlich.perMinute).toBeGreaterThan(RATIONS.normal.perMinute);
    for (const g of Object.keys(FOOD.goods) as Good[]) expect(GOODS[g].store, g).toBe("nahrung");
    expect(FOOD.goods.getreide).toBeUndefined(); // Getreide muss erst durch Mühle und Bäckerei
    expect(START.stock.brot).toBeGreaterThan(0);
  });
});

describe("Platzierung der Felder", () => {
  it("braucht genug Wiese; Gras allein reicht für Getreide nicht, für den Obstgarten schon", () => {
    const g = createGame({ seed: 3, size: 40, scenario: "leer" });
    buildNow(g, "lager", 4, 10);
    stockUp(g, "holz", 60);
    const chk = g.canPlace("bauernhof", 15, 15, 0);
    expect(chk.ok).toBe(false);
    expect(chk.reason).toMatch(/Wiese/);
    expect(g.canPlace("obstgarten", 15, 15, 0).ok).toBe(true);
    // Vorschau zeigt die Feldkacheln (rot, weil Gras)
    const rect = fieldRect("bauernhof", 15, 15, 0);
    for (const [x, y] of rect) expect(chk.tiles.some((t) => t.x === x && t.y === y && !t.ok)).toBe(true);
    for (const [x, y] of rect.slice(0, BUILDINGS.bauernhof.fields!.min)) g.state.tiles[y * 40 + x].terrain = "wiese";
    expect(g.canPlace("bauernhof", 15, 15, 0).ok).toBe(true);
  });

  it("die Beete sind ab dem Setzen belegt: darauf baut man nichts, laufen kann man darüber", () => {
    const g = meadow();
    const r = g.dispatch({ t: "bauen", key: "bauernhof", x: 15, y: 15, o: 0 });
    expect(r.ok).toBe(true);
    const farm = g.state.buildings.find((b) => b.id === r.ids![0])!;
    expect(farm.built).toBeLessThan(1);
    expect(farm.farm!.plots.length).toBe(fieldRect("bauernhof", 15, 15, 0).length);
    const p = farm.farm!.plots[0];
    expect(plotAt(g.state, p.x, p.y)?.id).toBe(farm.id);
    expect(g.canPlace("haus", p.x, p.y, 0).ok).toBe(false);
    expect(g.canPlace("haus", p.x, p.y, 0).reason).toMatch(/Feld/);
    expect(g.wallPath(p.x, p.y, p.x, p.y + 3).ok).toBe(false);
    expect(g.state.tiles[p.y * 40 + p.x].building).toBe(0); // begehbar
    // ein zweiter Hof darf die Beete nicht mitbenutzen
    const pl = g.canPlace("bauernhof", 15, 18, 0);
    expect(pl.tiles.filter((t) => farm.farm!.plots.some((q) => q.x === t.x && q.y === t.y)).every((t) => !t.ok)).toBe(true);
  });

  it("alle vier Ausrichtungen: Beete = gedrehtes Feldrechteck, Bauer bestellt sie und bringt die Ernte zur Tür", () => {
    for (const o of [0, 1, 2, 3]) {
      const g = meadow(3);
      const farm = buildNow(g, "bauernhof", 16, 16, o);
      const [x0, y0, fw, fh] = BUILDINGS.bauernhof.fields!.rect;
      const [cx, cy] = center("bauernhof", 16, 16, o);
      const want = new Set<string>();
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
        const [dx, dy] = modelToWorld(x0 + i + 0.5, y0 + j + 0.5, o);
        want.add(`${Math.floor(cx + dx)},${Math.floor(cy + dy)}`);
      }
      expect(new Set(farm.farm!.plots.map((p) => `${p.x},${p.y}`)), `o=${o}`).toEqual(want);
      run(g, 150 * TPS);
      expect(farm.farm!.harvested, `o=${o}`).toBeGreaterThan(0);
      expect(stored(g, "getreide"), `o=${o}`).toBeGreaterThan(0);
    }
  });
});

describe("Sichtbare Feldarbeit", () => {
  it("Umgraben und Säen nur, wenn der Bauer auf dem Beet steht und arbeitet; Wachstum von selbst; Ernte getragen zum Hof", () => {
    const g = meadow(2);
    const farm = buildNow(g, "bauernhof", 16, 16, 0);
    const crop = CROPS.getreide;
    const seenAnims = new Set<string>();
    let carriedFromField = false, workedOnPlot = true;
    const prev = farm.farm!.plots.map((p) => p.stage);
    run(g, 170 * TPS, () => {
      const bauer = g.state.units.find((u) => u.key === "bauer");
      if (bauer && ["pfluegen", "saeen", "ernten"].includes(bauer.anim)) {
        seenAnims.add(bauer.anim);
        if (!farm.farm!.plots.some((p) => p.x === Math.floor(bauer.x) && p.y === Math.floor(bauer.y))) workedOnPlot = false;
      }
      if (bauer?.carry === "getreide") carriedFromField = true;
      farm.farm!.plots.forEach((p, k) => {
        if (p.stage !== prev[k]) {
          const was = crop.stages[prev[k]];
          // eine Arbeitsstufe endet nur unter den Händen des Bauern auf genau diesem Beet
          if (was.work) expect(bauer && Math.floor(bauer.x) === p.x && Math.floor(bauer.y) === p.y, `Beet ${k}`).toBe(true);
          prev[k] = p.stage;
        }
      });
    });
    expect([...seenAnims].sort()).toEqual(["ernten", "pfluegen", "saeen"]);
    expect(workedOnPlot).toBe(true);
    expect(carriedFromField).toBe(true);
    expect(farm.farm!.harvested).toBeGreaterThan(0);
    // Ernte kommt nur durch Träger in die Kornkammer (Hofstapel → Lagertyp nahrung)
    expect(stored(g, "getreide") + farm.output!.amount + g.state.units.filter((u) => u.carry === "getreide").length * 2).toBeGreaterThanOrEqual(farm.farm!.harvested - 2);
    expect(g.state.buildings.find((b) => b.key === "lager")!.slots.every((s) => s.good !== "getreide")).toBe(true);
  });

  it("voller Hof: reife Ernte bleibt auf dem Feld, der Bauer sät und gräbt weiter; Grund erscheint im Panel", () => {
    const g = meadow(1);
    const farm = buildNow(g, "bauernhof", 16, 16, 0);
    // keine Kornkammer mit Platz: alle Fächer mit Brot füllen
    stockUp(g, "brot", 120);
    run(g, 200 * TPS);
    const cap = BUILDINGS.bauernhof.output!.capacity;
    expect(farm.output!.amount).toBe(cap);
    const ripe = farm.farm!.plots.filter((p) => CROPS.getreide.stages[p.stage].harvest).length;
    expect(ripe).toBeGreaterThan(0);
    expect(g.state.units.find((u) => u.key === "bauer")?.carry ?? null).toBe(null);
  });

  it("Obstgarten: Setzlinge wachsen, der Obstbauer pflückt, die Äpfel landen in der Kornkammer und werden gegessen", () => {
    const g = meadow(3, true);
    emptyGranary(g);
    stockUp(g, "brot", 3);
    const orchard = buildNow(g, "obstgarten", 16, 16, 0);
    let picked = false;
    run(g, 300 * TPS, () => { if (g.state.units.some((u) => u.key === "obstbauer" && u.anim === "pfluecken")) picked = true; });
    expect(picked).toBe(true);
    expect(orchard.farm!.harvested).toBeGreaterThan(3);
    expect(g.state.food!.eaten).toBeGreaterThan(0);
    // Äpfel: geerntet = im Lager + auf dem Hof + getragen + gegessen
    const carried = g.state.units.filter((u) => u.carry === "apfel").length;
    const applesEaten = g.state.food!.eaten - (3 - stored(g, "brot"));
    expect(applesEaten).toBeGreaterThan(0);
    expect(stored(g, "apfel") + orchard.output!.amount + carried + applesEaten).toBe(orchard.farm!.harvested);
    expect(stageCounts(orchard.farm!).reduce((a, b) => a + b, 0)).toBe(orchard.farm!.plots.length);
  });
});

describe("Ganze Kette Feld → Kornkammer → Mühle → Bäckerei → Kornkammer → Verbrauch", () => {
  it("Brot entsteht nur aus geerntetem Getreide und wird gegessen; Mengen bleiben erhalten", () => {
    const g = meadow(8, true);
    emptyGranary(g);
    // Äpfel überbrücken die Zeit bis zum ersten Brot (Äpfel entstehen hier nirgends, gegessenes Brot = gegessen − Äpfel)
    stockUp(g, "apfel", 30);
    const farm = buildNow(g, "bauernhof", 16, 16, 0);
    const mill = buildNow(g, "muehle", 10, 22, 0);
    const bakery = buildNow(g, "baeckerei", 15, 25, 0);
    const seen = new Set<string>();
    let breadEatenEarly = false;
    run(g, 600 * TPS, () => {
      for (const u of g.state.units) if (u.carry) seen.add(u.carry);
      if (bakery.proc!.done === 0 && g.state.food!.eaten > 30) breadEatenEarly = true;
    });
    expect([...seen]).toEqual(expect.arrayContaining(["getreide", "mehl", "brot"]));
    expect(mill.proc!.done).toBeGreaterThan(3);
    expect(bakery.proc!.done).toBeGreaterThan(2);
    const f = g.state.food!;
    expect(f.eaten).toBeGreaterThan(0);
    expect(breadEatenEarly).toBe(false); // vor dem ersten Brot reichen nur die 30 Äpfel
    // Mengen: Getreide geerntet = verbleibend + 2 × Mahlgänge; Brot gebacken = verbleibend + gegessen
    const carried = (good: Good) => g.state.units.reduce((n, u) => n + (u.carry === good ? (u.key === "bauer" ? 2 : 1) : 0), 0);
    const inProc = (good: Good) => g.state.buildings.reduce((n, b) => n + (b.proc ? (b.proc.in[good] ?? 0) + (b.proc.out[good] ?? 0) + (b.proc.busy ? RECIPES[b.proc.recipe].inputs[good] ?? 0 : 0) : 0), 0);
    const getreide = stored(g, "getreide") + farm.output!.amount + carried("getreide") + inProc("getreide");
    expect(getreide + mill.proc!.done * RECIPES.mahlen.inputs.getreide!).toBe(farm.farm!.harvested);
    const brot = stored(g, "brot") + carried("brot") + inProc("brot");
    const breadEaten = f.eaten - (30 - stored(g, "apfel"));
    expect(breadEaten).toBeGreaterThan(0);
    expect(brot + breadEaten).toBe(bakery.proc!.done * RECIPES.backen.outputs.brot!);
  });
});

describe("Ernährung und Hunger", () => {
  it("Verbrauch je Minute = Bevölkerung × Ration, gegessen wird sichtbar aus den Fächern der Kornkammer", () => {
    const g = meadow(10, true);
    stockUp(g, "brot", 60);
    const before = stored(g, "brot");
    run(g, 60 * TPS + 2);
    const f = g.state.food!;
    expect(g.state.population).toBe(10);
    expect(f.perMinute).toBeCloseTo(10 * RATIONS.normal.perMinute, 5);
    expect(before - stored(g, "brot")).toBe(Math.floor(10 * RATIONS.normal.perMinute));
    expect(f.stock).toBe(stored(g, "brot"));
    expect(g.dispatch({ t: "rationen", ration: "reichlich" }).ok).toBe(true);
    const mid = stored(g, "brot");
    run(g, 60 * TPS);
    expect(mid - stored(g, "brot")).toBeGreaterThanOrEqual(Math.floor(10 * RATIONS.reichlich.perMinute) - 1);
    expect(g.state.food!.perMinute).toBeCloseTo(10 * RATIONS.reichlich.perMinute, 5);
  });

  it("ohne Essen: Meldung, kein Zuzug, nach der Schonfrist gehen untätige Tagelöhner fort; Essen beendet den Hunger", () => {
    const g = meadow(6, true);
    buildNow(g, "haus", 20, 4); buildNow(g, "haus", 23, 4);
    const w = worldOf(g);
    w.meta.immigration = true;
    w.meta.nextImmigrant = g.state.tick + 5 * TPS;
    run(g, 30 * TPS); // 6 Bewohner × 0,4 je Minute: die erste Portion ist nach 25 s fällig
    expect(g.state.food!.hunger).toBeGreaterThan(0);
    expect(g.state.messages.some((m) => /hungern/.test(m.text))).toBe(true);
    const pop0 = g.state.population;
    let leaving = false;
    run(g, (FOOD.graceSeconds + FOOD.leaveSeconds + 10) * TPS, () => { if (g.state.units.some((u) => u.activity === "zieht_fort")) leaving = true; });
    expect(leaving).toBe(true);
    expect(g.state.units.filter((u) => u.key === "tageloehner").length).toBeLessThan(6);
    expect(g.state.population).toBeLessThan(pop0); // keiner zugezogen, aber welche gegangen
    expect(g.state.messages.some((m) => /verlässt die Siedlung/.test(m.text))).toBe(true);
    stockUp(g, "apfel", 20);
    run(g, 2 * TPS);
    expect(g.state.food!.hunger).toBe(0);
    const n = g.state.population;
    run(g, TUNING.immigrantSeconds * 2 * TPS);
    expect(g.state.population).toBeGreaterThan(n); // Zuzug läuft wieder
  });

  it("Standardspiel: der Startvorrat reicht über die ersten Minuten ohne Hunger", () => {
    const g = createGame({ seed: 1, raids: false });
    run(g, 6 * 60 * TPS, () => { expect(g.state.food!.hunger).toBe(0); });
    expect(g.state.food!.eaten).toBeGreaterThan(10);
  });

  it("leeres Szenario der Tests: niemand isst", () => {
    const g = createGame({ seed: 1, scenario: "leer" });
    buildNow(g, "kornkammer", 4, 4);
    stockUp(g, "brot", 10);
    spawn(g, "tageloehner", 0, 10, 10);
    run(g, 120 * TPS);
    expect(stored(g, "brot")).toBe(10);
    expect(g.state.food!.hunger).toBe(0);
  });
});

describe("Abriss, Speichern und Laden", () => {
  it("Abriss: Beete werden frei, der Bauer wird Tagelöhner, getragene Ernte geht in die Kornkammer", () => {
    const g = meadow(2);
    const farm = buildNow(g, "bauernhof", 16, 16, 0);
    let carrying = false;
    run(g, 200 * TPS, () => { carrying = g.state.units.some((u) => u.key === "bauer" && u.carry === "getreide"); return carrying; });
    expect(carrying).toBe(true);
    const p = farm.farm!.plots[0];
    const total0 = stored(g, "getreide") + farm.output!.amount + 2;
    expect(g.dispatch({ t: "abreissen", id: farm.id }).ok).toBe(true);
    expect(plotAt(g.state, p.x, p.y)).toBeUndefined();
    expect(g.canPlace("haus", p.x, p.y, 0).ok).toBe(true);
    expect(g.state.units.some((u) => u.key === "bauer")).toBe(false);
    run(g, 40 * TPS);
    // der Hofstapel verfällt mit dem Hof (wie beim Holzfäller), die getragene Garbe kommt in die Kornkammer
    expect(stored(g, "getreide")).toBeGreaterThanOrEqual(total0 - farm.output!.amount - 1);
    expect(g.state.units.some((u) => u.carry === "getreide")).toBe(false);
  });

  it("Speichern mitten in Wachstum und Feldarbeit: nach dem Laden laufen dieselben Ticks gleich weiter", () => {
    const g = meadow(4, true);
    stockUp(g, "brot", 30);
    buildNow(g, "bauernhof", 16, 16, 1);
    buildNow(g, "obstgarten", 8, 24, 2);
    run(g, 75 * TPS);
    const bauer = g.state.units.find((u) => u.key === "bauer")!;
    expect(bauer).toBeDefined();
    const snap = g.save();
    const h = loadGame(snap);
    expect(h.state.food).toEqual(g.state.food);
    const farmA = g.state.buildings.find((b) => b.key === "bauernhof")!, farmB = h.state.buildings.find((b) => b.key === "bauernhof")!;
    expect(stages(farmB)).toBe(stages(farmA));
    for (let i = 0; i < 120 * TPS; i++) { g.tick(); h.tick(); }
    expect(h.save()).toBe(g.save());
    expect(farmA.farm!.harvested).toBeGreaterThan(0);
  });

  it("alte Spielstände ohne Ernährungszustand laden und essen ab dem ersten Tick", () => {
    const g = createGame({ seed: 1, raids: false });
    const d = JSON.parse(g.save());
    delete d.state.food;
    const h = loadGame(JSON.stringify(d));
    h.tick();
    expect(h.state.food?.ration).toBe(FOOD.start);
    expect(h.state.food!.perMinute).toBeGreaterThan(0);
  });
});

describe("Standardkarte", () => {
  it("Getreidehof und Obstgarten finden Platz nahe der Siedlung", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    for (const key of ["bauernhof", "obstgarten"] as BuildingKey[]) {
      const [x, y] = findSpot(g, key, l.x + 2, l.y + 6, 0, 25);
      const b: SBuilding = buildNow(g, key, x, y, 0);
      expect(b.farm!.plots.length).toBeGreaterThanOrEqual(BUILDINGS[key].fields!.min);
    }
  });
});
