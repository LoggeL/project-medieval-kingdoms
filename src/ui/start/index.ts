/**
 * Startablauf vor dem Spiel: Der Titelbildschirm erscheint, sobald Spielcode, Schriften und Schlüsselbild da sind;
 * Welt, Grafik und Sprite-Blätter laden dahinter weiter. Wer „Neues Spiel“ wählt, bevor alles geladen ist, sieht den
 * Ladebildschirm mit echtem Fortschritt und Tipps, bis das Spiel bereit ist; sonst geht es direkt ins Spiel.
 * main.ts meldet die Ladeschritte (schritt/fertig/datei), zeigt mit titel() das Menü, meldet mit geladen() das Ende
 * des Ladens und wartet mit bereit() auf beides.
 *
 * Nur im Entwicklungsmodus:
 *   ?direkt=1  Titel überspringen (Ladebildschirm bis zum Ende, dann sofort ins Spiel, wie früher)
 *   ?halten=1  Ladebildschirm nach dem Laden stehen lassen, bis man startet() aufruft oder Enter drückt (Prüfung der Tipps;
 *              zusammen mit dem Titel: erst „Neues Spiel“ wählen, solange noch geladen wird)
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
/** Der Titel wartet höchstens so lange auf Schriften und Schlüsselbild; kommt das Bild später, wird es nachgereicht. */
const TITEL_WARTEN_MS = 2500;

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
  /** Schriften und Schlüsselbild für den Titel (nebenbei()). */
  private vorTitel: Promise<void> = Promise.resolve();
  /** Alles geladen (main.ts ruft geladen()). */
  private istGeladen = false;
  private geladenSignal: (() => void) | null = null;
  private readonly geladenPromise = new Promise<void>((r) => { this.geladenSignal = r; });
  /** Erfüllt, sobald „Neues Spiel“ gewählt ist (oder ?direkt=1). */
  private gewaehlt: Promise<void> = new Promise(() => undefined);
  /** Ladebildschirm ist gerade sichtbar (am Anfang aus index.html, später nach „Neues Spiel“ vor Ende des Ladens). */
  private ladenSichtbar = true;

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
    let schluesselbildDa: () => void = () => undefined;
    const schluessel = new Promise<void>((r) => { schluesselbildDa = r; });
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
        if (ok && p === KARTE) this.laden.bild(url);
        if (ok && p === SCHLUESSELBILD) { this.schluesselbild = url; this.titelbild?.bild(url); }
        if (p === SCHLUESSELBILD) schluesselbildDa();
        this.fortschritt.tick("oberflaeche");
        this.zeichne();
      }));
      this.fertig("oberflaeche");
    })();
    this.vorTitel = Promise.all([schriften, schluessel]).then(() => undefined);
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
   * Titelbildschirm zeigen, sobald Schriften und Schlüsselbild da sind (höchstens TITEL_WARTEN_MS); das Laden läuft
   * dahinter weiter. Kehrt zurück, sobald der Titel steht (bzw. sofort bei ?direkt=1); auf die Wahl wartet bereit().
   * Der Klick auf „Neues Spiel“ ist die Nutzergeste, die die Audio-Regie freischaltet (Begrüßung, Aufbaumusik).
   */
  async titel(bridge: UiBridge): Promise<void> {
    if (this.dev?.has("direkt")) { this.gewaehlt = Promise.resolve(); return; }
    await Promise.race([this.vorTitel, new Promise((r) => window.setTimeout(r, TITEL_WARTEN_MS))]);
    if (this.phase === "fehler") return;
    this.musik = new TitelMusik(() => bridge.audio());
    // Konzeptseite liegt neben dem Spiel unter /konzept/ (Build: nginx, Entwicklung: Middleware in vite.config.ts)
    this.titelbild = new Titelbildschirm({ bridge, musik: this.musik, bild: this.schluesselbild, konzept: "./konzept/" });
    this.gewaehlt = this.titelbild.zeigen().then(() => this.gewaehltNochLaden());
    this.phase = "titel";
    this.ladenSichtbar = false;
    // Tipps und Hänger-Hinweis ruhen, solange der Titel steht (das Laden selbst läuft weiter)
    await this.laden.ausblenden(600);
  }

  /** „Neues Spiel“ gewählt: Ist noch nicht alles geladen, kommt der Ladebildschirm über den Titel. */
  private gewaehltNochLaden(): void {
    if (this.istGeladen || this.phase === "fehler") return;
    this.phase = "laden";
    this.ladenSichtbar = true;
    this.letzterFortschritt = performance.now();
    this.laden.zeigen();
    this.zeichne();
    const titel = this.titelbild;
    window.setTimeout(() => { if (titel && this.titelbild === titel) titel.el.classList.add("mk-weg"); }, 350);
  }

  /** main.ts: Welt, Grafik und Sprite-Blätter sind geladen. */
  geladen(): void {
    this.istGeladen = true;
    window.clearInterval(this.wache);
    this.zeichne();
    this.geladenSignal?.();
  }

  /** Warten, bis „Neues Spiel“ gewählt UND alles geladen ist (danach main.ts: Eingabe, Schleife, insSpiel()). */
  async bereit(): Promise<void> {
    await Promise.all([this.gewaehlt, this.geladenPromise]);
    if (this.dev?.has("halten") && this.ladenSichtbar) {
      await new Promise<void>((r) => {
        this.haltenWeiter = r;
        const k = (e: KeyboardEvent) => { if (e.key === "Enter") { window.removeEventListener("keydown", k, true); r(); } };
        window.addEventListener("keydown", k, true);
      });
    }
  }

  /** Nur ?halten=1: Ladebildschirm verlassen. */
  weiter(): void { this.haltenWeiter?.(); }

  /** Titel bzw. Ladebildschirm weich ausblenden, sobald das Spiel sein erstes Bild gezeichnet hat. */
  async insSpiel(): Promise<void> {
    this.phase = "spiel";
    await naechstesBild();
    await naechstesBild();
    const weg: Promise<void>[] = [];
    if (this.ladenSichtbar) { this.ladenSichtbar = false; weg.push(this.laden.ausblenden(600)); }
    if (this.titelbild) weg.push(this.titelbild.ausblenden(700));
    await Promise.all(weg);
    this.titelbild = null;
  }

  /** Titel per Code auslösen (Tests im Entwicklungsmodus). */
  starten(): void {
    if (this.phase === "laden" && this.istGeladen) this.weiter();
    this.titelbild?.starten();
  }
}
