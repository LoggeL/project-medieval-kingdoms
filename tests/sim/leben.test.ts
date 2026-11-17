/** Lebendige Welt (ADR 0016): Tiere, Jagd-Schnittstelle, nachwachsender Wald, Ruhebilder, Wachen, Treffer. */
import { describe, expect, it } from "vitest";
import { ANIMALS, LIFE, TERRAIN, type AnimalKey } from "../../src/data";
import { createGame, loadGame, postWorld } from "../../src/sim";
import { damageAnimal, findGame, killAnimal, LIFE_ID_BASE, releaseGame, reserveGame, spawnGroup, takeMeat, updateAnimals } from "../../src/sim/animals";
import { damageUnit } from "../../src/sim/combat";
import { buildNow, run, spawn, stockUp, worldOf } from "../../src/sim/debug";
import { FOREST_EVERY, updateForest } from "../../src/sim/forest";
import type { Tree } from "../../src/sim/types";
import { TPS } from "../../src/sim/world";

const KEYS = Object.keys(ANIMALS) as AnimalKey[];

/** Leere Wiese mit einer Gruppe einer Art bei (x, y), ohne andere Tiere. */
function meadow(key: AnimalKey, x: number, y: number, terrain: "wiese" | "waldboden" = "wiese") {
  const g = createGame({ scenario: "leer", size: 40, seed: 5 });
  const w = worldOf(g);
  for (const t of w.s.tiles) t.terrain = terrain;
  w.s.animals = [];
  // Gruppe genau an (x, y): spawnGroup sucht zufällig, darum hier direkt anlegen
  const a = spawnGroup(w, key, 0);
  for (const b of a) { b.x = b.px = b.hx = b.tx = x + 0.5; b.y = b.py = b.hy = b.ty = y + 0.5; }
  w.s.animals = [a[0]];
  return { g, w, a: a[0] };
}

