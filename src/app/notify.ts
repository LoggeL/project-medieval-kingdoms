/**
 * Kurzer Hinweis am Mauszeiger (z. B. warum hier nicht gebaut werden kann). Blendet nach kurzer Zeit aus.
 */
export class Notifier {
  private el: HTMLDivElement;
  private timer = 0;
  private mx = 0;
  private my = 0;

  constructor(host: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "mk-hinweis";
    this.el.setAttribute("role", "status");
    this.el.setAttribute("aria-live", "polite");
    host.appendChild(this.el);
    const track = (e: PointerEvent) => { this.mx = e.clientX; this.my = e.clientY; };
    window.addEventListener("pointermove", track, { passive: true });
    window.addEventListener("pointerdown", track, { passive: true, capture: true });
  }

  show(text: string, kind: "info" | "warnung" = "info"): void {
    const el = this.el;
    el.textContent = text;
    el.dataset.kind = kind;
    const x = Math.min(window.innerWidth - 16, Math.max(16, this.mx + 18));
    const y = Math.min(window.innerHeight - 40, Math.max(16, this.my + 18));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.classList.add("sichtbar");
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => el.classList.remove("sichtbar"), kind === "warnung" ? 2600 : 1800);
  }
}
