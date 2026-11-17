/**
 * Klang in der Kopfleiste: Lautsprecher-Knopf (Klick klappt das Panel auf) mit Reglern für Musik und Sprecher
 * (0–100 %), Stumm-Schalter und, falls die App es meldet, dem laufenden Musikstück (Titel aus MUSIC).
 * Spricht nur über bridge.audio() / setAudio() und das Ereignis "audio".
 */
import type { UiBridge } from "../app/contract";
import { MUSIC } from "../data/audio";
import { h, setAttr, setClass, setText } from "./dom";

export interface AudioControl { el: HTMLElement; update(): void }

const SVG_NS = "http://www.w3.org/2000/svg";

/** Lautsprecher als kleine Pixelgrafik (SVG, scharfe Kanten); Schallbögen oder Kreuz je nach Zustand. */
function speakerGlyph(): { el: SVGSVGElement; set(muted: boolean, level: number): void } {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", "0 0 16 16");
  el.setAttribute("width", "16");
  el.setAttribute("height", "16");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("shape-rendering", "crispEdges");
  el.classList.add("mk-speaker");
  const path = (d: string, cls: string) => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("class", cls);
    el.append(p);
    return p;
  };
  path("M1 5h3l4-4h1v14h-1l-4-4h-3z", "mk-sp-body");
  const w1 = path("M11 6h1v4h-1z", "mk-sp-wave");
  const w2 = path("M13 4h1v8h-1z", "mk-sp-wave");
  // Kreuz aus 1-px-Treppen (stumm)
  const x = path(Array.from({ length: 5 }, (_, i) => `M${10 + i} ${6 + i}h1v1h-1zM${14 - i} ${6 + i}h1v1h-1z`).join(""), "mk-sp-x");
  return {
    el,
    set(muted, level) {
      x.style.display = muted ? "" : "none";
      w1.style.display = !muted && level > 0 ? "" : "none";
      w2.style.display = !muted && level > 0.5 ? "" : "none";
    },
  };
}

export function createAudioControl(bridge: UiBridge): AudioControl {
  const glyph = speakerGlyph();
  const toggle = h("button.mk-btn.mk-btn-audio", { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" });
  toggle.append(glyph.el);

  const slider = (label: string, key: "music" | "voice") => {
    const input = h("input.mk-range", { type: "range", min: "0", max: "100", step: "5", "aria-label": `${label}: Lautstärke` });
    const val = h("span.mk-range-val.mk-num");
    input.addEventListener("input", () => {
      const v = Number(input.value) / 100;
      setText(val, `${input.value} %`);
      bridge.setAudio(bridge.audio().muted && v > 0 ? { [key]: v, muted: false } : { [key]: v });
    });
    const row = h("label.mk-audio-row", null, h("span.mk-audio-label", { text: label }), input, val);
    return { row, input, val, key };
  };
  const music = slider("Musik", "music");
  const voice = slider("Sprecher", "voice");
  const muteBtn = h("button.mk-btn.mk-btn-wide.mk-btn-mute", { type: "button", onclick: () => bridge.setAudio({ muted: !bridge.audio().muted }) });
  const track = h("p.mk-audio-track");
  const pop = h("div.mk-audio-pop.mk-parchment", { role: "dialog", "aria-label": "Klang" },
    h("h3.mk-sec-title", { text: "Klang" }), music.row, voice.row, track, muteBtn);
  pop.hidden = true;
  const el = h("div.mk-audio", null, toggle, pop);

  const open = (on: boolean) => {
    pop.hidden = !on;
    setAttr(toggle, "aria-expanded", String(on));
    setClass(toggle, "mk-on", on);
    if (on) update();
  };
  toggle.addEventListener("click", () => open(pop.hidden));
  document.addEventListener("pointerdown", (e) => { if (!pop.hidden && !el.contains(e.target as Node)) open(false); }, true);
  // Esc schließt das Panel (und nur das: Auswahl und Werkzeug bleiben).
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || pop.hidden) return;
    e.preventDefault(); e.stopPropagation();
    open(false);
  }, true);
  // Regler mit Pfeiltasten bedienen, ohne dass die Kamera mitfährt.
  pop.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement && /^(Arrow|Page|Home|End)/.test(e.key)) e.stopPropagation();
  });

  function update(): void {
    const a = bridge.audio();
    const loud = Math.max(a.music, a.voice);
    glyph.set(a.muted, loud);
    setClass(toggle, "mk-muted-btn", a.muted);
    const title = a.muted ? "Ton ist aus (Klick: Klang einstellen)" : "Klang: Musik und Sprecher einstellen";
    setAttr(toggle, "title", title);
    setAttr(toggle, "aria-label", title);
    if (pop.hidden) return;
    for (const s of [music, voice]) {
      const v = String(Math.round(a[s.key] * 100));
      if (document.activeElement !== s.input && s.input.value !== v) s.input.value = v;
      setText(s.val, `${v} %`);
    }
    setClass(pop, "mk-audio-muted", a.muted);
    setText(muteBtn, a.muted ? "Ton einschalten" : "Stumm schalten");
    const t = a.track ? MUSIC[a.track]?.title : undefined;
    track.hidden = a.track === undefined;
    setText(track, a.track === undefined ? "" : t ? `Es spielt: „${t}“` : "Gerade keine Musik");
  }

  update();
  return { el, update };
}
