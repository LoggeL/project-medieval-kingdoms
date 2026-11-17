/**
 * Waren und Lagertypen (BRIEF §5.1, §5.4, ADR 0011).
 *
 * Jede Ware gehört zu genau einem Lagertyp: Baustoffe, Metall, Werkzeug und Waffen ins Materiallager (Lagerhaus),
 * Lebensmittel in die Kornkammer. Ein Lager nimmt nur Waren seines Typs (BuildingDef.storage.kind), Träger suchen
 * Platz und Ware nur dort. Neue Ware = ein Eintrag hier (Typ in `Good` ergänzen) plus Lagerstapel-Sprite (`stack`,
 * Gebäudeblatt, Füllstufen 0–4) und Trägerfigur (`carrier`, Figurenblatt); die Ikone der Oberfläche schneidet die
 * Darstellung aus dem vollen Stapel. Fehlt ein Sprite, zeichnet die Darstellung einen Ersatz und warnt einmal.
 */

/** Lagertyp: welches Lager eine Ware aufnimmt. */
export type StoreKey = "material" | "nahrung";

export interface StoreDef {
  /** Name des Lagertyps (Kopfleiste, Panel). */
  name: string;
  /** Gebäude dieses Typs, das der Spieler baut (für Hinweise, z. B. „Baue eine weitere Kornkammer“). */
  building: string;
  /** Meldung, wenn eine Ware dieses Typs nirgends mehr Platz hat. */
  full: string;
  /** Meldung, wenn es gar kein Lager dieses Typs gibt und ein Träger seine Last nicht loswird. */
  none: string;
}

export const STORES: Record<StoreKey, StoreDef> = {
  material: {
    name: "Materiallager", building: "Lagerhaus",
    full: "Das Lager ist voll! Baue ein weiteres Lagerhaus.",
    none: "Kein Lagerhaus mehr: Getragene Waren bleiben liegen.",
  },
  nahrung: {
    name: "Kornkammer", building: "Kornkammer",
    full: "Die Kornkammer ist voll! Baue eine weitere Kornkammer.",
    none: "Keine Kornkammer: Getragene Lebensmittel bleiben liegen.",
  },
};

export const STORE_KEYS = Object.keys(STORES) as StoreKey[];

/** Gruppen der Kopfleiste, in dieser Reihenfolge. */
export type GoodGroup = "rohstoff" | "waffe" | "nahrung";
export const GOOD_GROUPS: { key: GoodGroup; label: string }[] = [
  { key: "rohstoff", label: "Rohstoffe" },
  { key: "waffe", label: "Waffen" },
  { key: "nahrung", label: "Nahrung" },
];

export type Good = "holz" | "stein" | "eisen" | "speer" | "schwert" | "bogen" | "getreide" | "mehl" | "brot";

export interface GoodDef {
  name: string;
  /** Lagertyp (STORES): Lagerhaus oder Kornkammer. */
  store: StoreKey;
  /** Gruppe in der Kopfleiste. */
  group: GoodGroup;
  /** Sprite-Schlüssel des Stapels im Lager (Gebäudeblatt, Varianten = Füllstufen 0..4); auch Ein- und Ausgang von Werkstätten. */
  stack: string;
  /** Figur, die diese Ware trägt (Figurenblatt). */
  carrier: string;
  /** Baumaterial auf der Baustelle (Gebäudeblatt, Varianten = Menge 0..4); fehlt es, liegt der Lagerstapel dort. */
  sitePile?: string;
}

export const GOODS: Record<Good, GoodDef> = {
  holz: { name: "Holz", store: "material", group: "rohstoff", stack: "stapel_holz", carrier: "traeger", sitePile: "baustoff_holz" },
  stein: { name: "Stein", store: "material", group: "rohstoff", stack: "stapel_stein", carrier: "traeger_stein", sitePile: "baustoff_stein" },
  eisen: { name: "Eisen", store: "material", group: "rohstoff", stack: "stapel_eisen", carrier: "traeger_kiste" },
  speer: { name: "Speere", store: "material", group: "waffe", stack: "stapel_speer", carrier: "traeger_speer" },
  schwert: { name: "Schwerter", store: "material", group: "waffe", stack: "stapel_schwert", carrier: "traeger_schwert" },
  bogen: { name: "Bögen", store: "material", group: "waffe", stack: "stapel_bogen", carrier: "traeger_bogen" },
  getreide: { name: "Getreide", store: "nahrung", group: "nahrung", stack: "stapel_getreide", carrier: "traeger_sack" },
  mehl: { name: "Mehl", store: "nahrung", group: "nahrung", stack: "stapel_mehl", carrier: "traeger_mehl" },
  brot: { name: "Brot", store: "nahrung", group: "nahrung", stack: "stapel_brot", carrier: "traeger_brot" },
};

export const GOOD_KEYS = Object.keys(GOODS) as Good[];

/** Lagertyp einer Ware. */
export const storeOf = (g: Good): StoreKey => GOODS[g].store;
