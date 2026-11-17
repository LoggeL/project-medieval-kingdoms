/**
 * Lagerplätze: Slots mit Ware, Menge, Reservierung (wird abgeholt) und Zulauf (wird gebracht).
 * Jede Ware liegt sichtbar auf ihrem Slot; eine Ware wird erst entnommen bzw. eingelagert, wenn ein Träger
 * tatsächlich am Slot steht. Reservierungen verhindern, dass zwei Träger dasselbe holen.
 */
import { BUILDINGS, GOODS, UNITS, type Good } from "../data";
import { center } from "./geom";
import type { StorageSlot } from "./types";
import type { SBuilding, World } from "./world";

export interface SlotRef { b: SBuilding; k: number }

const ALL_GOODS = Object.keys(GOODS) as Good[];

/** Fertige eigene Lager, nach Entfernung zu (x, y) sortiert. */
export function storagesNear(w: World, x: number, y: number): SBuilding[] {
  const out = w.s.buildings.filter((b) => b.team === 0 && b.built >= 1 && BUILDINGS[b.key].storage);
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
  for (const b of storagesNear(w, x, y)) {
    let best = -1;
    b.slots.forEach((s, k) => { if (s.good === good && s.amount - s.reserved > 0 && (best < 0 || s.amount - s.reserved < b.slots[best].amount - b.slots[best].reserved)) best = k; });
    if (best >= 0) { b.slots[best].reserved++; return { b, k: best }; }
  }
  return null;
}

/** Platz zum Einlagern reservieren: gleiche Ware zuerst, sonst ein leerer Slot. */
export function reservePut(w: World, good: Good, x: number, y: number): SlotRef | null {
  const stores = storagesNear(w, x, y);
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
  for (const b of w.s.buildings) {
    if (b.team !== 0 || b.built < 1 || !BUILDINGS[b.key].storage) continue;
    for (const s of b.slots) if (s.good === null || (s.good === good && s.amount + s.incoming < perSlot(b))) return true;
  }
  return false;
}

/** Sofort einlagern (Startbestand, Rückgabe beim Abriss). Gibt die eingelagerte Menge zurück. */
export function storeDirect(w: World, good: Good, n: number): number {
  let left = n;
  for (const b of storagesNear(w, w.meta.camp[0], w.meta.camp[1])) {
    const cap = perSlot(b);
    for (const s of b.slots) if (left > 0 && s.good === good) { const k = Math.min(left, cap - s.amount - s.incoming); if (k > 0) { s.amount += k; left -= k; } }
    for (const s of b.slots) if (left > 0 && s.good === null) { const k = Math.min(left, cap); s.good = good; s.amount = k; left -= k; }
  }
  return n - left;
}

/** Bereits verplante Waren: offene Baustellenlieferungen (noch im Lager) und wartende Rekruten. */
export function committed(w: World, good: Good): number {
  let n = 0;
  for (const b of w.s.buildings) {
    if (b.team !== 0) continue;
    if (b.built < 1 || b.upgrade) n += (b.needs[good] ?? 0) - (b.ai.picked[good] ?? 0);
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

/** state.stock und state.capacity aktualisieren. */
export function updateStock(w: World): void {
  const stock = Object.fromEntries(ALL_GOODS.map((g) => [g, 0])) as Record<Good, number>;
  let cap = 0;
  for (const b of w.s.buildings) {
    if (b.team !== 0 || b.built < 1) continue;
    const st = BUILDINGS[b.key].storage;
    if (!st) continue;
    cap += st.slots * st.perSlot;
    for (const s of b.slots) if (s.good) stock[s.good] += s.amount;
  }
  w.s.stock = stock;
  w.s.capacity = cap;
}
