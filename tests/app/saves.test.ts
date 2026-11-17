/**
 * Spielstände im Browser (ADR 0019): Ablagen (Arbeitsspeicher, localStorage mit vollem Speicher), Übersicht,
 * „Fortsetzen“ = neuester Stand, Sitzung mit Laden an Ort und Stelle und automatischem Speichern; dazu die
 * Beschriftungen der Oberfläche (Plätze, Statistik, Meldungsverlauf).
 */
import { describe, expect, it } from "vitest";
import { AUTOSAVE_SECONDS, SAVE_SLOTS, SAVE_SLOT_KEYS, TICKS_PER_SECOND } from "../../src/data";
import { LocalBackend, MemoryBackend, adoptSaves, latest, saveInfo, sortInfos, type SaveInfo } from "../../src/app/saves";
import { SaveSession } from "../../src/app/spielstand";
import { createGame } from "../../src/sim";
import { run } from "../../src/sim/debug";
import { ago, describeSave } from "../../src/ui/spielstaende";
import { producedRows, statRows } from "../../src/ui/ende";
import { HISTORY_MAX, MessageLog } from "../../src/ui/verlauf";

/** localStorage-Nachbau mit Größengrenze (wirft wie der Browser QuotaExceededError). */
class FakeStorage {
  map = new Map<string, string>();
  constructor(private limit = Infinity) {}
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) {
    const size = [...this.map].reduce((n, [kk, vv]) => n + (kk === k ? 0 : vv.length), 0) + v.length;
    if (size > this.limit) { const e = new Error("voll"); e.name = "QuotaExceededError"; throw e; }
    this.map.set(k, v);
  }
  removeItem(k: string) { this.map.delete(k); }
}

const info = (slot: SaveInfo["slot"], time: number): SaveInfo =>
  ({ slot, time, tick: 100, wave: 1, population: 8, outcome: null, scenario: "tal", difficulty: "normal", size: 10 });

describe("Speicherplätze (Daten)", () => {
  it("auto und schnell beschreibt das Spiel, drei Plätze der Spieler", () => {
    expect(SAVE_SLOT_KEYS).toEqual(["auto", "schnell", "platz1", "platz2", "platz3"]);
    expect(SAVE_SLOT_KEYS.filter((k) => SAVE_SLOTS[k].manual)).toEqual(["platz1", "platz2", "platz3"]);
    expect(AUTOSAVE_SECONDS).toBeGreaterThan(0);
  });
});

