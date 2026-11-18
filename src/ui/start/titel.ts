/**
 * Titelbildschirm (DOM): Schlüsselbild vollflächig (cover, Vignette, sehr langsamer Schwenk), Wappen und Schriftzug,
 * Menü „Fortsetzen“ (neuester Spielstand, nur wenn einer da ist), „Neues Spiel“ (Tafel mit Ziel und
 * Schwierigkeitsgrad aus den Daten), „Laden“ (Tafel mit allen Plätzen), „Klang“, „Steuerung“ und „Design-Dokument“
 * (Link auf die Konzeptseite unter /konzept/). ADR 0019.
 * Der Titel steht schon, während das Spiel dahinter noch lädt (src/ui/start/index.ts).
 *
 * Tastatur: Pfeile hoch/runter wandern durchs Menü, Enter löst aus (ohne Fokus startet Enter ein neues Spiel auf
 * „Normal“), Esc schließt eine offene Tafel. Spricht nur über die UiBridge (Klang, Spielstände) mit dem Spiel.
 */
import type { SaveInfo, UiBridge } from "../../app/contract";
import { latest } from "../../app/saves";
import { DEFAULT_DIFFICULTY, DEFAULT_SCENARIO, DIFFICULTIES, DIFFICULTY_KEYS, SCENARIOS, type DifficultyKey, type SaveSlotKey } from "../../data";
import { STEUERUNG } from "../../data/tips";
import { h, setText } from "../dom";
import { describeSave, slotLabel, slotList } from "../spielstaende";
import type { TitelMusik } from "./musik";

/** Was der Spieler im Titel gewählt hat. */
export type TitelWahl = { k: "neu"; difficulty: DifficultyKey } | { k: "laden"; slot: SaveSlotKey };

export interface TitelOptionen {
  bridge: UiBridge;
  musik: TitelMusik;
  /** Adresse des Schlüsselbilds oder null (dann Holzgrund). */
  bild: string | null;
  /** Adresse der Konzeptseite (Menüpunkt „Design-Dokument“) oder null (kein Menüpunkt). */
  konzept: string | null;
  /** Wahl ausführen (Partie anlegen oder Spielstand laden); wirft mit Spielertext, dann bleibt der Titel stehen. */
  waehlen: (w: TitelWahl) => Promise<void>;
}

