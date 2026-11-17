/**
 * Kopfleiste (dunkles Eichenholz mit Eisenbeschlägen): Waren, Waffen, Gold, Bevölkerung, Lager,
 * aktuelle Ereignisse mit Überfall-Countdown, Geschwindigkeit, Drehen, Zoom und Hilfe.
 */
import { GOODS, TICKS_PER_SECOND, type Good } from "../data";
import type { SimState } from "../sim/types";
import { clock, h, num, setAttr, setBar, setClass, setText } from "./dom";
import { coin, type UiCtx } from "./shared";

const ROT_LABEL = ["Norden oben", "Osten oben", "Süden oben", "Westen oben"];
const ROT_SHORT = ["N", "O", "S", "W"];

export interface TopBar { el: HTMLElement; update(s: SimState): void; updateView(): void; updateSpeed(): void }

export function createTopBar(ctx: UiCtx, openHelp: () => void): TopBar {
  const { bridge, icons } = ctx;

  const goodCell = (g: Good) => {
    const val = h("span.mk-num");
    const el = h("div.mk-res", { title: GOODS[g].name }, icons.make("ware", g, 24, 24), val);
    return { g, el, val };
  };
  const raw = (["holz", "stein", "eisen"] as Good[]).map(goodCell);
  const arms = (["speer", "schwert", "bogen"] as Good[]).map(goodCell);

  const goldVal = h("span.mk-num");
  const gold = h("div.mk-res.mk-res-gold", { title: "Gold" }, coin(), goldVal);

  const popVal = h("span.mk-num");
  const pop = h("div.mk-res", { title: "Bevölkerung / Wohnraum" }, icons.make("einheit", "tageloehner", 24, 24), popVal);

  const capVal = h("span.mk-num");
  const capFill = h("span.mk-bar-fill");
  const cap = h("div.mk-res.mk-res-cap", { title: "Lagerbestand / Lagerkapazität" },
    icons.make("gebaeude", "lager", 28, 28),
    h("span.mk-cap-col", null, capVal, h("span.mk-bar.mk-bar-cap", null, capFill)));

  // Ereignisse: neueste Meldung und Überfall
  const evText = h("span.mk-ev-text");
  const raidLabel = h("span.mk-raid-label");
  const raidTime = h("span.mk-raid-time");
  const raidText = h("span.mk-raid", null, raidLabel, raidTime);
  const events = h("div.mk-events", null, raidText, evText);

  // Steuerknöpfe
  const btn = (label: string, title: string, fn: () => void, cls = "") =>
    h(`button.mk-btn${cls}` as "button", { type: "button", title, "aria-label": title, onclick: fn, text: label });
  const speedBtns = [
    btn("❚❚", "Pause (Leertaste)", () => bridge.setSpeed(0)),
    btn("1×", "Normale Geschwindigkeit", () => bridge.setSpeed(1)),
    btn("2×", "Doppelte Geschwindigkeit", () => bridge.setSpeed(2)),
  ];
  const compass = h("span.mk-compass", { title: "Kameradrehung" });
  const rot = h("div.mk-group", { role: "group", "aria-label": "Drehen" },
    btn("⟲", "Ansicht nach links drehen (Q)", () => bridge.rotate(-1)), compass,
    btn("⟳", "Ansicht nach rechts drehen (E)", () => bridge.rotate(1)));
  const zoom = h("div.mk-group", { role: "group", "aria-label": "Zoom" },
    btn("−", "Herauszoomen (Mausrad)", () => bridge.zoom(-1)),
    btn("+", "Hineinzoomen (Mausrad)", () => bridge.zoom(1)));
  const help = btn("?", "Steuerung und Hilfe (F1)", openHelp, ".mk-btn-help");

  const el = h("header.mk-top.mk-wood", null,
    h("div.mk-top-res", null,
      h("div.mk-res-group", { "aria-label": "Rohstoffe" }, ...raw.map((r) => r.el)),
      h("span.mk-sep"),
      h("div.mk-res-group", { "aria-label": "Waffen" }, ...arms.map((r) => r.el)),
      h("span.mk-sep"),
      gold, pop, cap),
    events,
    h("div.mk-top-ctl", null,
      h("div.mk-group", { role: "group", "aria-label": "Geschwindigkeit" }, ...speedBtns),
      rot, zoom, help));

  let lastMsg = -1;
  return {
    el,
    update(s) {
      for (const r of [...raw, ...arms]) setText(r.val, num(s.stock[r.g] ?? 0));
      setText(goldVal, num(s.gold));
      setText(popVal, `${num(s.population)}/${num(s.housing)}`);
      setClass(pop, "mk-warn", s.population >= s.housing);
      const total = (Object.values(s.stock) as number[]).reduce((a, b) => a + b, 0);
      setText(capVal, `${num(total)}/${num(s.capacity)}`);
      setBar(capFill, s.capacity ? total / s.capacity : 0);
      setClass(cap, "mk-warn", s.capacity > 0 && total >= s.capacity * 0.9);

      // Überfall: raid.next ist der Tick des nächsten Überfalls.
      if (s.raid.active) {
        setText(raidLabel, "Überfall! ");
        setText(raidTime, `Welle ${s.raid.wave}`);
        setAttr(raidText, "title", `Überfall läuft: Welle ${s.raid.wave}`);
        setClass(raidText, "mk-raid-active", true);
      } else {
        const secs = (s.raid.next - s.tick) / TICKS_PER_SECOND;
        setText(raidLabel, "Nächster Überfall in ");
        setText(raidTime, clock(secs));
        setAttr(raidText, "title", `Nächster Überfall in ${clock(secs)} (Welle ${s.raid.wave + 1})`);
        setClass(raidText, "mk-raid-active", false);
        setClass(raidText, "mk-raid-soon", secs < 30);
      }
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
      const r = bridge.view().r & 3;
      setText(compass, ROT_SHORT[r]);
      setAttr(compass, "title", `Kameradrehung: ${ROT_LABEL[r]}`);
    },
    updateSpeed() {
      const v = bridge.speed();
      speedBtns.forEach((b, i) => { setClass(b, "mk-on", v === i); setAttr(b, "aria-pressed", String(v === i)); });
    },
  };
}
