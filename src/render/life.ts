/**
 * Darstellung der lebendigen Welt (ADR 0016), als reine Funktionen (ohne Pixi, testbar): welches Bild ein Baum im Wind,
 * ein nachwachsender Baum, ein Gebäude mit wehenden Bannern, eine ruhende, rennende oder getroffene Figur und ein Tier
 * zeigt, wie stark ein Gefallener schon ausgeblendet ist und welche Färbung das Tageslicht der Welt gibt.
 * Alle Zeiten sind Spielzeit (Tick), damit Pause und Zeitraffer gelten und jede Drehung dasselbe Bild zeigt.
 */
import { ANIMALS, DAYLIGHT, FLAGS, LIFE, LIFE_FIGURES, TICKS_PER_SECOND, TREE_ART, TUNING, type AnimalAnim } from "../data";
import type { Animal, Tree, Unit } from "../sim/types";

const FIG_FPS = 10;
type Anims = Record<string, [number, number]>;
/** Sprite vorhanden? Bildzahl (Varianten) eines Sprites. */
export interface SheetInfo { has(key: string): boolean; frames(key: string): number }

const hash = (id: number, salt: number) => ((Math.imul(id ^ salt, 2654435761) >>> 8) & 0xffff) / 0x10000;

/**
 * Stehender Baum im Wind bzw. nachwachsender Baum: Sprite und Variante, oder null (dann das stille Bild).
 * Wind: Variante = Baum · Phasen + Phase; jeder Baum hat seinen eigenen Takt (aus der ID), damit der Wald nicht im
 * Gleichschritt wiegt.
 */
export function treeArt(t: Tree, time: number, sheet: SheetInfo, stillFrames: number): { key: string; frame: number } | null {
  if (t.state === "waechst") {
    const key = TREE_ART.young[t.kind];
    if (!key || !sheet.has(key)) return null;
    return { key, frame: Math.min(sheet.frames(key) - 1, t.stage ?? 0) };
  }
  if (t.state !== "stehend") return null;
  const key = TREE_ART.wind[t.kind];
  if (!key || !sheet.has(key)) return null;
  const P = TREE_ART.phases, trees = Math.max(1, Math.floor(sheet.frames(key) / P));
  const speed = 0.85 + hash(t.id, 7) * 0.3;
  const phase = Math.floor((time / TREE_ART.swaySeconds) * speed * P + hash(t.id, 3) * P) % P;
  const tree = (t.variant % Math.max(1, stillFrames)) % trees;
  return { key, frame: tree * P + phase };
}

/** Fertiges Gebäudebild mit wehenden Bannern: Sprite und Bild, oder null (dann das stille Bild). */
export function flagArt(key: string, id: number, time: number, sheet: SheetInfo): { key: string; frame: number } | null {
  const f = FLAGS[key];
  if (!f || !sheet.has(f.sprite)) return null;
  const n = Math.max(1, sheet.frames(f.sprite));
  return { key: f.sprite, frame: Math.floor(time * f.fps + hash(id, 11) * n) % n };
}

/**
 * Zusatzbilder einer Figur aus dem Lebensblatt (LIFE_FIGURES): Sitzen, Plaudern, Rennen (fliehend), Zusammenzucken nach
 * einem Treffer. null = das normale Blatt. anims: Animationen des Lebensblatts oder null, wenn es fehlt.
 */
export function lifeFrame(u: Unit, tick: number, sprite: string, anims: Anims | null): { key: string; frame: number } | null {
  const key = LIFE_FIGURES[sprite];
  if (!key || !anims || u.dead) return null;
  const t = u.animT;
  const loop = (a: [number, number], fps = FIG_FPS) => a[0] + (Math.floor(t * fps) % Math.max(1, a[1]));
  const hitTicks = LIFE.hitSeconds * TICKS_PER_SECOND;
  if (u.hitT !== undefined && tick - u.hitT >= 0 && tick - u.hitT < hitTicks && anims.treffer) {
    const k = Math.min(anims.treffer[1] - 1, Math.floor(((tick - u.hitT) / hitTicks) * anims.treffer[1]));
    return { key, frame: anims.treffer[0] + k };
  }
  if (u.anim === "sitzen" && anims.sitzen) return { key, frame: loop(anims.sitzen) };
  if (u.anim === "plaudern" && anims.plaudern) return { key, frame: loop(anims.plaudern, 3) };
  if (u.run && u.anim === "gehen" && !u.carry && anims.rennen) return { key, frame: loop(anims.rennen, 14) };
  return null;
}

/** Deckkraft eines Gefallenen: voll, in den letzten LIFE.corpseFadeSeconds vor dem Wegräumen ausblendend. */
export function corpseAlpha(u: Unit): number {
  if (!u.dead || u.anim !== "tot") return 1;
  const left = TUNING.corpseSeconds - u.animT;
  return Math.max(0, Math.min(1, left / LIFE.corpseFadeSeconds));
}

/** Bild eines Tiers aus seinen Blatt-Animationen; Ersatz bei fehlender Animation: Stehbild. */
export function animalFrame(a: Animal, anims: Anims): number {
  const def = ANIMALS[a.key];
  const pick = (k: AnimalAnim): [number, number] | undefined => anims[k];
  const cur = pick(a.anim) ?? (a.anim === "rennen" ? pick("gehen") : a.anim === "auffliegen" ? pick("fliegen") : undefined) ?? pick("stehen") ?? [0, 1];
  const fps = def.fps?.[a.anim] ?? FIG_FPS;
  if (a.anim === "sterben" || a.anim === "auffliegen") return cur[0] + Math.min(cur[1] - 1, Math.floor(a.animT * fps));
  // Fressen mit Pausen: Kopf bleibt unten, dann wieder ein paar Bissen (Phase je Tier versetzt)
  return cur[0] + (Math.floor(a.animT * fps + hash(a.id, 5) * cur[1]) % Math.max(1, cur[1]));
}

/** Tageszeit 0..1 (0 = Mitternacht) zum Tick. */
export function dayTime(tick: number): number {
  const d = DAYLIGHT.daySeconds * TICKS_PER_SECOND;
  return (((tick / d + DAYLIGHT.start) % 1) + 1) % 1;
}

/** Färbung der Welt durch das Tageslicht (0xffffff = keine). */
export function daylightTint(tick: number): number {
  if (!DAYLIGHT.on) return 0xffffff;
  const t = dayTime(tick), keys = DAYLIGHT.keys;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= t) i++;
  const [t0, c0] = keys[i], [t1, c1] = keys[i + 1];
  const k = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;
  const mix = (sh: number) => Math.round(((c0 >> sh) & 255) * (1 - k) + ((c1 >> sh) & 255) * k);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** Name der Tageszeit für die Anzeige. */
export function dayName(tick: number): string {
  const t = dayTime(tick);
  if (t < 0.22 || t >= 0.86) return "Nacht";
  if (t < 0.32) return "Morgen";
  if (t < 0.45) return "Vormittag";
  if (t < 0.58) return "Mittag";
  if (t < 0.72) return "Nachmittag";
  return "Abend";
}
