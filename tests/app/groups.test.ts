/**
 * Kontrollgruppen (ADR 0018) mit einer DOM-Attrappe: ein EventTarget statt window, Tastendrücke als Event mit den
 * Feldern eines KeyboardEvent, Auswahl und Kamera als einfache Aufzeichnung.
 */
import { describe, expect, it } from "vitest";
import { GROUP_DOUBLE_MS, installControlGroups, type GroupHost } from "../../src/app/groups";

type Mods = Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "repeat", boolean>>;

/** Attrappe: lebende Einheiten mit Position, Auswahl, Kamera, Meldungen, steuerbare Uhr. */
function fake(units: Record<number, [number, number]>) {
  const rec = {
    selection: [] as number[],
    camera: null as [number, number] | null,
    notes: [] as string[],
    clock: 1000,
    blocked: false,
    alive: new Set(Object.keys(units).map(Number)),
  };
  const host: GroupHost = {
    groups: new Map(),
    selected: () => rec.selection.filter((id) => rec.alive.has(id)),
    alive: (ids) => ids.filter((id) => rec.alive.has(id)),
    select: (ids, add) => { rec.selection = add ? [...new Set([...rec.selection, ...ids])] : [...ids]; },
    lookAt: (x, y) => { rec.camera = [x, y]; },
    center: (ids) => {
      const ps = ids.filter((id) => rec.alive.has(id)).map((id) => units[id]);
      if (!ps.length) return null;
      return [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
    },
    notify: (t) => { rec.notes.push(t); },
    now: () => rec.clock,
  };
  const win = new EventTarget();
  const { dispose } = installControlGroups(win, host, () => rec.blocked);
  const press = (code: string, mods: Mods = {}) => {
    const ev = Object.assign(new Event("keydown", { cancelable: true }), {
      code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false, ...mods,
    });
    win.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  return { rec, host, press, dispose };
}

describe("Kontrollgruppen", () => {
  it("Strg + Ziffer speichert, Ziffer wählt wieder", () => {
    const { rec, host, press } = fake({ 1: [10, 10], 2: [12, 10], 3: [30, 30] });
    rec.selection = [1, 2];
    expect(press("Digit1", { ctrlKey: true })).toBe(true); // der Browser bekommt Strg + 1 nicht
    expect(host.groups.get(1)).toEqual([1, 2]);
    expect(rec.notes.at(-1)).toBe("Gruppe 1 gespeichert (2)");
    rec.selection = [3];
    press("Digit3", { ctrlKey: true });
    rec.selection = [];
    expect(press("Digit1")).toBe(true);
    expect(rec.selection).toEqual([1, 2]);
    press("Digit3");
    expect(rec.selection).toEqual([3]);
    expect(rec.camera).toBeNull();
  });

  it("zweimal schnell dieselbe Ziffer: Kamera zur Gruppe; zu langsam nicht", () => {
    const { rec, press } = fake({ 1: [10, 10], 2: [14, 20] });
    rec.selection = [1, 2];
    press("Digit2", { ctrlKey: true });
    rec.selection = [];
    press("Digit2");
    rec.clock += GROUP_DOUBLE_MS + 50;
    press("Digit2");
    expect(rec.camera).toBeNull();
    rec.clock += 150;
    press("Digit2");
    expect(rec.camera).toEqual([12, 15]);
    // ein dritter Druck zählt wieder als erster
    rec.camera = null;
    rec.clock += 100;
    press("Digit2");
    expect(rec.camera).toBeNull();
  });

  it("eine andere Ziffer dazwischen ist kein Doppeldruck", () => {
    const { rec, press } = fake({ 1: [1, 1], 2: [5, 5] });
    rec.selection = [1]; press("Digit1", { ctrlKey: true });
    rec.selection = [2]; press("Digit2", { ctrlKey: true });
    press("Digit1"); rec.clock += 50; press("Digit2"); rec.clock += 50; press("Digit1");
    expect(rec.camera).toBeNull();
    expect(rec.selection).toEqual([1]);
  });

  it("Umschalt + Ziffer nimmt die Gruppe zur Auswahl hinzu", () => {
    const { rec, press } = fake({ 1: [0, 0], 2: [0, 0], 3: [0, 0] });
    rec.selection = [1, 2]; press("Digit4", { ctrlKey: true });
    rec.selection = [3];
    press("Digit4", { shiftKey: true });
    expect([...rec.selection].sort()).toEqual([1, 2, 3]);
  });

  it("Gefallene fallen heraus; eine leere Gruppe meldet sich", () => {
    const { rec, host, press } = fake({ 1: [0, 0], 2: [0, 0] });
    rec.selection = [1, 2]; press("Digit5", { ctrlKey: true });
    rec.alive.delete(1);
    rec.selection = [];
    press("Digit5");
    expect(rec.selection).toEqual([2]);
    expect(host.groups.get(5)).toEqual([2]);
    rec.alive.delete(2);
    press("Digit5");
    expect(rec.notes.at(-1)).toMatch(/Gruppe 5 ist leer/);
    expect(host.groups.has(5)).toBe(false);
    press("Digit7");
    expect(rec.notes.at(-1)).toBe("Gruppe 7 ist leer – Strg + 7 speichert die Auswahl");
  });

  it("Strg + Ziffer ohne Auswahl leert die Gruppe; Cmd, Alt, Wiederholung und gesperrte Eingabe tun nichts", () => {
    const { rec, host, press, dispose } = fake({ 1: [0, 0] });
    rec.selection = [1]; press("Digit1", { ctrlKey: true });
    // Cmd + 1 wechselt am Mac den Browser-Reiter: nicht abfangen, nicht speichern
    rec.selection = [];
    expect(press("Digit1", { metaKey: true })).toBe(false);
    expect(host.groups.get(1)).toEqual([1]);
    press("Digit1", { ctrlKey: true, repeat: true });
    expect(host.groups.get(1)).toEqual([1]);
    expect(press("Digit1", { altKey: true })).toBe(false);
    rec.blocked = true; // Texteingabe oder offene Tafel
    expect(press("Digit1")).toBe(false);
    expect(rec.selection).toEqual([]);
    rec.blocked = false;
    press("Digit1", { ctrlKey: true });
    expect(host.groups.has(1)).toBe(false);
    expect(rec.notes.at(-1)).toBe("Gruppe 1 geleert");
    // andere Tasten gehören nicht den Gruppen
    expect(press("KeyJ")).toBe(false);
    dispose();
    rec.selection = [1]; press("Digit9", { ctrlKey: true });
    expect(host.groups.has(9)).toBe(false);
  });
});
