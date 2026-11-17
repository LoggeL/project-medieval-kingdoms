/**
 * Forschung (BRIEF §6.3): keine Zeitalter, jede Technik einzeln. Geforscht wird im Bergfried, eine Technik nach der
 * anderen. Gold wird beim Start bezahlt, Waren bringen Tagelöhner aus dem Lager in den Bergfried; erst wenn alles da
 * ist, läuft die Zeit. Neue Techniken sind Einträge hier (plus Ikone), kein neuer Code.
 *
 * Freischaltungen stehen beim Freigeschalteten: BuildingDef.tech bzw. UnitDef.tech nennen die nötige Technik, die
 * Ausbaustufen des Bergfrieds nennen sie in BuildingLevel.upgrade.tech. Die Oberfläche liest daraus, was eine Technik
 * freischaltet, damit nichts doppelt gepflegt wird.
 */
import type { AnimKey, BuildingKey, Cost, UnitKey } from "./index";

export type TechKey = "steinbau" | "festungsbau" | "werkzeuge" | "tragjoch" | "langbogen" | "ruestung" | "marktrecht";

export interface TechEffects {
  /** Arbeitszeit-Faktor je Arbeitsanimation (0,75 = ein Viertel schneller). */
  work?: Partial<Record<AnimKey, number>>;
  /** Werte-Boni für eigene Einheiten dieser Arten (gelten auch für schon ausgebildete). */
  units?: { keys: UnitKey[]; range?: number; armor?: number };
  /** Tempo-Faktor für Figuren, die eine Ware tragen. */
  carrySpeed?: number;
  /** Faktor auf die Steuern des Bergfrieds. */
  income?: number;
}

export interface TechDef {
  name: string;
  /** Was die Technik bewirkt, ein bis zwei Sätze. */
  desc: string;
  /** Ikone im Ikonenblatt (assets/ui/forschung.png, Spalte). */
  icon: number;
  /** Gold sofort, Waren bringen Träger in den Bergfried. */
  cost: Cost;
  seconds: number;
  /** Voraussetzungen: andere Techniken, fertige Gebäude, Stufe des Bergfrieds. */
  requires?: { techs?: TechKey[]; buildings?: BuildingKey[]; level?: number };
  effects?: TechEffects;
  /** Spalte im Forschungsbaum (0 = Bergfried, 1 = Wirtschaft, 2 = Militär); Zeile ergibt sich aus der Reihenfolge. */
  branch: 0 | 1 | 2;
}

export const TECHS: Record<TechKey, TechDef> = {
  steinbau: {
    name: "Steinbaukunst", desc: "Mörtel, Gerüst und behauene Quader: Der Bergfried lässt sich in Stein ausbauen.",
    icon: 0, cost: { gold: 20, stein: 10 }, seconds: 40, branch: 0,
  },
  festungsbau: {
    name: "Festungsbau", desc: "Zinnen, Wehrplattform und Ecktürmchen: Der Bergfried wird zum Burgfried ausgebaut.",
    icon: 1, cost: { gold: 40, stein: 20, holz: 10 }, seconds: 60, branch: 0,
    requires: { techs: ["steinbau"], buildings: ["kaserne"], level: 2 },
  },
  marktrecht: {
    name: "Marktrecht", desc: "Ein verbrieftes Marktrecht bringt Abgaben: Der Bergfried nimmt die Hälfte mehr Steuern ein.",
    icon: 6, cost: { gold: 30, holz: 6 }, seconds: 45, branch: 0,
    requires: { level: 2 }, effects: { income: 1.5 },
  },
  werkzeuge: {
    name: "Gehärtete Werkzeuge", desc: "Stahlschneiden für Axt und Spitzhacke: Holzfäller und Steinmetze arbeiten ein Viertel schneller.",
    icon: 2, cost: { gold: 15, holz: 8 }, seconds: 35, branch: 1,
    effects: { work: { hacken: 0.75, abbauen: 0.75 } },
  },
  tragjoch: {
    name: "Tragjoch", desc: "Ein Joch über den Schultern verteilt die Last: Träger gehen mit Ware ein Fünftel schneller.",
    icon: 3, cost: { gold: 15, holz: 6 }, seconds: 30, branch: 1,
    requires: { techs: ["werkzeuge"] }, effects: { carrySpeed: 1.2 },
  },
  langbogen: {
    name: "Langbogen", desc: "Bögen aus Eibe in Mannshöhe: Bogenschützen schießen anderthalb Felder weiter.",
    icon: 4, cost: { gold: 25, holz: 10 }, seconds: 45, branch: 2,
    requires: { buildings: ["kaserne"] }, effects: { units: { keys: ["bogen"], range: 1.5 } },
  },
  ruestung: {
    name: "Schwere Rüstung", desc: "Kettenhemd und Eisenhut: Speerträger und Schwertkämpfer bekommen zwei Punkte Rüstung dazu.",
    icon: 5, cost: { gold: 35, holz: 6, stein: 6 }, seconds: 50, branch: 2,
    requires: { buildings: ["kaserne"], level: 2 }, effects: { units: { keys: ["speer", "schwert"], armor: 2 } },
  },
};

export const TECH_KEYS = Object.keys(TECHS) as TechKey[];
