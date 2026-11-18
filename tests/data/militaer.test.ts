/**
 * Daten der Militärwirtschaft und des Einheitenrasters (ADR 0014): jede Konzepteinheit mit Werten und Kosten,
 * spielbare Einheiten mit Figur und Ausbildungsgebäude, Sperren, Schadensmatrix, Rezepte und Gebäude der Werkstätten.
 */
import { describe, expect, it } from "vitest";
import {
  ARMOR_MATRIX, BUILDINGS, START, DAMAGE_TYPES, GOODS, RECIPES, RECIPE_KEYS, RESOURCE_TAGS, TECHS, UNITS, UNIT_GROUPS,
  equipmentOf, hitFactor, recipesOf, trainCost, type BuildingKey, type UnitKey,
} from "../../src/data";
import { BELAGERUNG_UNITS } from "../../src/data/belagerung";
import { MILITAER } from "../../src/data/militaer";
import { RUESTUNG_BUILDINGS, RUESTUNG_TECHS } from "../../src/data/ruestung";
import { ROSTER, isPlayable } from "../../src/ui/roster";
import rosterSource from "../../src/ui/roster.ts?raw";
import FIGS from "../../assets/figures/vorgerendert/sheet.json";
import BLD from "../../assets/buildings/vorgerendert/sheet.json";

const FIG_KEYS = new Set((FIGS as { units: { key: string; anims: Record<string, unknown> }[] }).units.map((u) => u.key));
const FIG_ANIMS = new Map((FIGS as { units: { key: string; anims: Record<string, unknown> }[] }).units.map((u) => [u.key, Object.keys(u.anims)]));
const BLD_KEYS = new Set((BLD as { units: { key: string }[] }).units.map((u) => u.key));
const MIL = Object.keys(MILITAER) as UnitKey[];
const TRAINED = new Set(Object.values(BUILDINGS).flatMap((b) => b.trains ?? []));

describe("Einheiten aus dem Konzept", () => {
  it("jede Konzepteinheit hat Werte, Rüstungsklasse, Gruppe, Beschreibung und Kosten", () => {
    expect(MIL.length).toBeGreaterThanOrEqual(20);
    for (const k of MIL) {
      const d = UNITS[k];
      expect(d.hp, k).toBeGreaterThan(0);
      expect(d.damage, k).toBeGreaterThan(0);
      expect(d.range, k).toBeGreaterThan(0);
      expect(d.cooldown, k).toBeGreaterThan(0);
      expect(DAMAGE_TYPES[d.damageType!], k).toBeDefined();
      expect(ARMOR_MATRIX[d.damageType!][d.armorClass!], k).toBeDefined();
      expect(UNIT_GROUPS.some((g) => g.key === d.group), k).toBe(true);
      expect(d.desc!.length, k).toBeGreaterThan(20);
      expect(d.train!.gold, k).toBeGreaterThan(0);
      expect(d.train!.seconds, k).toBeGreaterThan(0);
      for (const g of equipmentOf(d)) expect(GOODS[g], `${k}: ${g}`).toBeDefined();
      if (d.tech) expect(TECHS[d.tech], k).toBeDefined();
      if (d.sprite) expect(FIG_KEYS.has(d.sprite), `${k}: Figur ${d.sprite}`).toBe(true);
    }
  });

  it("Waffenknecht, Pikenier und Armbrustschütze sind spielbar: Kaserne, eigene Figur mit Kampf- und Sterbeanimation", () => {
    for (const k of ["waffenknecht", "pikenier", "armbrustschuetze"] as UnitKey[]) {
      expect(BUILDINGS.kaserne.trains, k).toContain(k);
      expect(isPlayable(k), k).toBe(true);
      expect(UNITS[k].sprite, k).toBe(k);
      const anims = FIG_ANIMS.get(k)!;
      expect(anims, k).toEqual(expect.arrayContaining(["stehen", "gehen", "sterben", "tot"]));
      expect(anims.includes(UNITS[k].role === "fernkampf" ? "schiessen" : "angriff"), `${k}: ${anims}`).toBe(true);
    }
    expect(UNITS.pikenier.tech).toBe("gewalthaufen");
    expect(UNITS.armbrustschuetze.tech).toBe("armbrustbau");
    expect(UNITS.waffenknecht.tech).toBeUndefined();
  });

  it("geplante Einheiten bildet kein Gebäude aus; jede spielbare hat ein Ausbildungsgebäude", () => {
    for (const k of MIL) {
      if (UNITS[k].planned?.length) expect(TRAINED.has(k), k).toBe(false);
      else expect(TRAINED.has(k), k).toBe(true);
    }
  });

  it("die Kosten nennen alle Ausrüstungsstücke: Pikenier braucht Pike und Rüstung", () => {
    expect(equipmentOf(UNITS.pikenier)).toEqual(["pike", "ruestung"]);
    expect(trainCost(UNITS.pikenier)).toEqual({ gold: 15, pike: 1, ruestung: 1 });
    expect(trainCost(UNITS.armbrustschuetze)).toEqual({ gold: 14, armbrust: 1 });
    expect(trainCost(UNITS.waffenknecht)).toEqual({ gold: 4, speer: 1 });
    expect(trainCost(UNITS.landsknecht).gold).toBeGreaterThan(0);
  });
});

