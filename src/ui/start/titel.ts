/**
 * Titelbildschirm (DOM): Schlüsselbild vollflächig (cover, Vignette, sehr langsamer Schwenk), Wappen und Schriftzug,
 * Menü „Neues Spiel“, „Klang“, „Steuerung“ und „Design-Dokument“ (Link auf die Konzeptseite unter /konzept/).
 * „Fortsetzen“ gibt es nicht: Der Prototyp speichert keinen Spielstand im Browser.
 * Der Titel steht schon, während das Spiel dahinter noch lädt (src/ui/start/index.ts).
 *
 * Tastatur: Pfeile hoch/runter wandern durchs Menü, Enter löst aus (ohne Fokus startet Enter das Spiel), Esc schließt
 * eine offene Tafel. Spricht nur über die UiBridge (Klang-Einstellung) mit dem Spiel.
 */
import type { UiBridge } from "../../app/contract";
import { STEUERUNG } from "../../data/tips";
import { h, setText } from "../dom";
import type { TitelMusik } from "./musik";

export interface TitelOptionen {
  bridge: UiBridge;
  musik: TitelMusik;
  /** Adresse des Schlüsselbilds oder null (dann Holzgrund). */
  bild: string | null;
  /** Adresse der Konzeptseite (Menüpunkt „Design-Dokument“) oder null (kein Menüpunkt). */
  konzept: string | null;
}

type Tafel = "klang" | "steuerung" | null;

/** Wappenschild: Blau mit goldenem Rand und Turm, Teamfarbe wie die Banner der Sprites. */
function schild(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 64 76");
  svg.setAttribute("class", "mk-schild");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `
    <defs>
      <linearGradient id="mkS1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3f6fd0"/><stop offset="1" stop-color="#1b336f"/></linearGradient>
      <linearGradient id="mkS2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe7a4"/><stop offset=".55" stop-color="#d4a44a"/><stop offset="1" stop-color="#8a6420"/></linearGradient>
    </defs>
    <path d="M4 4 H60 V34 C60 54 46 66 32 73 C18 66 4 54 4 34 Z" fill="#120b05"/>
    <path d="M7 7 H57 V34 C57 51 45 62 32 69 C19 62 7 51 7 34 Z" fill="url(#mkS2)"/>
    <path d="M11 11 H53 V34 C53 48 43 57.5 32 64 C21 57.5 11 48 11 34 Z" fill="url(#mkS1)"/>
    <path d="M11 11 H53 V20 H11 Z" fill="#ffffff" opacity=".08"/>
    <g fill="url(#mkS2)" stroke="#2b1a08" stroke-width="1">
      <path d="M22 26 h4 v3 h3 v-3 h6 v3 h3 v-3 h4 v8 h-2 v18 h-16 v-18 h-2 Z"/>
    </g>
    <path d="M29 52 v-7 a3 3 0 0 1 6 0 v7 Z" fill="#1b336f"/>
    <rect x="30.7" y="36" width="2.6" height="4" fill="#1b336f"/>`;
  return svg;
}

export class Titelbildschirm {
  readonly el: HTMLElement;
  private menue: HTMLElement;
  private knoepfe: HTMLElement[] = [];
  private panelHost: HTMLElement;
  private tafel: Tafel = null;
  private knopfKlang!: HTMLButtonElement;
  private knopfSteuerung!: HTMLButtonElement;
  private gestartet = false;
  private resolve: (() => void) | null = null;
  private aus: (() => void)[] = [];

