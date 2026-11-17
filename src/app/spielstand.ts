/**
 * Spielstände der laufenden Sitzung (ADR 0019): verbindet die Ablage (saves.ts) mit der Simulation.
 *
 * - Speichern: Simulation.save() auf einen Platz, mit Übersicht (SaveInfo).
 * - Laden: Simulation.restore() an Ort und Stelle; Spielschleife, Eingabe, Darstellung und Audio behalten ihre
 *   Verweise auf dieselbe Simulation. Danach räumt `afterLoad` (main.ts) Auswahl, Darstellungsspuren und Ansagen auf.
 * - Automatisch: alle AUTOSAVE_SECONDS Spielsekunden auf den Platz „auto“ (autosave(), jedes Bild aufgerufen).
 */
import { AUTOSAVE_SECONDS, TICKS_PER_SECOND, type SaveSlotKey } from "../data";
import type { Simulation } from "../sim/game";
import type { SaveApi } from "./contract";
import { saveInfo, type SaveBackend, type SaveInfo } from "./saves";

export class SaveSession implements SaveApi {
  private backend: SaveBackend | null = null;
  private lastAuto: number;
  private busy = false;

  constructor(private game: Simulation, private ready: Promise<SaveBackend>, private afterLoad: () => void, private warn: (text: string) => void) {
    this.lastAuto = game.state.tick;
    void ready.then((b) => { this.backend = b; }, () => undefined);
  }

  private async store(): Promise<SaveBackend> {
    return this.backend ?? (this.backend = await this.ready);
  }

  persistent(): boolean { return this.backend ? this.backend.persistent : true; }

  async list(): Promise<SaveInfo[]> {
    try { return await (await this.store()).list(); } catch { return []; }
  }

  async save(slot: SaveSlotKey): Promise<SaveInfo> {
    const b = await this.store();
    let data: string;
    try { data = this.game.save(); } catch (e) { throw new Error(`Der Spielstand ließ sich nicht erzeugen (${(e as Error).message}).`); }
    const info = saveInfo(slot, this.game.state, data.length);
    await b.write(info, data);
    if (slot === "auto") this.lastAuto = this.game.state.tick;
    return info;
  }

  async load(slot: SaveSlotKey): Promise<void> {
    const b = await this.store();
    const data = await b.read(slot);
    if (!data) throw new Error("Auf diesem Platz liegt kein Spielstand.");
    this.game.restore(data); // wirft mit Spielertext (Version, beschädigt)
    this.lastAuto = this.game.state.tick;
    this.afterLoad();
  }

  async remove(slot: SaveSlotKey): Promise<void> {
    await (await this.store()).remove(slot);
  }

  /** Nach einem Partiewechsel ohne Laden (neues Spiel): Zähler für das automatische Speichern zurücksetzen. */
  restarted(): void { this.lastAuto = this.game.state.tick; }

  /** Jedes Bild: fällig, dann im Hintergrund auf „auto“ speichern. Fehler einmal melden. */
  autosave(): void {
    if (!AUTOSAVE_SECONDS || this.busy) return;
    const t = this.game.state.tick;
    if (t - this.lastAuto < AUTOSAVE_SECONDS * TICKS_PER_SECOND) return;
    this.lastAuto = t;
    this.busy = true;
    this.save("auto").catch((e: Error) => this.warn(`Automatisch speichern fehlgeschlagen: ${e.message}`)).finally(() => { this.busy = false; });
  }
}
