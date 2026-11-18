/**
 * Kopfleiste (dunkles Eichenholz mit Eisenbeschlägen): Waren nach Gruppen (GOOD_GROUPS: Rohstoffe, Waffen, Nahrung),
 * je Ware die frei verfügbare Menge (state.free, wie die Simulation beim Bauen rechnet) und, falls etwas verplant ist,
 * als kleines Schild an der Zelle „+n“ verplant (Tooltip: Bestand, verplant, frei); dazu
 * Gold, Bevölkerung, Bestand und Kapazität je Lagertyp (STORES: Lagerhaus, Kornkammer), aktuelle Ereignisse mit
 * Überfall-Countdown, Geschwindigkeit, Drehen mit Kompass, Zoom, Klang und Hilfe. Neue Waren und Lagertypen erscheinen
 * hier aus den Daten, ohne Änderung an dieser Datei.
 */
import { BUILDINGS, FOOD, GOODS, GOOD_GROUPS, GOOD_KEYS, RATIONS, STORES, STORE_KEYS, TICKS_PER_SECOND, type BuildingKey, type Good, type StoreKey } from "../data";
import { ZOOMS, zoomLabel } from "../data/view";
import { foodSeconds } from "../sim/food";
import type { SimState } from "../sim/types";
import { createAudioControl } from "./audio";
import { northOnScreen } from "./compass";
import { clock, h, num, setAttr, setBar, setClass, setText } from "./dom";
import { coin, freeOf, type UiCtx } from "./shared";

export interface TopBar { el: HTMLElement; update(s: SimState): void; updateView(): void; updateSpeed(): void; updateAudio(): void }

