import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../../src/data";
import { APP_KEYS, BUTTON_KEYS, CARD_KEYS, TAB_KEYS, TRAIN_KEYS, bindingLabel, keyLabel } from "../../src/data/hotkeys";
import { STEUERUNG } from "../../src/data/tips";
import { ROSTER } from "../../src/ui/roster";
import inputSource from "../../src/app/input.ts?raw";
import researchSource from "../../src/ui/research.ts?raw";
import helpSource from "../../src/ui/help.ts?raw";
import { swallowInGame } from "../../src/ui/hotkeys";

const appCodes = Object.values(APP_KEYS).flat() as string[];
/** Tasten, die nur die Knöpfe auswerten (nicht die Eingabe). */
const buttonOnly: [string, string][] = [
  ...Object.entries(TAB_KEYS).flatMap(([k, c]) => (c ? [[`Reiter ${k}`, c] as [string, string]] : [])),
  ...CARD_KEYS.map((c, i) => [`Baukarte ${i + 1}`, c] as [string, string]),
  ...TRAIN_KEYS.map((c, i) => [`Ausbilden ${i + 1}`, c] as [string, string]),
  ...BUTTON_KEYS.abriss.map((c) => ["Abriss", c] as [string, string]),
  ...BUTTON_KEYS.forschung.map((c) => ["Forschung", c] as [string, string]),
  ...BUTTON_KEYS.ausbauen.map((c) => ["Ausbau", c] as [string, string]),
];

describe("Tastenbelegung", () => {
  it("die Eingabe belegt keine Taste doppelt", () => {
    expect(new Set(appCodes).size).toBe(appCodes.length);
  });

  it("die Knopf-Tasten sind eindeutig und kollidieren nicht mit der Eingabe", () => {
    const codes = buttonOnly.map(([, c]) => c);
    expect(new Set(codes).size, JSON.stringify(buttonOnly)).toBe(codes.length);
    for (const [what, c] of buttonOnly) expect(appCodes, `${what}: ${c}`).not.toContain(c);
  });

  it("Auswahl, Stationieren und Halten zeigen genau die Tasten der Eingabe", () => {
    expect(BUTTON_KEYS.auswahl).toEqual(APP_KEYS.abbrechen);
    expect(BUTTON_KEYS.stationieren).toEqual(APP_KEYS.stationieren);
    expect(BUTTON_KEYS.halten).toEqual(APP_KEYS.halten);
  });

  it("die bisherigen Tasten bleiben (Q/E, WASD, R, T, H, P, Esc, F1, Zoom)", () => {
    expect(APP_KEYS.drehenLinks).toEqual(["KeyQ"]);
    expect(APP_KEYS.drehenRechts).toEqual(["KeyE"]);
    expect([...APP_KEYS.kameraHoch, ...APP_KEYS.kameraLinks, ...APP_KEYS.kameraRunter, ...APP_KEYS.kameraRechts]).toEqual(
      expect.arrayContaining(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]));
    expect(APP_KEYS.bauDrehen).toEqual(["KeyR"]);
    expect(APP_KEYS.stationieren).toEqual(["KeyT"]);
    expect(APP_KEYS.halten).toEqual(["KeyH"]);
    expect(APP_KEYS.pause).toEqual(expect.arrayContaining(["Space", "KeyP"]));
    expect(APP_KEYS.abbrechen).toEqual(["Escape"]);
    expect(APP_KEYS.hilfe).toEqual(["F1"]);
    expect(APP_KEYS.zoomRein).toContain("BracketRight"); // „+“ auf deutscher Tastatur
    expect(APP_KEYS.zoomRaus).toContain("Slash"); // „−“ auf deutscher Tastatur
  });

  it("jeder Reiter hat eine Taste und jede Baukarte passt auf die Tastenreihe", () => {
    // der Bergfried (seat) wird nicht gebaut, seine Kategorie hat keinen Reiter
    const cats = new Set(Object.values(BUILDINGS).filter((b) => !b.seat).map((b) => b.category));
    for (const c of cats) expect(TAB_KEYS[c], c).toBeTruthy();
    for (const b of Object.values(BUILDINGS)) if (b.seat) expect(cats.has(b.category), b.name).toBe(false);
    for (const c of cats) {
      let n = Object.values(BUILDINGS).filter((b) => b.category === c).length;
      // im Reiter Militär folgen die ausbildbaren Einheiten des Rasters
      if (c === "militaer") n += ROSTER.flatMap((g) => g.entries).filter((e) => e.unit).length;
      expect(n, c).toBeLessThanOrEqual(CARD_KEYS.length);
    }
  });

  it("jede Kaserne hat für jede Einheit eine Ausbildungstaste", () => {
    for (const b of Object.values(BUILDINGS)) if (b.trains) expect(b.trains.length, b.name).toBeLessThanOrEqual(TRAIN_KEYS.length);
  });

  it("die Eingabe wertet die Tasten über APP_KEYS aus (keine fest verdrahteten Tasten)", () => {
    const src = inputSource;
    // Ziffern prüft digit(), die Leertaste hat einen eigenen Abfang; sonst kein Vergleich mit einer festen Taste
    expect(src).not.toMatch(/case "(Key|F\d|Escape|Equal|Minus)/);
    expect(src).not.toMatch(/e\.code === "(?!Space")/);
  });

  it("der Forschungsbaum liest seine Taste aus den Daten (F, H bleibt Halten)", () => {
    expect(BUTTON_KEYS.forschung).toEqual(["KeyF"]);
    expect(BUTTON_KEYS.ausbauen).not.toContain("KeyH");
    expect(researchSource).toContain("BUTTON_KEYS.forschung");
    expect(researchSource).not.toMatch(/"KeyF"/);
  });
});

