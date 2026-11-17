#!/usr/bin/env node
/**
 * Kopfloser Chrome über das DevTools-Protokoll, für Spieltests mit echter Bildschleife (requestAnimationFrame läuft).
 *
 *   node tools/dev/browser.mjs <url> <schritte.json> <ausgabeordner> [breite höhe]
 *
 * schritte.json: Liste von Schritten, nacheinander ausgeführt:
 *   {"eval": "JS-Ausdruck"}          – im Seitenkontext auswerten (await erlaubt), Ergebnis wird ausgegeben
 *   {"wait": 1500}                    – Millisekunden warten (Spiel läuft weiter)
 *   {"shot": "name.png"}              – Screenshot in den Ausgabeordner
 *   {"click": [x, y], "button": "left"|"right", "shift": true}
 *   {"drag": [x0, y0, x1, y1], "button": "left"}
 *   {"move": [x, y]}
 *   {"key": "q"}                      – Taste drücken (einzelnes Zeichen oder Name wie "Escape", "F1", "Delete", "ArrowLeft");
 *                                       {"key": "y", "code": "KeyZ"} gibt die physische Taste vor (QWERTZ)
 *   {"wheel": [x, y, deltaY]}
 * Konsolenfehler und Ausnahmen der Seite werden mitprotokolliert (Datei log.txt im Ausgabeordner).
 *
 * Ton ist immer stumm (--mute-audio): Audio wird nur über Zustand und Elemente geprüft, nie hörbar.
 *
 * Adressen (Dev-Server wie Auslieferung, siehe docs/DEPLOYMENT.md): Spiel unter /, Konzeptseite unter /konzept/,
 * alte Adressen /spiel/… leiten auf /… um. Also z. B. http://127.0.0.1:5173/?direkt=1, nicht mehr /spiel/.
 *
 * Das Spiel startet mit Lade- und Titelbildschirm; window.mk gibt es erst nach „Neues Spiel“. Für Spieltests die URL
 * mit ?direkt=1 aufrufen (überspringt den Titel, nur im Entwicklungsmodus). Weitere Schalter: ?halten=1 hält den
 * Ladebildschirm nach 100 %, ?fehlertest=<schritt> erzwingt die Fehlermeldung; window.mkStart steuert den Start.
 * Chrome: CHROME=/pfad/zu/chrome, sonst der Chrome for Testing aus dem Playwright-Cache oder Google Chrome.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const [url, stepsFile, outDir, W = "1440", H = "900"] = process.argv.slice(2);
if (!url || !stepsFile || !outDir) {
  console.error("Aufruf: node tools/dev/browser.mjs <url> <schritte.json> <ausgabeordner> [breite höhe]");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const logFile = join(outDir, "log.txt");
writeFileSync(logFile, "");
const log = (s) => { console.log(s); appendFileSync(logFile, s + "\n"); };

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(cache)) {
    const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const p = join(cache, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
      if (existsSync(p)) return p;
      const l = join(cache, d, "chrome-linux/chrome");
      if (existsSync(l)) return l;
    }
  }
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(mac)) return mac;
  throw new Error("Kein Chrome gefunden (CHROME setzen).");
}

const profile = mkdtempSync(join(tmpdir(), "mk-chrome-"));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(findChrome(), [
  "--headless=new", "--mute-audio", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* startet noch */ }
    await sleep(100);
  }
  throw new Error("Chrome antwortet nicht.");
}

let ws, seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

async function main() {
  ws = new WebSocket(await target());
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    } else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
      log(`[konsole.${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      log(`[ausnahme] ${d.exception?.description ?? d.text}`);
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await sleep(2500);

  const steps = JSON.parse(readFileSync(stepsFile, "utf8"));
  let mx = 0, my = 0;
  const mouse = (type, x, y, button = "none", extra = {}) =>
    send("Input.dispatchMouseEvent", { type, x, y, button, clickCount: type === "mouseMoved" ? 0 : 1, ...extra });
  for (const s of steps) {
    if (s.eval !== undefined) {
      const r = await send("Runtime.evaluate", { expression: `(async()=>{ return (${s.eval}); })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) log(`[eval-fehler] ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      else log(`[eval] ${typeof r.result.value === "string" ? r.result.value : JSON.stringify(r.result.value)}`);
    } else if (s.wait) await sleep(s.wait);
    else if (s.shot) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(outDir, s.shot), Buffer.from(r.data, "base64"));
      log(`[bild] ${s.shot}`);
    } else if (s.move) { [mx, my] = s.move; await mouse("mouseMoved", mx, my); }
    else if (s.click) {
      const [x, y] = s.click, button = s.button ?? "left", modifiers = s.shift ? 8 : 0;
      await mouse("mouseMoved", x, y); await sleep(30);
      await mouse("mousePressed", x, y, button, { modifiers, buttons: button === "right" ? 2 : 1 });
      await sleep(40);
      await mouse("mouseReleased", x, y, button, { modifiers });
      await sleep(60);
    } else if (s.drag) {
      const [x0, y0, x1, y1] = s.drag, button = s.button ?? "left", buttons = button === "right" ? 2 : button === "middle" ? 4 : 1;
      await mouse("mouseMoved", x0, y0); await mouse("mousePressed", x0, y0, button, { buttons });
      for (let i = 1; i <= 10; i++) { await mouse("mouseMoved", x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10, button, { buttons }); await sleep(20); }
      await mouse("mouseReleased", x1, y1, button); await sleep(60);
    } else if (s.wheel) {
      const [x, y, dy] = s.wheel;
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy });
      await sleep(80);
    } else if (s.key) {
      const k = s.key, single = k.length === 1;
      // "code" setzt die physische Taste ausdrücklich (z. B. {"key": "y", "code": "KeyZ"} für Y auf QWERTZ)
      const code = s.code ?? (single ? (/[a-z]/i.test(k) ? "Key" + k.toUpperCase() : k === " " ? "Space" : "") : k);
      const fkey = /^F(\d{1,2})$/.exec(k);
      const vk = single ? k.toUpperCase().charCodeAt(0) : fkey ? 111 + Number(fkey[1])
        : ({ Escape: 27, Enter: 13, Delete: 46, Backspace: 8, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Space: 32 })[k] ?? 0;
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: single ? k : undefined });
      await sleep(s.hold ?? 50);
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
      await sleep(60);
    }
  }
}

main().catch((e) => log(`[abbruch] ${e.message}`)).finally(() => { try { ws?.close(); } catch { /* egal */ } chrome.kill(); });
