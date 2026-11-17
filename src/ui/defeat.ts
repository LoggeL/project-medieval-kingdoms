/**
 * Niederlage: Fällt der Bergfried (SimState.outcome = "niederlage"), hält das Spiel an und eine Tafel meldet es.
 * „Weiter zusehen“ schließt die Tafel (die Simulation läuft weiter, wenn man die Pause aufhebt),
 * „Neues Spiel“ lädt die Seite neu und führt zurück zum Titel.
 */
import type { SimState } from "../sim/types";
import { h } from "./dom";
import type { UiCtx } from "./shared";

export interface Defeat { el: HTMLElement; update(s: SimState): void }

export function createDefeat(ctx: UiCtx): Defeat {
  let shown = false;
  const close = () => { el.hidden = true; };
  const card = h("div.mk-help-card.mk-defeat-card.mk-parchment", { role: "alertdialog", "aria-modal": "true", "aria-labelledby": "mk-defeat-title" },
    h("h2.mk-title", { id: "mk-defeat-title", text: "Die Burg ist gefallen" }),
    h("p", { text: "Der Bergfried, Sitz des Burgherrn, liegt in Trümmern. Diese Partie ist verloren." }),
    h("button.mk-btn.mk-btn-wide", { type: "button", text: "Neues Spiel", onclick: () => location.reload() }),
    h("button.mk-btn.mk-btn-wide", { type: "button", text: "Weiter zusehen", onclick: close }));
  const el = h("div.mk-help.mk-defeat", null, card);
  el.hidden = true;
  return {
    el,
    update(s) {
      if (shown || s.outcome !== "niederlage") return;
      shown = true;
      ctx.bridge.setSpeed(0);
      el.hidden = false;
      (card.querySelector("button") as HTMLElement).focus();
    },
  };
}
