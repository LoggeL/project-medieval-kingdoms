/**
 * Auswahl-Panel rechts auf Pergament. Erscheint nur bei einer Auswahl.
 * Gebäude: Zustand (Baustelle oder fertig), Arbeiter, Hofstapel, Lagerplätze, Ausbildung, Abreißen.
 * Einheiten: einzeln (Werte, Auftrag) oder als Gruppe (Anzahl je Typ), Befehle Stationieren und Halten.
 * Der Aufbau wird nur neu erzeugt, wenn sich die Auswahl oder ihre Form ändert; sonst werden Werte aktualisiert.
 */
import { BUILDINGS, GOODS, UNITS, type Good, type UnitKey } from "../data";
import type { Building, SimState, Unit, UnitActivity } from "../sim/types";
import { h, num, setBar, setClass, setText } from "./dom";
import { DAMAGE_NAME, ROLE_NAME } from "./roster";
import { costRow, hpBar, type UiCtx } from "./shared";
import { recruit } from "./unitgrid";

const CAT_NAME = { wirtschaft: "Wirtschaft", wohnen: "Wohnen", militaer: "Militär", befestigung: "Befestigung" } as const;
const LAYER_NAME = ["am Boden", "auf dem Wehrgang", "auf dem Turm"];

export interface SidePanel { el: HTMLElement; update(s: SimState): void }

type Updater = (s: SimState) => void;

