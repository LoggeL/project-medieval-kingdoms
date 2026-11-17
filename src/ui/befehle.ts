/**
 * Befehlsleiste der gewählten Soldaten im Auswahlpanel (Briefing §7, ADR 0018): Stationieren, Angriffsmarsch,
 * Patrouille, Rückzug; Formation (Linie, Block, locker) und Haltung (aggressiv, defensiv, Stellung halten) als
 * Umschalter mit der gerade gültigen Wahl. Ikonen aus assets/ui/befehle.png (Spalte = `icon` in src/data/befehle.ts),
 * Tasten aus src/data/hotkeys.ts (BUTTON_KEYS). T und H wertet die Eingabe aus (Knopf leuchtet nur auf), alle übrigen
 * Tasten lösen den Knopf aus (src/ui/hotkeys.ts). L und Ö schalten über einen kleinen Weiter-Knopf zur nächsten Wahl.
 */
import {
  COMMANDS, DEFAULT_FORMATION, DEFAULT_STANCE, FORMATIONS, FORMATION_ORDER, STANCES, STANCE_ORDER, UNITS,
  type CommandKey, type FormationKey, type StanceKey,
} from "../data";
import { BUTTON_KEYS } from "../data/hotkeys";
import type { Command } from "../sim/types";
import type { SimState, Unit } from "../sim/types";
import { h, setAttr, setClass } from "./dom";
import { setKey } from "./hotkeys";
import type { UiCtx } from "./shared";

/** Ikone aus dem Befehlsblatt (64 px je Spalte, 10 Spalten). */
export function commandIcon(i: number, size = 22): HTMLElement {
  return h("span.mk-bicon", { "aria-hidden": "true", style: `--mk-bi:${i};--mk-bs:${size}px` });
}

/** Häufigster Wert, bei Gleichstand der erste in order. */
function majority<K extends string>(values: K[], order: readonly K[], fallback: K): K {
  let best = fallback, n = -1;
  for (const k of order) { const c = values.filter((v) => v === k).length; if (c > n) { n = c; best = k; } }
  return values.length ? best : fallback;
}

export interface CommandBar { sections: HTMLElement[]; update(s: SimState): void }

/** Eigene Soldaten der aktuellen Auswahl. */
function selectedSoldiers(ctx: UiCtx): Unit[] {
  const s = ctx.bridge.state(), ids = new Set(ctx.bridge.selection().units);
  return s.units.filter((u) => ids.has(u.id) && !u.dead && u.team === 0 && UNITS[u.key].role !== "arbeiter");
}

