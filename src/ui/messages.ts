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

/** Hinweise am Mauszeiger; ohne bekannte Mausposition unten mittig über der Fußleiste. */
export function createToaster(layer: HTMLElement): (text: string, kind?: "info" | "warnung") => void {
  let mx = -1, my = -1;
  const track = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; };
  window.addEventListener("pointermove", track, { passive: true, capture: true });
  window.addEventListener("pointerdown", track, { passive: true, capture: true });
  let current: HTMLElement | null = null;
  let timer = 0;
  return (text, kind = "info") => {
    if (current && current.textContent === text) { clearTimeout(timer); }
    else {
      current?.remove();
      current = h(`div.mk-toast.mk-toast-${kind}` as "div", { role: "status", text });
      layer.append(current);
    }
    const t = current;
    const w = t.offsetWidth, hh = t.offsetHeight;
    if (mx >= 0) {
      t.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, mx + 16))}px`;
      t.style.top = `${Math.max(8, Math.min(window.innerHeight - hh - 8, my + 18))}px`;
    } else {
      t.style.left = `${(window.innerWidth - w) / 2}px`;
      t.style.top = `${window.innerHeight * 0.7}px`;
    }
    t.classList.remove("mk-out");
    timer = window.setTimeout(() => {
      t.classList.add("mk-out");
      window.setTimeout(() => { if (current === t) { t.remove(); current = null; } }, 300);
    }, kind === "warnung" ? 2600 : 1800);
  };
}
