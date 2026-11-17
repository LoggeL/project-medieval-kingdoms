/**
 * Ruhige Musik auf dem Titelbildschirm („Abend am Feuer“, MUSIC.aufbau_abend), erst nach einer Nutzergeste
 * (Autoplay-Regeln). Lautstärke und Stummschaltung folgen der Klang-Einstellung der Brücke. Beim Start des Spiels
 * blendet sie aus; danach übernimmt die Audio-Regie (src/app/audio.ts) wie gewohnt mit den Aufbau-Stücken.
 */
import { MUSIC, type MusicKey } from "../../data/audio";

export type TitelMusikZustand = "wartet" | "laeuft" | "blendet_aus" | "aus" | "fehlt";

export class TitelMusik {
  zustand: TitelMusikZustand = "wartet";
  private el: HTMLAudioElement | null = null;
  private gain = 0;
  private target = 0;
  private raf = 0;
  private last = 0;

  constructor(private pegel: () => { music: number; muted: boolean }, private stueck: MusicKey = "aufbau_abend") {}

  /** Nach einer Nutzergeste aufrufen. Startet höchstens einmal. */
  start(): void {
    if (this.zustand !== "wartet") return;
    const base = import.meta.env.BASE_URL || "./";
    const el = new Audio((base.endsWith("/") ? base : base + "/") + MUSIC[this.stueck].file);
    el.loop = true;
    el.preload = "auto";
    el.volume = 0;
    this.onError = () => { this.zustand = "fehlt"; this.halt(); };
    el.addEventListener("error", this.onError, { once: true });
    this.el = el;
    this.zustand = "laeuft";
    this.target = 1;
    el.play().catch(() => {
      // Ohne Geste abgelehnt: beim nächsten Versuch erneut
      if (this.zustand === "laeuft") { this.zustand = "wartet"; this.el = null; }
    });
    this.schleife();
  }

  /** Lautstärke an die Einstellung angleichen (nach Änderung im Klang-Feld). */
  pegelGeaendert(): void { this.apply(); }

  /** Ausblenden (Start des Spiels). Ohne laufende Musik sofort aus. */
  ausblenden(sekunden = 1.5): void {
    if (this.zustand !== "laeuft") { this.zustand = this.zustand === "fehlt" ? "fehlt" : "aus"; return; }
    this.zustand = "blendet_aus";
    this.target = 0;
    this.fade = sekunden;
    this.schleife();
  }

  /** Aktuelle Lautstärke des Elements (für Tests im Browser). */
  lautstaerke(): number { return this.el ? this.el.volume : 0; }

  private fade = 2.5;
  private onError: (() => void) | null = null;

  private schleife(): void {
    if (this.raf) return;
    this.last = performance.now();
    const step = () => {
      this.raf = 0;
      const now = performance.now();
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      const d = this.target - this.gain;
      this.gain += Math.sign(d) * Math.min(Math.abs(d), dt / this.fade);
      this.apply();
      if (this.gain === this.target) {
        if (this.target === 0) this.halt();
        return;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private apply(): void {
    if (!this.el) return;
    const p = this.pegel();
    const v = Math.max(0, Math.min(1, (p.muted ? 0 : p.music) * this.gain));
    if (Math.abs(this.el.volume - v) > 0.002) this.el.volume = v;
  }

  private halt(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.el) { if (this.onError) this.el.removeEventListener("error", this.onError); this.el.pause(); this.el.removeAttribute("src"); this.el.load(); this.el = null; }
    if (this.zustand !== "fehlt") this.zustand = "aus";
  }
}
