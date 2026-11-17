/**
 * Startablauf vor dem Spiel: Ladebildschirm mit echtem Fortschritt und Tipps, danach der Titelbildschirm.
 * main.ts meldet die Ladeschritte (schritt/fertig/datei) und wartet mit titel() auf „Neues Spiel“.
 *
 * Nur im Entwicklungsmodus:
 *   ?direkt=1  Titel überspringen (Spiel startet nach dem Laden sofort, wie früher)
 *   ?halten=1  Ladebildschirm nach dem Laden stehen lassen, bis man startet() aufruft oder Enter drückt (Prüfung der Tipps)
 *   ?fehlertest=<schritt>  Ladeschritt (z. B. grafik) mit einem Fehler abbrechen (Prüfung der Fehlermeldung)
 */
import type { UiBridge } from "../../app/contract";
import { LoadProgress, phaseOfAsset, type LoadPhase } from "../../app/progress";
import { TIPS } from "../../data/tips";
import { Ladebildschirm } from "./laden";
import { TitelMusik } from "./musik";
import { Titelbildschirm } from "./titel";

export const LADE_ABSCHNITTE: LoadPhase[] = [
  { id: "code", label: "Spielcode wird geladen", weight: 2 },
  { id: "schriften", label: "Schriften werden geladen", weight: 1 },
  { id: "oberflaeche", label: "Oberfläche und Titelbild werden geladen", weight: 2 },
  { id: "welt", label: "Das Tal wird angelegt", weight: 1 },
  { id: "grafik", label: "Grafik wird vorbereitet", weight: 1 },
  { id: "gebaeude", label: "Gebäude werden geladen", weight: 3 },
  { id: "figuren", label: "Figuren werden geladen", weight: 3 },
  { id: "gelaende", label: "Gelände wird geladen", weight: 2 },
];

/** Bilder für Lade- und Titelbildschirm und die Kacheln der Oberfläche (relativ zur Basis-URL). */
const KARTE = "ui/titel_ladebild_2.png";
const SCHLUESSELBILD = "ui/titel_schluesselbild.png";
const UI_KACHELN = ["ui/holz_kachel.png", "ui/pergament_kachel.png", "ui/stein_kachel.png"];
const SCHRIFTEN = ['700 48px "Cinzel"', '600 16px "Cinzel"', '400 16px "Alegreya Sans"', '700 16px "Alegreya Sans"', '400 16px "Pixelify Sans"'];
/** Ohne Fortschritt so lange: Hinweis „dauert ungewöhnlich lange“. */
const LANGSAM_MS = 25000;
/** Schriften blockieren das Laden höchstens so lange (offline geht es mit Ersatzschrift weiter). */
const SCHRIFT_MS = 6000;

export type StartPhase = "laden" | "titel" | "spiel" | "fehler";

function adresse(pfad: string): string {
  return new URL(pfad, new URL(import.meta.env.BASE_URL || "./", document.baseURI)).href;
}

