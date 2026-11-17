/**
 * Tests zu den Befunden der Prüfrunde (Bereich Simulation): Turmtür, Einheiten im Grundriss, Mauerlinie über
 * Hindernisse, Stationierung zur Feindseite, Tor nur in geraden Mauerstücken, wartende Arbeiter, Tätigkeiten.
 */
import { describe, expect, it } from "vitest";
import { createGame, entrance, footprintTiles } from "../../src/sim";
import { buildNow, run, spawn, stockUp } from "../../src/sim/debug";
import type { Simulation } from "../../src/sim/game";
import { TPS, type SUnit, type World } from "../../src/sim/world";
import { findSpot, lagerOf } from "./helpers";

const worldOf = (g: Simulation): World => (g as unknown as { world: World }).world;
const unit = (g: Simulation, id: number) => g.state.units.find((u) => u.id === id) as SUnit;

/**
 * Ringburg auf leerer Wiese (48 × 48, Überfälle von Osten): Mauerring x 15..21 / y 15..21, Tor im Osten (21, 18),
 * Treppe innen an der Nordmauer (16, 16), Turm außen an der Nordostecke (22..23, 14..15), Haus im Hof.
 */
function ring(): Simulation {
  const g = createGame({ scenario: "leer", size: 48 });
  for (let x = 15; x <= 21; x++) for (let y = 15; y <= 21; y++) {
    if (x !== 15 && x !== 21 && y !== 15 && y !== 21) continue;
    buildNow(g, x === 21 && y === 18 ? "tor" : "mauer", x, y, 0);
  }
  buildNow(g, "treppe", 16, 16, 0);
  buildNow(g, "turm", 22, 14, 0);
  buildNow(g, "haus", 18, 18, 0);
  return g;
}

describe("Turmtür", () => {
  it("ist nur für eigene Leute offen: Angreifer kommen vom Boden nicht auf Turm und Wehrgang", () => {
    const g = ring();
    const w = worldOf(g), nav = w.nav;
    const tower = g.state.buildings.find((b) => b.key === "turm")!;
    const [ex, ey] = entrance("turm", tower.x, tower.y, tower.o);
    const door = nav.node(0, ex, ey), top = nav.node(2, tower.x, tower.y + 1);
    expect(nav.comp[0][door]).toBe(nav.comp[0][top]);
    expect(nav.comp[1][door]).not.toBe(nav.comp[1][top]);
    // Eigene Leute gehen durch die Tür auf den Turm
    const own = spawn(g, "bogen", 0, ex, ey + 2);
    g.dispatch({ t: "bewegen", units: [own.id], x: tower.x, y: tower.y + 1 });
    run(g, 20 * TPS);
    expect(own.layer).toBe(2);
  });

  it("Angreifer stehen nie auf Wehrgang oder Turm, solange Tor und Mauern stehen", () => {
    const g = ring();
    const forts = new Set(g.state.buildings.filter((b) => b.key === "mauer" || b.key === "tor").map((b) => b.id));
    for (let i = 0; i < 8; i++) spawn(g, i % 2 ? "schwert" : "speer", 1, 30 + (i % 3), 12 + i);
    let upWhileIntact = 0;
    run(g, 120 * TPS, () => {
      const intact = [...forts].every((id) => g.state.buildings.some((b) => b.id === id));
      if (intact && g.state.units.some((u) => u.team === 1 && !u.dead && u.layer > 0)) upWhileIntact++;
    });
    expect(upWhileIntact).toBe(0);
    // Sie arbeiten sich durch Turm, Tor oder Mauer (irgendein Bau hat Schaden genommen oder ist weg)
    const damaged = g.state.buildings.some((b) => b.hp < 400 && b.key !== "haus") || [...forts].some((id) => !g.state.buildings.some((b) => b.id === id));
    expect(damaged).toBe(true);
  });
});