describe("Schadensmatrix (Konzept 05)", () => {
  it("Pike und Speer treffen Reiter mehrfach; Reiterbonus ersetzt den Rollenbonus", () => {
    expect(UNITS.ritter_pferd.mounted).toBe(true);
    expect(hitFactor(UNITS.pikenier, UNITS.ritter_pferd)).toBeCloseTo(3 * ARMOR_MATRIX.stich.kette);
    // gegen Fußvolk der Rollenbonus × Stich gegen die Kette des Schwertkämpfers
    expect(hitFactor(UNITS.pikenier, UNITS.schwert)).toBeCloseTo(UNITS.pikenier.bonus!.nahkampf! * ARMOR_MATRIX.stich.kette);
    expect(hitFactor(UNITS.schwert, UNITS.ritter_pferd)).toBeLessThan(hitFactor(UNITS.pikenier, UNITS.ritter_pferd) / 2);
  });

  it("Bolzen gegen Platte vier Mal so stark wie Pfeil, Hieb an Platte schwach, Kugel fast ungebremst", () => {
    expect(ARMOR_MATRIX.bolzen.platte / ARMOR_MATRIX.pfeil.platte).toBe(4);
    expect(ARMOR_MATRIX.hieb.platte).toBeLessThan(ARMOR_MATRIX.wucht.platte);
    expect(ARMOR_MATRIX.kugel.platte).toBeGreaterThan(0.8);
    // jede Spalte: Rüstung schützt (nie mehr Schaden gegen bessere Rüstung)
    const order = ["keine", "gepolstert", "leder", "kette", "platte"] as const;
    for (const row of Object.values(ARMOR_MATRIX)) for (let i = 1; i < order.length; i++) expect(row[order[i]]).toBeLessThanOrEqual(row[order[i - 1]]);
  });

  it("ohne Rüstungsklasse (Arbeiter) rechnet der Faktor wie bisher", () => {
    expect(hitFactor(UNITS.schwert, UNITS.tageloehner)).toBe(1);
    expect(hitFactor(UNITS.bogen, UNITS.tageloehner)).toBe(1);
  });

  it("jeder Angreifer der Überfälle trägt eine Rüstungsklasse: die Matrix wirkt auch gegen sie (BRIEF §7)", () => {
    const raiders = new Set<UnitKey>([...START.raid.mix, ...(Object.keys(BELAGERUNG_UNITS) as UnitKey[])]);
    for (const k of raiders) if (UNITS[k].role !== "belagerung") expect(UNITS[k].armorClass, k).toBeDefined();
    // Schwertkämpfer in Kette: Armbrustbolzen wirken stärker als Pfeile („stark gegen schwer gepanzerte“)
    expect(hitFactor(UNITS.armbrustschuetze, UNITS.schwert)).toBeGreaterThan(hitFactor(UNITS.bogen, UNITS.schwert));
    expect(hitFactor(UNITS.bogen, UNITS.schwert)).toBeCloseTo(ARMOR_MATRIX.pfeil.kette);
    // die Texte der Grundeinheiten nennen ihre Rüstung
    expect(UNITS.schwert.armorClass).toBe("kette");
    expect(UNITS.speer.armorClass).toBe("gepolstert");
    expect(UNITS.bogen.armorClass).toBe("leder");
  });
});