export function createSidePanel(ctx: UiCtx): SidePanel {
  const { bridge } = ctx;
  const body = h("div.mk-side-body");
  const el = h("aside.mk-side.mk-parchment", { "aria-label": "Auswahl", "aria-live": "polite" },
    h("button.mk-x", { type: "button", "aria-label": "Auswahl aufheben", text: "×", onclick: () => bridge.select({ units: [], building: null }) }),
    body);
  el.hidden = true;
  let sig = "";
  let upd: Updater[] = [];
  // Schriften laden nach: Titel danach noch einmal einpassen.
  document.fonts?.ready.then(() => { if (!el.hidden) fitTitle(); }).catch(() => undefined);

  function build(s: SimState): void {
    body.textContent = "";
    upd = [];
    const sel = bridge.selection();
    const b = sel.building ? s.buildings.find((q) => q.id === sel.building) : undefined;
    if (b) buildingView(b);
    else {
      const units = liveUnits(s, sel.units);
      if (units.length === 1) singleUnit(units[0]);
      else if (units.length > 1) groupView(units);
    }
  }

  function signature(s: SimState): string {
    const sel = bridge.selection();
    if (sel.building) {
      const b = s.buildings.find((q) => q.id === sel.building);
      return b ? `b${b.id}:${b.key}:${b.built >= 1 ? 1 : 0}:${b.team}` : "";
    }
    const units = liveUnits(s, sel.units);
    if (units.length === 1) return `u${units[0].id}`;
    return units.length ? `g${units.map((u) => u.key + u.team).sort().join(",")}` : "";
  }

  // ------------------------------------------------------------ Gebäude
  function buildingView(b0: Building): void {
    const def = BUILDINGS[b0.key];
    const id = b0.id;
    const get = (s: SimState) => s.buildings.find((q) => q.id === id);
    body.append(head(ctx.icons.make("gebaeude", b0.key, 72, 72, b0.team), def.name,
      b0.team === 0 ? CAT_NAME[def.category] : "Feindliches Gebäude", b0.team !== 0));

    if (b0.built < 1) {
      // Baustelle
      const fill = h("span.mk-bar-fill");
      const pct = h("span.mk-bar-label");
      const missing = h("div.mk-goods");
      const site = h("div.mk-goods");
      body.append(section("Baustelle", h("span.mk-bar.mk-bar-build", null, fill, pct),
        h("p.mk-label", { text: "Fehlt noch" }), missing, h("p.mk-label", { text: "Liegt bereit" }), site));
      // null: goodsSig liefert nie null, so wird beim ersten Durchlauf immer gefüllt (auch "Noch nichts angeliefert.").
      let lastNeeds: string | null = null, lastSite: string | null = null;
      upd.push((s) => {
        const b = get(s); if (!b) return;
        setBar(fill, b.built);
        setText(pct, `${Math.floor(b.built * 100)} %`);
        const n = goodsSig(b.needs), t = goodsSig(b.site);
        if (n !== lastNeeds) { lastNeeds = n; fillGoods(missing, b.needs, "Alles angeliefert, es wird gebaut."); }
        if (t !== lastSite) { lastSite = t; fillGoods(site, b.site, "Noch nichts angeliefert."); }
      });
    } else {
      const hp = hpBar();
      body.append(section("Zustand", hp.el));
      upd.push((s) => { const b = get(s); if (b) hp.update(b.hp, def.hp); });
    }

    if (def.workers && b0.built >= 1) {
      const val = h("span.mk-num");
      body.append(row(`${UNITS[def.workers.unit].name}`, ctx.icons.make("einheit", def.workers.unit, 24, 24), val));
      upd.push((s) => { const b = get(s); if (b) setText(val, `${b.workers.length} / ${def.workers!.count}`); });
    }

    if (def.output && b0.built >= 1) {
      const val = h("span.mk-num");
      const fill = h("span.mk-bar-fill");
      body.append(section("Hofstapel", h("div.mk-row", null, ctx.icons.make("ware", def.output.good, 24, 24),
        h("span.mk-bar.mk-bar-stock", null, fill), val),
      h("p.mk-sub", { text: "Träger holen die Ware ab. Ist der Hof voll, ruht die Arbeit." })));
      upd.push((s) => {
        const b = get(s); if (!b?.output) return;
        setText(val, `${b.output.amount} / ${def.output!.capacity}`);
        setBar(fill, b.output.amount / def.output!.capacity);
      });
    }

    if (def.storage && b0.built >= 1) {
      const slots = Array.from({ length: def.storage.slots }, (_, k) => {
        const icon = ctx.icons.make("ware", "leer", 28, 28);
        const amt = h("span.mk-num");
        const inc = h("span.mk-inc");
        const fill = h("span.mk-bar-fill");
        const el = h("div.mk-slot", { title: `Stellplatz ${k + 1}` }, icon, amt, inc, h("span.mk-bar.mk-bar-slot", null, fill));
        return { el, icon, amt, inc, fill };
      });
      const total = h("span.mk-num");
      body.append(section("Stellplätze", h("div.mk-slots", null, ...slots.map((x) => x.el)),
        h("div.mk-row.mk-row-sum", null, h("span", { text: "Belegt" }), total)));
      upd.push((s) => {
        const b = get(s); if (!b) return;
        let sum = 0;
        slots.forEach((x, k) => {
          const sl = b.slots[k];
          const good = sl?.good ?? null;
          sum += sl?.amount ?? 0;
          ctx.icons.change(x.icon, "ware", good ?? "leer");
          setClass(x.el, "mk-empty", !good);
          setText(x.amt, good ? `${sl.amount}/${def.storage!.perSlot}` : "frei");
          setText(x.inc, sl && sl.incoming > 0 ? `+${sl.incoming}` : "");
          setBar(x.fill, sl ? sl.amount / def.storage!.perSlot : 0);
          x.el.title = good ? `${GOODS[good].name}: ${sl.amount} von ${def.storage!.perSlot}${sl.incoming ? `, ${sl.incoming} unterwegs` : ""}` : "Freier Stellplatz";
        });
        setText(total, `${sum} / ${def.storage!.slots * def.storage!.perSlot}`);
      });
    }

    if (def.housing && b0.built >= 1) body.append(row("Wohnraum", null, h("span.mk-num", { text: `${def.housing} Bewohner` })));

    if ((def.walkway || def.stairs) && b0.built >= 1) {
      const posts = def.posts?.length ?? 0;
      const val = h("span.mk-num");
      const info = def.stairs ? "Führt hinauf auf den Wehrgang."
        : def.gate ? "Tor für eigene Leute, oben läuft der Wehrgang weiter."
        : (def.walkway ?? 0) >= 2 ? "Turmplattform über dem Wehrgang: Schützen schießen von hier am weitesten."
        : "Begehbarer Wehrgang mit Zinnen. Zugang über eine Treppe oder einen Turm.";
      body.append(section("Wehrbau", h("p.mk-sub", { text: info }), posts ? row("Besetzte Posten", null, val) : null));
      if (posts) upd.push((s) => {
        const n = s.units.filter((u) => !u.dead && u.order.t === "station" && u.order.building === id).length;
        setText(val, `${n} / ${posts}`);
      });
    }

    if (def.trains && b0.built >= 1 && b0.team === 0) trainingView(id, def.trains);

    body.append(h("p.mk-desc", { text: def.desc }));

    if (b0.team === 0) {
      let armed = false;
      const btn = h("button.mk-btn.mk-btn-wide.mk-btn-danger", { type: "button", text: "Abreißen", onclick: () => {
        if (!armed) { armed = true; setText(btn, "Wirklich abreißen?"); setTimeout(() => { armed = false; setText(btn, "Abreißen"); }, 2500); return; }
        const r = bridge.dispatch({ t: "abreissen", id });
        if (!r.ok) ctx.toast(r.reason ?? "Abriss nicht möglich.", "warnung");
        else { if (r.reason) ctx.toast(r.reason, "info"); bridge.select({ units: [], building: null }); }
      } });
      body.append(h("div.mk-actions", null, btn));
    }
  }

  function trainingView(id: number, trains: UnitKey[]): void {
    const get = (s: SimState) => s.buildings.find((q) => q.id === id);
    const buttons = trains.map((u) => {
      const t = UNITS[u].train!;
      const cost = costRow(ctx, { gold: t.gold, [t.equipment]: 1 }, 14);
      const el = h("button.mk-recruit", { type: "button", title: `${UNITS[u].name} ausbilden (${t.seconds} s)`, onclick: () => recruit(ctx, id, u) },
        ctx.icons.make("einheit", u, 36, 36), h("span.mk-recruit-name", { text: UNITS[u].name }), cost.el);
      return { u, el, cost };
    });
    const curIcon = h("span.mk-cur-icon");
    const curName = h("span");
    const fill = h("span.mk-bar-fill");
    const cur = h("div.mk-training", null, curIcon, h("div.mk-training-col", null, curName, h("span.mk-bar.mk-bar-train", null, fill)));
    const way = h("div.mk-recruits-way");
    const queue = h("div.mk-queue");
    body.append(section("Ausbildung", h("div.mk-recruits", null, ...buttons.map((b) => b.el)), cur, way, queue));
    let lastCur = "", lastWay = "", lastQ = "";
    upd.push((s) => {
      const b = get(s); if (!b) return;
      for (const x of buttons) {
        x.cost.update(s);
        const t = UNITS[x.u].train!;
        setClass(x.el, "mk-cant", s.gold < t.gold || (s.stock[t.equipment] ?? 0) < 1);
      }
      // Rekruten auf dem Weg: aus Building.recruits; fehlt das Feld, gilt der Kopf der Warteschlange als unterwegs,
      // solange nicht ausgebildet wird (die Simulation nimmt ihn erst beim Eintreten aus der Warteschlange).
      const rest = [...b.queue];
      const recruits: { unit: UnitKey; stage: "waffe" | "weg" }[] = b.recruits
        ?? (!b.training && rest.length ? [{ unit: rest[0], stage: "waffe" }] : []);
      for (const r of recruits) { const i = rest.indexOf(r.unit); if (i >= 0) rest.splice(i, 1); }

      const tr = b.training;
      const ck = tr ? `t:${tr.unit}` : recruits.length ? `w:${recruits[0].unit}` : "";
      if (ck !== lastCur) {
        lastCur = ck;
        curIcon.textContent = "";
        const shown = tr?.unit ?? recruits[0]?.unit;
        if (shown) curIcon.append(ctx.icons.make("einheit", shown, 32, 32));
        setClass(cur, "mk-idle", !tr && !recruits.length);
        setClass(cur, "mk-waiting", !tr && !!recruits.length);
      }
      // Sekunden (t und dur wie in der Simulation)
      if (tr) {
        setText(curName, `${UNITS[tr.unit].name}: wird ausgebildet, ${Math.floor((tr.t / Math.max(0.001, tr.dur)) * 100)} %`);
        setBar(fill, tr.dur ? tr.t / tr.dur : 0);
      } else if (recruits.length) {
        setText(curName, recruitText(recruits[0].unit, recruits[0].stage));
        setBar(fill, 0);
      } else { setText(curName, "Keine Ausbildung"); setBar(fill, 0); }

      // Weitere Rekruten unterwegs (der erste steht oben, solange nicht ausgebildet wird)
      const more = tr ? recruits : recruits.slice(1);
      const wk = more.map((r) => r.unit + r.stage).join(",");
      if (wk !== lastWay) {
        lastWay = wk;
        way.textContent = "";
        for (const r of more) way.append(h("div.mk-row.mk-way", null, ctx.icons.make("einheit", r.unit, 24, 24), h("span.mk-sub", { text: recruitText(r.unit, r.stage) })));
      }
      const qk = rest.join(",");
      if (qk !== lastQ) {
        lastQ = qk;
        queue.textContent = "";
        if (rest.length) {
          queue.append(h("span.mk-label", { text: "Warteschlange" }));
          for (const u of rest) queue.append(h("span.mk-qitem", { title: UNITS[u].name }, ctx.icons.make("einheit", u, 24, 24)));
        }
      }
    });
  }

  // ------------------------------------------------------------ Einheiten
  function singleUnit(u0: Unit): void {
    const def = UNITS[u0.key];
    const id = u0.id;
    body.append(head(ctx.icons.make("einheit", u0.key, 72, 72, u0.team), def.name,
      `${ROLE_NAME[def.role]}${u0.team !== 0 ? " · Feind" : ""}`, u0.team !== 0));
    const hp = hpBar();
    const state = h("span");
    const carry = h("span.mk-carry");
    body.append(section("Zustand", hp.el, h("div.mk-row", null, state, carry)));
    const stats: [string, string][] = [["Rüstung", num(def.armor)], ["Tempo", `${String(def.speed).replace(".", ",")}`]];
    if (def.damage) stats.unshift(["Schaden", `${def.damage} ${def.damageType ? DAMAGE_NAME[def.damageType] : ""}`.trim()]);
    if (def.range && def.role === "fernkampf") stats.push(["Reichweite", String(def.range).replace(".", ",")]);
    body.append(h("dl.mk-stats", null, ...stats.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])));
    let lastCarry: Good | null | undefined;
    upd.push((s) => {
      const u = s.units.find((q) => q.id === id); if (!u) return;
      hp.update(u.hp, u.maxHp);
      setText(state, orderText(s, u));
      if (u.carry !== lastCarry) {
        lastCarry = u.carry;
        carry.textContent = "";
        if (u.carry) carry.append("trägt ", ctx.icons.make("ware", u.carry, 18, 18), GOODS[u.carry].name);
      }
    });
    if (u0.team === 0) commands([u0]);
  }

  function groupView(units: Unit[]): void {
    const byKey = new Map<string, Unit[]>();
    for (const u of units) {
      const k = `${u.team}:${u.key}`;
      byKey.set(k, [...(byKey.get(k) ?? []), u]);
    }
    const allOwn = units.every((u) => u.team === 0);
    body.append(head(null, `${units.length} Einheiten`, allOwn ? "Gruppe" : "Gemischte Auswahl", false));
    const chips: { key: string; val: HTMLElement }[] = [];
    const grid = h("div.mk-chips");
    for (const [k, list] of byKey) {
      const u = list[0];
      const val = h("span.mk-num");
      const chip = h("button.mk-chip", {
        type: "button", title: `Nur ${UNITS[u.key].name} auswählen`,
        onclick: () => bridge.select({ units: list.map((q) => q.id), building: null }),
      }, ctx.icons.make("einheit", u.key, 36, 36, u.team), val);
      if (u.team !== 0) chip.classList.add("mk-enemy");
      chips.push({ key: k, val });
      grid.append(chip);
    }
    const hp = hpBar();
    body.append(section("Zusammensetzung", grid), section("Leben gesamt", hp.el));
    upd.push((s) => {
      const sel = liveUnits(s, bridge.selection().units);
      let cur = 0, max = 0;
      const count = new Map<string, number>();
      for (const u of sel) { cur += u.hp; max += u.maxHp; count.set(`${u.team}:${u.key}`, (count.get(`${u.team}:${u.key}`) ?? 0) + 1); }
      for (const c of chips) setText(c.val, `×${count.get(c.key) ?? 0}`);
      hp.update(cur, max);
    });
    const own = units.filter((u) => u.team === 0);
    if (own.length) commands(own);
  }

  function commands(units: Unit[]): void {
    const soldiers = units.filter((u) => UNITS[u.key].role !== "arbeiter");
    if (!soldiers.length) {
      body.append(h("p.mk-desc", { text: "Arbeiter folgen ihrer Arbeit. Befehle gibt es nur für Soldaten." }));
      return;
    }
    const ids = () => liveUnits(bridge.state(), bridge.selection().units).filter((u) => u.team === 0 && UNITS[u.key].role !== "arbeiter").map((u) => u.id);
    const send = (t: "stationieren" | "halten") => {
      const r = bridge.dispatch({ t, units: ids() });
      if (!r.ok) ctx.toast(r.reason ?? "Befehl nicht möglich.", "warnung");
      else if (r.reason) ctx.toast(r.reason, "info");
    };
    const canStation = soldiers.some((u) => UNITS[u.key].canStation);
    body.append(section("Befehle",
      h("div.mk-cmds", null,
        h("button.mk-btn.mk-cmd", { type: "button", title: "Auf freie Posten an Mauern und Türmen verteilen (T)", disabled: !canStation, onclick: () => send("stationieren") },
          h("span.mk-cmd-glyph.mk-g-station", { "aria-hidden": "true" }), h("span", { text: "Stationieren" }), h("kbd", { text: "T" })),
        h("button.mk-btn.mk-cmd", { type: "button", title: "Stehen bleiben und nur in Reichweite kämpfen (H)", onclick: () => send("halten") },
          h("span.mk-cmd-glyph.mk-g-hold", { "aria-hidden": "true" }), h("span", { text: "Halten" }), h("kbd", { text: "H" }))),
      h("p.mk-sub", { text: "Angreifen: Rechtsklick auf einen Gegner. Bewegen: Rechtsklick auf den Boden oder einen Wehrgang." })));
  }

  /** Titel auf eine Zeile verkleinern (bis 14 px), statt mitten im Wort umzubrechen; reicht das nicht, darf er umbrechen. */
  function fitTitle(): void {
    const t = body.querySelector<HTMLElement>(".mk-head .mk-title");
    if (!t) return;
    t.style.fontSize = "";
    t.classList.add("mk-fit");
    let size = parseFloat(getComputedStyle(t).fontSize) || 24;
    while (t.scrollWidth > t.clientWidth + 1 && size > 14) { size -= 1; t.style.fontSize = `${size}px`; }
    if (t.scrollWidth > t.clientWidth + 1) t.classList.remove("mk-fit");
  }

  // ------------------------------------------------------------ Bausteine
  function head(icon: HTMLElement | null, title: string, sub: string, enemy: boolean): HTMLElement {
    // Lange Namen (z. B. "Schwertkämpfer") passt fitTitle() nach dem Einhängen auf eine Zeile ein.
    return h(`div.mk-head${enemy ? ".mk-enemy" : ""}` as "div", null,
      icon ? h("span.mk-head-icon", null, icon) : null,
      h("div.mk-head-text", null, h("h2.mk-title", { text: title, lang: "de" }), h("p.mk-sub", { text: sub })));
  }
  function section(title: string, ...kids: (Node | null)[]): HTMLElement {
    return h("section.mk-sec", null, h("h3.mk-sec-title", { text: title }), ...kids);
  }
  function row(label: string, icon: HTMLElement | null, val: HTMLElement): HTMLElement {
    return h("div.mk-row", null, icon, h("span.mk-row-label", { text: label }), val);
  }
  function fillGoods(box: HTMLElement, goods: Partial<Record<Good, number>>, empty: string): void {
    box.textContent = "";
    const list = (Object.entries(goods) as [Good, number][]).filter(([, v]) => v > 0);
    if (!list.length) { box.append(h("span.mk-sub", { text: empty })); return; }
    for (const [g, v] of list) box.append(h("span.mk-good", { title: GOODS[g].name }, ctx.icons.make("ware", g, 20, 20), h("span.mk-num", { text: num(v) })));
  }

  return {
    el,
    update(s) {
      const next = signature(s);
      if (next !== sig) {
        sig = next;
        el.hidden = !next;
        if (next) { build(s); fitTitle(); }
      }
      if (next) for (const f of upd) f(s);
    },
  };
}

