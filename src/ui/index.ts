/**
 * Mittelalterliche Oberfläche (DOM + CSS). Spricht nur über die UiBridge (src/app/contract.ts) mit dem Spiel.
 * Aufbau: Kopfleiste (Holz), Chronik, Auswahl-Panel rechts (Pergament), Fußleiste (Stein) mit Übersichtskarte
 * und Bauleiste, Hilfe-Overlay und Hinweise. Die Leisten fangen Mausereignisse nur dort ab, wo sie liegen.
 * Aktualisiert wird über bridge.on(...), gebündelt auf höchstens ~10 Mal pro Sekunde und nur bei Änderungen.
 */
import type { MountUi } from "../app/contract";
import { createBuildBar } from "./buildbar";
import { h } from "./dom";
import { createHelp } from "./help";
import { Icons } from "./icons";
import { createChronicle, createToaster } from "./messages";
import { createMinimap } from "./minimap";
import type { UiCtx } from "./shared";
import { createSidePanel } from "./sidepanel";
import { createTopBar } from "./topbar";
import "./ui.css";

const FRAME_MS = 100;

export const mountUi: MountUi = (root, bridge) => {
  root.textContent = "";
  root.classList.add("mk-root");
  // Absolute Adressen: Eine url() in einer CSS-Variable wird sonst relativ zum Stylesheet aufgelöst, das var() benutzt
  // (im Build /assets/index-*.css), und die Kacheln landen bei /assets/ui/… (404).
  const base = new URL(import.meta.env.BASE_URL, document.baseURI);
  for (const t of ["stein", "holz", "pergament"]) {
    root.style.setProperty(`--mk-tex-${t}`, `url("${new URL(`ui/${t}_kachel.png`, base).href}")`);
  }

  const toastLayer = h("div.mk-toasts");
  const rectOf = (el: HTMLElement) => (el.isConnected && !el.hidden ? el.getBoundingClientRect() : null);
  const toast = createToaster(toastLayer, () => ({ bottom: rectOf(bottom), side: rectOf(side.el) }));
  const ctx: UiCtx = { bridge, icons: new Icons(bridge), toast };
  // Ein einziges Hinweis-System: Hinweise der App (bridge.notify) kommen über onNotify hier an.
  bridge.onNotify(toast);

  const help = createHelp();
  const top = createTopBar(ctx, () => help.toggle());
  const chron = createChronicle();
  const side = createSidePanel(ctx);
  const build = createBuildBar(ctx);
  const mini = createMinimap(bridge);
  const bottom = h("footer.mk-bottom.mk-stone", null, h("div.mk-mini-frame", null, mini.el), build.el);

  root.append(top.el, chron.el, side.el, bottom, help.el, toastLayer);
  if (window.innerWidth < 1024) build.el.classList.add("mk-collapsed");

  // Knöpfe geben nach einem Mausklick den Fokus ab, damit Leertaste und Enter sie nicht erneut auslösen
  // (Leertaste = Pause fängt die App ab). Mit der Tastatur ausgelöste Klicks (detail 0) behalten den Fokus.
  root.addEventListener("click", (e) => {
    if (e.detail === 0) return;
    const b = (e.target as Element | null)?.closest?.("button");
    if (b instanceof HTMLButtonElement) b.blur();
  });
  root.addEventListener("pointerup", (e) => {
    const t = e.target as Element | null;
    if (t instanceof HTMLInputElement && t.type === "range") window.setTimeout(() => t.blur(), 0);
  });

  // ------------------------------------------------------------ Aktualisierung
  let pending = false, lastFrame = 0, lastTick = 0;
  const frame = () => {
    pending = false;
    lastFrame = performance.now();
    const s = bridge.state();
    top.update(s);
    chron.update(s);
    side.update(s);
    build.update(s);
    mini.update(s);
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    const wait = Math.max(0, FRAME_MS - (performance.now() - lastFrame));
    window.setTimeout(() => requestAnimationFrame(frame), wait);
  };

  bridge.on("tick", () => { lastTick = performance.now(); schedule(); });
  bridge.on("selection", () => { side.update(bridge.state()); schedule(); });
  bridge.on("tool", () => build.updateTool());
  bridge.on("view", () => { top.updateView(); mini.update(bridge.state(), true); });
  bridge.on("audio", () => top.updateAudio());
  // Geschwindigkeit hat kein eigenes Ereignis; in der Pause kommen keine Ticks, Befehle ändern den Zustand aber trotzdem.
  window.setInterval(() => {
    top.updateSpeed();
    if (performance.now() - lastTick > 300) schedule();
  }, 250);

  top.updateView();
  top.updateSpeed();
  build.updateTool();
  frame();
  mini.update(bridge.state(), true);
};
