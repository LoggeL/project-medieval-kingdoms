/**
 * Fußleiste (behauene Steinplatte): Reiter Wirtschaft, Wohnen, Befestigung, Militär mit Baukarten aus BUILDINGS,
 * dazu Auswahl- und Abriss-Werkzeug. Der Reiter Militär zeigt außerdem das Einheitenraster (unitgrid.ts).
 */
import type { Tool } from "../app/contract";
import { BUILDINGS, type BuildingDef, type BuildingKey } from "../data";
import type { SimState } from "../sim/types";
import { h, setAttr, setClass } from "./dom";
import { canAfford, costRow, type UiCtx } from "./shared";
import { createUnitGrid } from "./unitgrid";

type Cat = BuildingDef["category"];
const TABS: { cat: Cat; label: string }[] = [
  { cat: "wirtschaft", label: "Wirtschaft" },
  { cat: "wohnen", label: "Wohnen" },
  { cat: "befestigung", label: "Befestigung" },
  { cat: "militaer", label: "Militär" },
];

export interface BuildBar { el: HTMLElement; update(s: SimState): void; updateTool(): void }

export function createBuildBar(ctx: UiCtx): BuildBar {
  const { bridge, icons } = ctx;
  const keys = Object.keys(BUILDINGS) as BuildingKey[];
  let tab: Cat = "wirtschaft";
  try { const t = localStorage.getItem("mk-ui-tab") as Cat | null; if (t && TABS.some((x) => x.cat === t)) tab = t; } catch { /* ohne Speicher */ }

  // ------------------------------------------------------------ Baukarten
  const cards = keys.map((key) => {
    const def = BUILDINGS[key];
    const cost = costRow(ctx, def.cost, 14);
    const el = h("button.mk-card", {
      type: "button", "data-key": key,
      title: `${def.name}\n${def.desc}${def.drag ? "\n(Ziehen zum Bauen)" : ""}`,
      onclick: () => pick(key),
    },
    h("span.mk-card-icon", null, icons.make("gebaeude", key, 72, 72)),
    h("span.mk-card-name", { text: def.name }),
    cost.el);
    return { key, def, el, cost };
  });

  function pick(key: BuildingKey): void {
    const cur = bridge.tool();
    const def = BUILDINGS[key];
    if (!canAfford(bridge.state(), def.cost)) ctx.toast(`Nicht genug Material für ${def.name}.`, "warnung");
    let next: Tool;
    if (def.drag) next = cur.t === "mauer" ? { t: "auswahl" } : { t: "mauer" };
    else if (cur.t === "bauen" && cur.key === key) next = { t: "auswahl" };
    else next = { t: "bauen", key, o: cur.t === "bauen" ? cur.o : 0 };
    bridge.setTool(next);
  }

  // ------------------------------------------------------------ Werkzeuge
  const toolBtn = (label: string, title: string, t: Tool["t"], cls: string) =>
    h(`button.mk-tool.${cls}` as "button", {
      type: "button", title, "aria-label": title,
      onclick: () => bridge.setTool(t === "abriss" && bridge.tool().t !== "abriss" ? { t: "abriss" } : { t: "auswahl" }),
    }, h("span.mk-tool-glyph", { "aria-hidden": "true" }), h("span.mk-tool-label", { text: label }));
  const selBtn = toolBtn("Auswahl", "Auswählen (Esc)", "auswahl", "mk-tool-sel");
  const delBtn = toolBtn("Abriss", "Abreißen: Gebäude anklicken", "abriss", "mk-tool-del");

  // ------------------------------------------------------------ Reiter
  const tabBtns = TABS.map((t) => h("button.mk-tab", {
    type: "button", role: "tab", "data-cat": t.cat, text: t.label,
    onclick: () => { tab = t.cat; el.classList.remove("mk-collapsed"); try { localStorage.setItem("mk-ui-tab", tab); } catch { /* egal */ } layout(); },
  }));
  const strip = h("div.mk-cards", { role: "tabpanel" });
  // Weiterblättern: Mausrad (senkrecht → waagrecht) und Pfeilknöpfe an den Rändern, sobald es mehr gibt als Platz.
  const scrollBy = (dir: number) => strip.scrollBy({ left: dir * Math.max(120, strip.clientWidth * 0.7), behavior: "smooth" });
  const prev = h("button.mk-scroll.mk-scroll-prev", { type: "button", title: "Weiter links", "aria-label": "Weiter links", onclick: () => scrollBy(-1) });
  const next = h("button.mk-scroll.mk-scroll-next", { type: "button", title: "Weiter rechts", "aria-label": "Weiter rechts", onclick: () => scrollBy(1) });
  const stripWrap = h("div.mk-cards-wrap", null, strip, prev, next);
  const updateArrows = () => {
    const max = strip.scrollWidth - strip.clientWidth;
    prev.hidden = strip.scrollLeft <= 2;
    next.hidden = strip.scrollLeft >= max - 2;
    setClass(stripWrap, "mk-more-left", !prev.hidden);
    setClass(stripWrap, "mk-more-right", !next.hidden);
  };
  strip.addEventListener("wheel", (e) => {
    if (strip.scrollWidth <= strip.clientWidth) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    strip.scrollLeft += e.deltaMode === 1 ? d * 32 : d;
  }, { passive: false });
  strip.addEventListener("scroll", updateArrows, { passive: true });
  window.addEventListener("resize", updateArrows);
  const grid = createUnitGrid(ctx);
  const collapse = h("button.mk-collapse", {
    type: "button", title: "Fußleiste ein- oder ausklappen", "aria-label": "Fußleiste ein- oder ausklappen",
    onclick: () => { el.classList.toggle("mk-collapsed"); requestAnimationFrame(updateArrows); },
  });

  const el = h("div.mk-build", null,
    h("div.mk-tabs", { role: "tablist" }, ...tabBtns, h("span.mk-tabs-fill"), collapse),
    h("div.mk-build-body", null, stripWrap, h("div.mk-tools", null, selBtn, delBtn)));

  function layout(): void {
    tabBtns.forEach((b) => { const on = b.dataset.cat === tab; setClass(b, "mk-on", on); setAttr(b, "aria-selected", String(on)); });
    strip.textContent = "";
    for (const c of cards) if (c.def.category === tab) strip.append(c.el);
    if (tab === "militaer") strip.append(grid.el);
    strip.scrollLeft = 0;
    requestAnimationFrame(updateArrows);
  }
  layout();

  return {
    el,
    update(s) {
      for (const c of cards) {
        if (c.def.category !== tab) continue;
        c.cost.update(s);
        setClass(c.el, "mk-cant", !canAfford(s, c.def.cost));
      }
      if (tab === "militaer") grid.update(s);
    },
    updateTool() {
      const t = bridge.tool();
      for (const c of cards) setClass(c.el, "mk-on", (t.t === "bauen" && t.key === c.key) || (t.t === "mauer" && !!c.def.drag));
      setClass(selBtn, "mk-on", t.t === "auswahl");
      setClass(delBtn, "mk-on", t.t === "abriss");
    },
  };
}
