/**
 * Ende der Partie (ADR 0019): Sieg (alle Ziele des Szenarios erreicht) oder Niederlage (Bergfried gefallen). Das Spiel
 * hält an, eine Tafel nennt den Ausgang und die Statistik (Spielzeit, Wellen, Verluste, erzeugte Waren).
 * „Weiterbauen“ bzw. „Weiter zusehen“ schließt die Tafel (weiter geht es mit der Leertaste), „Hauptmenü“ speichert
 * automatisch und kehrt zum Titel zurück.
 *
 * Die Tafel erscheint nur, wenn die Partie in dieser Sitzung entschieden wird: Wer einen Stand nach Sieg oder
 * Niederlage lädt, bekommt sie nicht noch einmal (match.endTick ändert sich dann nicht).
 */
import { GOODS, GOOD_KEYS, SCENARIOS, TICKS_PER_SECOND } from "../data";
import type { MatchStats, SimState } from "../sim/types";
import { clock, h, num } from "./dom";
import type { UiCtx } from "./shared";

export interface Ende { el: HTMLElement; update(s: SimState): void; /** Nach dem Laden: Ausgang der geladenen Partie gilt als gesehen. */ loaded(s: SimState): void }

/** Zeilen der Statistik (Bezeichnung, Wert) für die Tafel. */
export function statRows(s: SimState): [string, string][] {
  const st: MatchStats = s.match.stats;
  const end = s.match.endTick ?? s.tick;
  const rows: [string, string][] = [
    ["Spielzeit", clock(end / TICKS_PER_SECOND)],
    ["Überfälle abgewehrt", num(st.waves)],
    ["Angreifer besiegt", num(st.kills)],
    ["Gefallene Soldaten", num(st.lostSoldiers)],
    ["Gefallene Arbeiter", num(st.lostWorkers)],
    ["Zerstörte Gebäude", num(st.lostBuildings)],
    ["Gebäude errichtet", num(st.built)],
    ["Soldaten ausgebildet", num(st.trained)],
  ];
  return rows;
}

/** Erzeugte Waren in der Reihenfolge der Daten (nur, was es gab). */
export function producedRows(s: SimState): [string, number][] {
  const p = s.match.stats.produced;
  return GOOD_KEYS.filter((g) => (p[g] ?? 0) > 0).map((g) => [GOODS[g].name, p[g]!]);
}

export function createEnde(ctx: UiCtx): Ende {
  let seen: number | null = null;
  const title = h("h2.mk-title", { id: "mk-ende-titel" });
  const text = h("p.mk-ende-text");
  const stats = h("dl.mk-ende-stats");
  const goods = h("div.mk-ende-waren");
  const weiter = h("button.mk-btn.mk-btn-wide", { type: "button", onclick: () => { el.hidden = true; } });
  const menue = h("button.mk-btn.mk-btn-wide", {
    type: "button", text: "Hauptmenü",
    onclick: () => { menue.disabled = true; ctx.bridge.toTitle().catch((e: Error) => { menue.disabled = false; ctx.toast(e.message, "warnung"); }); },
  });
  const card = h("div.mk-help-card.mk-ende-card.mk-parchment", { role: "alertdialog", "aria-modal": "true", "aria-labelledby": "mk-ende-titel" },
    title, text, stats, goods, h("div.mk-ende-knoepfe", null, weiter, menue));
  const el = h("div.mk-help.mk-ende", null, card);
  el.hidden = true;

  const show = (s: SimState) => {
    const win = s.outcome === "sieg";
    const sc = s.match.scenario ? SCENARIOS[s.match.scenario] : null;
    card.classList.toggle("mk-sieg", win);
    card.classList.toggle("mk-niederlage", !win);
    title.textContent = win ? "Das Tal ist sicher" : "Die Burg ist gefallen";
    text.textContent = win
      ? `${sc ? `${sc.name}: ` : ""}Alle Ziele erreicht. Die Angreifer kommen nicht wieder; du kannst weiterbauen.`
      : "Der Bergfried, Sitz des Burgherrn, liegt in Trümmern. Diese Partie ist verloren.";
    stats.textContent = "";
    for (const [k, v] of statRows(s)) stats.append(h("dt", { text: k }), h("dd.mk-num", { text: v }));
    goods.textContent = "";
    const rows = producedRows(s);
    goods.append(h("h3", { text: "Erzeugte Waren" }));
    if (!rows.length) goods.append(h("p", { text: "Keine." }));
    else goods.append(h("ul", null, ...rows.map(([n, v]) => h("li", null, h("span", { text: n }), h("span.mk-num", { text: num(v) })))));
    weiter.textContent = win ? "Weiterbauen" : "Weiter zusehen";
    menue.disabled = false;
    ctx.bridge.setSpeed(0);
    el.hidden = false;
    weiter.focus();
  };

  return {
    el,
    update(s) {
      if (!s.outcome || s.match.endTick === seen) return;
      seen = s.match.endTick;
      show(s);
    },
    loaded(s) {
      seen = s.outcome ? s.match.endTick : null;
      el.hidden = true;
    },
  };
}
