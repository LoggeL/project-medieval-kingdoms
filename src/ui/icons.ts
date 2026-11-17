/**
 * Icons aus den echten Sprites (bridge.icon). Jedes Icon ist ein eigenes Canvas, in das die Vorlage der
 * Brücke kopiert wird, damit dieselbe Vorlage an mehreren Stellen erscheinen kann. Solange die Sprites laden,
 * bleibt das Canvas leer und wird beim Ereignis "assets" nachgezeichnet.
 */
import type { IconKind, UiBridge } from "../app/contract";

interface Slot { c: HTMLCanvasElement; kind: IconKind; key: string; size: number; done: boolean }

export class Icons {
  private slots = new Set<Slot>();

  constructor(private bridge: UiBridge) {
    bridge.on("assets", () => this.refresh());
  }

  /** Neues Icon-Canvas (size × size Pixel, CSS-Größe = display). */
  make(kind: IconKind, key: string, size: number, display = size): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    c.className = "mk-icon";
    c.style.width = `${display}px`; c.style.height = `${display}px`;
    const slot: Slot = { c, kind, key, size, done: false };
    this.draw(slot);
    if (!slot.done) this.slots.add(slot);
    return c;
  }

  /** Bestehendes Icon auf eine andere Vorlage umstellen. */
  change(c: HTMLCanvasElement, kind: IconKind, key: string): void {
    if (c.dataset.key === `${kind}:${key}`) return;
    for (const s of this.slots) if (s.c === c) this.slots.delete(s);
    const slot: Slot = { c, kind, key, size: c.width, done: false };
    this.draw(slot);
    if (!slot.done) this.slots.add(slot);
  }

  private draw(s: Slot): void {
    s.c.dataset.key = `${s.kind}:${s.key}`;
    const g = s.c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, s.size, s.size);
    let src: HTMLCanvasElement | null = null;
    try { src = this.bridge.icon(s.kind, s.key, s.size); } catch { src = null; }
    if (!src || !src.width || !src.height) return;
    g.imageSmoothingEnabled = false;
    // Vorlage einpassen, Seitenverhältnis halten, unten bündig (Figuren stehen auf dem Boden).
    const k = Math.min(s.size / src.width, s.size / src.height);
    const w = Math.round(src.width * k), hh = Math.round(src.height * k);
    g.drawImage(src, Math.floor((s.size - w) / 2), s.size - hh, w, hh);
    s.done = true;
  }

  private refresh(): void {
    for (const s of [...this.slots]) {
      // Nicht mehr eingehängte Icons (neu aufgebautes Panel) vergessen; neue werden synchron eingehängt.
      if (!s.c.isConnected) { this.slots.delete(s); continue; }
      this.draw(s);
      if (s.done) this.slots.delete(s);
    }
  }
}
