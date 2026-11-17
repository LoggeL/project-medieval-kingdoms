/**
 * Aufgabenleiste (ADR 0019) oben links unter der Kopfleiste: das Ziel der Partie mit Fortschritt (Daten:
 * SCENARIOS, Fortschritt: scenarioGoals aus src/sim/match.ts) und der aktuelle Schritt der Einführung
 * (state.match.tutorial, Text aus TUTORIAL). Beides bleibt stehen, statt in den Meldungen unterzugehen.
 * Einklappbar (dann nur eine Zeile); der Knopf „Verlauf“ öffnet den Meldungsverlauf.
 */
import { SCENARIOS, TUTORIAL } from "../data";
import { scenarioGoals } from "../sim/match";
import type { SimState } from "../sim/types";
import { h, setAttr, setClass, setText } from "./dom";

export interface TaskBar { el: HTMLElement; update(s: SimState): void }

export function createTaskBar(openHistory: () => void): TaskBar {
  let open = true;
  const name = h("span.mk-task-name");
  const sum = h("span.mk-task-sum.mk-num");
  const toggle = h("button.mk-task-btn", { type: "button", "aria-expanded": "true", onclick: () => { open = !open; render(); } });
  const hist = h("button.mk-task-btn.mk-task-hist", { type: "button", text: "Verlauf", title: "Alle Meldungen dieser Partie", onclick: openHistory });
  const head = h("div.mk-task-head", null, h("span.mk-task-kicker", { text: "Ziel" }), name, sum, hist, toggle);
  const goals = h("ul.mk-task-goals");
  const stepLabel = h("span.mk-task-kicker");
  const stepText = h("p.mk-task-step");
  const step = h("div.mk-task-tut", null, stepLabel, stepText);
  const body = h("div.mk-task-body", null, goals, step);
  const el = h("section.mk-tasks.mk-parchment", { "aria-label": "Aufgaben" }, head, body);
  let sig = "";
  let last: SimState | null = null;

  function render(): void {
    setAttr(toggle, "aria-expanded", String(open));
    setText(toggle, open ? "–" : "+");
    setAttr(toggle, "title", open ? "Aufgaben einklappen" : "Aufgaben ausklappen");
    body.hidden = !open;
    if (last) { sig = ""; update(last); }
  }

  function update(s: SimState): void {
    last = s;
    const sc = s.match.scenario ? SCENARIOS[s.match.scenario] : null;
    const gp = scenarioGoals(s);
    const tut = s.match.tutorial;
    const next = `${open}|${sc?.name}|${s.outcome}|${gp.map((g) => `${g.have}/${g.need}`).join(",")}|${tut}`;
    if (next === sig) return;
    sig = next;
    el.hidden = !sc && tut === null;
    setText(name, sc ? sc.name : "Freies Spiel");
    const first = gp[0];
    setText(sum, s.outcome === "sieg" ? "gewonnen" : s.outcome === "niederlage" ? "verloren" : first ? `${first.have}/${first.need}` : "");
    setClass(el, "mk-task-won", s.outcome === "sieg");
    setClass(el, "mk-task-lost", s.outcome === "niederlage");
    goals.textContent = "";
    if (sc) goals.append(h("li.mk-task-auftrag", { text: sc.text }));
    for (const g of gp) {
      const pips = h("span.mk-task-pips", { "aria-hidden": "true" });
      for (let i = 0; i < g.need && g.need <= 12; i++) pips.append(h(`span.mk-task-pip${i < g.have ? ".mk-on" : ""}` as "span"));
      goals.append(h(`li.mk-task-goal${g.done ? ".mk-done" : ""}` as "li", null,
        h("span", { text: g.label }), pips, h("span.mk-num", { text: `${g.have} / ${g.need}` })));
    }
    if (s.outcome === "niederlage") goals.append(h("li.mk-task-goal.mk-lost", { text: "Der Bergfried ist gefallen." }));
    step.hidden = tut === null || tut === undefined || !TUTORIAL[tut] || !!s.outcome;
    if (!step.hidden) {
      setText(stepLabel, `Einführung ${tut! + 1}/${TUTORIAL.length}`);
      setText(stepText, TUTORIAL[tut!].text);
    }
  }

  render();
  return { el, update };
}