type Tafel = "klang" | "steuerung" | "neu" | "laden" | null;

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
  private knopfNeu!: HTMLButtonElement;
  private knopfLaden!: HTMLButtonElement;
  private knopfWeiter!: HTMLButtonElement;
  /** Spielstände (nach dem Einhängen gelesen). */
  private staende: SaveInfo[] = [];
  private schwierigkeit: DifficultyKey = DEFAULT_DIFFICULTY;
  private fehlerBox!: HTMLElement;
  private gestartet = false;
  private resolve: (() => void) | null = null;
  private aus: (() => void)[] = [];

  constructor(private o: TitelOptionen) {
    const bildBox = h("div.mk-titel-bild");
    if (o.bild) {
      const img = h("img", { src: o.bild, alt: "", decoding: "async", draggable: "false" });
      bildBox.append(img);
    }
    this.knopfWeiter = h("button.mk-menue-knopf.mk-haupt.mk-weiter", { type: "button", text: "Fortsetzen", onclick: () => this.fortsetzen() });
    this.knopfWeiter.hidden = true;
    this.knopfNeu = h("button.mk-menue-knopf.mk-neu", { type: "button", text: "Neues Spiel", "aria-expanded": "false", "aria-controls": "mk-tafel", onclick: () => this.zeige("neu") });
    this.knopfLaden = h("button.mk-menue-knopf", { type: "button", text: "Laden", "aria-expanded": "false", "aria-controls": "mk-tafel", onclick: () => this.zeige("laden") });
    this.knopfKlang = h("button.mk-menue-knopf", { type: "button", text: "Klang", "aria-expanded": "false", "aria-controls": "mk-tafel", onclick: () => this.zeige("klang") });
    this.knopfSteuerung = h("button.mk-menue-knopf", { type: "button", text: "Steuerung", "aria-expanded": "false", "aria-controls": "mk-tafel", onclick: () => this.zeige("steuerung") });
    const items: HTMLElement[] = [this.knopfWeiter, this.knopfNeu, this.knopfLaden, this.knopfKlang, this.knopfSteuerung];
    if (o.konzept) items.push(h("a.mk-menue-knopf", { href: o.konzept, text: "Design-Dokument", title: "Spiel- und Technikkonzept mit Schaubildern" }));
    this.knoepfe = items.filter((k) => !k.hidden);
    this.fehlerBox = h("p.mk-titel-fehler", { role: "alert" });
    this.fehlerBox.hidden = true;
    this.menue = h("nav.mk-menue", { "aria-label": "Hauptmenü" }, ...items, this.fehlerBox);
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
    // Spielstände lesen: Gibt es einen, steht „Fortsetzen“ oben (und hat den Fokus)
    void this.o.bridge.saves.list().then((list) => {
      this.staende = list;
      const neu = latest(list);
      if (this.tafel === "laden") this.zeige("laden", true);
      if (!neu || this.gestartet) return;
      const fokus = document.activeElement === this.knoepfe[0] || !this.el.contains(document.activeElement);
      this.knopfWeiter.hidden = false;
      this.knopfWeiter.title = `${slotLabel(neu.slot)}: ${describeSave(neu)}`;
      this.knopfWeiter.setAttribute("aria-label", `Fortsetzen: ${slotLabel(neu.slot)}, ${describeSave(neu)}`);
      this.knoepfe = [this.knopfWeiter, ...this.knoepfe.filter((k) => k !== this.knopfWeiter)];
      if (fokus) this.knopfWeiter.focus({ preventScroll: true });
    });
    return new Promise((r) => { this.resolve = r; if (this.gestartet) r(); });
  }

  /** Neuesten Spielstand laden. */
  private fortsetzen(): void {
    const neu = latest(this.staende);
    if (neu) void this.waehle({ k: "laden", slot: neu.slot });
  }

  /** Wahl ausführen; bei Fehler bleibt der Titel stehen und zeigt den Grund. */
  private async waehle(w: TitelWahl): Promise<void> {
    if (this.gestartet) return;
    this.gestartet = true;
    this.fehlerBox.hidden = true;
    this.el.classList.add("mk-titel-wartet");
    try {
      await this.o.waehlen(w);
    } catch (e) {
      this.gestartet = false;
      this.el.classList.remove("mk-titel-wartet");
      this.fehlerBox.textContent = `${w.k === "laden" ? "Laden fehlgeschlagen" : "Start fehlgeschlagen"}: ${(e as Error).message}`;
      this.fehlerBox.hidden = false;
      return;
    }
    this.o.musik.ausblenden(1.5);
    // Ab jetzt nicht mehr bedienbar: Liegt danach noch der Ladebildschirm darüber, dürfen Tasten das unsichtbare
    // Menü nicht erreichen (sonst öffnet Enter z. B. das Design-Dokument und das ladende Spiel ist weg).
    this.el.inert = true;
    if (this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.resolve?.();
  }

  /** Erste Geste: Titelmusik (falls nicht stumm, das regelt die Lautstärke). */
  private geste(): void {
    if (!this.gestartet) this.o.musik.start();
  }

  /** Neues Spiel mit dem gewählten Schwierigkeitsgrad (Standard: Normal). */
  starten(): void {
    void this.waehle({ k: "neu", difficulty: this.schwierigkeit });
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

  /** Tafel öffnen (erneuter Klick schließt; neuZeichnen: dieselbe Tafel mit frischen Daten, ohne Fokuswechsel). */
  private zeige(t: Tafel, neuZeichnen = false): void {
    const neu = t === this.tafel && !neuZeichnen ? null : t;
    const vorher = this.tafel;
    this.tafel = neu;
    this.panelHost.textContent = "";
    const knopf: Record<Exclude<Tafel, null>, HTMLButtonElement> = { klang: this.knopfKlang, steuerung: this.knopfSteuerung, neu: this.knopfNeu, laden: this.knopfLaden };
    for (const [k, b] of Object.entries(knopf)) b.setAttribute("aria-expanded", String(neu === k));
    if (!neu) {
      if (vorher) knopf[vorher].focus();
      return;
    }
    const zu = h("button.mk-panel-zu", { type: "button", "aria-label": "Schließen", text: "×", onclick: () => this.zeige(null) });
    const panel = neu === "klang" ? this.klangTafel(zu) : neu === "steuerung" ? this.steuerungTafel(zu)
      : neu === "neu" ? this.neuTafel(zu) : this.ladenTafel(zu);
    if (neuZeichnen && vorher === neu) { this.panelHost.append(panel); return; }
    this.panelHost.append(panel);
    (panel.querySelector("input, button:not(.mk-panel-zu)") as HTMLElement | null ?? zu).focus({ preventScroll: true });
    if (window.innerWidth <= 760) panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /** Neues Spiel: Ziel des Szenarios und Schwierigkeitsgrad (Daten), dann „Beginnen“. */
  private neuTafel(zu: HTMLElement): HTMLElement {
    const sc = SCENARIOS[DEFAULT_SCENARIO];
    const wahl = h("div.mk-schwierigkeit", { role: "radiogroup", "aria-label": "Schwierigkeitsgrad" });
    const zeichnen = () => {
      wahl.textContent = "";
      for (const k of DIFFICULTY_KEYS) {
        const d = DIFFICULTIES[k];
        const on = k === this.schwierigkeit;
        wahl.append(h(`button.mk-stufe${on ? ".mk-an" : ""}` as "button", {
          type: "button", role: "radio", "aria-checked": String(on), "data-stufe": k,
          onclick: () => { this.schwierigkeit = k; zeichnen(); (wahl.querySelector(`[data-stufe="${k}"]`) as HTMLElement).focus(); },
        }, h("strong", { text: d.name }), h("span", { text: d.text })));
      }
    };
    zeichnen();
    const los = h("button.mk-menue-knopf.mk-haupt.mk-beginnen", { type: "button", text: "Beginnen", onclick: () => this.starten() });
    return h("section.mk-start-panel.mk-ecken.mk-neu-tafel", { "aria-labelledby": "mk-tafel-titel" }, zu,
      h("h2", { id: "mk-tafel-titel", text: "Neues Spiel" }),
      h("p.mk-auftrag", null, h("strong", { text: `${sc.name}: ` }), sc.text),
      h("p.mk-klang-hinweis", { text: sc.niederlage }),
      wahl, los);
  }

  /** Laden: alle belegten Plätze. */
  private ladenTafel(zu: HTMLElement): HTMLElement {
    const liste = slotList({ mode: "laden", infos: this.staende, buttonClass: "mk-menue-knopf", pick: (slot) => void this.waehle({ k: "laden", slot }) });
    const hinweis = this.o.bridge.saves.persistent() ? null
      : h("p.mk-klang-hinweis", { text: "Der Browser erlaubt keine dauerhafte Ablage: Spielstände gelten nur, solange dieser Tab offen ist." });
    return h("section.mk-start-panel.mk-ecken.mk-laden-tafel", { "aria-labelledby": "mk-tafel-titel" }, zu,
      h("h2", { id: "mk-tafel-titel", text: "Laden" }), liste, hinweis);
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
