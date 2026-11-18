import { describe, expect, it } from "vitest";
import { BUILDINGS, START, TUNING, UNITS } from "../../src/data";
import { STEUERUNG, TIPS } from "../../src/data/tips";

/** Häufige englische Wörter: kommen in einem deutschen Tipp nicht vor. */
const ENGLISH = /\b(the|and|you|your|to|of|is|are|with|press|click|build|wall|tip)\b/i;

describe("Tipps (Ladebildschirm)", () => {
  it("hat 15–25 Tipps", () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(15);
    expect(TIPS.length).toBeLessThanOrEqual(25);
  });

  it("jeder Tipp ist ein knapper, vollständiger deutscher Satz", () => {
    for (const { text } of TIPS) {
      expect(text.trim()).toBe(text);
      expect(text.length, text).toBeGreaterThanOrEqual(30);
      expect(text.length, text).toBeLessThanOrEqual(150);
      expect(text, text).toMatch(/^[A-ZÄÖÜ0-9]/);
      expect(text, text).toMatch(/[.!]$/);
      expect(text, text).not.toMatch(ENGLISH);
      expect(text, text).not.toMatch(/ {2}|\s[,.]/);
      // keine ASCII-Anführungszeichen oder Bindestrich als Gedankenstrich
      expect(text, text).not.toMatch(/"| - /);
    }
  });

  it("ist auf Deutsch geschrieben (Umlaute und deutsche Funktionswörter kommen vor)", () => {
    const all = TIPS.map((t) => t.text).join(" ");
    expect(all).toMatch(/[äöüß]/);
    const german = TIPS.filter((t) => /\b(der|die|das|und|ein|eine|mit|auf|von|den|dem|ist|du|dich)\b/i.test(t.text));
    expect(german.length).toBe(TIPS.length);
  });

  it("enthält keinen Tipp doppelt", () => {
    const texts = TIPS.map((t) => t.text.toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("deckt alle Themen ab", () => {
    for (const thema of ["steuerung", "wirtschaft", "burgenbau", "militaer"] as const) {
      expect(TIPS.filter((t) => t.thema === thema).length, thema).toBeGreaterThanOrEqual(3);
    }
  });

  it("Zahlen in den Tipps stimmen mit den Spieldaten überein", () => {
    const find = (s: string) => TIPS.find((t) => t.text.includes(s))?.text ?? "";
    expect(find("Mauer ziehst")).toContain(`${BUILDINGS.mauer.cost.stein} Stein`);
    expect(find("Holzfällerhütte")).toMatch(/vier Bäume/);
    expect(BUILDINGS.holzfaeller.placement?.nearTag?.count).toBe(4);
    expect(BUILDINGS.steinbruch.placement?.adjacentTerrain).toBe("fels");
    const lager = BUILDINGS.lager.storage!;
    expect(find("Im Lagerhaus liegt")).toContain(`acht Fächer mit je ${lager.perSlot} Stück`);
    expect(lager.shelves.length).toBe(lager.slots);
    expect(lager.slots).toBe(8);
    expect(find("Wohnhaus")).toContain("vier Bewohnern");
    expect(BUILDINGS.haus.housing).toBe(4);
    expect(find("Wohnhaus")).toContain(`${TUNING.immigrantSeconds} Sekunden`);
    expect(START.raid.firstSeconds).toBe(360); // „etwa sechs Minuten“
    expect(START.raid.everySeconds).toBe(240); // „alle vier Minuten“
    expect(find("besiegte Angreifer")).toContain(`${TUNING.bounty} Gold`);
    expect(find("Die Kaserne")).toContain("sechs Truppen");
    expect(BUILDINGS.kaserne.trains).toHaveLength(6);
    // „Pikeniere und Armbrustschützen erst nach Forschung“, die übrigen ohne
    expect(BUILDINGS.kaserne.trains!.filter((u) => UNITS[u].tech)).toEqual(["pikenier", "armbrustschuetze"]);
  });
});

describe("Tastenübersicht (Titel)", () => {
  it("ist eindeutig und knapp", () => {
    const keys = STEUERUNG.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [k, v] of STEUERUNG) {
      expect(k.length).toBeGreaterThan(0);
      expect(v.length).toBeGreaterThan(3);
      expect(v.length).toBeLessThanOrEqual(60);
    }
  });
});