describe("Einheiten im Grundriss", () => {
  it("werden beim Platzieren hinausgeschoben, die Baustelle wird fertig", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    stockUp(g, "stein", 30);
    const [x, y] = findSpot(g, "kaserne", l.x + 6, l.y - 5);
    const u = spawn(g, "tageloehner", 0, x + 1, y + 1);
    const r = g.dispatch({ t: "bauen", key: "kaserne", x, y, o: 0 });
    expect(r.ok).toBe(true);
    const fp = new Set(footprintTiles("kaserne", x, y, 0).map(([a, b]) => `${a},${b}`));
    expect(fp.has(`${Math.floor(u.x)},${Math.floor(u.y)}`)).toBe(false);
    const site = g.state.buildings.find((b) => b.id === r.ids![0])!;
    run(g, 240 * TPS, () => site.built >= 1);
    expect(site.built).toBe(1);
  });

  it("finden vom gesperrten Startfeld zum nächsten freien Feld hinaus", () => {
    const g = createGame({ scenario: "leer", size: 32 });
    buildNow(g, "kaserne", 10, 10, 0);
    const s = spawn(g, "schwert", 0, 20, 20);
    s.x = 11.5; s.y = 11.5; // mitten im Grundriss (wie nach einem Spielstand ohne Verdrängen)
    expect(g.dispatch({ t: "bewegen", units: [s.id], x: 20, y: 20 }).ok).toBe(true);
    run(g, 20 * TPS);
    expect(Math.floor(s.x)).toBe(20);
    expect(Math.floor(s.y)).toBe(20);
  });

  it("der Disponent gibt unerreichbare Baustellen nicht immer wieder aus", () => {
    const g = createGame({ scenario: "leer", size: 32 });
    buildNow(g, "lager", 2, 2, 0);
    stockUp(g, "holz", 40);
    for (let i = 0; i < 3; i++) spawn(g, "tageloehner", 0, 4 + i, 7);
    // Haus-Baustelle in einem geschlossenen Mauerring (ohne Tor)
    for (let x = 18; x <= 23; x++) for (let y = 18; y <= 23; y++) if (x === 18 || x === 23 || y === 18 || y === 23) buildNow(g, "mauer", x, y, 0);
    const r = g.dispatch({ t: "bauen", key: "haus", x: 20, y: 20, o: 0 });
    expect(r.ok).toBe(true);
    let jobs = 0;
    run(g, 30 * TPS, () => { jobs += g.state.units.filter((u) => (u as SUnit).ai.job?.k === "supply").length; });
    expect(jobs).toBe(0);
    expect(g.state.stock.holz).toBe(40);
    expect(g.state.messages.some((m) => m.text.includes("nicht erreichbar"))).toBe(true);
  });
});

