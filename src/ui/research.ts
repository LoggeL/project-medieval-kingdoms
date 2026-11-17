/**
 * Forschungsbaum (F, Knopf „Forschung“ in der Fußleiste, Bergfried-Panel): drei Zweige aus TECHS (src/data/research.ts),
 * jede Technik mit Ikone, Zustand (erforscht, läuft, verfügbar, gesperrt), Kosten, Dauer, Voraussetzungen und dem,
 * was sie freischaltet. Oben die laufende Forschung mit Fortschritt und Abbrechen.
 * Die Regeln (Voraussetzungen, Zustand) liest die Oberfläche aus src/sim/research.ts, dieselben wie die Simulation.
 */
import { GOODS, TECHS, TECH_KEYS, type TechKey } from "../data";
import { BUTTON_KEYS } from "../data/hotkeys";
import { goodsOf, techMissing, techStatus, unlocksOf, type TechStatus } from "../sim/research";
import type { SimState } from "../sim/types";
import { h, setBar, setClass, setText } from "./dom";
import { flashKey, modalOpen, typing } from "./hotkeys";
import { canAfford, costRow, type UiCtx } from "./shared";

const BRANCHES = ["Bergfried", "Wirtschaft", "Militär"] as const;
const STATUS_NAME: Record<TechStatus, string> = { erforscht: "Erforscht", laeuft: "Läuft", verfuegbar: "Verfügbar", gesperrt: "Gesperrt" };

export interface ResearchView { el: HTMLElement; toggle(on?: boolean): void; isOpen(): boolean; update(s: SimState): void }

/** Ikone einer Technik aus assets/ui/forschung.png (Spalte TechDef.icon). */
export function techIcon(k: TechKey, size = 48): HTMLElement {
  // weitere Ikonenblätter (TechDef.iconSheet) registriert src/ui/index.ts als --mk-tex-<blatt>
  const sheet = TECHS[k].iconSheet;
  return h("span.mk-ticon", { "aria-hidden": "true", style: `--mk-ti:${TECHS[k].icon};--mk-ts:${size}px${sheet ? `;--mk-ticon-tex:var(--mk-tex-${sheet})` : ""}` });
}

/** Forschung starten mit Rückmeldung. */
export function startTech(ctx: UiCtx, k: TechKey): void {
  const r = ctx.bridge.dispatch({ t: "forschen", tech: k });
  if (!r.ok) ctx.toast(r.reason ?? `${TECHS[k].name} kann nicht erforscht werden.`, "warnung");
  else ctx.toast(r.reason ?? `Forschung begonnen: ${TECHS[k].name}`, "info");
}

export function cancelTech(ctx: UiCtx): void {
  const r = ctx.bridge.dispatch({ t: "forschung_abbrechen" });
  if (!r.ok) ctx.toast(r.reason ?? "Abbrechen nicht möglich.", "warnung");
  else if (r.reason) ctx.toast(r.reason, "info");
}

/** Text zur laufenden Forschung: wartet auf Träger, Träger unterwegs, oder Prozent. */
export function researchText(s: SimState): string {
  const cur = s.research.cur;
  if (!cur) return "Es wird nichts erforscht.";
  const missing = goodsOf(cur.needs).map(([g, n]) => `${n} ${GOODS[g].name}`);
  const carrying = Object.values(cur.enroute).some((n) => (n ?? 0) > 0);
  if (missing.length && !carrying) return `${TECHS[cur.key].name}: wartet auf freie Tagelöhner, es fehlen noch ${missing.join(", ")}`;
  if (missing.length) return `${TECHS[cur.key].name}: Tagelöhner bringen noch ${missing.join(", ")}`;
  return `${TECHS[cur.key].name}: ${Math.floor((cur.t / Math.max(0.001, cur.dur)) * 100)} %`;
}

