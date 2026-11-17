import { describe, expect, it } from "vitest";
import { ZOOMS, ZOOM_DEFAULT, ZOOM_MS, zoomLabel } from "../../src/data/view";
import { Camera, pixelMode } from "../../src/render/camera";

const cam = () => {
  const c = new Camera(64, 64);
  c.sw = 1440; c.sh = 900;
  c.lookAt(32, 32);
  return c;
};

describe("Zoomstufen", () => {
  it("sind aufsteigend, reichen von der ganzen Karte bis 4× und starten bei 2×", () => {
    for (let i = 1; i < ZOOMS.length; i++) expect(ZOOMS[i]).toBeGreaterThan(ZOOMS[i - 1]);
    expect(ZOOMS[ZOOMS.length - 1]).toBe(4);
    expect(ZOOMS[ZOOM_DEFAULT]).toBe(2);
    expect(ZOOMS.length).toBeGreaterThanOrEqual(8);
    // Bei der kleinsten Stufe passt die ganze 64 × 64-Karte (4096 × 2048 Welt-Pixel) in ein 1440 × 900-Fenster
    expect(4096 * ZOOMS[0]).toBeLessThanOrEqual(1440);
    expect(2048 * ZOOMS[0]).toBeLessThanOrEqual(900);
  });

  it("deutsche Anzeige", () => {
    expect(zoomLabel(0.25)).toBe("0,25×");
    expect(zoomLabel(1.5)).toBe("1,5×");
    expect(zoomLabel(2)).toBe("2×");
  });
});

describe("Pixelmodus je Stufe", () => {
  it("ganze Stufen sind pixelgenau, Zwischenstufen über 1 rendern ganzzahlig und verkleinern weich", () => {
    for (const z of ZOOMS) {
      const m = pixelMode(z);
      if (z < 1) expect(m).toEqual({ smooth: true, resolution: 1, cssSmooth: true });
      else if (Number.isInteger(z)) expect(m).toEqual({ smooth: false, resolution: 1, cssSmooth: false });
      else {
        expect(m.smooth).toBe(false);
        expect(m.cssSmooth).toBe(true);
        // Welt-Pixel → Canvas-Pixel ganzzahlig
        const k = z * m.resolution;
        expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
        expect(m.resolution).toBeGreaterThan(1);
        expect(m.resolution).toBeLessThan(2);
      }
    }
  });
});

describe("Kamera-Zoom", () => {
  it("springt mit instant sofort und hält den Punkt unter der Maus fest", () => {
    const c = cam();
    c.instant = true;
    const before = c.toWorldPx(300, 200);
    expect(c.zoomAt(1, 300, 200)).toBe(true);
    expect(c.zoom).toBe(3);
    const after = c.toWorldPx(300, 200);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it("gleitet sanft zur nächsten Stufe, der Punkt unter der Maus bleibt auch dazwischen stehen", () => {
    const c = cam();
    const p = c.toWorldPx(900, 300);
    c.zoomAt(-1, 900, 300);
    expect(c.targetZoom).toBe(1.5);
    expect(c.zoom).toBe(2);
    c.step(ZOOM_MS / 2000);
    expect(c.zoom).toBeLessThan(2);
    expect(c.zoom).toBeGreaterThan(1.5);
    const mid = c.toWorldPx(900, 300);
    expect(mid[0]).toBeCloseTo(p[0], 6);
    expect(mid[1]).toBeCloseTo(p[1], 6);
    expect(c.zooming).toBe(true);
    c.step(1);
    expect(c.zoom).toBe(1.5);
    expect(c.zooming).toBe(false);
    expect(c.step(0.1)).toBe(false);
  });

  it("mehrere Schritte hintereinander laufen von der gerade gezeigten Stufe aus weiter", () => {
    const c = cam();
    c.zoomAt(1); c.step(ZOOM_MS / 4000);
    const z = c.zoom;
    c.zoomAt(1);
    expect(c.targetZoom).toBe(4);
    expect(c.zoom).toBe(z);
    c.step(1);
    expect(c.zoom).toBe(4);
  });

  it("bleibt an den Grenzen stehen", () => {
    const c = cam();
    c.instant = true;
    while (c.zoomAt(-1)) { /* bis ganz hinaus */ }
    expect(c.zoom).toBe(ZOOMS[0]);
    expect(c.zoomAt(-1)).toBe(false);
    while (c.zoomAt(1)) { /* bis ganz hinein */ }
    expect(c.zoom).toBe(ZOOMS[ZOOMS.length - 1]);
    expect(c.zoomAt(1)).toBe(false);
  });

  it("Verschieben während des Übergangs wird nicht zurückgenommen", () => {
    const c = cam();
    const ref = cam();
    c.zoomAt(1, 720, 450);
    ref.zoomAt(1, 720, 450);
    c.step(ZOOM_MS / 3000);
    ref.step(ZOOM_MS / 3000);
    c.pan(200, 0);
    c.step(1);
    ref.step(1);
    // 200 Bildschirmpixel beim Zwischenzoom, danach bleibt der Versatz in Welt-Pixeln erhalten
    expect(c.x - ref.x).toBeGreaterThan(200 / 3);
    expect(c.x - ref.x).toBeLessThan(200 / 2);
  });
});