describe("Tastenschilder", () => {
  it("zeigen ohne Layout die deutsche Belegung (QWERTZ)", () => {
    expect(CARD_KEYS.map((c) => keyLabel(c)).join(" ")).toBe("Y X C V B N M");
    expect(keyLabel("KeyY")).toBe("Z");
    expect(keyLabel("F2")).toBe("F2");
    expect(keyLabel("Delete")).toBe("Entf");
    expect(keyLabel("Escape")).toBe("Esc");
    expect(bindingLabel(BUTTON_KEYS.abriss)).toBe("Entf");
    expect(TRAIN_KEYS.map((c) => keyLabel(c)).join(" ")).toBe("U I O");
  });

  it("folgen dem gemeldeten Layout (englisch: Z statt Y)", () => {
    const us = new Map([["KeyZ", "z"], ["KeyY", "y"], ["KeyX", "x"]]);
    expect(keyLabel("KeyZ", us)).toBe("Z");
    expect(keyLabel("KeyY", us)).toBe("Y");
    expect(keyLabel("KeyX", us)).toBe("X");
  });

  it("die Steuerungsliste nennt die neuen Tasten", () => {
    const keys = STEUERUNG.map(([k]) => k).join(" | ");
    expect(keys).toContain(`${keyLabel(TAB_KEYS.wirtschaft!)} – ${keyLabel(TAB_KEYS.militaer!)}`);
    expect(keys).toContain(CARD_KEYS.map((c) => keyLabel(c)).join(" "));
    expect(keys).toContain(TRAIN_KEYS.map((c) => keyLabel(c)).join(" / "));
    expect(keys).toContain(bindingLabel(BUTTON_KEYS.abriss));
    expect(STEUERUNG.map(([k]) => k)).toEqual(expect.arrayContaining([bindingLabel(BUTTON_KEYS.forschung), bindingLabel(BUTTON_KEYS.ausbauen)]));
  });

  it("F2–F5 gehen im Spiel nie an den Browser (F5 lüde sonst die Seite neu), Strg/Cmd+F5 und andere Tasten schon", () => {
    const k = (code: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey", boolean>> = {}) =>
      swallowInGame({ code, ctrlKey: false, metaKey: false, altKey: false, ...mods });
    for (const c of Object.values(TAB_KEYS)) if (c) expect(k(c), c).toBe(true);
    expect(k("F5")).toBe(true);
    expect(k("F5", { ctrlKey: true })).toBe(false);
    expect(k("F5", { metaKey: true })).toBe(false);
    expect(k("KeyF")).toBe(false);
    expect(k("F1")).toBe(false); // F1 fängt die Hilfe selbst ab
  });

  it("F1 öffnet die Hilfe nicht unter einer offenen Tafel, Esc schließt nur die oberste", () => {
    expect(helpSource).toMatch(/el\.hidden && modalOpen\(\)\) return/);
    for (const src of [helpSource, researchSource]) expect(src).toContain("stopImmediatePropagation");
  });
});
