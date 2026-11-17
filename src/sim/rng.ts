/**
 * Deterministischer Zufall (mulberry32). Der Zustand ist eine 32-Bit-Zahl im gespeicherten Spielstand,
 * damit ein geladener Stand dieselben Folge-Ticks erzeugt.
 */
export function nextRandom(holder: { rng: number }): number {
  let t = (holder.rng = (holder.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Startwert aus dem Seed (verteilt kleine Seeds über den ganzen Zahlenraum). */
export function seedState(seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}
