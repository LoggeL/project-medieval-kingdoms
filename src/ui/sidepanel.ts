/**
 * Auswahl-Panel rechts auf Pergament. Erscheint nur bei einer Auswahl.
 * Gebäude: Zustand (Baustelle oder fertig), Arbeiter, Verarbeitung (Rezept, Eingangspuffer, Fortschritt, Ausgabestapel,
 * Stillstandsgrund, Anhalten; ADR 0011), Hofstapel, Lagerplätze, Ausbildung, Abreißen.
 * Bergfried: Stufe, Steuern, Ausbau (Kosten, fehlende Forschung, Fortschritt), laufende Forschung und der Forschungsbaum.
 * Einheiten: einzeln (Werte, Auftrag) oder als Gruppe (Anzahl je Typ), Befehlsleiste (src/ui/befehle.ts): Stationieren,
 * Angriffsmarsch, Patrouille, Rückzug, Formation und Haltung.
 * Tasten (src/data/hotkeys.ts): Ausbilden U I O, Abreißen Entf (zweimal), Stationieren T, Halten H, im Bergfried
 * Ausbauen G und Forschungsbaum F („Forschung abbrechen“ bleibt ohne Taste, damit kein Fortschritt aus Versehen verfällt).
 * Der Aufbau wird nur neu erzeugt, wenn sich die Auswahl oder ihre Form ändert; sonst werden Werte aktualisiert.
 */
import { BUILDINGS, GOODS, RECIPES, TECHS, UNITS, levelDef, recipesOf, type Good, type RecipeKey, type UnitKey } from "../data";
import { inputCap, outputCap, procProgress, procReason } from "../sim/production";
import { incomeOf, levelOf, lockedBy, nextLevel, upgradeMissing } from "../sim/research";
import type { Building, SimState, Unit, UnitActivity } from "../sim/types";
import { h, num, setBar, setClass, setText } from "./dom";
import { BUTTON_KEYS, TRAIN_KEYS } from "../data/hotkeys";
import { setKey } from "./hotkeys";
import { DAMAGE_NAME, ROLE_NAME } from "./roster";
import { cancelTech, researchText, techIcon } from "./research";
import { costRow, hpBar, type UiCtx } from "./shared";
import { recruit } from "./unitgrid";
import { createCommandBar } from "./befehle";

