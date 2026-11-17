/**
 * Meldungsverlauf (ADR 0019): alle Meldungen der Partie, neueste oben, mit Spielzeit und Art (Kampf, Warnung, Info),
 * filterbar. Die Simulation hält nur die letzten 40 Meldungen im Zustand; die Oberfläche sammelt darüber hinaus bis zu
 * HISTORY_MAX (nur Anzeige, nicht im Spielstand). Nach dem Laden beginnt der Verlauf mit den Meldungen des Spielstands.
 * Öffnen: Knopf „Verlauf“ in der Aufgabenleiste. Esc oder × schließt.
 */
import { TICKS_PER_SECOND } from "../data";
import type { Message, SimState } from "../sim/types";
import { clock, h } from "./dom";

export const HISTORY_MAX = 300;

type Filter = "alle" | "kampf" | "warnung" | "info";
const FILTERS: [Filter, string][] = [["alle", "Alle"], ["kampf", "Kampf"], ["warnung", "Warnungen"], ["info", "Hinweise"]];

/** Sammelt Meldungen über die 40 des Zustands hinaus (Schlüssel: Tick und Text). */
export class MessageLog {
  readonly items: Message[] = [];
  private keys = new Set<string>();
  private lastLen = -1;
  private lastTick = -1;

  /** Neue Meldungen übernehmen; gibt true zurück, wenn etwas dazukam. */
  take(s: SimState): boolean {
    const last = s.messages[s.messages.length - 1];
    if (s.messages.length === this.lastLen && (last?.tick ?? -1) === this.lastTick) return false;
    this.lastLen = s.messages.length; this.lastTick = last?.tick ?? -1;
    let added = false;
    for (const m of s.messages) {
      const k = `${m.tick}|${m.kind}|${m.text}`;
      if (this.keys.has(k)) continue;
      this.keys.add(k);
      this.items.push({ tick: m.tick, text: m.text, kind: m.kind });
      added = true;
    }
    if (this.items.length > HISTORY_MAX) {
      for (const m of this.items.splice(0, this.items.length - HISTORY_MAX)) this.keys.delete(`${m.tick}|${m.kind}|${m.text}`);
    }
    return added;
  }

  /** Andere Partie: von vorn. */
  reset(): void { this.items.length = 0; this.keys.clear(); this.lastLen = -1; this.lastTick = -1; }
}

export interface History { el: HTMLElement; update(s: SimState): void; toggle(on?: boolean): void; loaded(s: SimState): void }

export function createHistory(): History {
  const log = new MessageLog();
  let filter: Filter = "alle";
  const list = h("ol.mk-hist-list");
  const bar = h("div.mk-hist-filter", { role: "group", "aria-label": "Meldungen filtern" });
  const close = () => toggle(false);
  const card = h("div.mk-help-card.mk-parchment.mk-hist-card", { role: "dialog", "aria-modal": "true", "aria-labelledby": "mk-hist-title" },
    h("button.mk-x", { type: "button", "aria-label": "Verlauf schließen", text: "×", onclick: close }),
    h("h2.mk-title", { id: "mk-hist-title", text: "Meldungen" }), bar, list);
  const el = h("div.mk-help.mk-hist", { onclick: (e: Event) => { if (e.target === el) close(); } }, card);
  el.hidden = true;
  let last: Element | null = null;

  const renderBar = () => {
    bar.textContent = "";
    for (const [k, label] of FILTERS) {
      bar.append(h(`button.mk-btn${filter === k ? ".mk-on" : ""}` as "button", { type: "button", text: label, "aria-pressed": String(filter === k), onclick: () => { filter = k; renderBar(); renderList(); } }));
    }
  };
  const renderList = () => {
    list.textContent = "";
    const items = log.items.filter((m) => filter === "alle" || m.kind === filter);
    if (!items.length) { list.append(h("li.mk-hist-leer", { text: "Keine Meldungen." })); return; }
    for (let i = items.length - 1; i >= 0; i--) {
      const m = items[i];
      list.append(h(`li.mk-hist-item.mk-msg-${m.kind}` as "li", null,
        h("span.mk-chron-time", { text: clock(m.tick / TICKS_PER_SECOND) }), h("span.mk-hist-text", { text: m.text })));
    }
  };

  function toggle(on = el.hidden): void {
    if (on === !el.hidden) return;
    el.hidden = !on;
    if (on) { renderBar(); renderList(); last = document.activeElement; (card.querySelector(".mk-x") as HTMLElement).focus(); }
    else if (last instanceof HTMLElement) last.focus();
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.hidden) { e.preventDefault(); e.stopImmediatePropagation(); toggle(false); }
  }, true);

  return {
    el,
    toggle,
    update(s) { if (log.take(s) && !el.hidden) renderList(); },
    loaded(s) { log.reset(); log.take(s); if (!el.hidden) renderList(); },
  };
}