function liveUnits(s: SimState, ids: number[]): Unit[] {
  const set = new Set(ids);
  return s.units.filter((u) => set.has(u.id) && !u.dead);
}

const goodsSig = (g: Partial<Record<Good, number>>) => Object.entries(g).filter(([, v]) => v).map(([k, v]) => `${k}${v}`).join(",");

/** Rekrut unterwegs: holt die Waffe im Lager oder trägt sie zur Kaserne. */
function recruitText(unit: UnitKey, stage: "waffe" | "weg"): string {
  return stage === "waffe" ? `${UNITS[unit].name}: Tagelöhner holt die Waffe aus dem Lager` : `${UNITS[unit].name}: Tagelöhner bringt die Waffe zur Kaserne`;
}

const ACTIVITY: Record<UnitActivity, string> = {
  wartet: "Wartet",
  unterwegs: "Unterwegs",
  baut: "Baut an einer Baustelle",
  traegt: "Trägt Ware",
  faellt: "Fällt einen Baum",
  zerlegt: "Zerlegt den Stamm",
  baut_ab: "Bricht Stein",
  holt_waffe: "Holt die Waffe für die Ausbildung",
  flieht: "Flieht",
  kaempft: "Kämpft",
  wache: "Hält Wache",
  haelt: "Hält die Stellung",
  zieht_zu: "Zieht in die Siedlung",
};

