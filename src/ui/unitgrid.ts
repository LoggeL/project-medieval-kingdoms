/**
 * Einheitenraster (BRIEF §8.3): jede Einheit mit eigenem Icon, Kosten (Gold + Ausrüstung) und Voraussetzungen.
 * Gesperrte Einheiten stehen ausgegraut mit Schloss im Raster. Ein Klick öffnet die Detailkarte.
 * Gruppen nach Ausbildungsstätte, je Gruppe zweizeilig; die Leiste blättert waagrecht (Mausrad, Pfeilknöpfe),
 * so bleibt das Raster auch bei vielen Einheiten übersichtlich und vollständig erreichbar.
 */
import { BUILDINGS, GOODS, TECHS, UNITS, WALL_BONUS, type Good, type UnitKey } from "../data";
import { lockedBy } from "../sim/research";
import type { Building, SimState } from "../sim/types";
import { h, num, setClass, setText } from "./dom";
import { DAMAGE_NAME, ROLE_NAME, ROSTER, initials, type RosterEntry } from "./roster";
import { costRow, type UiCtx } from "./shared";

const EQUIP: Partial<Record<Good, string>> = { speer: "den Speer", schwert: "das Schwert", bogen: "den Bogen", eisen: "das Eisen" };

/** keyed: Karten, die eine Taste bekommen (spielbare Einheiten, in Rasterreihenfolge; gesperrte haben keine). */
export interface UnitGrid { el: HTMLElement; keyed: HTMLElement[]; update(s: SimState): void }

/** Fertige eigene Kaserne, die diese Einheit ausbildet; bevorzugt die ausgewählte. */
export function trainingSite(ctx: UiCtx, unit: UnitKey): Building | null {
  const s = ctx.bridge.state();
  const ok = (b: Building) => b.team === 0 && b.built >= 1 && !!BUILDINGS[b.key].trains?.includes(unit);
  const sel = ctx.bridge.selection().building;
  const chosen = sel ? s.buildings.find((b) => b.id === sel) : undefined;
  if (chosen && ok(chosen)) return chosen;
  return s.buildings.find(ok) ?? null;
}

/** Icon einer Einheit: Figur aus dem Blatt oder, solange es keine gibt, ein Wappenschild mit Anfangsbuchstaben. */
export function unitIcon(ctx: UiCtx, e: RosterEntry, size: number): HTMLElement {
  const sprite = e.unit ?? e.sprite;
  if (sprite) return ctx.icons.make("einheit", sprite, size, size);
  return h("span.mk-shield", { title: "Noch keine Figur", style: `width:${size}px;height:${size}px` }, h("span", { text: initials(e.name) }));
}

/** Rekrutieren mit Rückmeldung. */
export function recruit(ctx: UiCtx, building: number, unit: UnitKey): void {
  const r = ctx.bridge.dispatch({ t: "rekrutieren", building, unit });
  if (!r.ok) ctx.toast(r.reason ?? `${UNITS[unit].name} kann nicht ausgebildet werden.`, "warnung");
  else if (r.reason) ctx.toast(r.reason, "info");
}