describe("Tiere", () => {
  it("die Startkarte hat jede Art in Gruppen auf ihrem Gelände, mit eigenem ID-Bereich, deterministisch", () => {
    const g = createGame({ seed: 1 });
    const animals = g.state.animals!;
    for (const k of KEYS) expect(animals.filter((a) => a.key === k).length, k).toBeGreaterThanOrEqual(ANIMALS[k].group[0]);
    for (const a of animals) {
      const t = g.state.tiles[Math.floor(a.y) * g.state.w + Math.floor(a.x)];
      expect(ANIMALS[a.key].terrain).toContain(t.terrain);
      expect(t.building).toBe(0);
      expect(a.id).toBeGreaterThanOrEqual(LIFE_ID_BASE);
    }
    // gleicher Seed, gleiche Tiere; die übrige Welt (IDs, Zufall) bleibt von den Tieren unberührt
    const h = createGame({ seed: 1 });
    expect(JSON.stringify(h.state.animals)).toBe(JSON.stringify(animals));
    expect(worldOf(h).meta.nextId).toBe(worldOf(g).meta.nextId);
    expect(Math.max(...g.state.units.map((u) => u.id), ...g.state.trees.map((t) => t.id))).toBeLessThan(LIFE_ID_BASE);
    // leeres Szenario: keine Tiere
    expect(createGame({ scenario: "leer", size: 32 }).state.animals).toBeUndefined();
  });

  it("Weidetiere bleiben in ihrem Streifgebiet, nie auf Wasser oder in Gebäuden, und bewegen sich sichtbar (gehen, grasen)", () => {
    const g = createGame({ seed: 2, raids: false });
    const herd = g.state.animals!.filter((a) => ANIMALS[a.key].kind === "herde");
    const start = new Map(herd.map((a) => [a.id, [a.hx, a.hy]]));
    const seen = new Set<string>();
    run(g, 240 * TPS, () => {
      for (const a of herd) {
        seen.add(a.anim);
        const t = g.state.tiles[Math.floor(a.y) * g.state.w + Math.floor(a.x)];
        expect(TERRAIN[t.terrain].walkable).toBe(true);
        expect(t.building).toBe(0);
      }
    });
    for (const a of herd) {
      const [hx, hy] = start.get(a.id)!;
      expect(Math.hypot(a.x - hx, a.y - hy)).toBeLessThanOrEqual(ANIMALS[a.key].roam + 1);
    }
    expect(seen.has("gehen") && seen.has("grasen")).toBe(true);
  });

  it("Wild flieht vor Figuren: rennt weg und ist danach weiter entfernt; Weidetiere bleiben ruhig", () => {
    for (const key of ["reh", "hirsch"] as AnimalKey[]) {
      const { g, a } = meadow(key, 20, 20, "waldboden");
      const u = spawn(g, "tageloehner", 0, 17, 20);
      const d0 = Math.hypot(a.x - u.x, a.y - u.y);
      let ran = false;
      run(g, 2 * TPS, () => { ran ||= a.anim === "rennen" && a.mode === "flieht"; });
      expect(ran, key).toBe(true);
      expect(Math.hypot(a.x - u.x, a.y - u.y)).toBeGreaterThan(d0 + 2);
    }
    const { g, a } = meadow("kuh", 20, 20);
    spawn(g, "tageloehner", 0, 19, 20);
    run(g, 2 * TPS, () => { expect(a.mode).not.toBe("flieht"); });
  });

  it("Krähen fliegen auf, wenn jemand kommt, mit dem Schwarm, und landen ein Stück weiter", () => {
    const { g, w } = meadow("kraehe", 20, 20);
    const flock = spawnGroup(w, "kraehe", 0);
    for (const b of flock) { b.x = b.px = 20.5 + (b.x % 1) - 0.5; b.y = b.py = 20.5 + (b.y % 1) - 0.5; }
    w.s.animals!.push(...flock);
    const birds = w.s.animals!;
    const u = spawn(g, "speer", 0, 18, 20);
    let maxZ = 0;
    run(g, TPS, () => { for (const b of birds) maxZ = Math.max(maxZ, b.z); });
    expect(birds.filter((b) => b.mode === "fliegt").length).toBeGreaterThanOrEqual(2);
    expect(maxZ).toBeGreaterThan(1);
    u.x = u.px = 2.5; u.y = u.py = 2.5; // Störenfried geht weg
    run(g, 12 * TPS, () => { for (const b of birds) maxZ = Math.max(maxZ, b.z); });
    expect(maxZ).toBeGreaterThan(LIFE.animals.flyHeight * 0.8);
    for (const b of birds) {
      expect(b.mode).not.toBe("fliegt");
      expect(b.z).toBe(0);
      expect(Math.hypot(b.x - 20.5, b.y - 20.5)).toBeGreaterThan(4);
    }
  });

  it("Jagd-Schnittstelle: Wild finden, reservieren, erlegen, Fleisch nehmen; Weidetiere sind kein Wild", () => {
    const g = createGame({ seed: 3, raids: false });
    const w = worldOf(g);
    const any = findGame(w, 32, 32, 999)!;
    expect(ANIMALS[any.key].game).toBeDefined();
    expect(findGame(w, 32, 32, 999, (a) => a.key === "schaf")).toBeNull();
    expect(reserveGame(w, any.id, 77)).toBe(true);
    expect(reserveGame(w, any.id, 78)).toBe(false);
    expect(findGame(w, any.x, any.y, 0.01)).toBeNull(); // reserviert: nicht mehr zu finden
    releaseGame(w, any.id, 78); // fremde Freigabe wirkt nicht
    expect(any.reservedBy).toBe(77);
    // Schaden bis zum Tod
    const hp = ANIMALS[any.key].game!.hp;
    expect(damageAnimal(w, any.id, hp / 2)).toBe(false);
    expect(any.mode).toBe("flieht");
    expect(damageAnimal(w, any.id, hp)).toBe(true);
    expect(any.mode).toBe("tot");
    expect(any.anim).toBe("sterben");
    expect(killAnimal(w, any.id)).toBe(false);
    run(g, TPS);
    expect(any.anim).toBe("tot");
    const meat = ANIMALS[any.key].game!.meat;
    expect(takeMeat(w, any.id, 2)).toBe(2);
    expect(takeMeat(w, any.id, 99)).toBe(meat - 2);
    run(g, 1);
    expect(g.state.animals!.includes(any)).toBe(false);
    // ein Schaf lässt sich nicht erlegen
    const sheep = g.state.animals!.find((a) => a.key === "schaf")!;
    expect(killAnimal(w, sheep.id)).toBe(false);
    expect(reserveGame(w, sheep.id, 1)).toBe(false);
  });

  it("Erlegtes kommt nach: fehlt eine Art, zieht nach respawnSeconds eine neue Gruppe zu", () => {
    const g = createGame({ seed: 4, raids: false });
    const w = worldOf(g);
    const rehe = () => g.state.animals!.filter((a) => a.key === "reh" && a.mode !== "tot");
    const n0 = rehe().length;
    for (const a of rehe()) { killAnimal(w, a.id); takeMeat(w, a.id, 99); }
    run(g, 2);
    expect(rehe().length).toBe(0);
    run(g, (LIFE.animals.respawnSeconds * 2 + 1) * TPS);
    expect(rehe().length).toBeGreaterThan(0);
    expect(rehe().length).toBeLessThanOrEqual(n0 + ANIMALS.reh.group[1]);
  });

  it("Speichern und Laden mitten im Flug und auf der Flucht ergibt identische Folge-Ticks", () => {
    const { g, w } = meadow("kraehe", 20, 20);
    w.s.animals!.push(...spawnGroup(w, "reh", 0));
    spawn(g, "tageloehner", 0, 18, 20);
    run(g, 8);
    expect(g.state.animals!.some((a) => a.mode === "fliegt")).toBe(true);
    const h = loadGame(g.save());
    for (let i = 0; i < 6; i++) { run(g, 40); run(h, 40); expect(h.save()).toBe(g.save()); }
  });
});

