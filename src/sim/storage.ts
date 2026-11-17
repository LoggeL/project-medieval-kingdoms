/**
 * Lagerplätze: Slots mit Ware, Menge, Reservierung (wird abgeholt) und Zulauf (wird gebracht).
 * Jede Ware liegt sichtbar auf ihrem Slot; eine Ware wird erst entnommen bzw. eingelagert, wenn ein Träger
 * tatsächlich am Slot steht. Reservierungen verhindern, dass zwei Träger dasselbe holen.
 *
 * Lagertypen (ADR 0011): Jede Ware gehört zu einem Lagertyp (GoodDef.store), jedes Lager hat einen
 * (BuildingDef.storage.kind, Standard Materiallager). Alle Funktionen hier suchen Ware und Platz nur in Lagern des
 * passenden Typs: Getreide liegt in der Kornkammer, Holz im Lagerhaus.
 */
import { BUILDINGS, GOODS, STORES, STORE_KEYS, UNITS, storeOf, type Good, type StoreKey } from "../data";
import { center } from "./geom";
import type { StorageSlot } from "./types";
import type { SBuilding, World } from "./world";

export interface SlotRef { b: SBuilding; k: number }

const ALL_GOODS = Object.keys(GOODS) as Good[];

/** Lagertyp eines Lagers (null = kein Lager). */
export function storeKind(key: SBuilding["key"]): StoreKey | null {
  const st = BUILDINGS[key].storage;
  return st ? st.kind ?? "material" : null;
}

/** Fertige eigene Lager (nur des Typs kind, wenn angegeben), nach Entfernung zu (x, y) sortiert. */
export function storagesNear(w: World, x: number, y: number, kind?: StoreKey): SBuilding[] {
  const out = w.s.buildings.filter((b) => b.team === 0 && b.built >= 1 && BUILDINGS[b.key].storage && (!kind || storeKind(b.key) === kind));
  const d = (b: SBuilding) => { const [cx, cy] = center(b.key, b.x, b.y, b.o); return Math.abs(cx - x) + Math.abs(cy - y); };
  return out.sort((a, b) => d(a) - d(b) || a.id - b.id);
}

export function perSlot(b: SBuilding): number { return BUILDINGS[b.key].storage?.perSlot ?? 0; }

/** Leerer Slot verliert seine Ware. */
export function tidy(slot: StorageSlot): void {
  if (slot.amount <= 0 && slot.reserved <= 0 && slot.incoming <= 0) { slot.amount = 0; slot.reserved = 0; slot.incoming = 0; slot.good = null; }
}

/** Ware zum Abholen reservieren (nächstes Lager zuerst). */
export function reserveTake(w: World, good: Good, x: number, y: number): SlotRef | null {
  for (const b of storagesNear(w, x, y, storeOf(good))) {
    let best = -1;
    b.slots.forEach((s, k) => { if (s.good === good && s.amount - s.reserved > 0 && (best < 0 || s.amount - s.reserved < b.slots[best].amount - b.slots[best].reserved)) best = k; });
    if (best >= 0) { b.slots[best].reserved++; return { b, k: best }; }
  }
  return null;
}

/** Platz zum Einlagern reservieren: gleiche Ware zuerst, sonst ein leerer Slot. */
export function reservePut(w: World, good: Good, x: number, y: number): SlotRef | null {
  const stores = storagesNear(w, x, y, storeOf(good));
  for (const b of stores) {
    const k = b.slots.findIndex((s) => s.good === good && s.amount + s.incoming < perSlot(b));
    if (k >= 0) { b.slots[k].incoming++; return { b, k }; }
  }
  for (const b of stores) {
    const k = b.slots.findIndex((s) => s.good === null);
    if (k >= 0) { const s = b.slots[k]; s.good = good; s.incoming = 1; return { b, k }; }
  }
  return null;
}