export function createUnitGrid(ctx: UiCtx): UnitGrid {
  const live: { e: RosterEntry; el: HTMLElement; cost: ReturnType<typeof costRow>; need: HTMLElement }[] = [];
  const groups = ROSTER.map((g) => {
    const cards = g.entries.map((e) => {
      const isLocked = !e.unit;
      const def = e.unit ? UNITS[e.unit] : null;
      const need = h("span.mk-need");
      let costEl: HTMLElement;
      if (def?.train) {
        const cost = costRow(ctx, { gold: def.train.gold, [def.train.equipment]: 1 }, 14);
        live.push({ e, el: null as unknown as HTMLElement, cost, need });
        costEl = cost.el;
      } else {
        costEl = h("span.mk-lock-note", null, h("span.mk-lock", { "aria-hidden": "true" }), "gesperrt");
      }
      const el = h("button.mk-ucard", {
        type: "button", "data-unit": e.key, "aria-label": `${e.name}${isLocked ? " (gesperrt)" : ""}`,
        title: isLocked ? `${e.name}\n${e.role}\nVoraussetzung: ${e.needs?.join(", ")}` : `${e.name} – Details`,
        onclick: () => openDetail(e, el),
      }, h("span.mk-ucard-icon", null, unitIcon(ctx, e, 44)), h("span.mk-ucard-name", { text: e.name, lang: "de" }), costEl, need);
      if (isLocked) el.classList.add("mk-locked");
      const l = live.find((x) => x.e === e);
      if (l) l.el = el;
      return el;
    });
    return h("section.mk-ugroup", null, h("h4.mk-ugroup-title", { text: g.title, title: `Ausbildung: ${g.building}` }), h("div.mk-ugroup-cards", null, ...cards));
  });
  const el = h("div.mk-ugrid", { "aria-label": "Einheiten" }, ...groups);

  // ------------------------------------------------------------ Detailkarte
  const detail = h("div.mk-detail.mk-parchment", { role: "dialog", "aria-label": "Einheit" });
  detail.hidden = true;
  let open: RosterEntry | null = null;
  let detailUpdate: ((s: SimState) => void) | null = null;
  const close = () => { detail.hidden = true; open = null; detailUpdate = null; };
  document.addEventListener("pointerdown", (ev) => {
    if (!open) return;
    const t = ev.target as Node;
    if (!detail.contains(t) && !el.contains(t)) close();
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && open) close(); });

  function openDetail(e: RosterEntry, anchor: HTMLElement): void {
    if (open === e) { close(); return; }
    open = e;
    detail.textContent = "";
    if (!detail.isConnected) document.querySelector(".mk-root")?.append(detail);
    const def = e.unit ? UNITS[e.unit] : null;
    const rows: [string, string][] = [];
    if (def) {
      rows.push(["Leben", num(def.hp)], ["Rüstung", num(def.armor)]);
      if (def.damage) rows.push(["Schaden", `${def.damage} ${def.damageType ? DAMAGE_NAME[def.damageType] : ""}`.trim()]);
      if (def.range) rows.push(["Reichweite", `${String(def.range).replace(".", ",")} Felder`]);
      if (def.cooldown) rows.push(["Angriffstakt", `${String(def.cooldown).replace(".", ",")} s`]);
      rows.push(["Tempo", `${String(def.speed).replace(".", ",")} Felder/s`]);
      if (def.bonus?.nahkampf) rows.push(["Stark gegen", `Nahkämpfer (×${String(def.bonus.nahkampf).replace(".", ",")})`]);
      if (def.role === "fernkampf" && def.canStation) rows.push(["Auf der Mauer", `+${String(WALL_BONUS.rangePerStep).replace(".", ",")} Reichweite je Höhenstufe`]);
      if (def.train) rows.push(["Ausbildung", `${def.train.seconds} s in der Kaserne`]);
    }
    const body = h("div.mk-detail-body", null,
      h("div.mk-detail-head", null, h("span.mk-detail-icon", null, unitIcon(ctx, e, 64)),
        h("div", null, h("h3.mk-title", { text: e.name }), h("p.mk-sub", { text: def ? ROLE_NAME[def.role] : e.role ?? "" }))),
      rows.length ? h("dl.mk-stats", null, ...rows.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])) : null,
    );
    if (def?.train) {
      const cost = costRow(ctx, { gold: def.train.gold, [def.train.equipment]: 1 }, 16);
      const where = h("p.mk-sub");
      const go = h("button.mk-btn.mk-btn-wide", { type: "button", text: "Ausbilden", onclick: () => {
        const k = trainingSite(ctx, e.unit!);
        if (!k) { ctx.toast("Zuerst eine Kaserne bauen.", "warnung"); return; }
        recruit(ctx, k.id, e.unit!);
      } });
      body.append(h("div.mk-detail-cost", null, h("span", { text: "Kosten: " }), cost.el),
        h("p.mk-sub", { text: `Dazu ein Tagelöhner, der ${EQUIP[def.train.equipment] ?? GOODS[def.train.equipment].name} selbst aus dem Lager holt.` }),
        where, go);
      detailUpdate = (s) => {
        cost.update(s);
        const k = trainingSite(ctx, e.unit!);
        const need = lockedBy(s, def);
        setText(where, need ? `Voraussetzung: Forschung „${TECHS[need].name}“.` : k ? "" : "Voraussetzung: eine fertige Kaserne.");
        setClass(go, "mk-disabled", !k || !!need);
      };
    } else {
      body.append(h("div.mk-locked-box", null, h("span.mk-lock", { "aria-hidden": "true" }),
        h("div", null, h("strong", { text: "Gesperrt" }), h("ul", null, ...(e.needs ?? []).map((n) => h("li", { text: n }))))),
      h("p.mk-sub", { text: "Diese Forschung gibt es im Prototyp noch nicht. Was sich schon erforschen lässt, zeigt der Forschungsbaum (F)." }));
    }
    detail.append(h("button.mk-x", { type: "button", "aria-label": "Schließen", text: "×", onclick: close }), body);
    detail.hidden = false;
    detailUpdate?.(ctx.bridge.state());
    // über der angeklickten Karte, innerhalb des Fensters
    const r = anchor.getBoundingClientRect();
    const w = detail.offsetWidth || 280;
    detail.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    detail.style.bottom = `${Math.max(8, window.innerHeight - r.top + 10)}px`;
  }

  return {
    el,
    keyed: live.map((l) => l.el),
    update(s) {
      const hasPeasant = s.units.some((u) => u.team === 0 && !u.dead && u.key === "tageloehner");
      for (const l of live) {
        l.cost.update(s);
        const def = UNITS[l.e.unit!];
        const site = s.buildings.some((b) => b.team === 0 && b.built >= 1 && BUILDINGS[b.key].trains?.includes(l.e.unit!));
        const need = lockedBy(s, def);
        const lack = need ? `Forschung: ${TECHS[need].name}` : !site ? "Kaserne nötig" : !hasPeasant ? "Kein Tagelöhner frei" : "";
        setClass(l.el, "mk-locked", !!need);
        setText(l.need, lack);
        setClass(l.el, "mk-cant", !!lack || s.gold < (def.train?.gold ?? 0) || (s.stock[def.train!.equipment] ?? 0) < 1);
      }
      detailUpdate?.(s);
    },
  };
}