describe("Wald wächst nach", () => {
  function forest() {
    const g = createGame({ scenario: "leer", size: 32, seed: 6 });
    const w = worldOf(g);
    const t: Tree = { id: 5, x: 10, y: 10, kind: "baum", variant: 1, state: "stumpf", progress: 0, fallX: 1, fallY: 0, logs: 0, reservedBy: 0 };
    w.s.trees.push(t);
    return { g, w, t };
  }

  it("Stumpf → Setzling → Jungbaum → halbwüchsig → fällbarer Baum, in den Zeiten aus den Daten", () => {
    const { g, t } = forest();
    const F = LIFE.forest;
    run(g, F.stumpSeconds * TPS - FOREST_EVERY);
    expect(t.state).toBe("stumpf");
    run(g, FOREST_EVERY * 2);
    expect(t.state).toBe("waechst");
    expect(t.stage).toBe(0);
    run(g, F.stageSeconds[0] * TPS);
    expect(t.stage).toBe(1);
    run(g, F.stageSeconds[1] * TPS);
    expect(t.stage).toBe(2);
    run(g, F.stageSeconds[2] * TPS);
    expect(t.state).toBe("stehend");
    expect(t.stage).toBeUndefined();
    expect(t.id).toBe(5);
  });

  it("wachsende Bäume sperren das Bauen nicht (die Baustelle räumt sie), stehende schon", () => {
    const { g, t } = forest();
    buildNow(g, "lager", 20, 20, 0);
    stockUp(g, "holz", 30);
    t.state = "waechst"; t.stage = 1;
    expect(g.canPlace("haus", 10, 10, 0).ok).toBe(true);
    t.state = "stehend";
    expect(g.canPlace("haus", 10, 10, 0).ok).toBe(false);
    t.state = "waechst";
    expect(g.dispatch({ t: "bauen", key: "haus", x: 10, y: 10, o: 0 }).ok).toBe(true);
    expect(g.state.trees.includes(t)).toBe(false);
  });

  it("unter einem Gebäude wächst nichts nach", () => {
    const { g, w, t } = forest();
    w.s.tiles[w.idx(t.x, t.y)].building = 999;
    run(g, (LIFE.forest.stumpSeconds + 5) * TPS);
    expect(t.state).toBe("stumpf");
  });

  it("der Wald sät nach, solange er kleiner ist als beim Start, aber nie darüber hinaus", () => {
    const g = createGame({ seed: 1, raids: false });
    const w = worldOf(g);
    const trees0 = w.meta.life!.trees0;
    const living = () => g.state.trees.filter((t) => t.state === "stehend" || t.state === "waechst").length;
    expect(living()).toBe(trees0);
    // ein Drittel des Waldes verschwindet (z. B. Bauplätze)
    const gone = new Set(g.state.trees.filter((_, i) => i % 3 === 0));
    w.s.trees = g.state.trees.filter((t) => !gone.has(t));
    const after = living();
    run(g, 600 * TPS);
    const grown = g.state.trees.filter((t) => t.id >= LIFE_ID_BASE);
    expect(grown.length).toBeGreaterThan(5);
    expect(living()).toBeGreaterThan(after);
    expect(living()).toBeLessThanOrEqual(trees0);
    for (const t of grown) {
      expect(LIFE.forest.seedTerrain).toContain(g.state.tiles[w.idx(t.x, t.y)].terrain);
      expect(g.state.trees.filter((o) => o.x === t.x && o.y === t.y)).toHaveLength(1);
    }
  });
});

