/**
 * Tastenkürzel der Knöpfe (Fußleiste und Auswahlpanel). Belegung: src/data/hotkeys.ts.
 *
 * Ein Knopf bekommt mit setKey(knopf, codes) eine Taste: Attribut data-hotkey, ein kleines Tastenschild (kbd.mk-key)
 * unten rechts, den Tastennamen im Tooltip und aria-keyshortcuts. Drückt man die Taste, leuchtet der Knopf kurz auf
 * und wird ausgelöst wie bei einem Klick. Gesperrte Knöpfe (.mk-locked oder disabled) lösen nur ihre Sperr-Meldung aus
 * (data-locked). Knöpfe mit app: true (Auswahl/Esc, Stationieren/T, Halten/H) leuchten nur auf: Diese Tasten wertet
 * die Eingabe (src/app/input.ts) selbst aus.
 *
 * Gesucht wird in Dokumentreihenfolge unter den sichtbaren Knöpfen; das Auswahlpanel steht vor der Fußleiste, darum
 * reißt Entf bei gewähltem Gebäude dieses ab (Panel) und schaltet sonst das Abriss-Werkzeug (Fußleiste).
 * Keine Taste wirkt, solange ein Eingabefeld den Fokus hat, eine Tafel (aria-modal) offen ist, Lade- oder Titelbildschirm
 * noch stehen (.mk-start) oder Strg/Alt/Cmd gedrückt sind.
 */
import { keyLabel, type LayoutMap } from "../data/hotkeys";
import { h } from "./dom";

let layout: LayoutMap | null = null;
const FLASH_MS = 260;
const timers = new WeakMap<HTMLElement, number>();

/** Tastendruck gehört einem Texteingabefeld? (Regler, Häkchen und Knöpfe zählen nicht.) */
export function typing(e: KeyboardEvent): boolean {
  const tg = e.target as HTMLElement | null;
  if (!tg || !tg.tagName) return false;
  if (tg.tagName === "INPUT") return !["range", "checkbox", "radio", "button", "submit", "reset", "color"].includes((tg as HTMLInputElement).type);
  return tg.tagName === "TEXTAREA" || tg.tagName === "SELECT" || tg.isContentEditable;
}

/** Ist eine Tafel offen, die alle Spieltasten sperrt (Hilfe, Lade- oder Titelbildschirm)? */
export function modalOpen(): boolean {
  if (typeof document === "undefined") return false;
  if (document.querySelector(".mk-start")) return true;
  for (const m of document.querySelectorAll<HTMLElement>('[aria-modal="true"]')) if (m.isConnected && !m.closest("[hidden]")) return true;
  return false;
}

/** Spieltasten aussetzen: Texteingabe hat den Fokus oder eine Tafel ist offen. */
export function keyBlocked(e: KeyboardEvent): boolean {
  return typing(e) || modalOpen();
}

/** Aufschrift nach dem erkannten Tastaturlayout (sonst QWERTZ). */
export function label(code: string): string {
  return keyLabel(code, layout);
}

/**
 * Taste eines Knopfs setzen (codes: erste Taste steht auf dem Schild) oder mit null entfernen.
 * app: Die Eingabe wertet die Taste selbst aus, der Knopf leuchtet nur auf.
 */
export function setKey(btn: HTMLElement, codes: readonly string[] | null, opts: { app?: boolean } = {}): void {
  let badge = btn.querySelector<HTMLElement>(":scope > kbd.mk-key");
  if (btn.dataset.baseTitle === undefined) btn.dataset.baseTitle = btn.getAttribute("title") ?? "";
  const base = btn.dataset.baseTitle;
  if (!codes?.length) {
    badge?.remove();
    delete btn.dataset.hotkey;
    delete btn.dataset.hotkeyApp;
    btn.removeAttribute("aria-keyshortcuts");
    if (base) btn.setAttribute("title", base); else btn.removeAttribute("title");
    return;
  }
  const text = label(codes[0]);
  if (!badge) { badge = h("kbd.mk-key", { "aria-hidden": "true" }); btn.append(badge); }
  badge.dataset.code = codes[0];
  if (badge.textContent !== text) badge.textContent = text;
  btn.dataset.hotkey = codes.join(" ");
  if (opts.app) btn.dataset.hotkeyApp = ""; else delete btn.dataset.hotkeyApp;
  btn.setAttribute("aria-keyshortcuts", codes.map(ariaKey).join(" "));
  btn.setAttribute("title", `${base ? base + "\n" : ""}Taste: ${text}`);
}

/** Knopf kurz aufleuchten lassen (auch bei reduzierter Bewegung: ohne Animation, nur Farbe). */
export function flash(btn: HTMLElement): void {
  btn.classList.remove("mk-key-hit");
  void btn.offsetWidth;
  btn.classList.add("mk-key-hit");
  const old = timers.get(btn);
  if (old) clearTimeout(old);
  timers.set(btn, window.setTimeout(() => btn.classList.remove("mk-key-hit"), FLASH_MS));
}

/** Tastaturbelegung des Browsers abfragen (Chrome, Edge) und die Schilder danach beschriften. */
function loadLayout(root: HTMLElement): void {
  const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<LayoutMap> } }).keyboard;
  kb?.getLayoutMap?.().then((m) => {
    layout = m;
    for (const b of root.querySelectorAll<HTMLElement>("[data-hotkey]")) {
      const codes = b.dataset.hotkey!.split(" ");
      setKey(b, codes, { app: b.dataset.hotkeyApp !== undefined });
    }
  }).catch(() => undefined);
}

/** Tastendruck auf die Knöpfe unter root verteilen. toast: Sperr-Meldung gesperrter Knöpfe. */
export function installHotkeys(root: HTMLElement, toast: (text: string, kind?: "info" | "warnung") => void): void {
  loadLayout(root);
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || keyBlocked(e)) return;
    if (!/^[A-Za-z0-9]+$/.test(e.code)) return;
    const btn = [...root.querySelectorAll<HTMLElement>(`[data-hotkey~="${e.code}"]`)].find(usable);
    if (!btn) return;
    flash(btn);
    if (btn.dataset.hotkeyApp !== undefined) return;
    e.preventDefault();
    if (e.repeat) return;
    if (btn.matches(".mk-locked, [disabled]")) {
      toast(btn.dataset.locked || "Noch gesperrt.", "warnung");
      return;
    }
    btn.click();
  });
}

function usable(el: HTMLElement): boolean {
  return el.isConnected && !el.closest("[hidden]");
}

/** Taste für aria-keyshortcuts: Buchstaben als Zeichen, sonst der Tastenname (F2, Escape, Delete). */
function ariaKey(code: string): string {
  return /^Key.$/.test(code) ? label(code) : code;
}