const naechstesBild = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class Startbildschirm {
  readonly fortschritt = new LoadProgress(LADE_ABSCHNITTE);
  readonly laden = new Ladebildschirm(TIPS);
  phase: StartPhase = "laden";
  musik: TitelMusik | null = null;
  titelbild: Titelbildschirm | null = null;
  private letzterFortschritt = performance.now();
  private letzterWert = -1;
  private wache = 0;
  private schluesselbild: string | null = null;
  private dev = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
  private haltenWeiter: (() => void) | null = null;

  constructor() {
    // Die Hilfe des Spiels (F1) gehört nicht auf Lade- und Titelbildschirm. Dieser Horcher hängt vor dem der
    // Oberfläche (mountUi), weil der Startbildschirm zuerst entsteht.
    window.addEventListener("keydown", (e) => {
      if (e.key === "F1" && this.phase !== "spiel") { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    this.zeichne();
    this.wache = window.setInterval(() => {
      if (this.phase !== "laden") return;
      this.laden.langsam(performance.now() - this.letzterFortschritt > LANGSAM_MS);
    }, 1000);
  }

  private zeichne(): void {
    const f = this.fortschritt.fraction();
    if (f !== this.letzterWert) { this.letzterWert = f; this.letzterFortschritt = performance.now(); }
    this.laden.setze(f, this.fortschritt.label());
  }

  begin(id: string): void { this.fortschritt.begin(id); this.zeichne(); }
  fertig(...ids: string[]): void { for (const id of ids) this.fortschritt.finish(id); this.zeichne(); }

  /** Ein Ladeschritt: anzeigen, dem Browser ein Bild Zeit zum Zeichnen geben, ausführen, als fertig melden. */
  async schritt<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
    this.begin(id);
    await naechstesBild();
    if (this.dev?.get("fehlertest") === id) throw new Error(`Testfehler im Ladeschritt „${id}“ (?fehlertest)`);
    const r = await fn();
    this.fertig(id);
    return r;
  }

  /** Rückruf für loadSheets: Dateien der Sprite-Blätter. */
  datei = (pfad: string, done: boolean): void => {
    const p = phaseOfAsset(pfad);
    if (!p) return;
    if (done) this.fortschritt.tick(p); else this.fortschritt.add(p);
    this.zeichne();
  };

  /** Schriften, Kacheln und Titelbilder parallel zum übrigen Laden. Fehler sind hier nicht fatal. */
  nebenbei(): Promise<void> {
    const schriften = (async () => {
      this.fortschritt.add("schriften", SCHRIFTEN.length);
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      await Promise.all(SCHRIFTEN.map(async (s) => {
        try {
          if (fonts) await Promise.race([fonts.load(s), new Promise((r) => window.setTimeout(r, SCHRIFT_MS))]);
        } catch { /* Ersatzschrift */ }
        this.fortschritt.tick("schriften");
        this.zeichne();
      }));
      this.fertig("schriften");
    })();
    const bilder = (async () => {
      const liste = [KARTE, SCHLUESSELBILD, ...UI_KACHELN];
      this.fortschritt.add("oberflaeche", liste.length);
      await Promise.all(liste.map(async (p) => {
        const url = adresse(p);
        const ok = await new Promise<boolean>((res) => {
          const im = new Image();
          im.decoding = "async";
          im.onload = () => { (im.decode ? im.decode().catch(() => undefined) : Promise.resolve()).then(() => res(true)); };
          im.onerror = () => res(false);
          im.src = url;
        });
        if (!ok) console.warn(`[Start] Bild ${p} fehlt`);
        if (ok && p === KARTE && this.phase === "laden") this.laden.bild(url);
        if (ok && p === SCHLUESSELBILD) this.schluesselbild = url;
        this.fortschritt.tick("oberflaeche");
        this.zeichne();
      }));
      this.fertig("oberflaeche");
    })();
    return Promise.all([schriften, bilder]).then(() => undefined);
  }

  /** Laden fehlgeschlagen: Meldung statt ewigem Balken. */
  fehler(e: unknown): void {
    this.phase = "fehler";
    window.clearInterval(this.wache);
    const msg = e instanceof Error ? e.message : String(e);
    const webgl = /webgl|context|renderer|gpu/i.test(msg);
    this.fortschritt.fail(msg);
    this.laden.stop();
    this.laden.fehler(
      "Das Spiel konnte nicht starten",
      webgl
        ? "Die Grafik ließ sich nicht einrichten. Das Spiel braucht WebGL; bitte die Hardwarebeschleunigung im Browser einschalten oder einen anderen Browser versuchen."
        : "Beim Laden ist ein Fehler aufgetreten. Meist hilft es, die Seite neu zu laden.",
      msg,
    );
    // Titel oder Spiel bleiben verborgen
    this.titelbild?.el.remove();
  }

  /**
   * Nach dem Laden: Titelbildschirm zeigen und warten, bis „Neues Spiel“ gewählt wird.
   * Der Klick darauf ist die Nutzergeste, die die Audio-Regie freischaltet (Begrüßung, Aufbaumusik).
   */
  async titel(bridge: UiBridge): Promise<void> {
    window.clearInterval(this.wache);
    this.zeichne();
    if (this.dev?.has("halten")) {
      await new Promise<void>((r) => {
        this.haltenWeiter = r;
        const k = (e: KeyboardEvent) => { if (e.key === "Enter") { window.removeEventListener("keydown", k, true); r(); } };
        window.addEventListener("keydown", k, true);
      });
    }
    if (this.dev?.has("direkt")) {
      this.phase = "spiel";
      await this.laden.ausblenden(0);
      return;
    }
    this.musik = new TitelMusik(() => bridge.audio());
    // Konzeptseite liegt neben dem Spiel unter /konzept/ (Build: nginx, Entwicklung: Middleware in vite.config.ts)
    this.titelbild = new Titelbildschirm({ bridge, musik: this.musik, bild: this.schluesselbild, konzept: "./konzept/" });
    const gewaehlt = this.titelbild.zeigen();
    this.phase = "titel";
    await this.laden.ausblenden(600);
    await gewaehlt;
  }

  /** Nur ?halten=1: Ladebildschirm verlassen. */
  weiter(): void { this.haltenWeiter?.(); }

  /** Titel weich ausblenden, sobald das Spiel sein erstes Bild gezeichnet hat. */
  async insSpiel(): Promise<void> {
    this.phase = "spiel";
    await naechstesBild();
    await naechstesBild();
    await this.titelbild?.ausblenden(700);
    this.titelbild = null;
  }

  /** Titel per Code auslösen (Tests im Entwicklungsmodus). */
  starten(): void {
    if (this.phase === "laden") this.weiter();
    this.titelbild?.starten();
  }
}