export function createTopBar(ctx: UiCtx, openHelp: () => void, openMenu?: () => void): TopBar {
  const { bridge, icons } = ctx;

  const goodCell = (g: Good) => {
    const val = h("span.mk-num");
    const res = h("span.mk-num.mk-res-verplant");
    res.hidden = true;
    const el = h("div.mk-res", { title: GOODS[g].name }, icons.make("ware", g, 24, 24), val, res);
    return { g, el, val, res };
  };
  const groups = GOOD_GROUPS.map((gr) => ({ gr, cells: GOOD_KEYS.filter((g) => GOODS[g].group === gr.key).map(goodCell) }))
    .filter((x) => x.cells.length);
  const cells = groups.flatMap((x) => x.cells);

  const goldVal = h("span.mk-num");
  const gold = h("div.mk-res.mk-res-gold", { title: "Gold" }, coin(), goldVal);

  const popVal = h("span.mk-num");
  const pop = h("div.mk-res", { title: "Bevölkerung / Wohnraum" }, icons.make("einheit", "tageloehner", 24, 24), popVal);

  // Nahrung (ADR 0013): essbarer Vorrat und Verbrauch je Minute; warnt bei Hunger und wenn der Vorrat bald endet
  const foodVal = h("span.mk-num");
  const foodRate = h("span.mk-food-rate.mk-num");
  const food = h("div.mk-res.mk-res-food", { title: "Nahrung" }, icons.make("gebaeude", "bauernhof", 28, 28),
    h("span.mk-cap-col", null, foodVal, foodRate));

  // Bestand / Kapazität je Lagertyp, mit dem Bild des Lagers, das diesen Typ aufnimmt
  const storeBuilding = (k: StoreKey): BuildingKey =>
    (Object.keys(BUILDINGS) as BuildingKey[]).find((b) => (BUILDINGS[b].storage?.kind ?? (BUILDINGS[b].storage ? "material" : null)) === k && !BUILDINGS[b].seat) ?? "lager";
  const caps = STORE_KEYS.map((k) => {
    const val = h("span.mk-num");
    const fill = h("span.mk-bar-fill");
    const el = h(`div.mk-res.mk-res-cap.mk-res-cap-${k}` as "div", { title: `${STORES[k].name}: Bestand / Kapazität` },
      icons.make("gebaeude", storeBuilding(k), 28, 28),
      h("span.mk-cap-col", null, val, h("span.mk-bar.mk-bar-cap", null, fill)));
    return { k, el, val, fill };
  });

  // Ereignisse: neueste Meldung und Überfall
  const evText = h("span.mk-ev-text");
  const raidLabel = h("span.mk-raid-label");
  const raidTime = h("span.mk-raid-time.mk-num");
  const raidNextTime = h("span");
  const raidNext = h("span.mk-raid-next", null, " · ", h("span.mk-raid-next-pre", { text: "nächste in " }), raidNextTime);
  const raidText = h("span.mk-raid", null, raidLabel, raidTime, raidNext);
  const events = h("div.mk-events", null, raidText, evText);

  // Steuerknöpfe
  const btn = (label: string, title: string, fn: () => void, cls = "") =>
    h(`button.mk-btn${cls}` as "button", { type: "button", title, "aria-label": title, onclick: fn, text: label });
  const speedBtns = [
    btn("❚❚", "Pause (Leertaste)", () => bridge.setSpeed(0)),
    btn("1×", "Normale Geschwindigkeit (Leertaste: Pause/Weiter)", () => bridge.setSpeed(1)),
    btn("2×", "Doppelte Geschwindigkeit", () => bridge.setSpeed(2)),
  ];
  // Kompass: die Nadel zeigt, wohin Norden (Welt −y) im Bild tatsächlich zeigt.
  const needle = h("span.mk-needle", { "aria-hidden": "true" });
  const nLabel = h("span.mk-compass-n", { "aria-hidden": "true", text: "N" });
  const compass = h("span.mk-compass", { role: "img" }, needle, nLabel);
  const rot = h("div.mk-group", { role: "group", "aria-label": "Drehen" },
    btn("⟲", "Ansicht gegen den Uhrzeigersinn drehen (Q)", () => bridge.rotate(-1), ".mk-btn-rot"), compass,
    btn("⟳", "Ansicht im Uhrzeigersinn drehen (E)", () => bridge.rotate(1), ".mk-btn-rot"));
  const zoomOut = btn("−", "Herauszoomen (Mausrad, Taste −)", () => bridge.zoom(-1));
  const zoomIn = btn("+", "Hineinzoomen (Mausrad, Taste +)", () => bridge.zoom(1));
  const zoomVal = h("span.mk-zoom-val.mk-num", { "aria-live": "polite" });
  const zoom = h("div.mk-group", { role: "group", "aria-label": "Zoom" }, zoomOut, zoomVal, zoomIn);
  const audio = createAudioControl(bridge);
  const help = btn("?", "Steuerung und Hilfe (F1)", openHelp, ".mk-btn-help");
  const menu = openMenu ? btn("☰", "Spielmenü: Speichern, Laden, Einstellungen, Hauptmenü (Esc, wenn nichts gewählt ist)", openMenu, ".mk-btn-menu") : null;

  const el = h("header.mk-top.mk-wood", null,
    h("div.mk-top-res", null,
      ...groups.flatMap((x) => [h(`div.mk-res-group.mk-res-group-${x.gr.key}` as "div", { "aria-label": x.gr.label }, ...x.cells.map((r) => r.el)), h("span.mk-sep")]),
      gold, pop, food, ...caps.map((c) => c.el)),
    events,
    h("div.mk-top-ctl", null,
      h("div.mk-group", { role: "group", "aria-label": "Geschwindigkeit" }, ...speedBtns),
      rot, zoom, audio.el, help, menu));

  let lastMsg = -1;
  return {
    el,
    update(s) {
      for (const r of cells) {
        const all = s.stock[r.g] ?? 0, free = Math.min(all, freeOf(s, r.g)), held = all - free;
        setText(r.val, num(free));
        setText(r.res, `+${num(held)}`);
        r.res.hidden = held <= 0;
        setAttr(r.el, "title", held > 0
          ? `${GOODS[r.g].name}: ${num(free)} frei, ${num(held)} verplant (Baustellen, Forschung, Werkstätten, Rekruten), ${num(all)} im Lager`
          : `${GOODS[r.g].name}: ${num(all)} im Lager, alles frei`);
      }
      setText(goldVal, num(s.gold));
      setText(popVal, `${num(s.population)}/${num(s.housing)}`);
      setClass(pop, "mk-warn", s.population >= s.housing);
      const f = s.food;
      if (f) {
        const left = foodSeconds(f);
        const kinds = (Object.keys(FOOD.goods) as Good[]).map((g) => `${GOODS[g].name} ${num(s.stock[g] ?? 0)}`).join(", ");
        setText(foodVal, num(f.stock));
        setText(foodRate, `−${f.perMinute.toLocaleString("de-DE", { maximumFractionDigits: 1 })}/min`);
        setClass(food, "mk-warn", f.hunger > 0 || left < 60);
        setClass(food, "mk-food-hunger", f.hunger > 0);
        setAttr(food, "title", `Nahrung: ${num(f.stock)} Portionen (${kinds}). Verbrauch ${f.perMinute.toLocaleString("de-DE", { maximumFractionDigits: 1 })} je Minute, Rationen ${RATIONS[f.ration].name}. `
          + (f.hunger > 0 ? "Die Leute hungern!" : Number.isFinite(left) ? `Reicht etwa ${clock(left)}.` : "Niemand isst."));
      }
      food.hidden = !f;
      for (const c of caps) {
        const st = s.stores?.[c.k] ?? { used: 0, cap: 0 };
        setText(c.val, `${num(st.used)}/${num(st.cap)}`);
        setBar(c.fill, st.cap ? st.used / st.cap : 0);
        setClass(c.el, "mk-warn", st.cap > 0 && st.used >= st.cap * 0.9);
      }

      // Überfall: raid.next ist der Tick der nächsten Welle, auch während eine Welle läuft.
      const secs = (s.raid.next - s.tick) / TICKS_PER_SECOND;
      if (s.outcome && !s.raid.active) {
        // Partie entschieden: keine Wellen mehr (ADR 0019). Kurz und im Zeitfeld, das in jeder Breite sichtbar ist
        setText(raidLabel, "");
        setText(raidTime, s.outcome === "sieg" ? "Tal gesichert" : "Burg gefallen");
        raidNext.hidden = true;
        setAttr(raidText, "title", s.outcome === "sieg" ? "Alle Ziele erreicht: Es kommen keine Überfälle mehr." : "Der Bergfried ist gefallen.");
        setClass(raidText, "mk-raid-active", false);
      } else if (s.raid.active) {
        setText(raidLabel, "Überfall! ");
        setText(raidTime, `Welle ${s.raid.wave}`);
        setText(raidNextTime, clock(secs));
        raidNext.hidden = false;
        setAttr(raidText, "title", `Überfall läuft: Welle ${s.raid.wave}. Die nächste Welle (${s.raid.wave + 1}) kommt in ${clock(secs)}.`);
        setClass(raidText, "mk-raid-active", true);
      } else {
        setText(raidLabel, "Nächster Überfall in ");
        setText(raidTime, clock(secs));
        raidNext.hidden = true;
        setAttr(raidText, "title", `Nächster Überfall in ${clock(secs)} (Welle ${s.raid.wave + 1})`);
        setClass(raidText, "mk-raid-active", false);
      }
      setClass(raidText, "mk-raid-soon", !s.outcome && secs < 30);
      setClass(raidText, "mk-raid-ende", !!s.outcome && !s.raid.active);
      setClass(raidText, "mk-raid-sieg", s.outcome === "sieg");
      const m = s.messages[s.messages.length - 1];
      const key = m ? m.tick * 31 + s.messages.length : -1;
      if (key !== lastMsg) {
        lastMsg = key;
        setText(evText, m ? m.text : "");
        evText.className = `mk-ev-text mk-msg-${m?.kind ?? "info"}`;
        setAttr(evText, "title", m ? m.text : null);
      }
    },
    updateView() {
      const v = bridge.view();
      const z = v.zoom;
      setText(zoomVal, zoomLabel(z));
      setAttr(zoomVal, "title", `Zoomstufe ${zoomLabel(z)} (${ZOOMS.map(zoomLabel).join(", ")})`);
      setClass(zoomOut, "mk-disabled", z <= ZOOMS[0]);
      setClass(zoomIn, "mk-disabled", z >= ZOOMS[ZOOMS.length - 1]);
      const r = v.r & 3;
      const n = northOnScreen(r);
      needle.style.transform = `translate(-50%, -50%) rotate(${n.deg}deg)`;
      // "N" sitzt außen an der Nadelspitze
      const rad = (n.deg * Math.PI) / 180;
      nLabel.style.left = `${50 + Math.sin(rad) * 33}%`;
      nLabel.style.top = `${50 - Math.cos(rad) * 33}%`;
      const label = `Kompass: Norden liegt ${n.where} (Ansicht ${r + 1} von 4)`;
      setAttr(compass, "title", label);
      setAttr(compass, "aria-label", label);
    },
    updateSpeed() {
      const v = bridge.speed();
      speedBtns.forEach((b, i) => { setClass(b, "mk-on", v === i); setAttr(b, "aria-pressed", String(v === i)); });
    },
    updateAudio: () => audio.update(),
  };
}
