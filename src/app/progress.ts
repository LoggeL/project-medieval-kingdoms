/**
 * Ladefortschritt und Tippwechsel für den Ladebildschirm, als reine Logik ohne DOM (tests/app/progress.test.ts).
 *
 * Fortschritt: Das Laden ist in Abschnitte mit Gewicht geteilt (Spielcode, Schriften, Oberfläche, Welt, Grafik,
 * Gebäude, Figuren, Gelände). Ein Abschnitt zählt erledigt, wenn finish() kam. Davor zählen nur tatsächlich geladene
 * Dateien (add/tick), höchstens bis 95 %, weil nach den Dateien noch Verarbeitung folgt. Es gibt keinen Zeitfortschritt:
 * Steht das Laden, steht der Balken. Die Anzeige läuft nie rückwärts, auch wenn ein Abschnitt neue Dateien entdeckt
 * (z. B. Bilder erst nach dem Lesen von sheet.json).
 */

export interface LoadPhase {
  id: string;
  /** Text für den Ladebildschirm, z. B. „Gebäude werden geladen“. */
  label: string;
  weight: number;
}

interface PhaseState { started: boolean; finished: boolean; items: number; done: number }

/** Anteil eines Abschnitts mit Dateien, solange er nicht abgeschlossen ist. */
export const PHASE_CAP = 0.95;

export class LoadProgress {
  private states = new Map<string, PhaseState>();
  private shown = 0;
  private failed: string | null = null;

  constructor(readonly phases: LoadPhase[]) {
    for (const p of phases) this.states.set(p.id, { started: false, finished: false, items: 0, done: 0 });
  }

  private st(id: string): PhaseState {
    const s = this.states.get(id);
    if (!s) throw new Error(`Unbekannter Ladeabschnitt: ${id}`);
    return s;
  }

  begin(id: string): void { this.st(id).started = true; }

  /** n weitere Dateien in diesem Abschnitt angemeldet. */
  add(id: string, n = 1): void { const s = this.st(id); s.started = true; s.items += n; }

  /** n Dateien fertig (auch wenn eine fehlt: fertig heißt „nicht mehr unterwegs“). */
  tick(id: string, n = 1): void { const s = this.st(id); s.done = Math.min(s.items, s.done + n); }

  finish(id: string): void { const s = this.st(id); s.started = true; s.finished = true; s.done = s.items; }

  fail(message: string): void { this.failed = message; }
  get error(): string | null { return this.failed; }

  /** Anteil eines Abschnitts (0..1). */
  phaseFraction(id: string): number {
    const s = this.st(id);
    if (s.finished) return 1;
    if (s.items === 0) return 0;
    return Math.min(PHASE_CAP, s.done / s.items);
  }

  /** Gesamtfortschritt 0..1, nie kleiner als beim letzten Aufruf. */
  fraction(): number {
    let sum = 0, total = 0;
    for (const p of this.phases) { sum += p.weight * this.phaseFraction(p.id); total += p.weight; }
    const f = total > 0 ? sum / total : 1;
    this.shown = Math.max(this.shown, f);
    return this.shown;
  }

  complete(): boolean { return this.phases.every((p) => this.st(p.id).finished); }

  /** Text des ersten begonnenen, noch nicht fertigen Abschnitts (sonst des ersten offenen). */
  label(): string {
    const open = this.phases.filter((p) => !this.st(p.id).finished);
    if (!open.length) return "Bereit";
    return (open.find((p) => this.st(p.id).started) ?? open[0]).label;
  }
}

/** Ordnet eine Datei des Sprite-Ladens (Pfad relativ zur Basis) ihrem Ladeabschnitt zu. */
export function phaseOfAsset(path: string): "gebaeude" | "figuren" | "gelaende" | null {
  if (path.startsWith("buildings/")) return "gebaeude";
  if (path.startsWith("figures/")) return "figuren";
  if (path.startsWith("terrain/")) return "gelaende";
  return null;
}

/**
 * Reihenfolge der Tipps: gemischt, jeder kommt einmal dran, bevor sich einer wiederholt, und an der Grenze zweier
 * Durchgänge steht nie zweimal derselbe hintereinander.
 */
export class TipRotation {
  private order: number[] = [];
  private pos = 0;
  private last = -1;

  constructor(private count: number, private rand: () => number = Math.random) {
    if (count < 1) throw new Error("Keine Tipps");
  }

  private shuffle(): void {
    const a = Array.from({ length: this.count }, (_, i) => i);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(this.rand() * (i + 1)));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (a.length > 1 && a[0] === this.last) [a[0], a[1]] = [a[1], a[0]];
    this.order = a;
    this.pos = 0;
  }

  next(): number {
    if (this.pos >= this.order.length) this.shuffle();
    this.last = this.order[this.pos++];
    return this.last;
  }
}

/** Abstand zwischen zwei Tipps (ms): 6–8 s, längere Tipps etwas länger. */
export function tipDuration(text: string): number {
  return Math.round(Math.min(8000, Math.max(6000, 4500 + text.length * 25)));
}
