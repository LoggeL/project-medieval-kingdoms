/**
 * Ladebildschirm: übernimmt das statische Gerüst aus index.html (#mk-laden), zeigt echten Fortschritt
 * (src/app/progress.ts) als Ornament-Leiste, die Karte des Tals als Hintergrund und wechselnde Tipps
 * (src/data/tips.ts, alle 6–8 s; Klick oder Taste zeigt den nächsten). Im Fehlerfall steht dort eine Meldung.
 */
import { TipRotation, tipDuration } from "../../app/progress";
import type { Tip } from "../../data/tips";
import { h, setText } from "../dom";

export class Ladebildschirm {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private bar: HTMLElement;
  private step: HTMLElement;
  private tipText: HTMLElement;
  private tipNr: HTMLElement;
  private tipBox: HTMLElement;
  private rot: TipRotation;
  private timer = 0;
  private fadeTimer = 0;
  private aktiv = true;
  /** Index des gerade gezeigten Tipps (für Tests). */
  tipp = -1;
  /** Wie viele Tipps schon gezeigt wurden. */
  gezeigt = 0;

  constructor(private tips: Tip[]) {
    let el = document.getElementById("mk-laden");
    if (!el) {
      // Fallback, falls index.html das Gerüst nicht hat (z. B. Testseite)
      el = h("div.mk-start.mk-laden", { id: "mk-laden" },
        h("div.mk-laden-bild"), h("h1.mk-laden-titel", { text: "Medieval Kingdoms" }),
        h("div.mk-laden-unten", null,
          h("div.mk-leiste", { role: "progressbar" }, h("div.mk-leiste-bahn", null, h("div.mk-leiste-fuell"))),
          h("p.mk-laden-schritt")));
      document.body.prepend(el);
    }
    this.el = el;
    this.fill = el.querySelector(".mk-leiste-fuell") as HTMLElement;
    this.bar = el.querySelector(".mk-leiste") as HTMLElement;
    this.step = el.querySelector(".mk-laden-schritt") as HTMLElement;
    // Der reine CSS-Hinweis für einen hängenden Spielcode ist ab jetzt überflüssig: das Skript läuft.
    el.querySelector(".mk-laden-haenger")?.remove();

    this.tipNr = h("span.mk-tipp-nr");
    this.tipText = h("p.mk-tipp-text");
    this.tipBox = h("div.mk-laden-tipp.mk-ecken", { title: "Nächster Tipp" },
      h("div.mk-tipp-kopf", null, "Tipp", this.tipNr),
      this.tipText,
      h("p.mk-tipp-hinweis", { text: "Klick oder Taste: nächster Tipp" }));
    (el.querySelector(".mk-laden-unten") ?? el).append(this.tipBox);
    this.rot = new TipRotation(tips.length);

    el.addEventListener("click", (e) => { if (!(e.target as Element).closest("a")) this.weiter(); });
    window.addEventListener("keydown", this.onKey);
    this.weiter(true);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.aktiv || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Tab" || e.key === "F5" || e.key === "F12") return;
    this.weiter();
  };

  /** Nächster Tipp (sofort beim ersten Mal, sonst mit kurzem Überblenden). */
  weiter(sofort = false): void {
    if (!this.aktiv) return;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.fadeTimer);
    const i = this.rot.next();
    this.tipp = i;
    this.gezeigt++;
    const tip = this.tips[i];
    const show = () => {
      setText(this.tipText, tip.text);
      setText(this.tipNr, `${i + 1} / ${this.tips.length}`);
      this.tipText.classList.remove("mk-wechsel");
    };
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (sofort || reduced) show();
    else { this.tipText.classList.add("mk-wechsel"); this.fadeTimer = window.setTimeout(show, 300); }
    this.timer = window.setTimeout(() => this.weiter(), tipDuration(tip.text));
  }

  /** Fortschritt 0..1 und aktueller Schritt. */
  setze(frac: number, label: string): void {
    const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
    const w = `${pct}%`;
    if (this.fill.style.width !== w) this.fill.style.width = w;
    this.bar.setAttribute("aria-valuenow", String(pct));
    const sep = pct >= 100 ? " · " : " … ";
    const text = `${label}${sep}${pct} %`;
    if (this.step.dataset.t !== text) {
      this.step.dataset.t = text;
      this.step.textContent = "";
      this.step.append(label + sep, h("span.mk-prozent", { text: `${pct} %` }));
    }
  }

  /** Hintergrundbild (Karte des Tals) einblenden, sobald es geladen ist. */
  bild(url: string): void {
    const b = this.el.querySelector(".mk-laden-bild") as HTMLElement | null;
    if (!b) return;
    b.style.backgroundImage = `url("${url}")`;
    b.classList.add("mk-da");
  }

  /** Verständliche Meldung statt ewigem Balken. */
  fehler(titel: string, text: string, detail?: string): void {
    // Auch nach dem Ausblenden (Fehler beim Spielstart) wieder sichtbar machen
    if (!this.el.isConnected) document.body.append(this.el);
    this.el.classList.remove("mk-weg");
    this.el.classList.add("mk-fehler");
    this.el.setAttribute("aria-busy", "false");
    setText(this.step, "Laden abgebrochen");
    const box = h("div.mk-laden-meldung", { role: "alert" },
      h("strong", { text: titel }), text, " ",
      h("a", { href: "", text: "Seite neu laden" }),
      detail ? h("div", null, h("code", { text: detail })) : null);
    this.el.querySelector(".mk-laden-meldung")?.remove();
    this.tipBox.before(box);
  }

  /** Langsamer Hinweis ohne Abbruch (das Laden läuft weiter). */
  langsam(an: boolean): void {
    let n = this.el.querySelector(".mk-laden-langsam");
    if (an && !n) {
      n = h("p.mk-laden-schritt.mk-laden-langsam", null, "Das dauert ungewöhnlich lange. ", h("a", { href: "", text: "Seite neu laden" }));
      this.step.after(n);
    } else if (!an && n) n.remove();
  }

  /** Wieder einblenden (nach „Neues Spiel“, solange noch geladen wird): oben auf, Tipps laufen wieder. */
  zeigen(): void {
    if (this.el.classList.contains("mk-fehler")) return;
    document.body.append(this.el);
    this.el.setAttribute("aria-busy", "true");
    // Erst im nächsten Bild sichtbar schalten, damit die Blende greift
    this.el.classList.add("mk-weg");
    void this.el.offsetWidth;
    this.el.classList.remove("mk-weg");
    if (!this.aktiv) {
      this.aktiv = true;
      window.addEventListener("keydown", this.onKey);
      this.weiter(true);
    }
  }

  /** Ausblenden und entfernen. */
  async ausblenden(ms = 600): Promise<void> {
    this.stop();
    this.el.setAttribute("aria-busy", "false");
    this.el.classList.add("mk-weg");
    await new Promise((r) => window.setTimeout(r, ms));
    // Inzwischen wieder eingeblendet (zeigen() oder Fehlermeldung)? Dann bleibt er stehen.
    if (this.el.classList.contains("mk-weg")) this.el.remove();
  }

  stop(): void {
    this.aktiv = false;
    window.clearTimeout(this.timer);
    window.clearTimeout(this.fadeTimer);
    window.removeEventListener("keydown", this.onKey);
  }
}