/** Tätigkeit für das Panel: aus Unit.activity (Simulation), sonst grob aus dem Befehl. */
function orderText(s: SimState, u: Unit): string {
  const where = LAYER_NAME[u.layer] ?? "";
  const post = () => {
    if (u.order.t !== "station") return null;
    const id = u.order.building;
    const b = s.buildings.find((q) => q.id === id);
    return b?.key === "turm" ? "Auf Posten im Turm" : b?.key === "tor" ? "Auf Posten über dem Tor" : "Auf Posten an der Mauer";
  };
  if (u.activity) {
    switch (u.activity) {
      case "wache": return post() ?? `Hält Wache ${where}`;
      case "haelt": return `Hält die Stellung ${where}`;
      case "wartet": return u.layer > 0 ? `Wartet ${where}` : "Wartet";
      case "traegt": return u.carry ? `Trägt ${GOODS[u.carry].name}` : ACTIVITY.traegt;
      case "unterwegs": return u.order.t === "move" && u.order.layer > 0 ? "Steigt auf den Wehrgang" : post() ? "Zieht auf den Posten" : "Unterwegs";
      default: return ACTIVITY[u.activity] ?? "Bei der Arbeit";
    }
  }
  switch (u.order.t) {
    case "move": return u.order.layer > 0 ? "Steigt auf den Wehrgang" : "Unterwegs";
    case "attack": return "Greift an";
    case "station": return post() ?? "Auf Posten";
    case "hold": return `Hält die Stellung ${where}`;
    case "job": return u.carry ? `Trägt ${GOODS[u.carry].name}` : u.anim === "abbauen" ? "Bricht Stein" : u.anim === "bauen" ? "Baut an einer Baustelle" : "Bei der Arbeit";
    default: return u.layer > 0 ? `Wartet ${where}` : "Wartet";
  }
}
