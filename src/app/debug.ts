/**
 * Debug-Anzeige (Taste F3): Bildrate, JS-Zeit je Bild, Tick-Dauer, Sprites, Objekte, sortierte Paare.
 * Hängt in document.body über der Oberfläche (oben mittig), damit sie nicht hinter Leisten oder Übersichtskarte liegt.
 */
export interface DebugStats {
  fps: number; frameMs: number; tickMs: number; sprites: number; items: number; pairs: number; chunks: number;
  units: number; objects: number; r: number; zoom: number; tick: number; silhouettes: number; resolution: number;
}

export class DebugOverlay {
  private el: HTMLDivElement;
  visible = false;
  private last = 0;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "mk-debug";
    this.el.hidden = true;
    document.body.appendChild(this.el);
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
      `${s.fps.toFixed(0)} FPS · JS je Bild ${s.frameMs.toFixed(2)} ms · Tick ${s.tickMs.toFixed(2)} ms (Nr. ${s.tick})\n` +
      `Sprites ${s.sprites} · Objekte ${s.items}/${s.objects} · Paare ${s.pairs} · Abschnitte ${s.chunks} · Silhouetten ${s.silhouettes}\n` +
      `Figuren ${s.units} · Drehung ${s.r} · Zoom ${s.zoom}× · Auflösung ${s.resolution}× (Gerät ${window.devicePixelRatio || 1}×)`;
  }
}