/** Gibt es irgendwo Platz für diese Ware? */
export function hasRoom(w: World, good: Good): boolean {
  const kind = storeOf(good);
  for (const b of w.s.buildings) {
    if (b.team !== 0 || b.built < 1 || storeKind(b.key) !== kind) continue;
    for (const s of b.slots) if (s.good === null || (s.good === good && s.amount + s.incoming < perSlot(b))) return true;
  }
  return false;
}

/** Sofort einlagern (Startbestand, Rückgabe beim Abriss). Gibt die eingelagerte Menge zurück. */
export function storeDirect(w: World, good: Good, n: number): number {
  let left = n;
  for (const b of storagesNear(w, w.meta.camp[0], w.meta.camp[1], storeOf(good))) {
    const cap = perSlot(b);
    for (const s of b.slots) if (left > 0 && s.good === good) { const k = Math.min(left, cap - s.amount - s.incoming); if (k > 0) { s.amount += k; left -= k; } }
    for (const s of b.slots) if (left > 0 && s.good === null) { const k = Math.min(left, cap); s.good = good; s.amount = k; left -= k; }
  }
  return n - left;
}

/** Gibt es überhaupt ein eigenes Lager (fertig oder im Bau) für diesen Lagertyp? */
export function hasStoreOf(w: World, kind: StoreKey): boolean {
  return w.s.buildings.some((b) => b.team === 0 && storeKind(b.key) === kind);
}

/** Meldung, wenn eine Ware nirgends Platz hat (Text je Lagertyp aus STORES). */
export function fullMessage(w: World, good: Good): void {
  const kind = storeOf(good);
  w.msg(STORES[kind].full, "warnung", `lagervoll-${kind}`, 30, "lager_voll");
}

/** Bereits verplante Waren: offene Baustellenlieferungen (noch im Lager), Anlieferungen an Werkstätten und wartende Rekruten. */
export function committed(w: World, good: Good): number {
  let n = 0;
  for (const b of w.s.buildings) {
    if (b.team !== 0) continue;
    if (b.built < 1 || b.upgrade) n += (b.needs[good] ?? 0) - (b.ai.picked[good] ?? 0);
    if (b.proc) n += (b.proc.enroute[good] ?? 0) - (b.proc.picked[good] ?? 0);
    for (let i = 0; i < b.queue.length; i++) {
      if (UNITS[b.queue[i]].train?.equipment !== good) continue;
      if (i === 0 && b.ai.recruitPicked) continue;
      n++;
    }
  }
  const cur = w.s.research.cur;
  if (cur) n += (cur.needs[good] ?? 0) - (cur.picked[good] ?? 0);
  return n;
}

export function stockOf(w: World, good: Good): number {
  let n = 0;
  for (const b of w.s.buildings) if (b.team === 0 && b.built >= 1) for (const s of b.slots) if (s.good === good) n += s.amount;
  return n;
}

/** Frei verfügbare Menge (Bestand minus verplant). */
export function available(w: World, good: Good): number { return stockOf(w, good) - committed(w, good); }

/** state.stock, state.free (Bestand minus verplant), state.capacity und state.stores (je Lagertyp) aktualisieren. */
export function updateStock(w: World): void {
  const stock = Object.fromEntries(ALL_GOODS.map((g) => [g, 0])) as Record<Good, number>;
  const stores = Object.fromEntries(STORE_KEYS.map((k) => [k, { used: 0, cap: 0 }])) as Record<StoreKey, { used: number; cap: number }>;
  let cap = 0;
  for (const b of w.s.buildings) {
    if (b.team !== 0 || b.built < 1) continue;
    const st = BUILDINGS[b.key].storage;
    if (!st) continue;
    const kind = stores[st.kind ?? "material"];
    cap += st.slots * st.perSlot;
    kind.cap += st.slots * st.perSlot;
    for (const s of b.slots) if (s.good) { stock[s.good] += s.amount; kind.used += s.amount; }
  }
  w.s.stock = stock;
  const free = {} as Record<Good, number>;
  for (const g of ALL_GOODS) free[g] = stock[g] > 0 ? Math.max(0, stock[g] - committed(w, g)) : 0;
  w.s.free = free;
  w.s.capacity = cap;
  w.s.stores = stores;
}
