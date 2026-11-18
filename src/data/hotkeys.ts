/**
 * Tastenbelegung (KeyboardEvent.code, also die physische Taste, unabhängig vom Tastaturlayout).
 *
 * Zwei Gruppen:
 * - APP_KEYS: Tasten, die die Eingabe (src/app/input.ts) selbst auswertet: Kamera, Drehen, Zoom, Pause, Gruppen,
 *   Bauen drehen, Stationieren, Halten, Abbrechen (ohne Auswahl und Werkzeug: Spielmenü), Hilfe, Debug, Schnellspeichern (F10; F8 gehört dem Reiter Wege).
 * - Tasten der Knöpfe unten und im Auswahlpanel (src/ui/hotkeys.ts): Bau-Reiter, Baukarten im offenen Reiter
 *   (nach Lage auf einer festen Tastenreihe), Werkzeuge, Ausbilden in der Kaserne, Abreißen, Forschung, Ausbau des
 *   Bergfrieds.
 *
 * Schema: Reiter auf F2–F8 (F6 Nahrung, F7 Handwerk, F8 Wege), Baukarten auf der unteren Buchstabenreihe (deutsch Y X C V B N M, englisch Z X C V B N M),
 * Ausbilden auf U I O Ü Ä # (seit ADR 0018; J K L gehören den Befehlen der Soldaten), Abriss auf Entf (am Mac auch die Löschtaste ⌫), Forschungsbaum auf F (Knopf „Forschung“ in der
 * Fußleiste und im Bergfried-Panel; der Forschungsbaum wertet F selbst aus, damit F ihn auch wieder schließt), Ausbau
 * des gewählten Bergfrieds auf G. Stationieren (T), Halten (H) und Auswahl (Esc) behalten ihre Tasten und zeigen sie
 * jetzt auch auf dem Knopf. Befehle der Soldaten (ADR 0018): Patrouille J, Angriffsmarsch K, Formation L, Haltung Ö,
 * Rückzug Z (deutsche Aufschrift; Code KeyY). tests/data/hotkeys.test.ts und tests/data/befehle-tasten.test.ts prüfen,
 * dass keine Taste doppelt belegt ist.
 */
import type { BuildingDef } from "./index";

type Cat = BuildingDef["category"];

