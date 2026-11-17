/** Kleine DOM-Helfer der Oberfläche. Alles hier fasst den DOM nur an, wenn sich etwas ändert. */

type Attrs = Record<string, string | number | boolean | undefined | ((ev: Event) => void)>;

/** Element bauen: h("div.klasse.zweite", {title: "…", onclick: fn}, kind1, "Text"). */
export function h<K extends keyof HTMLElementTagNameMap>(
  sel: K | `${K}.${string}`,
  attrs: Attrs | null = null,
  ...kids: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const [tag, ...cls] = sel.split(".");
  const el = document.createElement(tag as K);
  if (cls.length) el.className = cls.join(" ");
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v as EventListener);
    else if (k === "text") el.textContent = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
  return el;
}

/** Text setzen, nur bei Änderung. */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Klasse umschalten, nur bei Änderung. */
export function setClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/** Attribut setzen, nur bei Änderung (null entfernt es). */
export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name); return; }
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** Breite eines Balkens (0..1) setzen, nur bei Änderung. */
export function setBar(el: HTMLElement, frac: number): void {
  const w = `${Math.round(Math.max(0, Math.min(1, frac)) * 1000) / 10}%`;
  if (el.style.width !== w) el.style.width = w;
}

/** Ganzzahl mit Tausenderpunkt (deutsch). */
export const num = (n: number): string => Math.floor(n).toLocaleString("de-DE");

/** Sekunden als m:ss. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
