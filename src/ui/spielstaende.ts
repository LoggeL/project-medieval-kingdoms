/**
 * Spielstände in der Oberfläche (ADR 0019): Beschriftung der Plätze und die Liste zum Laden bzw. Speichern, die Titel
 * und Spielmenü gemeinsam nutzen. Spricht nur über UiBridge.saves mit der App.
 */
import type { SaveInfo } from "../app/contract";
import { DIFFICULTIES, SAVE_SLOTS, SAVE_SLOT_KEYS, SCENARIOS, TICKS_PER_SECOND, type SaveSlotKey } from "../data";
import { clock, h } from "./dom";

/** „gerade eben“, „vor 5 Minuten“, „vor 3 Stunden“, sonst Datum und Uhrzeit. */
export function ago(time: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - time) / 1000));
  if (s < 60) return "gerade eben";
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "vor einer Minute" : `vor ${m} Minuten`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return hrs === 1 ? "vor einer Stunde" : `vor ${hrs} Stunden`;
  const d = new Date(time);
  const two = (n: number) => String(n).padStart(2, "0");
  return `am ${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()} um ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Zeile zu einem Spielstand: Spielzeit, Welle, Schwierigkeit, Ausgang, wann gespeichert. */
export function describeSave(i: SaveInfo, now = Date.now()): string {
  const parts = [`${clock(i.tick / TICKS_PER_SECOND)} Spielzeit`];
  parts.push(i.wave ? `Welle ${i.wave}` : "vor dem ersten Überfall");
  parts.push(DIFFICULTIES[i.difficulty]?.name ?? i.difficulty);
  if (i.outcome === "sieg") parts.push("gewonnen");
  else if (i.outcome === "niederlage") parts.push("verloren");
  parts.push(ago(i.time, now));
  return parts.join(" · ");
}

export const slotLabel = (slot: SaveSlotKey): string => SAVE_SLOTS[slot].name;

export const scenarioLabel = (i: SaveInfo): string => (i.scenario ? SCENARIOS[i.scenario]?.name ?? "" : "Freies Spiel");

export interface SlotListOptions {
  /** "laden": belegte Plätze, Klick lädt; "speichern": Plätze des Spielers (belegte überschreiben nach Rückfrage). */
  mode: "laden" | "speichern";
  infos: SaveInfo[];
  /** Klick auf einen Platz (nach Rückfrage beim Überschreiben). */
  pick(slot: SaveSlotKey): void;
  /** Löschen anbieten (nur Plätze des Spielers). */
  remove?(slot: SaveSlotKey): void;
  /** Klassen für die Knöpfe (Titel und Spiel haben verschiedene Materialien). */
  buttonClass: string;
}

/** Liste der Plätze als Knöpfe. */
export function slotList(o: SlotListOptions): HTMLElement {
  const by = new Map(o.infos.map((i) => [i.slot, i]));
  const list = h("ul.mk-plaetze");
  const slots = SAVE_SLOT_KEYS.filter((k) => (o.mode === "speichern" ? SAVE_SLOTS[k].manual : by.has(k)));
  if (!slots.length) list.append(h("li.mk-platz-leer", { text: "Noch kein Spielstand gespeichert." }));
  for (const slot of slots) {
    const info = by.get(slot);
    const line = info ? describeSave(info) : "frei";
    const btn = h(`button.${o.buttonClass}.mk-platz-knopf` as "button", {
      type: "button", "data-slot": slot,
      "aria-label": `${slotLabel(slot)}: ${line}${o.mode === "speichern" && info ? " (überschreiben)" : ""}`,
    }, h("span.mk-platz-name", { text: slotLabel(slot) }), h("span.mk-platz-info", { text: line }));
    let armed = false;
    btn.addEventListener("click", () => {
      if (o.mode === "speichern" && info && !armed) {
        armed = true;
        btn.classList.add("mk-platz-frage");
        (btn.querySelector(".mk-platz-info") as HTMLElement).textContent = "Überschreiben? Noch einmal klicken.";
        window.setTimeout(() => {
          if (!btn.isConnected) return;
          armed = false;
          btn.classList.remove("mk-platz-frage");
          (btn.querySelector(".mk-platz-info") as HTMLElement).textContent = line;
        }, 4000);
        return;
      }
      o.pick(slot);
    });
    const li = h("li.mk-platz", null, btn);
    if (o.remove && info && SAVE_SLOTS[slot].manual) {
      li.append(h(`button.${o.buttonClass}.mk-platz-weg` as "button", {
        type: "button", title: `${slotLabel(slot)} löschen`, "aria-label": `${slotLabel(slot)} löschen`, text: "×",
        onclick: () => o.remove!(slot),
      }));
    }
    list.append(li);
  }
  return list;
}
