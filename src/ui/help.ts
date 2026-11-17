/** Hilfe-Overlay mit der Steuerung (F1 oder ?-Knopf, Esc schließt). */
import { STEUERUNG } from "../data/tips";
import { h } from "./dom";

/** Dieselbe Tastenliste wie auf dem Titelbildschirm (eine Quelle, src/data/tips.ts). */
const KEYS = STEUERUNG;

const TIPS = [
  "Holzfäller und Steinmetze legen ihre Ware auf den Hof, Tagelöhner tragen sie durch das Tor ins Lagerhaus.",
  "Fährst du mit der Maus über ein Gebäude, siehst du hinein: im Lagerhaus jede Ware auf ihrem Fach. Ist es voll, ruht die Arbeit.",
  "Soldaten kosten Gold und eine Waffe aus dem Lager. Ein Tagelöhner holt sie und tritt in die Kaserne ein.",
  "Mauern sind begehbar: Treppe anbauen, Soldaten stationieren. Schützen auf der Mauer schießen weiter und nehmen weniger Schaden.",
  "Übersichtskarte: Klicken oder Ziehen setzt die Kamera dorthin, der helle Rahmen zeigt den Sichtbereich.",
  "Der Kompass oben zeigt mit seiner Nadel, wohin Norden gerade im Bild zeigt.",
  "Klang: Der Lautsprecher-Knopf oben rechts öffnet die Regler für Musik und Sprecher (0–100 %) und schaltet den Ton stumm.",
];

export interface Help { el: HTMLElement; toggle(on?: boolean): void; isOpen(): boolean }

export function createHelp(): Help {
  const close = () => toggle(false);
  const card = h("div.mk-help-card.mk-parchment", { role: "dialog", "aria-modal": "true", "aria-labelledby": "mk-help-title" },
    h("button.mk-x", { type: "button", "aria-label": "Hilfe schließen", text: "×", onclick: close }),
    h("h2.mk-title", { id: "mk-help-title", text: "Steuerung" }),
    h("dl.mk-keys", null, ...KEYS.flatMap(([k, v]) => [h("dt", null, ...k.split(" / ").flatMap((x, i) => (i ? [" / ", h("kbd", { text: x })] : [h("kbd", { text: x })]))), h("dd", { text: v })])),
    h("h3.mk-sec-title", { text: "Gut zu wissen" }),
    h("ul.mk-tips", null, ...TIPS.map((t) => h("li", { text: t }))));
  const el = h("div.mk-help", { onclick: (e: Event) => { if (e.target === el) close(); } }, card);
  el.hidden = true;
  let last: Element | null = null;

  function toggle(on = el.hidden): void {
    if (on === !el.hidden) return;
    el.hidden = !on;
    if (on) { last = document.activeElement; (card.querySelector(".mk-x") as HTMLElement).focus(); }
    else if (last instanceof HTMLElement) last.focus();
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "F1") { e.preventDefault(); toggle(); }
    else if (e.key === "Escape" && !el.hidden) { e.preventDefault(); e.stopPropagation(); toggle(false); }
  }, true);

  return { el, toggle, isOpen: () => !el.hidden };
}
