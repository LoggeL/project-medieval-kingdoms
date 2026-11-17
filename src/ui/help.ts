/** Hilfe-Overlay mit der Steuerung (F1 oder ?-Knopf, Esc schließt). */
import { h } from "./dom";

const KEYS: [string, string][] = [
  ["Linksklick", "Auswählen, Bauen, Abreißen"],
  ["Ziehen mit links", "Auswahlrahmen, beim Mauerbau die Mauerlinie"],
  ["Rechtsklick", "Bewegen, Angreifen; auf einen Wehrgang: hinaufsteigen"],
  ["Q / E", "Ansicht um 90° drehen: Q gegen, E im Uhrzeigersinn (wie die Knöpfe ⟲ ⟳)"],
  ["R", "Gebäude beim Bauen drehen"],
  ["Mausrad", "Zoomen; über der Bauleiste: blättern"],
  ["W A S D / Pfeiltasten", "Kamera bewegen"],
  ["T", "Ausgewählte Soldaten auf Mauern und Türmen stationieren"],
  ["H", "Halten: stehen bleiben"],
  ["Esc", "Werkzeug oder Auswahl aufheben"],
  ["Leertaste", "Pause / Weiter"],
  ["F1", "Diese Hilfe"],
];

const TIPS = [
  "Holzfäller und Steinmetze legen ihre Ware auf den Hof, Tagelöhner tragen sie zum Lagerplatz.",
  "Der Lagerplatz zeigt jede Ware auf ihrem Stapel. Ist er voll, ruht die Arbeit.",
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