export function createResearch(ctx: UiCtx): ResearchView {
  const close = () => toggle(false);

  // ------------------------------------------------------------ laufende Forschung
  const curIcon = h("span.mk-cur-icon");
  const curText = h("span");
  const fill = h("span.mk-bar-fill");
  const cancel = h("button.mk-btn", { type: "button", text: "Abbrechen", title: "Forschung abbrechen: Gold und angelieferte Waren gehen zurück ins Lager", onclick: () => cancelTech(ctx) });
  const cur = h("div.mk-training.mk-rcur", null, curIcon, h("div.mk-training-col", null, curText, h("span.mk-bar.mk-bar-train", null, fill)), cancel);

  // ------------------------------------------------------------ Karten
  const cards = TECH_KEYS.map((k) => {
    const def = TECHS[k];
    const cost = costRow(ctx, def.cost, 16);
    const badge = h("span.mk-rbadge");
    const req = h("ul.mk-rreq");
    const go = h("button.mk-btn.mk-btn-wide", { type: "button", text: "Erforschen", onclick: () => startTech(ctx, k) });
    const unlocks = unlocksOf(k);
    const el = h("article.mk-rcard", { "data-tech": k },
      h("div.mk-rhead", null, techIcon(k, 48), h("div.mk-rhead-text", null, h("h4.mk-rname", { text: def.name, lang: "de" }), badge)),
      h("p.mk-rdesc", { text: def.desc }),
      unlocks.length ? h("p.mk-runlock", null, h("strong", { text: "Schaltet frei: " }), unlocks.join(", ")) : null,
      h("div.mk-rcost", null, cost.el, h("span.mk-rtime", { text: `${def.seconds} s` })),
      req, go);
    return { k, el, cost, badge, req, go, lastReq: "" };
  });
  const cols = BRANCHES.map((title, i) => h("section.mk-rcol", null, h("h3.mk-sec-title", { text: title }),
    ...cards.filter((c) => TECHS[c.k].branch === i).map((c) => c.el)));

  const card = h("div.mk-help-card.mk-research-card.mk-parchment", { role: "dialog", "aria-modal": "true", "aria-labelledby": "mk-research-title" },
    h("button.mk-x", { type: "button", "aria-label": "Forschung schließen", text: "×", onclick: close }),
    h("h2.mk-title", { id: "mk-research-title", text: "Forschung" }),
    h("p.mk-sub", { text: "Geforscht wird im Bergfried, eine Technik nach der anderen. Gold zahlst du sofort, die Waren tragen Tagelöhner aus dem Lager hinein. Erst wenn alles da ist, läuft die Zeit." }),
    cur,
    h("div.mk-rcols", null, ...cols));
  const el = h("div.mk-help.mk-research", { onclick: (e: Event) => { if (e.target === el) close(); } }, card);
  el.hidden = true;
  let last: Element | null = null;

  function toggle(on = el.hidden): void {
    if (on === !el.hidden) return;
    el.hidden = !on;
    if (on) { last = document.activeElement; update(ctx.bridge.state()); (card.querySelector(".mk-x") as HTMLElement).focus(); }
    else if (last instanceof HTMLElement) last.focus();
  }

  let lastCur = "";
  function update(s: SimState): void {
    if (el.hidden) return;
    const rc = s.research.cur;
    setClass(cur, "mk-idle", !rc);
    const ck = rc?.key ?? "";
    if (ck !== lastCur) { lastCur = ck; curIcon.textContent = ""; if (rc) curIcon.append(techIcon(rc.key, 32)); }
    setText(curText, researchText(s));
    setBar(fill, rc && rc.dur ? rc.t / rc.dur : 0);
    cancel.hidden = !rc;
    const busy = !!rc;
    for (const c of cards) {
      const st = techStatus(s, c.k);
      setText(c.badge, STATUS_NAME[st]);
      for (const x of ["erforscht", "laeuft", "verfuegbar", "gesperrt"] as const) setClass(c.el, `mk-r-${x}`, st === x);
      c.cost.update(s);
      const miss = st === "gesperrt" ? techMissing(s, c.k) : [];
      const sig = miss.join("|");
      if (sig !== c.lastReq) {
        c.lastReq = sig;
        c.req.textContent = "";
        for (const m of miss) c.req.append(h("li", { text: m }));
      }
      c.go.hidden = st === "erforscht" || st === "laeuft";
      const afford = canAfford(s, TECHS[c.k].cost);
      c.go.disabled = st !== "verfuegbar" || busy || !afford;
      c.go.title = st === "gesperrt" ? "Voraussetzungen fehlen" : busy ? "Es läuft schon eine Forschung" : !afford ? "Nicht genug Gold oder Waren im Lager" : `${TECHS[c.k].name} erforschen`;
    }
  }

  window.addEventListener("keydown", (e) => {
    if (typing(e)) return;
    // Taste aus src/data/hotkeys.ts (BUTTON_KEYS.forschung); öffnet und schließt den Baum
    if ((BUTTON_KEYS.forschung as readonly string[]).includes(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // nur im Spiel (die Oberfläche ist eingehängt und nicht vom Titel verdeckt), nicht über einer anderen Tafel (Hilfe)
      if (!el.isConnected || document.querySelector("#mk-titel:not(.mk-weg), #mk-laden:not(.mk-weg)")) return;
      if (el.hidden && modalOpen()) return;
      if (e.repeat) { e.preventDefault(); return; }
      e.preventDefault();
      if (el.hidden) flashKey(e.code);
      toggle();
    } else if (e.key === "Escape" && !el.hidden) { e.preventDefault(); e.stopImmediatePropagation(); toggle(false); }
  }, true);

  return { el, toggle, isOpen: () => !el.hidden, update };
}
