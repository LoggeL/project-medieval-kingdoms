/**
 * Wege, Brücken und Fuhrwesen (BRIEF §3, §5.3, §9 Infrastruktur; ADR 0015). Die Gebäude werden in BUILDINGS (index.ts)
 * mit einer Zeile eingehängt.
 *
 * Wege und Brücken sind Bauten mit `road`: Sie werden wie eine Mauer gezogen, Tagelöhner bringen das Material (Kies
 * bzw. Pflastersteine sind Stein aus dem Lager) und legen den Belag Feld für Feld. Ihr Grundriss bleibt begehbar, fertig
 * gilt im Laufraster `road.cost` statt der Geländekosten: Figuren gehen dort schneller, und die Wegfindung bevorzugt
 * sie. Eine Brücke liegt nur auf Wasser und macht es erst begehbar, wenn sie fertig ist.
 */
import type { BuildingDef } from "./index";

export type TransportKey = "kiesweg" | "pflaster" | "bruecke";

export const TRANSPORT: Record<TransportKey, BuildingDef> = {
  kiesweg: {
    name: "Kiesweg", desc: "Ziehen, um einen Weg aus gestampftem Kies zu legen. Auf Wegen gehen alle schneller, Träger nehmen sie gern.",
    category: "wege", footprint: [1, 1], cost: { stein: 1 }, buildSeconds: 2, sprite: "kiesweg_kreuz",
    construction: { ground: "baustelle_weg", foundation: 0.3, piles: [[0, 0]] },
    road: { cost: 0.62, pieces: "kiesweg" }, drag: true, hp: 50,
  },
  pflaster: {
    name: "Pflasterstraße", desc: "Ziehen, um eine Straße aus Feldsteinen zu pflastern: teurer als Kies, aber noch schneller.",
    category: "wege", footprint: [1, 1], cost: { stein: 2 }, buildSeconds: 4, sprite: "pflaster_kreuz",
    construction: { ground: "baustelle_weg", foundation: 0.3, piles: [[0, 0]] },
    road: { cost: 0.55, pieces: "pflaster" }, drag: true, hp: 80,
  },
  bruecke: {
    name: "Holzbrücke", desc: "Über den Fluss ziehen: Joch für Joch vom Ufer aus gebaut, erst die fertige Brücke ist begehbar.",
    category: "wege", footprint: [1, 1], cost: { holz: 4 }, buildSeconds: 6, sprite: "bruecke",
    construction: { ground: "baustelle_bruecke", foundation: 0.3, piles: [[0, 0]] },
    road: { cost: 0.7, bridge: true }, drag: true, hp: 200,
  },
};