describe("Mauerlinie", () => {
  function meadow(): Simulation {
    const g = createGame({ scenario: "leer", size: 40 });
    buildNow(g, "lager", 2, 2, 0);
    return g;
  }

  it("über ein Hindernis: Vorschau und Bau lehnen gleich ab, keine Mauer mit Lücke", () => {
    const g = meadow();
    stockUp(g, "stein", 60);
    worldOf(g).s.trees.push({ id: 999, x: 21, y: 20, kind: "baum", variant: 0, state: "stehend", progress: 0, fallX: 0, fallY: 0, logs: 0, reservedBy: 0 });
    const p = g.wallPath(18, 20, 24, 20);
    expect(p.ok).toBe(false);
    expect(p.reason).toBe("Bäume im Weg");
    expect(p.tiles.find((t) => t.x === 21)!.ok).toBe(false);
    const r = g.dispatch({ t: "mauer", x0: 18, y0: 20, x1: 24, y1: 20 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(p.reason);
    expect(r.voice).toBe("kein_platz");
    expect(g.state.buildings.filter((b) => b.key === "mauer")).toHaveLength(0);
  });

  it("bei Teilbezahlbarkeit liefern Vorschau und Bau dasselbe, mit klarem Grund", () => {
    const g = meadow();
    stockUp(g, "stein", 15); // 5 Stücke à 3 Stein
    const p = g.wallPath(10, 10, 18, 10);
    expect(p.ok).toBe(true);
    expect(p.reason).toBe("Nur 5 von 9 Mauerstücken bezahlbar");
    expect(p.tiles.filter((t) => t.ok)).toHaveLength(5);
    const r = g.dispatch({ t: "mauer", x0: 10, y0: 10, x1: 18, y1: 10 });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe(p.reason);
    expect(r.ids).toHaveLength(5);
    const built = g.state.buildings.filter((b) => b.key === "mauer").map((b) => b.x).sort((a, b) => a - b);
    expect(built).toEqual(p.tiles.filter((t) => t.ok).map((t) => t.x));
    // Nichts mehr bezahlbar
    const none = g.wallPath(10, 12, 14, 12);
    expect(none.ok).toBe(false);
    const r2 = g.dispatch({ t: "mauer", x0: 10, y0: 12, x1: 14, y1: 12 });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe(none.reason);
    expect(r2.voice).toBe("zu_teuer");
  });
});

describe("Tor", () => {
  it("nur in ein gerades Mauerstück, nicht auf Ecken, Enden, T-Stücke oder freies Feld", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    buildNow(g, "lager", 2, 2, 0);
    stockUp(g, "stein", 40); stockUp(g, "holz", 40);
    for (let x = 20; x <= 24; x++) buildNow(g, "mauer", x, 24, 0);
    for (let y = 25; y <= 27; y++) buildNow(g, "mauer", 24, y, 0); // Ecke bei (24, 24)
    buildNow(g, "mauer", 22, 25, 0); // T-Stück bei (22, 24)
    expect(g.canPlace("tor", 24, 24, 0).ok).toBe(false); // Ecke
    expect(g.canPlace("tor", 20, 24, 0).ok).toBe(false); // Ende
    expect(g.canPlace("tor", 22, 24, 0).ok).toBe(false); // T
    expect(g.canPlace("tor", 30, 30, 0).reason).toBe("Ein Tor gehört in eine gerade Mauerlinie");
    expect(g.canPlace("tor", 24, 24, 0).reason).toMatch(/gerades Mauerstück/);
    const ok = g.dispatch({ t: "bauen", key: "tor", x: 24, y: 26, o: 0 }); // gerade, entlang y
    expect(ok.ok).toBe(true);
    expect(g.state.buildings.find((b) => b.key === "tor")!.o).toBe(1);
    // Lücke in einer geraden Linie schließen geht auch
    expect(g.canPlace("tor", 21, 24, 0).ok).toBe(true);
  });
});

describe("Wartende Arbeiter", () => {
  it("stehen bei vollem Hof nicht deckungsgleich", () => {
    const g = createGame({ seed: 1, raids: false });
    const w = worldOf(g);
    const rock = g.state.rocks[0];
    const [x, y] = findSpot(g, "steinbruch", rock.x, rock.y + 2);
    // Kein Lager: der Hof läuft voll, beide Steinmetze warten mit Stein in der Hand
    const l = lagerOf(g);
    w.s.buildings.splice(w.s.buildings.indexOf(l as never), 1); w.reindex();
    for (const [tx, ty] of footprintTiles("lager", l.x, l.y, l.o)) w.s.tiles[w.idx(tx, ty)].building = 0;
    w.nav.rebuild();
    const q = buildNow(g, "steinbruch", x, y, 0);
    const waiting = () => q.workers.map((id) => unit(g, id)).filter((u) => u && u.carry === "stein" && (u.ai.job?.k === "cycle" && u.ai.job.step === 4));
    run(g, 400 * TPS, () => q.output!.amount >= 6 && waiting().length === 2);
    run(g, 5 * TPS);
    const both = waiting();
    expect(q.output!.amount).toBe(6);
    for (const u of both) expect(u.anim).toBe("stehen");
    expect(both).toHaveLength(2);
    expect(Math.hypot(both[0].x - both[1].x, both[0].y - both[1].y)).toBeGreaterThan(0.5);
    expect(g.state.messages.some((m) => m.voice === "hof_voll")).toBe(true);
  });
});

describe("Stationierung", () => {
  it("besetzt die Feindseite gleichmäßig, Schützen auf den Turm, Nahkämpfer nie auf Turm-Schützenposten", () => {
    const g = ring();
    const archers: number[] = [], melee: number[] = [];
    for (let i = 0; i < 6; i++) archers.push(spawn(g, "bogen", 0, 16 + (i % 3), 17 + Math.floor(i / 3)).id);
    for (let i = 0; i < 6; i++) melee.push(spawn(g, i % 2 ? "schwert" : "speer", 0, 16 + (i % 3), 19 + Math.floor(i / 3)).id);
    const r = g.dispatch({ t: "stationieren", units: [...melee, ...archers] });
    expect(r.ok).toBe(true);
    expect(r.ids).toHaveLength(12);
    const post = (id: number) => {
      const o = unit(g, id).order;
      if (o.t !== "station") throw new Error("nicht stationiert");
      return g.state.buildings.find((b) => b.id === o.building)!;
    };
    const archerPosts = archers.map(post);
    expect(archerPosts.filter((b) => b.key === "turm")).toHaveLength(4);
    // die übrigen Schützen auf den Mauern zur Feindseite (Anmarsch von Ost-Südost: Ost- und Südmauer)
    const wallArchers = archerPosts.filter((b) => b.key === "mauer");
    expect(wallArchers).toHaveLength(2);
    for (const b of wallArchers) expect(b.x === 21 || b.y === 21).toBe(true);
    for (const id of melee) expect(post(id).key).toBe("mauer");
    // Ostmauer (x = 21) stärker besetzt als die Westmauer (x = 15)
    const all = [...archers, ...melee].map(post);
    expect(all.filter((b) => b.x === 21).length).toBeGreaterThan(all.filter((b) => b.x === 15).length);
    // alle kommen an
    run(g, 60 * TPS);
    for (const id of [...archers, ...melee]) expect(unit(g, id).activity).toBe("wache");
  });

  it("verteilt Schützen auf einer langen Mauer statt alle nebeneinander", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    for (let x = 6; x <= 30; x++) buildNow(g, "mauer", x, 20, 0);
    buildNow(g, "treppe", 8, 21, 0);
    const ids = [0, 1, 2, 3].map((i) => spawn(g, "bogen", 0, 8 + i, 25).id);
    expect(g.dispatch({ t: "stationieren", units: ids }).ok).toBe(true);
    const xs = ids.map((id) => g.state.buildings.find((b) => b.id === (unit(g, id).order as { building: number }).building)!.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(3);
    expect(Math.min(...xs)).toBeGreaterThan(18); // Feind im Osten
  });
});

describe("Tätigkeit und Rekruten", () => {
  it("Tagelöhner bauen mit der Animation „bauen“, Träger tragen, Rekruten holen die Waffe", () => {
    const g = createGame({ seed: 2, raids: false });
    const l = lagerOf(g);
    const [x, y] = findSpot(g, "haus", l.x + 6, l.y - 4);
    g.dispatch({ t: "bauen", key: "haus", x, y, o: 0 });
    const seen = new Set<string>();
    let buildAnim = false;
    run(g, 120 * TPS, () => {
      for (const u of g.state.units) {
        seen.add(u.activity!);
        if (u.activity === "baut") { expect(u.anim).toBe("bauen"); buildAnim = true; }
        if (u.activity === "traegt") expect(u.carry).not.toBeNull();
      }
      return g.state.buildings.every((b) => b.built >= 1);
    });
    expect(buildAnim).toBe(true);
    expect(seen.has("traegt")).toBe(true);
    expect(seen.has("wartet")).toBe(true);
    for (const u of g.state.units) expect(u.activity).toBeDefined();
    // Rekrut
    const [kx, ky] = findSpot(g, "kaserne", l.x + 6, l.y - 8);
    const k = buildNow(g, "kaserne", kx, ky, 0);
    g.dispatch({ t: "rekrutieren", building: k.id, unit: "bogen" });
    const stages = new Set<string>();
    let holt = false;
    run(g, 60 * TPS, () => {
      for (const r of k.recruits ?? []) { stages.add(r.stage); expect(r.unit).toBe("bogen"); }
      holt ||= g.state.units.some((u) => u.activity === "holt_waffe");
      return g.state.units.some((u) => u.key === "bogen");
    });
    expect([...stages].sort()).toEqual(["waffe", "weg"]);
    expect(holt).toBe(true);
    expect(k.recruits).toEqual([]);
  });

  it("Holzfäller fällt und zerlegt, Steinmetz baut ab, Soldaten halten, Tagelöhner fliehen", () => {
    const g = createGame({ seed: 1, raids: false });
    const [x, y] = findSpot(g, "holzfaeller", 17, 30);
    buildNow(g, "holzfaeller", x, y, 0);
    const rock = g.state.rocks[0];
    const [qx, qy] = findSpot(g, "steinbruch", rock.x, rock.y + 2);
    buildNow(g, "steinbruch", qx, qy, 0);
    const seen = new Set<string>();
    run(g, 90 * TPS, () => { for (const u of g.state.units) seen.add(u.activity!); });
    for (const a of ["faellt", "zerlegt", "baut_ab", "unterwegs"]) expect(seen.has(a)).toBe(true);
    const s = spawn(g, "speer", 0, 30, 30);
    g.dispatch({ t: "halten", units: [s.id] });
    run(g, 2);
    expect(s.activity).toBe("haelt");
    // Angreifer neben einem untätigen Tagelöhner
    const h = createGame({ scenario: "leer", size: 32 });
    const p = spawn(h, "tageloehner", 0, 10, 10);
    spawn(h, "schwert", 1, 13, 10);
    let fled = false;
    run(h, 5 * TPS, () => { fled ||= p.activity === "flieht"; });
    expect(fled).toBe(true);
  });

  it("Zuzügler ziehen zu, bis sie den Sammelplatz erreichen", () => {
    const g = createGame({ seed: 3, raids: false });
    run(g, 21 * TPS);
    const fresh = g.state.units.filter((u) => u.activity === "zieht_zu");
    expect(fresh.length).toBe(1);
  });
});

describe("Dauerlauf-Ungereimtheiten", () => {
  it("Tor meldet gateOpen, solange eigene Leute davor stehen, für Angreifer nie", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    for (let y = 0; y < 40; y++) buildNow(g, y === 20 ? "tor" : "mauer", 20, y, 1);
    const tor = g.state.buildings.find((b) => b.key === "tor")!;
    run(g, 1);
    expect(tor.gateOpen).toBe(false);
    const u = spawn(g, "schwert", 0, 10, 20);
    g.dispatch({ t: "bewegen", units: [u.id], x: 30, y: 20 });
    let opened = false;
    run(g, 20 * TPS, () => { opened ||= !!tor.gateOpen; });
    expect(opened).toBe(true);
    run(g, 2);
    expect(tor.gateOpen).toBe(false);
    spawn(g, "schwert", 1, 21, 20);
    run(g, 2);
    expect(tor.gateOpen).toBe(false);
  });

  it("eine Mauerlinie baut das Laufraster nur einmal neu und schiebt Leute aus der Linie", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    buildNow(g, "lager", 2, 2, 0);
    stockUp(g, "stein", 60);
    const w = worldOf(g);
    const u = spawn(g, "tageloehner", 0, 14, 10);
    const v = w.meta.navVersion;
    const r = g.dispatch({ t: "mauer", x0: 10, y0: 10, x1: 25, y1: 10 });
    expect(r.ids).toHaveLength(16);
    expect(w.meta.navVersion).toBe(v + 1);
    expect(Math.floor(u.y)).not.toBe(10);
  });

  it("zugebauter Sammelplatz: Tagelöhner suchen sich freien Boden", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    const w = worldOf(g);
    const [cx, cy] = w.meta.camp;
    for (let x = cx - 5; x <= cx + 5; x += 2) for (let y = cy - 5; y <= cy + 5; y += 2) buildNow(g, "haus", x, y, 0);
    const p = spawn(g, "tageloehner", 0, 2, 2);
    run(g, 30 * TPS);
    expect(w.nav.open(w.nav.node(0, Math.floor(p.x), Math.floor(p.y)), 0)).toBe(true);
    expect(Math.hypot(p.x - cx, p.y - cy)).toBeLessThan(12);
    expect(p.activity).toBe("wartet");
  });

  it("Soldat tritt bei zugebautem Kasernen-Eingang auf freien Boden", () => {
    const g = createGame({ seed: 1, raids: false });
    const l = lagerOf(g);
    const [kx, ky] = findSpot(g, "kaserne", l.x + 6, l.y - 5);
    const k = buildNow(g, "kaserne", kx, ky, 0);
    expect(g.dispatch({ t: "rekrutieren", building: k.id, unit: "speer" }).ok).toBe(true);
    run(g, 60 * TPS, () => !!k.training);
    expect(k.training).not.toBeNull();
    const [ex, ey] = entrance("kaserne", k.x, k.y, k.o);
    buildNow(g, "mauer", ex, ey, 0);
    run(g, 20 * TPS, () => g.state.units.some((u) => u.key === "speer"));
    const s = g.state.units.find((u) => u.key === "speer")!;
    const w = worldOf(g);
    expect(w.nav.open(w.nav.node(0, Math.floor(s.x), Math.floor(s.y)), 0)).toBe(true);
  });

  it("Abriss einer Mauer: Wachen steigen ohne Schaden herab", () => {
    const g = createGame({ scenario: "leer", size: 40 });
    buildNow(g, "lager", 2, 2, 0);
    for (let x = 10; x <= 14; x++) buildNow(g, "mauer", x, 20, 0);
    const a = spawn(g, "bogen", 0, 12, 20, 1);
    const wall = g.state.buildings.find((b) => b.key === "mauer" && b.x === 12)!;
    g.dispatch({ t: "abreissen", id: wall.id });
    expect(a.layer).toBe(0);
    expect(a.hp).toBe(a.maxHp);
  });
});
