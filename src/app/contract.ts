/**
 * Schnittstelle zwischen Spielschleife/Darstellung (src/app, src/render) und der DOM-Oberfläche (src/ui).
 * src/app/main.ts erzeugt die Brücke und ruft mountUi(root, bridge) aus src/ui auf.
 */
import type { BuildingKey, Good, UnitKey } from "../data";
import type { MusicKey } from "../data/audio";
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
  icon(kind: IconKind, key: BuildingKey | UnitKey | Good | string, size: number, team?: 0 | 1): HTMLCanvasElement | null;
  /**
   * Kamera für die Übersichtskarte: Bildmitte in Welt-Tiles (x, y) und die vier Ecken des sichtbaren Bereichs
   * in Welt-Tiles (Boden, z = 0), im Uhrzeigersinn ab oben links am Bildschirm.
   */
  camera(): { x: number; y: number; corners: [number, number][] };
  /** Kamera auf einen Welt-Punkt (Tiles) setzen, z. B. Klick in die Übersichtskarte. */
  lookAt(x: number, y: number): void;
  /**
   * Lautstärken 0..1 und Stummschaltung (Musik, Sprecher). Wird im Browser gespeichert.
   * track (optional): gerade laufendes Musikstück (Schlüssel aus MUSIC), null in der Pause zwischen zwei Stücken;
   * fehlt das Feld, zeigt die Oberfläche kein Stück an. Wechsel des Stücks meldet die App über on("audio").
   */
  audio(): { music: number; voice: number; muted: boolean; track?: MusicKey | null };
  setAudio(a: Partial<{ music: number; voice: number; muted: boolean }>): void;
  /** Meldung oder Wechsel (Auswahl, Werkzeug, Tick) abonnieren. Gibt eine Abmeldefunktion zurück. */
  on(ev: "tick" | "selection" | "tool" | "view" | "assets" | "audio", fn: () => void): () => void;
  /** Kurzer Hinweis am Mauszeiger oder in der Meldungsleiste (z. B. Grund, warum nicht gebaut werden kann). */
  notify(text: string, kind?: "info" | "warnung"): void;
  /**
   * Optional: Hinweise aus notify abonnieren (die Oberfläche zeigt sie am Mauszeiger). Bietet die Brücke das nicht an,
   * leitet die Oberfläche bridge.notify beim Einhängen selbst auf ihre Anzeige um (Originalfunktion wird weiter aufgerufen).
   */
  onNotify(fn: (text: string, kind?: "info" | "warnung") => void): () => void;
}

/** Wird von src/ui exportiert. */
export type MountUi = (root: HTMLElement, bridge: UiBridge) => void;