describe("Ablagen", () => {
  it("Arbeitsspeicher: schreiben, lesen, Übersicht in Platzreihenfolge, löschen", async () => {
    const b = new MemoryBackend();
    await b.write(info("platz2", 5), "B");
    await b.write(info("auto", 9), "A");
    expect((await b.list()).map((i) => i.slot)).toEqual(["auto", "platz2"]);
    expect(await b.read("platz2")).toBe("B");
    await b.remove("platz2");
    expect(await b.read("platz2")).toBeNull();
    expect(b.persistent).toBe(false);
  });

  it("localStorage: Index und Daten getrennt, überschreiben ersetzt den Eintrag", async () => {
    const ls = new FakeStorage();
    const b = new LocalBackend(ls);
    await b.write(info("platz1", 1), "eins");
    await b.write(info("platz1", 2), "zwei");
    await b.write(info("schnell", 3), "drei");
    expect((await b.list()).map((i) => [i.slot, i.time])).toEqual([["schnell", 3], ["platz1", 2]]);
    expect(await b.read("platz1")).toBe("zwei");
    expect(ls.getItem(LocalBackend.key("platz1"))).toBe("zwei");
    await b.remove("platz1");
    expect((await b.list()).map((i) => i.slot)).toEqual(["schnell"]);
  });

  it("localStorage voll: Fehler mit Spielertext, kein halber Platz bleibt stehen, alte Plätze bleiben", async () => {
    const ls = new FakeStorage(200);
    const b = new LocalBackend(ls);
    await b.write(info("platz1", 1), "klein");
    await expect(b.write(info("platz2", 2), "x".repeat(500))).rejects.toThrow(/Speicher des Browsers ist voll/);
    expect((await b.list()).map((i) => i.slot)).toEqual(["platz1"]);
    expect(ls.getItem(LocalBackend.key("platz2"))).toBeNull();
    expect(await b.read("platz1")).toBe("klein");
  });

  it("localStorage mit kaputtem Index: leere Liste statt Absturz", async () => {
    const ls = new FakeStorage();
    ls.setItem(LocalBackend.INDEX, "{kaputt");
    expect(await new LocalBackend(ls).list()).toEqual([]);
    ls.setItem(LocalBackend.INDEX, JSON.stringify([{ slot: "unbekannt", time: 1, tick: 1 }, info("platz3", 4)]));
    expect((await new LocalBackend(ls).list()).map((i) => i.slot)).toEqual(["platz3"]);
  });

  it("Übersicht eines Stands aus dem Zustand (auch ohne Partie-Daten eines leeren Spiels)", () => {
    const g = createGame({ seed: 1, difficulty: "leicht" });
    g.state.raid.wave = 2;
    g.state.outcome = "sieg";
    expect(saveInfo("schnell", g.state, 42, 7)).toEqual({
      slot: "schnell", time: 7, tick: 0, wave: 2, population: g.state.population, outcome: "sieg",
      scenario: "tal", difficulty: "leicht", size: 42,
    });
    expect(saveInfo("auto", createGame({ seed: 1, scenario: "leer" }).state, 1, 1).scenario).toBeNull();
  });

  it("Fortsetzen nimmt den neuesten Stand, gleich auf welchem Platz", () => {
    expect(latest([])).toBeNull();
    expect(latest([info("platz1", 5), info("auto", 9), info("schnell", 7)])!.slot).toBe("auto");
    expect(sortInfos([info("platz3", 1), info("schnell", 2)]).map((i) => i.slot)).toEqual(["schnell", "platz3"]);
  });

  it("Stände aus der Ausweich-Ablage werden übernommen, der neuere Stand je Platz gewinnt", async () => {
    // Sitzung 1 fand IndexedDB nicht rechtzeitig und schrieb nach localStorage; Sitzung 2 hat IndexedDB wieder
    const main = new MemoryBackend();
    await main.write(info("platz1", 50), "neu-haupt");
    await main.write(info("auto", 10), "alt-haupt");
    const ls = new FakeStorage();
    const fb = new LocalBackend(ls);
    await fb.write(info("platz1", 20), "alt-ausweich");
    await fb.write(info("auto", 30), "neu-ausweich");
    await fb.write(info("platz2", 40), "nur-ausweich");
    expect(await adoptSaves(main, fb)).toBe(2);
    expect(await main.read("platz1")).toBe("neu-haupt");
    expect(await main.read("auto")).toBe("neu-ausweich");
    expect(await main.read("platz2")).toBe("nur-ausweich");
    expect(await fb.list()).toEqual([]);
    expect(latest(await main.list())!.slot).toBe("platz1");
    expect(await adoptSaves(main, fb)).toBe(0);
  });

  it("Übernahme: ein Platz, der sich nicht schreiben lässt, bleibt in der Ausweich-Ablage", async () => {
    const main = new LocalBackend(new FakeStorage(60));
    const fb = new MemoryBackend();
    await fb.write(info("platz3", 5), "x".repeat(200));
    expect(await adoptSaves(main, fb)).toBe(0);
    expect((await fb.list()).map((i) => i.slot)).toEqual(["platz3"]);
  });
});

