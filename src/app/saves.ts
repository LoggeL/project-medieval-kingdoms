/**
 * Spielstände im Browser (ADR 0019): Plätze aus SAVE_SLOTS (src/data/spielziel.ts), je Platz der Spielstand
 * (Simulation.save, JSON) und eine kleine Übersicht (SaveInfo) für Menüs, ohne den Stand selbst zu lesen.
 *
 * Ablage: IndexedDB (Datenbank „medieval-kingdoms“, Speicher „info“ und „daten“), sonst localStorage (Schlüssel
 * mk-save-<platz> und mk-save-index), sonst nur im Arbeitsspeicher dieser Sitzung (privater Modus, gesperrter Speicher).
 * Jeder Zugriff ist abgesichert; Fehler kommen als Error mit Spielertext zurück, nie als Absturz.
 */
import { SAVE_SLOT_KEYS, SAVE_SLOTS, type DifficultyKey, type SaveSlotKey, type ScenarioKey } from "../data";
import type { SimState } from "../sim/types";

/** Übersicht eines Spielstands (für Titel, Laden-Tafel und „Fortsetzen“). */
export interface SaveInfo {
  slot: SaveSlotKey;
  /** Zeitpunkt des Speicherns (Date.now()). */
  time: number;
  /** Spielzeit in Ticks, Welle, Bevölkerung, Ausgang. */
  tick: number;
  wave: number;
  population: number;
  outcome: SimState["outcome"] | null;
  scenario: ScenarioKey | null;
  difficulty: DifficultyKey;
  /** Größe des Spielstands in Zeichen. */
  size: number;
}

export interface SaveBackend {
  /** „IndexedDB“, „localStorage“ oder „Arbeitsspeicher“. */
  readonly kind: string;
  /** Bleiben Spielstände über das Schließen des Tabs hinaus erhalten? */
  readonly persistent: boolean;
  list(): Promise<SaveInfo[]>;
  read(slot: SaveSlotKey): Promise<string | null>;
  write(info: SaveInfo, data: string): Promise<void>;
  remove(slot: SaveSlotKey): Promise<void>;
}

/** Übersicht aus dem Zustand bilden. */
export function saveInfo(slot: SaveSlotKey, s: SimState, size: number, time = Date.now()): SaveInfo {
  return {
    slot, time, tick: s.tick, wave: s.raid.wave, population: s.population, outcome: s.outcome ?? null,
    scenario: s.match?.scenario ?? null, difficulty: s.match?.difficulty ?? "normal", size,
  };
}

const isSlot = (x: unknown): x is SaveSlotKey => typeof x === "string" && (SAVE_SLOT_KEYS as string[]).includes(x);
const validInfo = (x: unknown): x is SaveInfo =>
  !!x && typeof x === "object" && isSlot((x as SaveInfo).slot) && typeof (x as SaveInfo).time === "number" && typeof (x as SaveInfo).tick === "number";

/** Plätze in der Reihenfolge der Daten. */
export function sortInfos(list: SaveInfo[]): SaveInfo[] {
  return [...list].sort((a, b) => SAVE_SLOT_KEYS.indexOf(a.slot) - SAVE_SLOT_KEYS.indexOf(b.slot));
}

/** Neuester Spielstand (für „Fortsetzen“) oder null. */
export function latest(list: SaveInfo[]): SaveInfo | null {
  let best: SaveInfo | null = null;
  for (const i of list) if (!best || i.time > best.time) best = i;
  return best;
}

/** Fehlertext für den Spieler. */
function quotaText(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (/quota/i.test(name) || /quota/i.test(String(e))) return "Der Speicher des Browsers ist voll. Lösche einen alten Spielstand.";
  return "Der Browser hat das Speichern abgelehnt.";
}

// ---------------------------------------------------------------- Arbeitsspeicher
export class MemoryBackend implements SaveBackend {
  readonly kind = "Arbeitsspeicher";
  readonly persistent = false;
  private infos = new Map<SaveSlotKey, SaveInfo>();
  private data = new Map<SaveSlotKey, string>();
  async list(): Promise<SaveInfo[]> { return sortInfos([...this.infos.values()]); }
  async read(slot: SaveSlotKey): Promise<string | null> { return this.data.get(slot) ?? null; }
  async write(info: SaveInfo, data: string): Promise<void> { this.infos.set(info.slot, { ...info }); this.data.set(info.slot, data); }
  async remove(slot: SaveSlotKey): Promise<void> { this.infos.delete(slot); this.data.delete(slot); }
}

