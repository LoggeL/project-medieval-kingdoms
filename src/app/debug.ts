/**
 * Debug-Anzeige (Taste F3): Bildrate, Bildzeit, Tick-Dauer, Sprites, Objekte, sortierte Paare.
 */
export interface DebugStats {
  fps: number; frameMs: number; tickMs: number; sprites: number; items: number; pairs: number; chunks: number;
  units: number; objects: number; r: number; zoom: number; tick: number;
}

export class DebugOverlay {
  private el: HTMLDivElement;
  visible = false;
  private last = 0;

  constructor(host: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "mk-debug";
    this.el.hidden = true;
    host.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  update(s: DebugStats): void {
    if (!this.visible) return;
    const now = performance.now();
    if (now - this.last < 250) return;
    this.last = now;
    this.el.textContent =
      `${s.fps.toFixed(0)} FPS · Bild ${s.frameMs.toFixed(1)} ms · Tick ${s.tickMs.toFixed(2)} ms (Nr. ${s.tick})\n` +
      `Sprites ${s.sprites} · Objekte ${s.items}/${s.objects} · Paare ${s.pairs} · Abschnitte ${s.chunks}\n` +
      `Figuren ${s.units} · Drehung ${s.r} · Zoom ${s.zoom}×`;
  }
}