  constructor(private o: TitelOptionen) {
    const bildBox = h("div.mk-titel-bild");
    if (o.bild) {
      const img = h("img", { src: o.bild, alt: "", decoding: "async", draggable: "false" });
      bildBox.append(img);
    }
    const neu = h("button.mk-menue-knopf.mk-haupt", { type: "button", text: "Neues Spiel", onclick: () => this.starten() });
    this.knopfKlang = h("button.mk-menue-knopf", { type: "button", text: "Klang", "aria-expanded": "false", "aria-controls": "mk-tafel", onclick: () => this.zeige("klang") });
    this.knopfSteuerung = h("button.mk-menue-knopf", { type: "button", text: "Steuerung", "aria-expanded": "false", "aria-controls": "mk-tafel", onclick: () => this.zeige("steuerung") });
    const items: HTMLElement[] = [neu, this.knopfKlang, this.knopfSteuerung];
    if (o.konzept) items.push(h("a.mk-menue-knopf", { href: o.konzept, text: "Design-Dokument", title: "Spiel- und Technikkonzept mit Schaubildern" }));
    this.knoepfe = items;
    this.menue = h("nav.mk-menue", { "aria-label": "Hauptmenü" }, ...items);
    this.panelHost = h("div", { id: "mk-tafel" });

    const fuss = h("p.mk-titel-fuss", null,
      "Prototyp · ", h("span.mk-nur-gross", null, h("kbd", { text: "↑" }), " ", h("kbd", { text: "↓" }), " wählen, ", h("kbd", { text: "Enter" }), " bestätigen · "),
      "Eigenständiges Spiel in Entwicklung");

    this.el = h("div.mk-start.mk-titel", { id: "mk-titel", role: "dialog", "aria-modal": "true", "aria-labelledby": "mk-titel-name" },
      bildBox,
      h("div.mk-titel-inhalt", null,
        h("div.mk-titel-spalte", null,
          h("header.mk-wappen", null,
            schild(),
            h("h1.mk-titel-name", { id: "mk-titel-name" }, h("span", { text: "Medieval" }), h("span", { text: "Kingdoms" })),
            h("p.mk-untertitel", { text: "Prototyp" })),
          this.menue),
        this.panelHost,
        fuss));
    if (!o.bild) this.el.classList.add("mk-titel-ohne-bild");

    this.el.addEventListener("keydown", (e) => this.taste(e));
    // Die Geste auf „Neues Spiel“ selbst startet keine Titelmusik (sie würde sofort wieder ausblenden).
    this.el.addEventListener("pointerdown", (e) => { if (!(e.target as Element).closest?.(".mk-haupt")) this.geste(); });
    // Tasten außerhalb des Titels (Fokus auf body): Enter startet, Pfeile holen den Fokus ins Menü
    const global = (e: KeyboardEvent) => {
      if (this.gestartet) return;
      if (this.el.contains(document.activeElement)) return;
      if (e.key === "Enter") { e.preventDefault(); this.starten(); return; }
      this.geste();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); this.knoepfe[0].focus(); }
    };
    window.addEventListener("keydown", global, true);
    this.aus.push(() => window.removeEventListener("keydown", global, true));
    const off = o.bridge.on("audio", () => { o.musik.pegelGeaendert(); this.klangAuffrischen(); });
    this.aus.push(off);
    window.addEventListener("resize", this.skalierung);
    this.aus.push(() => window.removeEventListener("resize", this.skalierung));
  }

  /** Schlüsselbild nachreichen, wenn es erst nach dem Erscheinen des Titels geladen ist. */
  bild(url: string): void {
    const box = this.el.querySelector(".mk-titel-bild") as HTMLElement;
    if (box.querySelector("img")) return;
    const img = h("img", { src: url, alt: "", decoding: "async", draggable: "false" }) as HTMLImageElement;
    img.addEventListener("load", () => { this.el.classList.remove("mk-titel-ohne-bild"); this.skalierung(); }, { once: true });
    box.append(img);
  }

  /** Pixelgenau ab etwa doppelter Vergrößerung, darunter weich (nächster Nachbar bei 0,9× würde Pixel verschlucken). */
  private skalierung = (): void => {
    const img = this.el.querySelector(".mk-titel-bild img") as HTMLImageElement | null;
    if (!img || !img.naturalWidth) return;
    const s = Math.max(window.innerWidth / img.naturalWidth, window.innerHeight / img.naturalHeight) * (window.devicePixelRatio || 1);
    this.el.querySelector(".mk-titel-bild")!.classList.toggle("mk-pixel", s >= 1.75);
  };

  /** Einhängen und warten, bis „Neues Spiel“ gewählt wird. */
  zeigen(parent: HTMLElement = document.body): Promise<void> {
    parent.append(this.el);
    const img = this.el.querySelector(".mk-titel-bild img") as HTMLImageElement | null;
    if (img) { if (img.complete) this.skalierung(); else img.addEventListener("load", this.skalierung, { once: true }); }
    // Schon eine Geste auf der Seite (z. B. Klick auf einen Tipp)? Dann darf die Titelmusik gleich beginnen.
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua?.hasBeenActive) this.geste();
    window.setTimeout(() => this.knoepfe[0].focus({ preventScroll: true }), 50);
    return new Promise((r) => { this.resolve = r; if (this.gestartet) r(); });
  }

  /** Erste Geste: Titelmusik (falls nicht stumm, das regelt die Lautstärke). */
  private geste(): void {
    if (!this.gestartet) this.o.musik.start();
  }

  starten(): void {
    if (this.gestartet) return;
    this.gestartet = true;
    this.o.musik.ausblenden(1.5);
    // Ab jetzt nicht mehr bedienbar: Liegt danach noch der Ladebildschirm darüber, dürfen Tasten das unsichtbare
    // Menü nicht erreichen (sonst öffnet Enter z. B. das Design-Dokument und das ladende Spiel ist weg).
    this.el.inert = true;
    if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.resolve?.();
  }

  /** Sofort abbauen (Ladefehler): Musik aus, Horcher weg, Element entfernen. */
  abbauen(): void {
    this.gestartet = true;
    this.o.musik.ausblenden(0.5);
    for (const f of this.aus) f();
    this.aus = [];
    this.el.remove();
  }

  private taste(e: KeyboardEvent): void {
    if (this.gestartet) return;
    const haupt = (document.activeElement as Element | null)?.classList.contains("mk-haupt");
    if (!(haupt && (e.key === "Enter" || e.key === " "))) this.geste();
    if (e.key === "Escape" && this.tafel) { e.preventDefault(); e.stopPropagation(); this.zeige(null); return; }
    const i = this.knoepfe.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    if (e.key === "Enter") {
      // Selbst auslösen (auch wenn der Browser Enter nicht als Klick weitergibt), ohne doppelte Aktivierung
      e.preventDefault();
      this.knoepfe[i].click();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = this.knoepfe.length;
      this.knoepfe[(i + (e.key === "ArrowDown" ? 1 : n - 1)) % n].focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      this.knoepfe[e.key === "Home" ? 0 : this.knoepfe.length - 1].focus();
    }
  }

  /** Klang- oder Steuerungstafel öffnen (erneuter Klick schließt). */
  private zeige(t: Tafel): void {
    const neu = t === this.tafel ? null : t;
    const vorher = this.tafel;
    this.tafel = neu;
    this.panelHost.textContent = "";
    this.knopfKlang.setAttribute("aria-expanded", String(neu === "klang"));
    this.knopfSteuerung.setAttribute("aria-expanded", String(neu === "steuerung"));
    if (!neu) {
      if (vorher === "klang") this.knopfKlang.focus();
      else if (vorher === "steuerung") this.knopfSteuerung.focus();
      return;
    }
    const zu = h("button.mk-panel-zu", { type: "button", "aria-label": "Schließen", text: "×", onclick: () => this.zeige(null) });
    const panel = neu === "klang" ? this.klangTafel(zu) : this.steuerungTafel(zu);
    this.panelHost.append(panel);
    (panel.querySelector("input, button:not(.mk-panel-zu)") as HTMLElement | null ?? zu).focus({ preventScroll: true });
    if (window.innerWidth <= 760) panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  private steuerungTafel(zu: HTMLElement): HTMLElement {
    const dl = h("dl.mk-tasten");
    for (const [k, v] of STEUERUNG) {
      const dt = h("dt");
      k.split(" / ").forEach((x, i) => { if (i) dt.append(" / "); dt.append(h("kbd", { text: x })); });
      dl.append(dt, h("dd", { text: v }));
    }
    return h("section.mk-start-panel.mk-ecken", { "aria-labelledby": "mk-tafel-titel" }, zu,
      h("h2", { id: "mk-tafel-titel", text: "Steuerung" }), dl);
  }

  private regler(label: string, key: "music" | "voice"): HTMLElement {
    const id = `mk-klang-${key}`;
    const a = this.o.bridge.audio();
    const wert = h("span.mk-klang-wert", { text: `${Math.round(a[key] * 100)} %` });
    const input = h("input.mk-regler", {
      id, type: "range", min: "0", max: "100", step: "5", value: String(Math.round(a[key] * 100)),
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value) / 100;
        this.o.bridge.setAudio({ [key]: v });
        // Regler ziehen ist eine Geste: Titelmusik darf jetzt beginnen
        this.geste();
      },
    });
    input.dataset.key = key;
    return h("div.mk-klang-zeile", null, h("label", { for: id, text: label }), input, wert);
  }

  private klangTafel(zu: HTMLElement): HTMLElement {
    const a = this.o.bridge.audio();
    const stumm = h("input", { type: "checkbox", id: "mk-klang-stumm", onchange: (e: Event) => this.o.bridge.setAudio({ muted: (e.target as HTMLInputElement).checked }) });
    (stumm as HTMLInputElement).checked = a.muted;
    return h("section.mk-start-panel.mk-ecken.mk-klang", { "aria-labelledby": "mk-tafel-titel" }, zu,
      h("h2", { id: "mk-tafel-titel", text: "Klang" }),
      this.regler("Musik", "music"),
      this.regler("Sprecher", "voice"),
      h("label.mk-klang-aus", { for: "mk-klang-stumm" }, stumm, "Ton aus (stumm)"),
      h("p.mk-klang-hinweis", { text: "Die Einstellung gilt auch im Spiel und bleibt im Browser gespeichert. Im Spiel: Lautsprecher-Knopf oben rechts." }));
  }

  private klangAuffrischen(): void {
    if (this.tafel !== "klang") return;
    const a = this.o.bridge.audio();
    for (const input of this.panelHost.querySelectorAll<HTMLInputElement>("input.mk-regler")) {
      const key = input.dataset.key as "music" | "voice";
      const v = Math.round(a[key] * 100);
      if (document.activeElement !== input && input.value !== String(v)) input.value = String(v);
      const out = input.parentElement?.querySelector(".mk-klang-wert");
      if (out) setText(out, `${v} %`);
    }
    const stumm = this.panelHost.querySelector<HTMLInputElement>("#mk-klang-stumm");
    if (stumm) stumm.checked = a.muted;
    this.panelHost.querySelector(".mk-klang")?.classList.toggle("mk-stumm", a.muted);
  }

  /** Weich ausblenden und entfernen. */
  async ausblenden(ms = 700): Promise<void> {
    for (const f of this.aus) f();
    this.aus = [];
    this.el.classList.add("mk-weg");
    await new Promise((r) => window.setTimeout(r, ms));
    this.el.remove();
  }
}
