/**
 * Chronik (die letzten vier Meldungen aus state.messages, Warnungen und Kampf farbig) und Hinweise (Toasts)
 * am Mauszeiger. Die Chronik fängt keine Mausereignisse ab, damit Klicks ins Spiel durchgehen.
 */
import { TICKS_PER_SECOND } from "../data";
import type { Message, SimState } from "../sim/types";
import { clock, h } from "./dom";

export interface Chronicle { el: HTMLElement; update(s: SimState): void }

export function createChronicle(): Chronicle {
  const list = h("ol.mk-chron-list");
  const el = h("div.mk-chron", { "aria-label": "Chronik", "aria-live": "polite" }, list);
  let sig = "";
  return {
    el,
    update(s) {
      const last = s.messages.slice(-4);
      const next = `${s.messages.length}:${last.map((m) => m.tick + m.text).join("|")}`;
      if (next === sig) return;
      sig = next;
      list.textContent = "";
      last.forEach((m: Message, i) => {
        list.append(h(`li.mk-chron-item.mk-msg-${m.kind}` as "li", { style: `--age:${last.length - 1 - i}` },
          h("span.mk-chron-time", { text: clock(m.tick / TICKS_PER_SECOND) }),
          h("span.mk-chron-text", { text: m.text })));
      });
    },
  };
}

/**
 * Hinweise (Toasts): das einzige System für vorübergehende Hinweise. Quellen: bridge.onNotify (App, z. B. abgelehnte
 * Befehle) und die Oberfläche selbst. Platz am Mauszeiger, aber nie über den Leisten: Steht die Maus über der Fußleiste,
 * erscheint der Hinweis darüber (verdeckt also keine Baukarten-Kosten), über dem Auswahl-Panel links daneben.
 * Ohne bekannte Mausposition unten mittig über der Fußleiste.
 */
export function createToaster(layer: HTMLElement, avoid: () => { bottom: DOMRect | null; side: DOMRect | null }): (text: string, kind?: "info" | "warnung") => void {
  let mx = -1, my = -1;
  const track = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; };
  window.addEventListener("pointermove", track, { passive: true, capture: true });
  window.addEventListener("pointerdown", track, { passive: true, capture: true });
  let current: HTMLElement | null = null;
  let timer = 0;
  return (text, kind = "info") => {
    if (current && current.textContent === text && current.dataset.kind === kind) { clearTimeout(timer); }
    else {
      current?.remove();
      current = h(`div.mk-toast.mk-toast-${kind}` as "div", { role: "status", "data-kind": kind, text });
      layer.append(current);
    }
    const t = current;
    const w = t.offsetWidth, hh = t.offsetHeight;
    const W = window.innerWidth, H = window.innerHeight;
    const { bottom, side } = avoid();
    let x: number, y: number;
    if (mx < 0) { x = (W - w) / 2; y = (bottom ? bottom.top : H) - hh - 16; }
    else {
      x = mx + 16; y = my + 18;
      if (bottom && my >= bottom.top - 4) { y = bottom.top - hh - 12; x = mx - w / 2; }
      else if (side && mx >= side.left && my >= side.top && my <= side.bottom) { x = side.left - w - 10; y = my - hh / 2; }
      else if (bottom && y + hh > bottom.top - 6) y = Math.max(8, my - hh - 14);
    }
    t.style.left = `${Math.round(Math.max(8, Math.min(W - w - 8, x)))}px`;
    t.style.top = `${Math.round(Math.max(8, Math.min(H - hh - 8, y)))}px`;
    t.classList.remove("mk-out");
    timer = window.setTimeout(() => {
      t.classList.add("mk-out");
      window.setTimeout(() => { if (current === t) { t.remove(); current = null; } }, 300);
    }, kind === "warnung" ? 2600 : 1800);
  };
}
