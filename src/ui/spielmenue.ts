/**
 * Spielmenü (ADR 0019): Esc, wenn nichts gewählt und kein Werkzeug aktiv ist (die Eingabe meldet on("menu")), oder
 * der Knopf ☰ oben rechts. Das Spiel hält an, solange das Menü offen ist, und läuft danach mit der vorigen
 * Geschwindigkeit weiter.
 *
 * - Weiterspielen
 * - Speichern: Plätze 1–3 (belegte nach Rückfrage überschreiben); Schnellspeichern mit F10 (src/data/hotkeys.ts)
 * - Laden: alle belegten Plätze (auch Automatisch und Schnellspeicher), eigene Plätze löschbar
 * - Einstellungen: Musik, Sprecher, stumm; Ziel und Schwierigkeitsgrad der Partie zur Ansicht
 * - Hauptmenü: speichert automatisch (Platz „Automatisch“) und kehrt zum Titel zurück, dort „Fortsetzen“
 *
 * Esc geht eine Ebene zurück bzw. schließt das Menü.
 */
import { APP_KEYS, bindingLabel } from "../data/hotkeys";
import { DIFFICULTIES, SCENARIOS, type SaveSlotKey } from "../data";
import { h } from "./dom";
import type { UiCtx } from "./shared";
import { slotLabel, slotList } from "./spielstaende";

type View = "haupt" | "speichern" | "laden" | "einstellungen" | "hauptmenue";

export interface GameMenu { el: HTMLElement; toggle(on?: boolean): void; isOpen(): boolean }

