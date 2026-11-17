/** Tasten der Befehlsleiste (ADR 0018): eindeutig über alle Belegungen, deutsche Schilder, in der Tastenübersicht. */
import { describe, expect, it } from "vitest";
import { COMMANDS, FORMATIONS, STANCES } from "../../src/data";
import { APP_KEYS, BUTTON_KEYS, CARD_KEYS, TAB_KEYS, TRAIN_KEYS, bindingLabel, keyLabel } from "../../src/data/hotkeys";
import { STEUERUNG } from "../../src/data/tips";
import inputSource from "../../src/app/input.ts?raw";
import barSource from "../../src/ui/befehle.ts?raw";

/** Knöpfe, die bewusst dieselbe Taste wie die Eingabe zeigen (die Eingabe wertet sie aus). */
const ALIAS = new Set(["auswahl", "stationieren", "halten"]);

describe("Befehlstasten", () => {
  it("keine Taste ist doppelt belegt (Eingabe, Reiter, Baukarten, Ausbilden, alle Knöpfe)", () => {
    const all: [string, string][] = [
      ...Object.entries(APP_KEYS).flatMap(([k, cs]) => cs.map((c) => [`app:${k}`, c] as [string, string])),
      ...Object.entries(TAB_KEYS).flatMap(([k, c]) => (c ? [[`reiter:${k}`, c] as [string, string]] : [])),
      ...CARD_KEYS.map((c, i) => [`karte:${i}`, c] as [string, string]),
      ...TRAIN_KEYS.map((c, i) => [`ausbilden:${i}`, c] as [string, string]),
      ...Object.entries(BUTTON_KEYS).filter(([k]) => !ALIAS.has(k)).flatMap(([k, cs]) => cs.map((c) => [`knopf:${k}`, c] as [string, string])),
    ];
    const seen = new Map<string, string>();
    for (const [what, code] of all) {
      expect(seen.get(code), `${what} und ${seen.get(code)} teilen ${code}`).toBeUndefined();
      seen.set(code, what);
    }
  });

  it("A bleibt Kamera; Befehle auf J K L Ö und Z (deutsche Tastatur)", () => {
    expect(APP_KEYS.kameraLinks).toContain("KeyA");
    expect(bindingLabel(BUTTON_KEYS.patrouille)).toBe("J");
    expect(bindingLabel(BUTTON_KEYS.angriffsbewegung)).toBe("K");
    expect(bindingLabel(BUTTON_KEYS.formation)).toBe("L");
    expect(bindingLabel(BUTTON_KEYS.haltung)).toBe("Ö");
    expect(bindingLabel(BUTTON_KEYS.rueckzug)).toBe("Z");
    // englisches Layout: Schild folgt dem gemeldeten Layout
    expect(keyLabel("KeyY", new Map([["KeyY", "y"]]))).toBe("Y");
    expect(keyLabel("Semicolon", new Map([["Semicolon", ";"]]))).toBe(";");
  });

  it("die Tastenübersicht nennt die Befehle", () => {
    const text = STEUERUNG.map(([k, v]) => `${k} ${v}`).join(" | ");
    for (const k of ["patrouille", "angriffsbewegung", "rueckzug"] as const) expect(text).toContain(`${bindingLabel(BUTTON_KEYS[k])} `);
    expect(text).toContain(`${bindingLabel(BUTTON_KEYS.formation)} / ${bindingLabel(BUTTON_KEYS.haltung)}`);
    expect(text).toMatch(/Rechts ziehen/);
    expect(text).toMatch(/zweimal/);
  });

  it("Leiste und Eingabe lesen die Tasten aus den Daten", () => {
    for (const k of ["patrouille", "angriffsbewegung", "rueckzug", "formation", "haltung", "halten", "stationieren"]) expect(barSource).toContain(`BUTTON_KEYS.${k}`);
    expect(barSource).not.toMatch(/"Key[A-Z]"|"Semicolon"/);
    expect(inputSource).not.toMatch(/"Key[JKLY]"|"Semicolon"/);
  });

  it("Ikonen: jede Spalte des Befehlsblatts (10) ist genau einmal vergeben, Stellung halten = Halten-Schild", () => {
    const icons = [...Object.values(COMMANDS).map((c) => c.icon), ...Object.values(FORMATIONS).map((f) => f.icon), ...Object.values(STANCES).map((s) => s.icon)];
    expect([...new Set(icons)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(icons).toHaveLength(10);
  });
});
