/**
 * Einheiten des Militärs aus dem Konzept (docs/concept/05-militaer-und-kampf.md, BRIEF §6, §7, §8.3; ADR 0014).
 *
 * Jede Konzepteinheit ist eine UnitDef mit Werten (Leben, Rüstung, Rüstungsklasse, Schaden und Schadensart,
 * Reichweite, Takt, Konter-Boni) und Kosten (Gold, Ausrüstung aus dem Lager, ein Tagelöhner als Bevölkerung).
 * Spielbar ist eine Einheit, wenn ein Gebäude sie in BuildingDef.trains führt; Forschungssperren stehen in
 * UnitDef.tech. Was es im Spiel noch nicht gibt (Reitstall, Söldnerlager, Pferde, Pulver …), nennt UnitDef.planned:
 * Solche Einheiten stehen ausgegraut im Einheitenraster (src/ui/roster.ts liest nur diese Daten) und lassen sich nicht
 * ausbilden. Belagerungsgerät gehört nicht hierher (eigener Zweig).
 *
 * Schadensmodell (Konzept „Schadensmodell“): Grundschaden × Konter-Bonus × Faktor Schadensart gegen Rüstungsklasse
 * (ARMOR_MATRIX), dann wie bisher abzüglich Rüstungspunkte × DAMAGE_TYPES[art].armor. Die Formel steht einmal in
 * hitFactor (index.ts), Simulation und Oberfläche rechnen damit.
 */
import type { UnitDef } from "./index";

/** Rüstungsklassen des Konzepts. Einheiten ohne Klasse (Arbeiter) zählen mit Faktor 1. */
export type ArmorClass = "keine" | "gepolstert" | "leder" | "kette" | "platte";

export const ARMOR_NAME: Record<ArmorClass, string> = { keine: "keine", gepolstert: "Gambeson", leder: "Leder", kette: "Kette", platte: "Platte" };

/** Faktor je Schadensart (Zeile) und Rüstungsklasse (Spalte), Tabelle aus dem Konzept 05. */
export const ARMOR_MATRIX = {
  hieb: { keine: 1.2, gepolstert: 1.0, leder: 0.9, kette: 0.6, platte: 0.3 },
  stich: { keine: 1.1, gepolstert: 1.0, leder: 0.9, kette: 0.8, platte: 0.5 },
  wucht: { keine: 1.0, gepolstert: 0.9, leder: 0.9, kette: 0.9, platte: 0.8 },
  pfeil: { keine: 1.2, gepolstert: 0.8, leder: 0.8, kette: 0.5, platte: 0.15 },
  bolzen: { keine: 1.2, gepolstert: 1.0, leder: 1.0, kette: 0.8, platte: 0.6 },
  kugel: { keine: 1.2, gepolstert: 1.1, leder: 1.1, kette: 1.0, platte: 0.9 },
} as const satisfies Record<string, Record<ArmorClass, number>>;

/** Gruppen des Einheitenrasters, in dieser Reihenfolge. building = wo ausgebildet wird bzw. werden soll. */
export type UnitGroup = "fussvolk" | "schuetzen" | "reiterei" | "tross";
export const UNIT_GROUPS: { key: UnitGroup; title: string; building: string }[] = [
  { key: "fussvolk", title: "Fußvolk", building: "Kaserne, Söldnerlager" },
  { key: "schuetzen", title: "Schützen", building: "Kaserne, Schießplatz, Büchsenmeisterei" },
  { key: "reiterei", title: "Reiterei", building: "Reitstall" },
  { key: "tross", title: "Tross", building: "Kaserne" },
];

const REITSTALL = ["Forschung: Gestüt", "Gebäude: Reitstall", "Ware: Pferde"];
const PULVER = ["Forschung: Schwarzpulver", "Gebäude: Büchsenmeisterei", "Ware: Pulver"];
const MORAL = ["Moral und Formationen (noch nicht im Spiel)"];

export type MilitaerKey =
  | "waffenknecht" | "milizsoldat" | "fusssoldat" | "hellebardier" | "pikenier" | "doppelsoeldner" | "landsknecht"
  | "schleuderer" | "langbogenschuetze" | "armbrustschuetze" | "schwere_armbrust" | "pavesenschuetze" | "handbuechse" | "arkebusier" | "hakenbuechse"
  | "leichter_reiter" | "sergeant" | "ritter_pferd" | "berittener_armbrust" | "gepanzerter_ritter"
  | "bannertraeger" | "trommler" | "feldscher" | "ingenieur";