/** Tasten der Eingabe (src/app/input.ts). */
export const APP_KEYS = {
  kameraLinks: ["KeyA", "ArrowLeft"],
  kameraRechts: ["KeyD", "ArrowRight"],
  kameraHoch: ["KeyW", "ArrowUp"],
  kameraRunter: ["KeyS", "ArrowDown"],
  drehenLinks: ["KeyQ"],
  drehenRechts: ["KeyE"],
  /** Auf deutscher Tastatur liegt „+“ auf BracketRight, „−“ auf Slash. */
  zoomRein: ["Equal", "NumpadAdd", "BracketRight"],
  zoomRaus: ["Minus", "NumpadSubtract", "Slash"],
  bauDrehen: ["KeyR"],
  stationieren: ["KeyT"],
  halten: ["KeyH"],
  pause: ["Space", "KeyP", "Pause"],
  abbrechen: ["Escape"],
  hilfe: ["F1"],
  debug: ["F9"],
  /** Schnellspeichern auf den Platz „Schnellspeicher“ (ADR 0019); Laden über das Spielmenü (Esc). */
  schnellspeichern: ["F10"],
  /** Ziffern: Gruppe wählen, mit Strg speichern. */
  gruppen: ["Digit0", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"],
} as const satisfies Record<string, readonly string[]>;

export type AppAction = keyof typeof APP_KEYS;

/** Bau-Reiter der Fußleiste. null: Kategorie ohne Reiter (der Bergfried steht von Beginn an und wird nicht gebaut). */
export const TAB_KEYS: Record<Cat, string | null> = {
  zentrum: null,
  wirtschaft: "F2",
  wohnen: "F3",
  befestigung: "F4",
  militaer: "F5",
  nahrung: "F6",
  handwerk: "F7",
  wege: "F8",
};

/** Baukarten im offenen Reiter, in ihrer Reihenfolge (danach im Reiter Militär die ausbildbaren Einheiten). */
export const CARD_KEYS = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM"] as const;

/**
 * Ausbilden im Auswahlpanel einer Kaserne, in der Reihenfolge von BuildingDef.trains: U I O auf der oberen Reihe, dann
 * Ü Ä # am rechten Rand (deutsche Tastatur). J K L waren es bis zur Zusammenführung mit ADR 0018; sie gehören jetzt der
 * Befehlsleiste der Soldaten, die im Kampf häufiger gebraucht wird als die Ausbildungsknöpfe (die Einheiten haben im
 * Reiter Militär zusätzlich ihre Baukarten-Tasten).
 */
export const TRAIN_KEYS = ["KeyU", "KeyI", "KeyO", "BracketLeft", "Quote", "Backslash"] as const;

/** Werkzeuge und Befehle der Knöpfe. Auswahl, Stationieren und Halten sind dieselben Tasten wie in APP_KEYS. */
export const BUTTON_KEYS = {
  /** Auswahl-Werkzeug: Esc bricht das Bauen ab (wertet die Eingabe aus). */
  auswahl: APP_KEYS.abbrechen,
  /** Abriss-Werkzeug; ist ein eigenes Gebäude gewählt, reißt dieselbe Taste dieses ab (zweimal drücken). */
  abriss: ["Delete", "Backspace"],
  /** Forschungsbaum öffnen und schließen (wertet src/ui/research.ts aus, die Knöpfe leuchten nur auf). */
  forschung: ["KeyF"],
  /** Gewählten Bergfried zur nächsten Stufe ausbauen. */
  ausbauen: ["KeyG"],
  stationieren: APP_KEYS.stationieren,
  halten: APP_KEYS.halten,
  /**
   * Befehlsleiste der gewählten Soldaten (ADR 0018), nur solange das Auswahlpanel sie zeigt. A wäre üblich, ist aber
   * Kamera (WASD); darum die Reihe J K L Ö rechts daneben und Z (QWERTZ, „zurück“) für den Rückzug.
   * Angriffsmarsch und Patrouille warten danach auf Klicks in die Welt; L und Ö schalten Formation bzw. Haltung weiter.
   */
  patrouille: ["KeyJ"],
  angriffsbewegung: ["KeyK"],
  formation: ["KeyL"],
  haltung: ["Semicolon"],
  rueckzug: ["KeyY"],
} as const satisfies Record<string, readonly string[]>;

/** Tastenschild: Tastaturlayout als Zuordnung code → Zeichen (navigator.keyboard.getLayoutMap), wenn bekannt. */
export type LayoutMap = { get(code: string): string | undefined };

/** Deutsches Layout (QWERTZ): Abweichungen zu den Aufschriften nach code. Gilt, solange der Browser nichts anderes meldet. */
const QWERTZ: Record<string, string> = { KeyZ: "Y", KeyY: "Z", BracketRight: "+", Slash: "−", Minus: "ß", Equal: "´", Semicolon: "Ö", Quote: "Ä", BracketLeft: "Ü", Backslash: "#" };

const NAMES: Record<string, string> = {
  Escape: "Esc", Delete: "Entf", Backspace: "⌫", Space: "Leertaste", Pause: "Pause",
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", NumpadAdd: "+", NumpadSubtract: "−",
};

/** Aufschrift einer Taste für die Oberfläche. Ohne Layout gilt QWERTZ (das Spiel ist deutsch). */
export function keyLabel(code: string, layout?: LayoutMap | null): string {
  if (NAMES[code]) return NAMES[code];
  if (/^F\d{1,2}$/.test(code)) return code;
  const fromLayout = layout?.get(code);
  if (fromLayout && fromLayout.trim()) return fromLayout.length === 1 ? fromLayout.toUpperCase() : fromLayout;
  if (QWERTZ[code]) return QWERTZ[code];
  const m = /^(?:Key|Digit)(.)$/.exec(code);
  return m ? m[1] : code;
}

/** Aufschrift einer Belegung mit mehreren Tasten: die erste zählt (Entf statt Entf/⌫). */
export function bindingLabel(codes: readonly string[], layout?: LayoutMap | null): string {
  return codes.length ? keyLabel(codes[0], layout) : "";
}
