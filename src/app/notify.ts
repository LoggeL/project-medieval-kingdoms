/**
 * Hinweise. Absprache: Vorübergehende Hinweise (Toasts) zeigt allein die Oberfläche; die App reicht sie über
 * bridge.notify an die onNotify-Abonnenten weiter (NotifyHub). Einzige Ausnahme ist der Live-Grund einer roten
 * Bauvorschau: Er steht als kleiner Zeiger-Hinweis direkt am Mauszeiger (PointerHint), über allen Leisten.
 */
export type NotifyKind = "info" | "warnung";
type Listener = (text: string, kind?: NotifyKind) => void;

export class NotifyHub {
  private subs = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }

  emit(text: string, kind: NotifyKind = "info"): void {
    if (!this.subs.size) { console.info(`[Hinweis] ${text}`); return; }
    for (const fn of [...this.subs]) {
      try { fn(text, kind); } catch (e) { console.error("Fehler beim Anzeigen eines Hinweises", e); }
    }
  }
}

/** Kleiner Hinweis am Mauszeiger, solange die Bauvorschau rot ist (Grund der Ablehnung). */
export class PointerHint {
  private el: HTMLDivElement;
  private text = "";
  private x = -1;
  private y = -1;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "mk-zeiger";
    this.el.setAttribute("role", "status");
    this.el.setAttribute("aria-live", "polite");
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  /** Text an Bildschirmposition (clientX/Y) zeigen; leerer Text blendet aus. Ändert das DOM nur bei Änderungen. */
  set(text: string, cx: number, cy: number): void {
    if (text !== this.text) {
      this.text = text;
      this.el.textContent = text;
      this.el.hidden = !text;
    }
    if (!text) return;
    const x = Math.round(Math.min(window.innerWidth - 16, Math.max(8, cx + 16)));
    const y = Math.round(Math.min(window.innerHeight - 30, Math.max(8, cy + 20)));
    if (x === this.x && y === this.y) return;
    this.x = x; this.y = y;
    this.el.style.transform = `translate(${x}px, ${y}px)`;
  }

  hide(): void { this.set("", 0, 0); }
}
