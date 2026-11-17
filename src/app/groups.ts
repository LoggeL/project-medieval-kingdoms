/**
 * Kontrollgruppen (Briefing §7, ADR 0018): Strg + Ziffer speichert die eigenen ausgewählten Einheiten als Gruppe,
 * die Ziffer wählt die Gruppe wieder (Tote fallen heraus), zweimal schnell hintereinander fährt die Kamera zur Gruppe,
 * Umschalt + Ziffer nimmt die Gruppe zur Auswahl hinzu. Ziffern aus APP_KEYS.gruppen (src/data/hotkeys.ts).
 *
 * Ohne DOM testbar: installControlGroups hängt sich an ein beliebiges EventTarget (im Spiel window, im Test eine
 * Attrappe) und spricht nur über GroupHost mit Auswahl, Kamera und Meldungen.
 */
import { APP_KEYS } from "../data/hotkeys";

/** Zweiter Druck derselben Ziffer innerhalb dieser Zeit: Kamera zur Gruppe. */
export const GROUP_DOUBLE_MS = 400;

export interface GroupHost {
  /** Gespeicherte Gruppen (Ziffer → Einheiten-IDs), z. B. AppStore.groups. */
  groups: Map<number, number[]>;
  /** Ausgewählte eigene, lebende Einheiten. */
  selected(): number[];
  /** Von diesen IDs die noch lebenden eigenen Einheiten. */
  alive(ids: number[]): number[];
  /** Auswahl setzen (add: zur bisherigen Auswahl hinzunehmen). */
  select(ids: number[], add: boolean): void;
  /** Kamera auf einen Welt-Punkt (Tiles). */
  lookAt(x: number, y: number): void;
  /** Mittelpunkt der Einheiten in Welt-Tiles, null ohne lebende. */
  center(ids: number[]): [number, number] | null;
  notify(text: string, kind?: "info" | "warnung"): void;
  /** Uhr in Millisekunden (performance.now). */
  now(): number;
}

/** Was eine Taste tun soll; null = keine Gruppentaste. */
export type GroupKey = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "repeat">;

const DIGITS = APP_KEYS.gruppen as readonly string[];

/** Ziffer einer Gruppentaste (Digit0 … Digit9) oder null. */
export function groupDigit(code: string): number | null {
  const i = DIGITS.indexOf(code);
  return i < 0 ? null : Number(code.slice(-1));
}

export class ControlGroups {
  private last = { n: -1, t: -Infinity };

  constructor(private host: GroupHost) {}

  /** Taste auswerten. true = es war eine Gruppentaste (verarbeitet oder bewusst ignoriert). */
  key(e: GroupKey): boolean {
    const n = groupDigit(e.code);
    if (n === null || e.altKey) return false;
    const h = this.host;
    // Cmd + Ziffer wechselt am Mac den Browser-Reiter: bleibt beim Browser, nur Strg speichert
    if (e.metaKey && !e.ctrlKey) return false;
    if (e.ctrlKey) {
      if (e.repeat) return true;
      const ids = h.selected();
      if (!ids.length) {
        h.groups.delete(n);
        h.notify(`Gruppe ${n} geleert`);
      } else {
        h.groups.set(n, [...ids]);
        h.notify(`Gruppe ${n} gespeichert (${ids.length})`);
      }
      this.last = { n: -1, t: -Infinity };
      return true;
    }
    if (e.repeat) return true;
    const ids = h.alive(h.groups.get(n) ?? []);
    if (!ids.length) {
      if (h.groups.has(n)) h.groups.delete(n);
      h.notify(`Gruppe ${n} ist leer – Strg + ${n} speichert die Auswahl`, "warnung");
      return true;
    }
    h.groups.set(n, ids);
    const now = h.now();
    const again = this.last.n === n && now - this.last.t <= GROUP_DOUBLE_MS;
    h.select(ids, e.shiftKey);
    if (again) {
      const c = h.center(ids);
      if (c) h.lookAt(c[0], c[1]);
      this.last = { n: -1, t: -Infinity };
    } else this.last = { n, t: now };
    return true;
  }
}

/**
 * Gruppentasten an target (window) hängen. blocked: Tasten aussetzen (Texteingabe, offene Tafel). Gibt eine
 * Abmeldefunktion zurück.
 */
export function installControlGroups(target: EventTarget, host: GroupHost, blocked: (e: KeyboardEvent) => boolean): { groups: ControlGroups; dispose: () => void } {
  const groups = new ControlGroups(host);
  const fn = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (blocked(e)) return;
    if (groups.key(e)) e.preventDefault?.();
  };
  target.addEventListener("keydown", fn);
  return { groups, dispose: () => target.removeEventListener("keydown", fn) };
}
