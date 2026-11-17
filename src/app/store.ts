/**
 * Zustand der Oberfläche, der nicht zur Simulation gehört: Auswahl, Werkzeug, Geschwindigkeit, Kontrollgruppen.
 * Meldet Änderungen als Ereignisse an die Brücke (UiBridge.on).
 */
import type { SimState } from "../sim/types";
import type { Selection, Tool } from "./contract";

export type AppEvent = "tick" | "selection" | "tool" | "view" | "assets" | "audio";

export class AppStore {
  selection: Selection = { units: [], building: null };
  tool: Tool = { t: "auswahl" };
  speed = 1;
  groups = new Map<number, number[]>();
  private listeners = new Map<AppEvent, Set<() => void>>();

  on(ev: AppEvent, fn: () => void): () => void {
    let set = this.listeners.get(ev);
    if (!set) { set = new Set(); this.listeners.set(ev, set); }
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  emit(ev: AppEvent): void {
    const set = this.listeners.get(ev);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(); } catch (e) { console.error(`Fehler im Ereignis „${ev}“`, e); }
    }
  }

  select(sel: Selection): void {
    const units = [...new Set(sel.units)];
    const same = units.length === this.selection.units.length && units.every((u, i) => u === this.selection.units[i]) && sel.building === this.selection.building;
    if (same) return;
    this.selection = { units, building: units.length ? null : sel.building };
    this.emit("selection");
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.emit("tool");
  }

  /** Tote oder verschwundene Einheiten und abgerissene Gebäude aus der Auswahl nehmen. */
  prune(state: SimState): void {
    const sel = this.selection;
    if (!sel.units.length && !sel.building) return;
    const alive = sel.units.filter((id) => state.units.some((u) => u.id === id && !u.dead));
    const building = sel.building && state.buildings.some((b) => b.id === sel.building) ? sel.building : null;
    if (alive.length !== sel.units.length || building !== sel.building) this.select({ units: alive, building });
  }
}