/** sprite "" = noch keine Figur (das Raster zeigt ein Wappenschild mit Anfangsbuchstaben). */
export const MILITAER: Record<MilitaerKey, UnitDef> = {
  // ------------------------------------------------------------ Fußvolk
  waffenknecht: {
    name: "Waffenknecht", sprite: "waffenknecht", role: "nahkampf", group: "fussvolk", armorClass: "leder",
    desc: "Billige Masse mit Speer: schwach, aber schnell ausgebildet. Sein Stich trifft Reiter doppelt.",
    hp: 60, speed: 1.5, armor: 0, damage: 7, damageType: "stich", range: 1.3, cooldown: 1.2, bonus: { reiter: 2 },
    train: { gold: 4, equipment: "speer", seconds: 5 }, canStation: true,
  },
  milizsoldat: {
    name: "Milizsoldat", sprite: "", role: "nahkampf", group: "fussvolk", armorClass: "gepolstert",
    desc: "Städtische Bürgerwehr mit Speer und Gambeson: solide Verteidiger.",
    hp: 75, speed: 1.4, armor: 2, damage: 9, damageType: "stich", range: 1.3, cooldown: 1.2, bonus: { reiter: 2 },
    train: { gold: 8, equipment: "speer", seconds: 7 }, canStation: true, planned: ["Ware: Gambesons (Schneiderei)"],
  },
  fusssoldat: {
    name: "Gepanzerter Fußknecht", sprite: "ritter", role: "nahkampf", group: "fussvolk", armorClass: "platte",
    desc: "Schwere Front im Plattenharnisch mit Streitkolben: langsam, kaum verwundbar, Wucht geht durch Rüstung.",
    hp: 150, speed: 1.0, armor: 8, damage: 14, damageType: "wucht", range: 1.1, cooldown: 1.4,
    train: { gold: 30, equipment: "ruestung", seconds: 14 }, canStation: true, tech: "kettenschmiede",
    planned: ["Forschung: Plattnerei", "Ware: Streitkolben"],
  },
  hellebardier: {
    name: "Hellebardier", sprite: "", role: "nahkampf", group: "fussvolk", armorClass: "kette",
    desc: "Hellebarde und Kettenhemd: stark gegen Reiter und gegen Platte.",
    hp: 100, speed: 1.2, armor: 4, damage: 13, damageType: "stich", range: 1.6, cooldown: 1.4, bonus: { reiter: 2 },
    train: { gold: 18, equipment: "ruestung", seconds: 12 }, canStation: true, tech: "kettenschmiede",
    planned: ["Forschung: Stangenwaffen", "Ware: Hellebarden"],
  },
  pikenier: {
    name: "Pikenier", sprite: "pikenier", role: "nahkampf", group: "fussvolk", armorClass: "kette",
    desc: "Pike und Harnisch, Rückgrat des Gewalthaufens: große Reichweite, gegen Reiter dreifach (Pikenblock).",
    hp: 95, speed: 1.2, armor: 3, damage: 11, damageType: "stich", range: 2, cooldown: 1.5, bonus: { reiter: 3, nahkampf: 1.1 },
    train: { gold: 15, equipment: "pike", extra: ["ruestung"], seconds: 12 }, canStation: true, tech: "gewalthaufen",
  },
  doppelsoeldner: {
    name: "Doppelsöldner", sprite: "", role: "nahkampf", group: "fussvolk", armorClass: "kette",
    desc: "Elite mit dem Zweihänder, bricht Pikenblöcke. Söldner bringen ihre Ausrüstung mit, kosten aber viel Gold.",
    hp: 120, speed: 1.3, armor: 5, damage: 18, damageType: "hieb", range: 1.4, cooldown: 1.6, bonus: { nahkampf: 1.3 },
    train: { gold: 60, seconds: 6 }, canStation: true, planned: ["Gebäude: Söldnerlager"],
  },
  landsknecht: {
    name: "Landsknecht", sprite: "landsknecht", role: "nahkampf", group: "fussvolk", armorClass: "gepolstert",
    desc: "Vielseitiger Elite-Söldner in geschlitztem Wams, hoher Sold.",
    hp: 110, speed: 1.4, armor: 4, damage: 15, damageType: "hieb", range: 1.2, cooldown: 1.1,
    train: { gold: 45, seconds: 6 }, canStation: true, planned: ["Gebäude: Söldnerlager"],
  },
  // ------------------------------------------------------------ Schützen
  schleuderer: {
    name: "Schleuderer", sprite: "", role: "fernkampf", group: "schuetzen", armorClass: "keine",
    desc: "Billigster Fernkampf: Steine mit der Schleuder, ohne Ausrüstung aus dem Lager.",
    hp: 45, speed: 1.7, armor: 0, damage: 5, damageType: "wucht", range: 5, cooldown: 1.6,
    train: { gold: 6, seconds: 5 }, canStation: true, planned: ["Gebäude: Schießplatz"],
  },
  langbogenschuetze: {
    name: "Langbogenschütze", sprite: "", role: "fernkampf", group: "schuetzen", armorClass: "leder",
    desc: "Große Reichweite und hohe Kadenz, aber Pfeile prallen an Kette und Platte ab.",
    hp: 60, speed: 1.5, armor: 1, damage: 9, damageType: "pfeil", range: 9, cooldown: 1.4,
    train: { gold: 20, equipment: "bogen", seconds: 11 }, canStation: true, tech: "langbogen", planned: ["Gebäude: Schießplatz"],
  },
  armbrustschuetze: {
    name: "Armbrustschütze", sprite: "armbrustschuetze", role: "fernkampf", group: "schuetzen", armorClass: "leder",
    desc: "Durchschlagend gegen Rüstung, lädt aber langsam nach (4 s).",
    hp: 60, speed: 1.4, armor: 2, damage: 14, damageType: "bolzen", range: 6.5, cooldown: 4,
    train: { gold: 14, equipment: "armbrust", seconds: 10 }, canStation: true, tech: "armbrustbau",
  },
  schwere_armbrust: {
    name: "Schwerer Armbrustschütze", sprite: "", role: "fernkampf", group: "schuetzen", armorClass: "kette",
    desc: "Windenarmbrust im Kettenhemd: knackt Platte, lädt sehr langsam (7 s).",
    hp: 70, speed: 1.2, armor: 4, damage: 22, damageType: "bolzen", range: 7, cooldown: 7,
    train: { gold: 24, equipment: "armbrust", extra: ["ruestung"], seconds: 14 }, canStation: true, tech: "armbrustbau",
    planned: ["Ware: Windenarmbrüste", "Gebäude: Schießplatz"],
  },
  pavesenschuetze: {
    name: "Pavesenschütze", sprite: "armbrust", role: "fernkampf", group: "schuetzen", armorClass: "leder",
    desc: "Armbrust mit Setzschild: Deckung auch im freien Feld.",
    hp: 70, speed: 1.2, armor: 3, damage: 14, damageType: "bolzen", range: 6.5, cooldown: 4,
    train: { gold: 18, equipment: "armbrust", seconds: 12 }, canStation: true, tech: "armbrustbau", planned: ["Ware: Pavesen"],
  },
  handbuechse: {
    name: "Handbüchsenschütze", sprite: "", role: "fernkampf", group: "schuetzen", armorClass: "gepolstert",
    desc: "Ungenau und laut, aber die Kugel geht durch jede Rüstung.",
    hp: 55, speed: 1.3, armor: 1, damage: 16, damageType: "kugel", range: 5, cooldown: 8,
    train: { gold: 20, seconds: 10 }, canStation: true, planned: [...PULVER, "Ware: Handbüchsen"],
  },
  arkebusier: {
    name: "Arkebusier", sprite: "", role: "fernkampf", group: "schuetzen", armorClass: "leder",
    desc: "Hohe Durchschlagskraft, lädt sehr langsam nach (10 s).",
    hp: 60, speed: 1.3, armor: 2, damage: 24, damageType: "kugel", range: 6.5, cooldown: 10,
    train: { gold: 28, seconds: 12 }, canStation: true, planned: [...PULVER, "Forschung: Luntenschloss", "Ware: Arkebusen"],
  },
  hakenbuechse: {
    name: "Hakenbüchsenschütze", sprite: "", role: "fernkampf", group: "schuetzen", armorClass: "leder",
    desc: "Schwere Wallbüchse, nur auf Mauern und Türmen.",
    hp: 60, speed: 1.0, armor: 2, damage: 32, damageType: "kugel", range: 8, cooldown: 12,
    train: { gold: 34, seconds: 14 }, canStation: true, planned: [...PULVER, "Ware: Hakenbüchsen"],
  },
  // ------------------------------------------------------------ Reiterei
  leichter_reiter: {
    name: "Leichter Reiter", sprite: "", role: "nahkampf", group: "reiterei", mounted: true, armorClass: "leder",
    desc: "Späher zu Pferd: jagt Schützen im Freien und Belagerungsgerät.",
    hp: 90, speed: 2.6, armor: 2, damage: 9, damageType: "stich", range: 1.3, cooldown: 1.1, bonus: { fernkampf: 1.5 },
    train: { gold: 20, equipment: "speer", seconds: 12 }, planned: REITSTALL,
  },
  sergeant: {
    name: "Berittener Sergeant", sprite: "", role: "nahkampf", group: "reiterei", mounted: true, armorClass: "kette",
    desc: "Solide Kavallerie mit Schwert und Kettenhemd.",
    hp: 130, speed: 2.2, armor: 5, damage: 13, damageType: "hieb", range: 1.2, cooldown: 1.2, bonus: { fernkampf: 1.5 },
    train: { gold: 30, equipment: "schwert", extra: ["ruestung"], seconds: 14 }, planned: REITSTALL,
  },
  ritter_pferd: {
    name: "Ritter", sprite: "", role: "nahkampf", group: "reiterei", mounted: true, armorClass: "kette",
    desc: "Lanzenangriff, Elite zu Pferd. Gegen Pikeniere ein teurer Fehler.",
    hp: 170, speed: 2.2, armor: 6, damage: 18, damageType: "stich", range: 1.3, cooldown: 1.3, bonus: { fernkampf: 1.5 },
    train: { gold: 45, equipment: "schwert", extra: ["ruestung"], seconds: 18 }, planned: [...REITSTALL, "Ware: Lanzen"],
  },
  berittener_armbrust: {
    name: "Berittener Armbrustschütze", sprite: "", role: "fernkampf", group: "reiterei", mounted: true, armorClass: "leder",
    desc: "Mobile Feuerkraft: schießt Bolzen und reitet davon.",
    hp: 85, speed: 2.3, armor: 2, damage: 12, damageType: "bolzen", range: 5.5, cooldown: 4,
    train: { gold: 30, equipment: "armbrust", seconds: 14 }, tech: "armbrustbau", planned: REITSTALL,
  },
  gepanzerter_ritter: {
    name: "Gepanzerter Ritter", sprite: "", role: "nahkampf", group: "reiterei", mounted: true, armorClass: "platte",
    desc: "Plattenharnisch auch am Pferd, sehr teuer. Nur Bolzen, Kugeln und Piken halten ihn auf.",
    hp: 220, speed: 1.9, armor: 10, damage: 20, damageType: "stich", range: 1.3, cooldown: 1.3, bonus: { fernkampf: 1.5 },
    train: { gold: 70, equipment: "ruestung", seconds: 22 }, tech: "kettenschmiede", planned: [...REITSTALL, "Forschung: Plattnerei", "Ware: Lanzen"],
  },
  // ------------------------------------------------------------ Tross
  bannertraeger: {
    name: "Bannerträger", sprite: "", role: "nahkampf", group: "tross", armorClass: "gepolstert",
    desc: "Sammelpunkt im Kampf, hebt die Moral im Umkreis.",
    hp: 70, speed: 1.4, armor: 1, damage: 4, damageType: "hieb", range: 1.1, cooldown: 1.4,
    train: { gold: 12, seconds: 8 }, planned: MORAL,
  },
  trommler: {
    name: "Trommler", sprite: "", role: "nahkampf", group: "tross", armorClass: "gepolstert",
    desc: "Gibt den Takt: schneller und mutiger in Formation.",
    hp: 55, speed: 1.5, armor: 0, damage: 3, damageType: "hieb", range: 1.1, cooldown: 1.4,
    train: { gold: 10, seconds: 8 }, planned: MORAL,
  },
  feldscher: {
    name: "Feldscher", sprite: "", role: "nahkampf", group: "tross", armorClass: "keine",
    desc: "Heilt Verwundete langsam, abseits des Kampfes.",
    hp: 45, speed: 1.5, armor: 0, damage: 2, damageType: "hieb", range: 1.1, cooldown: 1.5,
    train: { gold: 15, seconds: 10 }, planned: ["Heilen (noch nicht im Spiel)", "Forschung: Wundarznei"],
  },
  ingenieur: {
    name: "Ingenieur", sprite: "", role: "nahkampf", group: "tross", armorClass: "keine",
    desc: "Baut Belagerungsgerät vor Ort und repariert es.",
    hp: 50, speed: 1.4, armor: 0, damage: 3, damageType: "wucht", range: 1.1, cooldown: 1.5,
    train: { gold: 20, seconds: 10 }, planned: ["Gebäude: Bauhütte", "Forschung: Belagerungstechnik"],
  },
};