// ---------------------------------------------------------------- localStorage
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class LocalBackend implements SaveBackend {
  readonly kind = "localStorage";
  readonly persistent = true;
  static readonly INDEX = "mk-save-index";
  static key(slot: SaveSlotKey): string { return `mk-save-${slot}`; }
  constructor(private ls: StorageLike) {}

  private index(): SaveInfo[] {
    try {
      const v = JSON.parse(this.ls.getItem(LocalBackend.INDEX) ?? "[]") as unknown;
      return Array.isArray(v) ? v.filter(validInfo) : [];
    } catch { return []; }
  }

  async list(): Promise<SaveInfo[]> { return sortInfos(this.index()); }

  async read(slot: SaveSlotKey): Promise<string | null> {
    try { return this.ls.getItem(LocalBackend.key(slot)); } catch { throw new Error("Der Browser verweigert den Zugriff auf die Spielstände."); }
  }

  async write(info: SaveInfo, data: string): Promise<void> {
    const rest = this.index().filter((i) => i.slot !== info.slot);
    try {
      this.ls.setItem(LocalBackend.key(info.slot), data);
      this.ls.setItem(LocalBackend.INDEX, JSON.stringify([...rest, info]));
    } catch (e) {
      // halb geschriebene Plätze nicht stehen lassen: Index ohne diesen Platz, Daten entfernen
      try { this.ls.removeItem(LocalBackend.key(info.slot)); this.ls.setItem(LocalBackend.INDEX, JSON.stringify(rest)); } catch { /* nichts mehr zu retten */ }
      throw new Error(quotaText(e));
    }
  }

  async remove(slot: SaveSlotKey): Promise<void> {
    try {
      this.ls.removeItem(LocalBackend.key(slot));
      this.ls.setItem(LocalBackend.INDEX, JSON.stringify(this.index().filter((i) => i.slot !== slot)));
    } catch { /* gesperrt: nichts zu tun */ }
  }
}

// ---------------------------------------------------------------- IndexedDB
const DB = "medieval-kingdoms";
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error("abgebrochen"));
  });
}

export class IdbBackend implements SaveBackend {
  readonly kind = "IndexedDB";
  readonly persistent = true;
  private constructor(private db: IDBDatabase) {}

  /** Datenbank öffnen; wirft, wenn IndexedDB fehlt oder gesperrt ist. */
  static async open(idb: IDBFactory = indexedDB, timeoutMs = 3000): Promise<IdbBackend> {
    const r = idb.open(DB, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("info")) db.createObjectStore("info", { keyPath: "slot" });
      if (!db.objectStoreNames.contains("daten")) db.createObjectStore("daten");
    };
    const db = await Promise.race([
      req(r),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("IndexedDB antwortet nicht")), timeoutMs)),
    ]);
    return new IdbBackend(db);
  }

  async list(): Promise<SaveInfo[]> {
    const tx = this.db.transaction("info", "readonly");
    const all = await req(tx.objectStore("info").getAll() as IDBRequest<unknown[]>);
    return sortInfos(all.filter(validInfo));
  }

  async read(slot: SaveSlotKey): Promise<string | null> {
    const tx = this.db.transaction("daten", "readonly");
    const v = await req(tx.objectStore("daten").get(slot) as IDBRequest<unknown>);
    return typeof v === "string" ? v : null;
  }

  async write(info: SaveInfo, data: string): Promise<void> {
    try {
      const tx = this.db.transaction(["info", "daten"], "readwrite");
      tx.objectStore("daten").put(data, info.slot);
      tx.objectStore("info").put({ ...info });
      await done(tx);
    } catch (e) {
      throw new Error(quotaText(e));
    }
  }

  async remove(slot: SaveSlotKey): Promise<void> {
    const tx = this.db.transaction(["info", "daten"], "readwrite");
    tx.objectStore("daten").delete(slot);
    tx.objectStore("info").delete(slot);
    await done(tx);
  }
}

/** Beste verfügbare Ablage: IndexedDB, sonst localStorage, sonst Arbeitsspeicher. */
export async function openSaveBackend(): Promise<SaveBackend> {
  try {
    if (typeof indexedDB !== "undefined") return await IdbBackend.open();
  } catch (e) { console.warn("[Spielstände] IndexedDB nicht verfügbar:", e); }
  try {
    const ls = window.localStorage;
    ls.setItem("mk-save-probe", "1");
    ls.removeItem("mk-save-probe");
    return new LocalBackend(ls);
  } catch (e) { console.warn("[Spielstände] localStorage nicht verfügbar:", e); }
  return new MemoryBackend();
}

/** Anzeigename eines Platzes. */
export const slotName = (slot: SaveSlotKey): string => SAVE_SLOTS[slot].name;