describe("Sitzung", () => {
  it("speichert mit Übersicht, lädt an Ort und Stelle (dieselbe Simulation) und meldet das", async () => {
    const game = createGame({ seed: 1, difficulty: "schwer" });
    run(game, 40 * TICKS_PER_SECOND);
    const backend = new MemoryBackend();
    let loaded = 0;
    const s = new SaveSession(game, Promise.resolve(backend), () => loaded++, () => undefined);
    const i = await s.save("platz1");
    expect(i).toMatchObject({ slot: "platz1", tick: game.state.tick, difficulty: "schwer", scenario: "tal", wave: 0, outcome: null });
    const json = game.save();
    expect(i.size).toBe(json.length);
    run(game, 100);
    expect(game.state.tick).toBe(i.tick + 100);
    await s.load("platz1");
    expect(loaded).toBe(1);
    expect(game.state.tick).toBe(i.tick);
    expect(game.save()).toBe(json);
    await expect(s.load("platz2")).rejects.toThrow(/kein Spielstand/);
  });

  it("beschädigter Stand: Laden scheitert mit Meldung, die Partie bleibt unverändert", async () => {
    const game = createGame({ seed: 1 });
    const backend = new MemoryBackend();
    await backend.write(info("platz1", 1), "{kaputt");
    const s = new SaveSession(game, Promise.resolve(backend), () => undefined, () => undefined);
    const before = game.save();
    await expect(s.load("platz1")).rejects.toThrow(/beschädigt/);
    expect(game.save()).toBe(before);
  });

  it("speichert automatisch alle AUTOSAVE_SECONDS Spielsekunden auf „auto“", async () => {
    const game = createGame({ seed: 1, raids: false });
    const backend = new MemoryBackend();
    const s = new SaveSession(game, Promise.resolve(backend), () => undefined, () => undefined);
    await Promise.resolve();
    s.autosave();
    run(game, AUTOSAVE_SECONDS * TICKS_PER_SECOND - 1);
    s.autosave();
    await new Promise((r) => setTimeout(r, 0));
    expect(await backend.list()).toEqual([]);
    run(game, 1);
    s.autosave();
    await new Promise((r) => setTimeout(r, 0));
    const list = await backend.list();
    expect(list.map((x) => [x.slot, x.tick])).toEqual([["auto", AUTOSAVE_SECONDS * TICKS_PER_SECOND]]);
  });

  it("ein Fehler beim automatischen Speichern wird gemeldet, nicht geworfen", async () => {
    const game = createGame({ seed: 1, raids: false });
    const warn: string[] = [];
    const bad = new LocalBackend(new FakeStorage(10));
    const s = new SaveSession(game, Promise.resolve(bad), () => undefined, (t) => warn.push(t));
    run(game, AUTOSAVE_SECONDS * TICKS_PER_SECOND);
    s.autosave();
    await new Promise((r) => setTimeout(r, 0));
    expect(warn.join()).toMatch(/Automatisch speichern fehlgeschlagen: Der Speicher des Browsers ist voll/);
  });
});

describe("Beschriftung", () => {
  it("Spielstand-Zeile: Spielzeit, Welle, Schwierigkeit, Ausgang, Alter", () => {
    const now = Date.UTC(2026, 10, 17, 12, 0, 0);
    const i = { ...info("platz1", now - 5 * 60_000), tick: 754 * TICKS_PER_SECOND, wave: 3, difficulty: "schwer" as const, outcome: "sieg" as const };
    expect(describeSave(i, now)).toBe("12:34 Spielzeit · Welle 3 · Schwer · gewonnen · vor 5 Minuten");
    expect(describeSave({ ...i, wave: 0, outcome: null }, now)).toMatch(/vor dem ersten Überfall/);
    expect(ago(now - 10_000, now)).toBe("gerade eben");
    expect(ago(now - 60 * 60_000, now)).toBe("vor einer Stunde");
    expect(ago(now - 3 * 86400_000, now)).toMatch(/^am \d\d\.\d\d\.2026 um \d\d:\d\d$/);
  });

  it("Statistik der Endtafel aus dem Zustand", () => {
    const g = createGame({ seed: 1 });
    const st = g.state.match.stats;
    st.waves = 5; st.kills = 23; st.lostSoldiers = 4; st.produced = { holz: 120, brot: 8 };
    g.state.match.endTick = 1500 * TICKS_PER_SECOND;
    const rows = Object.fromEntries(statRows(g.state));
    expect(rows["Spielzeit"]).toBe("25:00");
    expect(rows["Überfälle abgewehrt"]).toBe("5");
    expect(rows["Angreifer besiegt"]).toBe("23");
    expect(producedRows(g.state)).toEqual([["Holz", 120], ["Brot", 8]]);
  });

  it("Meldungsverlauf sammelt über die 40 Meldungen des Zustands hinaus und beginnt nach dem Laden neu", () => {
    const g = createGame({ seed: 1 });
    const log = new MessageLog();
    const s = g.state;
    for (let i = 0; i < 400; i++) {
      s.tick = i;
      s.messages.push({ tick: i, text: `Meldung ${i}`, kind: "info" });
      if (s.messages.length > 40) s.messages.splice(0, s.messages.length - 40);
      log.take(s);
    }
    expect(log.items.length).toBe(HISTORY_MAX);
    expect(log.items[log.items.length - 1].text).toBe("Meldung 399");
    expect(log.take(s)).toBe(false);
    log.reset();
    log.take(s);
    expect(log.items.length).toBe(40);
  });
});