const CAT_NAME = { zentrum: "Sitz des Burgherrn", wirtschaft: "Wirtschaft", nahrung: "Nahrung", wohnen: "Wohnen", militaer: "Militär", befestigung: "Befestigung" } as const;
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
      return b ? `b${b.id}:${b.key}:${b.built >= 1 ? 1 : 0}:${b.team}:${levelOf(b)}:${b.upgrade ? 1 : 0}` : "";
    }
    const units = liveUnits(s, sel.units);
    if (units.length === 1) return `u${units[0].id}`;
    return units.length ? `g${units.map((u) => u.key + u.team).sort().join(",")}` : "";
  }

  // ------------------------------------------------------------ Gebäude
  function buildingView(b0: Building): void {
    const def = BUILDINGS[b0.key];
    const ld = levelDef(b0.key, levelOf(b0));
    const id = b0.id;
    const get = (s: SimState) => s.buildings.find((q) => q.id === id);
    body.append(head(ctx.icons.make("gebaeude", def.levels ? ld.sprite : b0.key, 72, 72, b0.team), ld.name,
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
      upd.push((s) => { const b = get(s); if (b) hp.update(b.hp, ld.hp); });
    }

    if (def.seat && b0.built >= 1 && b0.team === 0) seatView(b0);

    if (def.workers && b0.built >= 1) {
      const val = h("span.mk-num");
      body.append(row(`${UNITS[def.workers.unit].name}`, ctx.icons.make("einheit", def.workers.unit, 24, 24), val));
      upd.push((s) => { const b = get(s); if (b) setText(val, `${b.workers.length} / ${def.workers!.count}`); });
    }

    if (def.production && b0.proc && b0.built >= 1 && b0.team === 0) productionView(b0);

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

    if (ld.housing && b0.built >= 1) body.append(row("Wohnraum", null, h("span.mk-num", { text: `${ld.housing} Bewohner` })));

    if ((ld.walkway || def.stairs) && b0.built >= 1) {
      const posts = ld.posts?.length ?? 0;
      const val = h("span.mk-num");
      const info = def.stairs ? "Führt hinauf auf den Wehrgang."
        : def.gate ? "Tor für eigene Leute, oben läuft der Wehrgang weiter."
        : def.seat ? "Wehrplattform auf dem Bergfried: Schützen schießen von hier am weitesten. Hinauf geht es durch die Tür."
        : (ld.walkway ?? 0) >= 2 ? "Turmplattform über dem Wehrgang: Schützen schießen von hier am weitesten."
        : "Begehbarer Wehrgang mit Zinnen. Zugang über eine Treppe oder einen Turm.";
      body.append(section("Wehrbau", h("p.mk-sub", { text: info }), posts ? row("Besetzte Posten", null, val) : null));
      if (posts) upd.push((s) => {
        const n = s.units.filter((u) => !u.dead && u.order.t === "station" && u.order.building === id).length;
        setText(val, `${n} / ${posts}`);
      });
    }

    if (def.trains && b0.built >= 1 && b0.team === 0) trainingView(id, def.trains);

    body.append(h("p.mk-desc", { text: def.levels?.[levelOf(b0) - 1]?.desc ?? def.desc }));

    if (b0.team === 0 && !def.seat) {
      let armed = false;
      const lbl = h("span", { text: "Abreißen" });
      const btn = h("button.mk-btn.mk-btn-wide.mk-btn-danger", { type: "button", title: "Gebäude abreißen (zweimal drücken)", onclick: () => {
        if (!armed) { armed = true; setText(lbl, "Wirklich abreißen?"); setTimeout(() => { armed = false; setText(lbl, "Abreißen"); }, 2500); return; }
        const r = bridge.dispatch({ t: "abreissen", id });
        if (!r.ok) ctx.toast(r.reason ?? "Abriss nicht möglich.", "warnung");
        else { if (r.reason) ctx.toast(r.reason, "info"); bridge.select({ units: [], building: null }); }
      } }, lbl);
      setKey(btn, BUTTON_KEYS.abriss);
      body.append(h("div.mk-actions", null, btn));
    }
  }

  // ------------------------------------------------------------ Verarbeitung (Mühle, Bäckerei, …)
  function productionView(b0: Building): void {
    const id = b0.id;
    const get = (s: SimState) => s.buildings.find((q) => q.id === id);
    const list = recipesOf(b0.key);
    const recipeLine = (k: RecipeKey) => {
      const r = RECIPES[k];
      const side = (st: Partial<Record<Good, number>>) => (Object.keys(st) as Good[]).flatMap((g) => [
        h("span.mk-num", { text: `${st[g]}` }), ctx.icons.make("ware", g, 22, 22)]);
      return h("div.mk-recipe", { title: `${r.name}: ${r.seconds} s je Arbeitsgang` }, ...side(r.inputs), h("span.mk-recipe-arrow", { text: "→" }),
        ...side(r.outputs), h("span.mk-sub", { text: `${r.seconds} s` }));
    };
    // Rezept: fest, oder Auswahl, wenn das Gebäude mehrere kennt
    const recipeBtns = list.length > 1 ? list.map((k) => {
      const b = h("button.mk-btn.mk-recipe-btn", { type: "button", title: RECIPES[k].name, onclick: () => {
        const r = bridge.dispatch({ t: "rezept", building: id, recipe: k });
        if (!r.ok) ctx.toast(r.reason ?? "Rezept nicht möglich.", "warnung");
      } }, recipeLine(k));
      return { k, b };
    }) : [];
    const recipeBox = h("div.mk-recipes", null, ...(recipeBtns.length ? recipeBtns.map((x) => x.b) : [recipeLine(b0.proc!.recipe)]));
    // Eingangspuffer und Ausgabestapel je Ware, Fortschritt des laufenden Arbeitsgangs
    const goodRow = (g: Good) => {
      const val = h("span.mk-num"), inc = h("span.mk-inc"), fill = h("span.mk-bar-fill");
      const el = h("div.mk-row", { title: GOODS[g].name }, ctx.icons.make("ware", g, 24, 24), h("span.mk-bar.mk-bar-stock", null, fill), val, inc);
      return { g, el, val, inc, fill };
    };
    const ins = new Map<RecipeKey, ReturnType<typeof goodRow>[]>();
    const outs = new Map<RecipeKey, ReturnType<typeof goodRow>[]>();
    for (const k of list) {
      ins.set(k, (Object.keys(RECIPES[k].inputs) as Good[]).map(goodRow));
      outs.set(k, (Object.keys(RECIPES[k].outputs) as Good[]).map(goodRow));
    }
    const inBox = h("div.mk-proc-goods"), outBox = h("div.mk-proc-goods");
    const pFill = h("span.mk-bar-fill"), pPct = h("span.mk-bar-label");
    const why = h("p.mk-sub.mk-proc-why");
    const pauseLbl = h("span", { text: "Anhalten" });
    const pause = h("button.mk-btn.mk-btn-wide", { type: "button", title: "Verarbeitung anhalten: keine Anlieferung, kein neuer Arbeitsgang", onclick: () => {
      const b = get(bridge.state());
      if (b?.proc) bridge.dispatch({ t: "produktion", building: id, an: !!b.proc.paused });
    } }, pauseLbl);
    body.append(section("Verarbeitung", recipeBox,
      h("p.mk-label", { text: "Vorrat" }), inBox,
      h("span.mk-bar.mk-bar-build", null, pFill, pPct),
      h("p.mk-label", { text: "Fertig, wartet auf Träger" }), outBox,
      why, h("div.mk-actions", null, pause)));
    let shown: RecipeKey | null = null;
    upd.push((s) => {
      const b = get(s); const p = b?.proc; if (!b || !p) return;
      if (shown !== p.recipe) {
        shown = p.recipe;
        inBox.replaceChildren(...ins.get(p.recipe)!.map((x) => x.el));
        outBox.replaceChildren(...outs.get(p.recipe)!.map((x) => x.el));
      }
      for (const x of recipeBtns) setClass(x.b, "mk-on", x.k === p.recipe);
      for (const x of ins.get(p.recipe)!) {
        const n = p.in[x.g] ?? 0, cap = inputCap(b, x.g), on = (p.enroute[x.g] ?? 0) - (p.picked[x.g] ?? 0);
        setText(x.val, `${n} / ${cap}`);
        setText(x.inc, on > 0 ? `+${on}` : "");
        setBar(x.fill, cap ? n / cap : 0);
      }
      for (const x of outs.get(p.recipe)!) {
        const n = p.out[x.g] ?? 0, cap = outputCap(b, x.g);
        setText(x.val, `${n} / ${cap}`);
        setText(x.inc, "");
        setBar(x.fill, cap ? n / cap : 0);
      }
      const prog = procProgress(s, b);
      setBar(pFill, prog);
      setText(pPct, p.busy ? `${Math.floor(prog * 100)} %` : "ruht");
      const reason = procReason(s, b);
      setText(why, reason ?? `${RECIPES[p.recipe].name}: läuft. ${p.done} Arbeitsgänge fertig.`);
      setClass(why, "mk-warn", !!reason && p.why?.k !== "unterwegs");
      setText(pauseLbl, p.paused ? "Fortsetzen" : "Anhalten");
      setClass(pause, "mk-on", !!p.paused);
    });
  }

  // ------------------------------------------------------------ Bergfried: Stufe, Ausbau, Forschung
  function seatView(b0: Building): void {
    const def = BUILDINGS[b0.key];
    const id = b0.id;
    const get = (s: SimState) => s.buildings.find((q) => q.id === id);
    const lv = levelOf(b0), max = def.levels?.length ?? 1;
    const tax = h("span.mk-num");
    body.append(section("Sitz des Burgherrn",
      h("div.mk-level", null, h("span.mk-level-pips", null, ...Array.from({ length: max }, (_, i) => h(`span.mk-level-pip${i < lv ? ".mk-on" : ""}` as "span"))),
        h("span", { text: `Stufe ${lv} von ${max}` })),
      row("Steuern", null, tax),
      h("p.mk-sub", { text: "Fällt der Bergfried, ist die Burg verloren." })));
    upd.push((s) => setText(tax, `${String(Math.round(incomeOf(s) * 10) / 10).replace(".", ",")} Gold je Minute`));

    const nx = nextLevel(b0);
    if (b0.upgrade) {
      // Ausbau läuft: Material wie auf einer Baustelle, dann baut ein Tagelöhner
      const fill = h("span.mk-bar-fill");
      const pct = h("span.mk-bar-label");
      const missing = h("div.mk-goods");
      const site = h("div.mk-goods");
      body.append(section(`Ausbau: ${nx?.name ?? ""}`, h("span.mk-bar.mk-bar-build", null, fill, pct),
        h("p.mk-label", { text: "Fehlt noch" }), missing, h("p.mk-label", { text: "Liegt bereit" }), site));
      let lastNeeds: string | null = null, lastSite: string | null = null;
      upd.push((s) => {
        const b = get(s); if (!b?.upgrade) return;
        setBar(fill, b.upgrade.t);
        setText(pct, `${Math.floor(b.upgrade.t * 100)} %`);
        const n = goodsSig(b.needs), t = goodsSig(b.site);
        if (n !== lastNeeds) { lastNeeds = n; fillGoods(missing, b.needs, "Alles angeliefert, es wird gebaut."); }
        if (t !== lastSite) { lastSite = t; fillGoods(site, b.site, "Noch nichts angeliefert."); }
      });
    } else if (nx?.upgrade) {
      const up = nx.upgrade;
      const cost = costRow(ctx, up.cost, 16);
      const miss = h("ul");
      const go = h("button.mk-btn.mk-btn-wide", { type: "button", text: "Ausbauen", onclick: () => {
        const r = bridge.dispatch({ t: "ausbauen", building: id });
        if (!r.ok) ctx.toast(r.reason ?? "Ausbau nicht möglich.", "warnung");
        else if (r.reason) ctx.toast(r.reason, "info");
      } });
      setKey(go, BUTTON_KEYS.ausbauen);
      const gain: string[] = [`${nx.hp} Leben`];
      if (nx.housing) gain.push(`${nx.housing} Wohnraum`);
      if (nx.income) gain.push(`${nx.income} Gold Steuern je Minute`);
      if (nx.posts?.length) gain.push(`${nx.posts.length} Posten für Schützen`);
      body.append(section("Ausbau",
        h("div.mk-next", null, h("strong", { text: nx.name }), h("span", { text: nx.desc }), h("span.mk-sub", { text: `Danach: ${gain.join(", ")}.` }),
          h("div.mk-row", null, h("span.mk-row-label", { text: `Kosten (${up.seconds} s Bauzeit)` }), cost.el), miss),
        go));
      let lastMiss = "";
      upd.push((s) => {
        const b = get(s); if (!b) return;
        cost.update(s);
        const m = upgradeMissing(s, b);
        const sig = m.join("|");
        if (sig !== lastMiss) { lastMiss = sig; miss.textContent = ""; for (const x of m) miss.append(h("li", { text: x })); }
        go.disabled = m.length > 0;
        if (go.dataset.sig !== sig) {
          go.dataset.sig = sig;
          // Tooltip über setKey (hängt die Taste an); gesperrt meldet die Taste, was fehlt (data-locked)
          go.dataset.baseTitle = m.length ? m.join(", ") : `Ausbau: ${nx.name}. Gold sofort, das Material tragen Tagelöhner herbei.`;
          if (m.length) go.dataset.locked = `Ausbau nicht möglich: ${m.join(", ")}.`; else delete go.dataset.locked;
          setKey(go, BUTTON_KEYS.ausbauen);
        }
      });
    } else {
      body.append(section("Ausbau", h("p.mk-sub", { text: "Der Bergfried hat seine höchste Stufe erreicht." })));
    }

    // Forschung: laufende Technik, Abbrechen, Forschungsbaum
    const curIcon = h("span.mk-cur-icon");
    const curText = h("span");
    const fill = h("span.mk-bar-fill");
    const cur = h("div.mk-training", null, curIcon, h("div.mk-training-col", null, curText, h("span.mk-bar.mk-bar-train", null, fill)));
    const stop = h("button.mk-btn.mk-btn-wide", { type: "button", text: "Forschung abbrechen", onclick: () => cancelTech(ctx) });
    const open = h("button.mk-btn.mk-btn-wide", { type: "button", title: "Forschungsbaum öffnen", onclick: () => ctx.research?.toggle(true) },
      h("span", { text: "Forschungsbaum öffnen" }));
    // F wertet der Forschungsbaum selbst aus (src/ui/research.ts), der Knopf leuchtet nur auf
    setKey(open, BUTTON_KEYS.forschung, { app: true });
    const done = h("p.mk-sub");
    body.append(section("Forschung", cur, done, open, stop));
    let lastKey = "";
    upd.push((s) => {
      const rc = s.research.cur;
      const k = rc?.key ?? "";
      if (k !== lastKey) { lastKey = k; curIcon.textContent = ""; if (rc) curIcon.append(techIcon(rc.key, 32)); }
      setClass(cur, "mk-idle", !rc);
      setText(curText, researchText(s));
      setBar(fill, rc && rc.dur ? rc.t / rc.dur : 0);
      stop.hidden = !rc;
      const n = s.research.done.length;
      setText(done, n ? `Erforscht: ${s.research.done.map((t) => TECHS[t].name).join(", ")}` : "Noch nichts erforscht.");
    });
  }

  function trainingView(id: number, trains: UnitKey[]): void {
    const get = (s: SimState) => s.buildings.find((q) => q.id === id);
    const buttons = trains.map((u, i) => {
      const t = UNITS[u].train!;
      const cost = costRow(ctx, { gold: t.gold, [t.equipment]: 1 }, 14);
      const el = h("button.mk-recruit", { type: "button", title: `${UNITS[u].name} ausbilden (${t.seconds} s)`, onclick: () => recruit(ctx, id, u) },
        ctx.icons.make("einheit", u, 36, 36), h("span.mk-recruit-name", { text: UNITS[u].name }), cost.el);
      setKey(el, i < TRAIN_KEYS.length ? [TRAIN_KEYS[i]] : null);
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
        const need = lockedBy(s, UNITS[x.u]);
        x.el.title = need ? `${UNITS[x.u].name}: erst erforschen (${TECHS[need].name})` : `${UNITS[x.u].name} ausbilden (${t.seconds} s)`;
        setClass(x.el, "mk-cant", !!need || s.gold < t.gold || (s.stock[t.equipment] ?? 0) < 1);
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
    // Befehlsleiste, Formation und Haltung (src/ui/befehle.ts, ADR 0018)
    const bar = createCommandBar(ctx, soldiers, section);
    body.append(...bar.sections);
    upd.push((s) => bar.update(s));
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
  function section(title: string | HTMLElement, ...kids: (Node | null)[]): HTMLElement {
    return h("section.mk-sec", null, typeof title === "string" ? h("h3.mk-sec-title", { text: title }) : h("h3.mk-sec-title", null, title), ...kids);
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
  verarbeitet: "Arbeitet in der Werkstatt",
  holt_waffe: "Holt die Waffe für die Ausbildung",
  flieht: "Flieht",
  kaempft: "Kämpft",
  wache: "Hält Wache",
  haelt: "Hält die Stellung",
  zieht_zu: "Zieht in die Siedlung",
  marschiert: "Angriffsmarsch",
  patrouilliert: "Patrouilliert",
  zieht_zurueck: "Zieht sich zum Bergfried zurück",
};

/** Tätigkeit für das Panel: aus Unit.activity (Simulation), sonst grob aus dem Befehl. */
function orderText(s: SimState, u: Unit): string {
  const where = LAYER_NAME[u.layer] ?? "";
  const post = () => {
    if (u.order.t !== "station") return null;
    const id = u.order.building;
    const b = s.buildings.find((q) => q.id === id);
    return b?.key === "turm" ? "Auf Posten im Turm" : b?.key === "tor" ? "Auf Posten über dem Tor"
      : b && BUILDINGS[b.key].seat ? "Auf Posten auf dem Bergfried" : "Auf Posten an der Mauer";
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
