/**
 * Schnittstelle zwischen Spielschleife/Darstellung (src/app, src/render) und der DOM-Oberfläche (src/ui).
 * src/app/main.ts erzeugt die Brücke und ruft mountUi(root, bridge) aus src/ui auf.
 */
import type { BuildingKey, Good, UnitKey } from "../data";
import type { Command, CommandResult, SimState } from "../sim/types";

/** Werkzeug der Maus. */
export type Tool =
  | { t: "auswahl" }
  | { t: "bauen"; key: BuildingKey; o: number }
  | { t: "mauer" }
  | { t: "abriss" };

export interface Selection { units: number[]; building: number | null }

export type IconKind = "gebaeude" | "einheit" | "ware";

export interface UiBridge {
  /** Aktueller Simulationszustand (nur lesen). */
  state(): SimState;
  dispatch(cmd: Command): CommandResult;
  selection(): Selection;
  select(sel: Selection): void;
  tool(): Tool;
  setTool(t: Tool): void;
  /** Kameradrehung r (0..3) und Zoomstufe. */
  view(): { r: number; zoom: number };
  rotate(dir: 1 | -1): void;
  zoom(dir: 1 | -1): void;
  /** Geschwindigkeit 0 (Pause), 1, 2. */
  speed(): number;
  setSpeed(v: number): void;
  /**
   * Kleines Pixel-Icon aus den echten Sprites (Gebäude-Ansicht, Figur, Warenstapel), als Canvas.
   * Liefert null, solange die Sprites noch laden.
   */
  icon(kind: IconKind, key: BuildingKey | UnitKey | Good | string, size: number): HTMLCanvasElement | null;
  /** Meldung oder Wechsel (Auswahl, Werkzeug, Tick) abonnieren. Gibt eine Abmeldefunktion zurück. */
  on(ev: "tick" | "selection" | "tool" | "view" | "assets", fn: () => void): () => void;
  /** Kurzer Hinweis am Mauszeiger oder in der Meldungsleiste (z. B. Grund, warum nicht gebaut werden kann). */
  notify(text: string, kind?: "info" | "warnung"): void;
}

/** Wird von src/ui exportiert. */
export type MountUi = (root: HTMLElement, bridge: UiBridge) => void;
