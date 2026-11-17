/** Gemeinsames für alle Teile der Oberfläche: Kontext, Kosten-Anzeige, kleine Glyphen. */
import type { UiBridge } from "../app/contract";
import { GOODS, type Cost, type Good } from "../data";
import type { SimState } from "../sim/types";
import { h, num, setClass, setText } from "./dom";
import type { Icons } from "./icons";

export interface UiCtx {
  bridge: UiBridge;
  icons: Icons;
  /** Hinweis als Toast (am Mauszeiger, falls bekannt). */
  toast(text: string, kind?: "info" | "warnung"): void;
  /** Forschungsbaum öffnen oder schließen (gesetzt von index.ts, sobald er erzeugt ist). */
  research?: { toggle(on?: boolean): void };
}

/** Kleines Goldmünzen-Glyph (CSS, kein Sprite: im Gebäudeblatt gibt es keine Münze). */
export const coin = (): HTMLElement => h("span.mk-coin", { "aria-hidden": "true" });

/**
 * Frei verfügbare Menge einer Ware: Bestand minus verplant (Baustellen, Forschung, Verarbeitung, wartende Rekruten),
 * dieselbe Rechnung wie die Simulation beim Bauen (storage.available). Ohne state.free (alter Stand) der Bestand.
 */
export const freeOf = (s: SimState, g: Good): number => (s.free ?? s.stock)[g] ?? 0;

/** Reicht der freie Bestand für diese Kosten? */
export function canAfford(s: SimState, cost: Cost): boolean {
  for (const [k, v] of Object.entries(cost) as [Good | "gold", number][]) {
    if (!v) continue;
    if (k === "gold" ? s.gold < v : freeOf(s, k) < v) return false;
  }
  return true;
}

/** Kostenzeile mit Icons; update(state) färbt fehlende Posten rot. */
export function costRow(ctx: UiCtx, cost: Cost, iconSize = 16): { el: HTMLElement; update(s: SimState): void } {
  const parts: { k: Good | "gold"; v: number; el: HTMLElement }[] = [];
  const el = h("span.mk-cost");
  for (const [k, v] of Object.entries(cost) as [Good | "gold", number][]) {
    if (!v) continue;
    const icon = k === "gold" ? coin() : ctx.icons.make("ware", k, iconSize, iconSize);
    const label = k === "gold" ? "Gold" : GOODS[k].name;
    const part = h("span.mk-cost-part", { title: `${v} ${label}` }, icon, h("span.mk-num", { text: num(v) }));
    parts.push({ k, v, el: part });
    el.append(part);
  }
  if (!parts.length) el.append(h("span.mk-muted", { text: "kostenlos" }));
  return {
    el,
    update(s) {
      for (const p of parts) setClass(p.el, "mk-short", p.k === "gold" ? s.gold < p.v : freeOf(s, p.k) < p.v);
    },
  };
}

/** Lebensbalken mit Zahl. */
export function hpBar(): { el: HTMLElement; update(hp: number, max: number): void } {
  const fill = h("span.mk-bar-fill");
  const label = h("span.mk-bar-label");
  const el = h("span.mk-bar.mk-bar-hp", null, fill, label);
  return {
    el,
    update(hp, max) {
      const f = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
      const w = `${Math.round(f * 100)}%`;
      if (fill.style.width !== w) fill.style.width = w;
      setClass(el, "mk-low", f < 0.35);
      setText(label, `${num(Math.max(0, hp))} / ${num(max)}`);
    },
  };
}