export function createGameMenu(ctx: UiCtx): GameMenu {
  const { bridge } = ctx;
  let view: View = "haupt";
  let resume = 1;
  const title = h("h2.mk-title", { id: "mk-menu-title" });
  const content = h("div.mk-menu-body");
  const status = h("p.mk-menu-status", { role: "status" });
  const card = h("div.mk-help-card.mk-parchment.mk-menu-card", { role: "dialog", "aria-modal": "true", "aria-labelledby": "mk-menu-title" },
    h("button.mk-x", { type: "button", "aria-label": "Menü schließen", text: "×", onclick: () => toggle(false) }),
    title, content, status);
  const el = h("div.mk-help.mk-menu", { onclick: (e: Event) => { if (e.target === el) toggle(false); } }, card);
  el.hidden = true;

  const say = (text: string, kind: "ok" | "fehler" = "ok") => {
    status.textContent = text;
    status.className = `mk-menu-status mk-menu-${kind}`;
  };
  const btn = (text: string, fn: () => void, cls = "") => h(`button.mk-btn.mk-btn-wide${cls}` as "button", { type: "button", text, onclick: fn });
  const back = () => btn("Zurück", () => show("haupt"), ".mk-menu-back");

  async function show(v: View, keepStatus = false): Promise<void> {
    view = v;
    if (!keepStatus) say("");
    content.textContent = "";
    const titles: Record<View, string> = { haupt: "Spielmenü", speichern: "Speichern", laden: "Laden", einstellungen: "Einstellungen", hauptmenue: "Zum Hauptmenü" };
    title.textContent = titles[v];
    if (v === "haupt") {
      const quick = bindingLabel(APP_KEYS.schnellspeichern);
      content.append(
        btn("Weiterspielen", () => toggle(false), ".mk-menu-first"),
        btn("Speichern", () => void show("speichern")),
        btn("Laden", () => void show("laden")),
        btn("Einstellungen", () => void show("einstellungen")),
        btn("Hauptmenü", () => void show("hauptmenue")),
        h("p.mk-menu-hint", { text: `Schnellspeichern: Taste ${quick}. Automatisch gespeichert wird alle zwei Minuten und beim Wechsel ins Hauptmenü.` }));
      if (!bridge.saves.persistent()) content.append(h("p.mk-menu-hint.mk-menu-fehler", { text: "Der Browser erlaubt keine dauerhafte Ablage: Spielstände gelten nur, solange dieser Tab offen ist." }));
    } else if (v === "speichern" || v === "laden") {
      content.append(h("p.mk-menu-hint", { text: "Spielstände werden gelesen …" }));
      const infos = await bridge.saves.list();
      if (view !== v || el.hidden) return;
      content.textContent = "";
      content.append(slotList({
        mode: v, infos, buttonClass: "mk-btn.mk-btn-wide",
        pick: (slot) => void (v === "speichern" ? save(slot) : load(slot)),
        remove: v === "laden" ? (slot) => void remove(slot) : undefined,
      }), back());
    } else if (v === "einstellungen") {
      content.append(...settings(), back());
    } else {
      const go = btn("Speichern und zum Hauptmenü", () => {
        go.disabled = true;
        say("Wird gespeichert …");
        bridge.toTitle().catch((e: Error) => {
          go.disabled = false;
          say(`Speichern fehlgeschlagen: ${e.message}`, "fehler");
          content.append(btn("Ohne Speichern zum Hauptmenü", () => location.reload()));
        });
      }, ".mk-menu-first");
      content.append(h("p", { text: "Die Partie wird auf dem Platz „Automatisch“ gespeichert. Im Titel setzt „Fortsetzen“ sie fort." }), go, back());
    }
    (content.querySelector("button") as HTMLElement | null)?.focus();
  }

  async function save(slot: SaveSlotKey): Promise<void> {
    say("Wird gespeichert …");
    try {
      await bridge.saves.save(slot);
      await show("speichern", true);
      say(`Gespeichert: ${slotLabel(slot)}.`);
    } catch (e) { say(`Speichern fehlgeschlagen: ${(e as Error).message}`, "fehler"); }
  }

  async function load(slot: SaveSlotKey): Promise<void> {
    say("Wird geladen …");
    try {
      await bridge.saves.load(slot);
      ctx.toast(`Geladen: ${slotLabel(slot)}`);
      toggle(false);
    } catch (e) { say(`Laden fehlgeschlagen: ${(e as Error).message}`, "fehler"); }
  }

  async function remove(slot: SaveSlotKey): Promise<void> {
    try {
      await bridge.saves.remove(slot);
      await show("laden", true);
      say(`${slotLabel(slot)} gelöscht.`);
    } catch (e) { say(`Löschen fehlgeschlagen: ${(e as Error).message}`, "fehler"); }
  }

  function settings(): HTMLElement[] {
    const a = bridge.audio();
    const row = (label: string, key: "music" | "voice") => {
      const val = h("span.mk-range-val.mk-num", { text: `${Math.round(a[key] * 100)} %` });
      const input = h("input.mk-range", {
        type: "range", min: "0", max: "100", step: "5", value: String(Math.round(a[key] * 100)), "aria-label": label,
        oninput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          bridge.setAudio({ [key]: v / 100 });
          val.textContent = `${v} %`;
        },
      });
      return h("label.mk-audio-row", null, h("span", { text: label }), input, val);
    };
    const mute = h("input", { type: "checkbox", onchange: (e: Event) => bridge.setAudio({ muted: (e.target as HTMLInputElement).checked }) });
    (mute as HTMLInputElement).checked = a.muted;
    const s = bridge.state();
    const sc = s.match.scenario ? SCENARIOS[s.match.scenario] : null;
    return [
      h("h3.mk-sec-title", { text: "Klang" }),
      row("Musik", "music"), row("Sprecher", "voice"),
      h("label.mk-menu-check", null, mute, "Ton aus (stumm)"),
      h("h3.mk-sec-title", { text: "Diese Partie" }),
      h("p", { text: sc ? `${sc.name}: ${sc.text}` : "Freies Spiel ohne Ziel." }),
      h("p", { text: `Schwierigkeit: ${DIFFICULTIES[s.match.difficulty].name} (${DIFFICULTIES[s.match.difficulty].text}) Wählbar beim neuen Spiel im Titel.` }),
    ];
  }

  function toggle(on = el.hidden): void {
    if (on === !el.hidden) return;
    if (on) {
      resume = bridge.speed();
      bridge.setSpeed(0);
      el.hidden = false;
      void show("haupt");
    } else {
      el.hidden = true;
      if (resume) bridge.setSpeed(resume);
    }
  }

  // Esc: eine Ebene zurück, auf der obersten schließen (vor den Wächtern von Hilfe und Forschung, die dann zu sind)
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || el.hidden) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (view === "haupt") toggle(false); else void show("haupt");
  }, true);

  bridge.on("menu", () => toggle(true));
  return { el, toggle, isOpen: () => !el.hidden };
}