describe("Ruhe, Wache, Treffer", () => {
  it("untätige Tagelöhner stehen, sitzen und plaudern (nur zu zweit, einander zugewandt)", () => {
    const g = createGame({ seed: 1, raids: false });
    const seen = new Set<string>();
    run(g, 40 * TPS, () => {
      for (const u of g.state.units) {
        if (u.key !== "tageloehner" || (u as any).ai.job) continue;
        seen.add(u.anim);
        if (u.anim === "plaudern") {
          // ein Gesprächspartner steht daneben, und die Figur schaut ungefähr zu ihm
          const mates = g.state.units.filter((o) => o !== u && o.key === "tageloehner" && Math.hypot(o.x - u.x, o.y - u.y) <= LIFE.idle.chatRadius);
          expect(mates.length).toBeGreaterThan(0);
          const dot = (o: typeof u) => (u.fx * (o.x - u.x) + u.fy * (o.y - u.y)) / (Math.hypot(u.fx, u.fy) * Math.hypot(o.x - u.x, o.y - u.y) || 1);
          expect(Math.max(...mates.map(dot))).toBeGreaterThan(0.7);
        }
      }
    });
    expect(seen.has("sitzen")).toBe(true);
    expect(seen.has("plaudern")).toBe(true);
    expect(seen.has("stehen")).toBe(true);
  });

  it("Wachen auf dem Posten schauen sich um, bleiben aber genau auf ihrem Posten und „wache“", () => {
    const g = createGame({ scenario: "leer", size: 32, seed: 2 });
    buildNow(g, "turm", 14, 14, 0);
    const u = spawn(g, "bogen", 0, 12, 12);
    expect(g.dispatch({ t: "stationieren", units: [u.id] }).ok).toBe(true);
    run(g, 20 * TPS);
    const b = g.state.buildings.find((x) => x.key === "turm")!;
    const [px, py] = postWorld(b.key, b.x, b.y, b.o, (u.order as any).post);
    const dirs = new Set<string>();
    let stepped = false;
    run(g, 30 * TPS, () => {
      dirs.add(`${Math.round(Math.atan2(u.fy, u.fx) / (Math.PI / 4))}`);
      stepped ||= u.anim === "gehen";
      expect(Math.hypot(u.x - px, u.y - py)).toBeLessThan(0.01);
      expect(u.activity).toBe("wache");
    });
    expect(dirs.size).toBeGreaterThanOrEqual(3);
    expect(stepped).toBe(true);
  });

  it("Treffer merken sich den Tick (Zusammenzucken), fliehende Tagelöhner rennen und hören damit auf, wenn sie sicher sind", () => {
    const g = createGame({ scenario: "leer", size: 32, seed: 3 });
    const w = worldOf(g);
    const v = spawn(g, "tageloehner", 0, 10, 10);
    const e = spawn(g, "schwert", 1, 12, 10);
    run(g, 1);
    damageUnit(w, "schwert", 0, v, e.id);
    expect(v.hitT).toBe(g.state.tick);
    let ran = false;
    run(g, 3 * TPS, () => { ran ||= !!v.run && v.anim === "gehen"; });
    expect(ran).toBe(true);
    e.x = e.px = 30.5; e.y = e.py = 30.5; e.hp = 0; // Gegner weg
    w.removeUnit(e as any);
    run(g, 8 * TPS);
    expect(v.run).toBeUndefined();
  });
});

describe("Leistung mit Tieren", () => {
  it("Tiere und Wald kosten im Dauerlauf wenig (unter 0,05 ms je Tick im Mittel)", () => {
    const g = createGame({ seed: 1, raids: false });
    const w = worldOf(g);
    run(g, TPS);
    // nur die Lebenssysteme messen
    const t0 = performance.now();
    const n = 60 * TPS;
    for (let i = 0; i < n; i++) { w.s.tick++; w.grid.rebuild(w.s.units); }
    const base = performance.now() - t0;
    const t1 = performance.now();
    for (let i = 0; i < n; i++) { w.s.tick++; w.grid.rebuild(w.s.units); updateForest(w); updateAnimals(w); }
    const ms = (performance.now() - t1 - base) / n;
    console.log(`Lebendige Welt: ${ms.toFixed(4)} ms je Tick (${g.state.animals!.length} Tiere, ${g.state.trees.length} Bäume)`);
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
    if (env.MK_ZEITGRENZEN !== "aus") expect(ms).toBeLessThan(0.05);
  });
});