export function createCommandBar(ctx: UiCtx, soldiers: readonly Unit[], section: (title: HTMLElement | string, ...kids: (Node | null)[]) => HTMLElement): CommandBar {
  const { bridge } = ctx;
  const ids = () => selectedSoldiers(ctx).map((u) => u.id);
  const send = (cmd: Command, fallback = "Befehl nicht möglich.") => {
    const r = bridge.dispatch(cmd);
    if (!r.ok) ctx.toast(r.reason ?? fallback, "warnung");
    else if (r.reason) ctx.toast(r.reason, "info");
    return r.ok;
  };

  // ---------------------------------------------------------- Befehle
  const btn = (k: CommandKey, onclick: () => void, disabled = false) => h("button.mk-btn.mk-cmd", {
    type: "button", title: COMMANDS[k].desc, disabled, "data-befehl": k, onclick,
  }, commandIcon(COMMANDS[k].icon), h("span", { text: COMMANDS[k].name }));
  const tool = (cmd: "angriffsbewegung" | "patrouille") => () => {
    const t = bridge.tool();
    bridge.setTool(t.t === "befehl" && t.cmd === cmd ? { t: "auswahl" } : { t: "befehl", cmd, pts: [] });
  };
  const canStation = soldiers.some((u) => UNITS[u.key].canStation);
  const station = btn("stationieren", () => send({ t: "stationieren", units: ids() }, "Kein freier Posten."), !canStation);
  const amove = btn("angriffsbewegung", tool("angriffsbewegung"));
  const patrol = btn("patrouille", tool("patrouille"));
  const retreat = btn("rueckzug", () => send({ t: "rueckzug", units: ids() }, "Rückzug nicht möglich."));
  setKey(station, BUTTON_KEYS.stationieren, { app: true });
  setKey(amove, BUTTON_KEYS.angriffsbewegung);
  setKey(patrol, BUTTON_KEYS.patrouille);
  setKey(retreat, BUTTON_KEYS.rueckzug);

  // ---------------------------------------------------------- Umschalter
  function toggles<K extends string>(order: readonly K[], def: (k: K) => { name: string; desc: string; icon: number }, label: (k: K) => string, pick: (k: K) => void) {
    const map = new Map<K, HTMLButtonElement>();
    const row = h("div.mk-seg", { role: "group" });
    for (const k of order) {
      const d = def(k);
      const b = h("button.mk-btn.mk-seg-btn", { type: "button", title: `${d.name}: ${d.desc}`, "aria-pressed": "false", onclick: () => pick(k) },
        commandIcon(d.icon, 24), h("span", { text: label(k) }));
      map.set(k, b);
      row.append(b);
    }
    return { row, map };
  }
  const form = toggles(FORMATION_ORDER, (k) => FORMATIONS[k], (k) => FORMATIONS[k].name, (k) => send({ t: "formation", units: ids(), formation: k }));
  const stance = toggles(STANCE_ORDER, (k) => STANCES[k], (k) => (k === "stellung" ? "Halten" : STANCES[k].name),
    (k) => send(k === "stellung" ? { t: "halten", units: ids() } : { t: "haltung", units: ids(), stance: k }));
  // H (Halten) ist „Stellung halten“: die Eingabe wertet H aus, der Knopf leuchtet auf
  setKey(stance.map.get("stellung")!, BUTTON_KEYS.halten, { app: true });

  let curForm: FormationKey = DEFAULT_FORMATION, curStance: StanceKey = DEFAULT_STANCE;
  const next = <K extends string>(order: readonly K[], cur: K) => order[(order.indexOf(cur) + 1) % order.length];
  const cycle = (title: string, codes: readonly string[], onclick: () => void) => {
    const b = h("button.mk-btn.mk-cycle", { type: "button", title, onclick }, h("span", { text: "weiter" }));
    setKey(b, codes);
    return b;
  };
  const formNext = cycle("Nächste Formation", BUTTON_KEYS.formation, () => send({ t: "formation", units: ids(), formation: next(FORMATION_ORDER, curForm) }));
  const stanceNext = cycle("Nächste Haltung", BUTTON_KEYS.haltung, () => {
    const k = next(STANCE_ORDER, curStance);
    send(k === "stellung" ? { t: "halten", units: ids() } : { t: "haltung", units: ids(), stance: k });
  });
  const titled = (text: string, extra: HTMLElement) => h("span.mk-sec-row", null, h("span", { text }), extra);

  const sections = [
    section("Befehle", h("div.mk-cmds", null, station, amove, patrol, retreat),
      h("p.mk-sub", { text: "Rechtsklick: bewegen oder angreifen. Rechts ziehen: Formation ausrichten (Schützen hinten)." })),
    section(titled("Formation", formNext), form.row),
    section(titled("Haltung", stanceNext), stance.row),
  ];

  return {
    sections,
    update() {
      const us = selectedSoldiers(ctx);
      curForm = majority(us.map((u) => u.formation ?? DEFAULT_FORMATION), FORMATION_ORDER, DEFAULT_FORMATION);
      curStance = majority(us.map((u) => u.stance ?? DEFAULT_STANCE), STANCE_ORDER, DEFAULT_STANCE);
      for (const [k, b] of form.map) { setClass(b, "mk-on", k === curForm); setAttr(b, "aria-pressed", String(k === curForm)); }
      for (const [k, b] of stance.map) { setClass(b, "mk-on", k === curStance); setAttr(b, "aria-pressed", String(k === curStance)); }
      const t = bridge.tool();
      setClass(amove, "mk-on", t.t === "befehl" && t.cmd === "angriffsbewegung");
      setClass(patrol, "mk-on", t.t === "befehl" && t.cmd === "patrouille");
      setClass(retreat, "mk-on", us.length > 0 && us.every((u) => u.order.t === "retreat"));
    },
  };
}