describe("Werkstätten, Rezepte und Forschung", () => {
  it("jede Werkstatt hat Figur, Sprite mit Baustelle und Gerüst, Rezepte und Arbeitsplatz", () => {
    for (const k of Object.keys(RUESTUNG_BUILDINGS) as BuildingKey[]) {
      const d = BUILDINGS[k];
      expect(BLD_KEYS.has(d.sprite), `${k}: ${d.sprite}`).toBe(true);
      expect(BLD_KEYS.has(`baustelle_${k}`), k).toBe(true);
      expect(FIG_KEYS.has(UNITS[d.workers!.unit].sprite), k).toBe(true);
      if (d.production) {
        expect(recipesOf(k).length, k).toBeGreaterThan(0);
        expect(BLD_KEYS.has(`geruest_${k}`), k).toBe(true);
        expect(BLD_KEYS.has(`${d.sprite}_innen`), k).toBe(true);
      }
    }
    expect(BLD_KEYS.has(RESOURCE_TAGS.erz.sprite!)).toBe(true);
  });

  it("Rezepte der Kette: Erz → Eisen → Waffen und Rüstung, jede neue Ware hat einen Stapel im Lager", () => {
    expect(RECIPES.schmelzen.inputs).toEqual({ erz: 2, holz: 1 });
    expect(RECIPES.schmelzen.outputs).toEqual({ eisen: 1 });
    for (const k of RECIPE_KEYS) {
      const r = RECIPES[k];
      if (r.tech) expect(TECHS[r.tech], k).toBeDefined();
    }
    const made = new Set(RECIPE_KEYS.flatMap((k) => Object.keys(RECIPES[k].outputs)));
    for (const g of ["eisen", "schwert", "speer", "bogen", "pike", "armbrust", "ruestung"]) expect(made.has(g), g).toBe(true);
    for (const g of ["erz", "pike", "armbrust", "ruestung"]) {
      expect(GOODS[g as keyof typeof GOODS].store).toBe("material");
      expect(BLD_KEYS.has(`stapel_${g}`), g).toBe(true);
    }
  });

  it("neue Techniken: Voraussetzungen vorhanden, Kosten mit Gold, eigenes Ikonenblatt", () => {
    for (const [k, t] of Object.entries(RUESTUNG_TECHS)) {
      expect(t.cost.gold, k).toBeGreaterThan(0);
      expect(t.iconSheet, k).toBe("forschung_ruestung");
      for (const r of t.requires?.techs ?? []) expect(TECHS[r], `${k} → ${r}`).toBeDefined();
      for (const b of t.requires?.buildings ?? []) expect(BUILDINGS[b], `${k} → ${b}`).toBeDefined();
    }
    // Gesamtkosten in Gold bleiben unter dem Startgold (150): Forschung ist eine Wahl, keine Pflicht
    const gold = Object.values(RUESTUNG_TECHS).reduce((n, t) => n + (t.cost.gold ?? 0), 0);
    expect(gold).toBeLessThan(150);
  });
});

describe("Einheitenraster liest nur Daten", () => {
  it("jede Konzepteinheit steht im Raster, spielbare je Gruppe zuerst", () => {
    const all = ROSTER.flatMap((g) => g.entries.map((e) => e.key));
    for (const k of MIL) expect(all, k).toContain(k);
    for (const g of ROSTER) {
      const p = g.entries.map((e) => !!e.unit);
      expect(p.indexOf(false) === -1 || p.lastIndexOf(true) < p.indexOf(false), g.title).toBe(true);
    }
    const locked = ROSTER.flatMap((g) => g.entries).filter((e) => !e.unit);
    for (const e of locked) expect(e.needs!.length, e.key).toBeGreaterThan(0);
  });

  it("roster.ts nennt keine Einheit beim Namen", () => {
    for (const k of MIL) expect(rosterSource.includes(`"${k}"`), k).toBe(false);
  });
});
