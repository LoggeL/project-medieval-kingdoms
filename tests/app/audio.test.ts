import { describe, expect, it } from "vitest";
import { MUSIC, VOICE } from "../../src/data/audio";
import { FADE_SECONDS, MusicDirector, SILENCE, VOICE_STALE, VoiceScheduler } from "../../src/app/audio";

/** Feste Zufallsfolge für reproduzierbare Tests. */
function seq(...xs: number[]): () => number {
  let i = 0;
  return () => xs[i++ % xs.length];
}

describe("Musik-Regie", () => {
  it("spielt im Frieden Aufbau-Stücke abwechselnd mit 20–60 s Stille dazwischen", () => {
    const d = new MusicDirector(seq(0, 0.5, 0.99, 0.3));
    const first = d.step(0, false, false);
    expect(first && "play" in first && MUSIC[first.play].mood).toBe("aufbau");
    const a = (first as { play: string }).play;
    expect(d.step(10, false, false)).toBeNull();
    // Stück zu Ende → Stille
    expect(d.step(100, false, true)).toEqual({ stop: true, fade: 0 });
    expect(d.nextAt - 100).toBeGreaterThanOrEqual(SILENCE[0]);
    expect(d.nextAt - 100).toBeLessThanOrEqual(SILENCE[1]);
    expect(d.step(d.nextAt - 1, false, false)).toBeNull();
    const second = d.step(d.nextAt, false, false);
    expect(second && "play" in second && MUSIC[second.play].mood).toBe("aufbau");
    expect((second as { play: string }).play).not.toBe(a);
  });

  it("blendet beim Überfall in 2 s auf Kampfmusik in Schleife, danach einmal Sieg und zurück zum Aufbau", () => {
    const d = new MusicDirector(seq(0.2));
    d.step(0, false, false);
    const battle = d.step(5, true, false);
    expect(battle).toEqual({ play: "kampf_sturm", fade: FADE_SECONDS, loop: true });
    expect(d.step(6, true, false)).toBeNull();
    expect(d.step(7, true, true)).toBeNull(); // Schleife: Ende ändert nichts
    const win = d.step(60, false, false);
    expect(win).toEqual({ play: "sieg_abgewehrt", fade: FADE_SECONDS, loop: false });
    expect(d.step(70, false, false)).toBeNull();
    expect(d.step(90, false, true)).toEqual({ stop: true, fade: 0 });
    expect(d.mode).toBe("aufbau");
    const next = d.step(d.nextAt, false, false);
    expect(next && "play" in next && MUSIC[next.play].mood).toBe("aufbau");
  });

  it("ein neuer Überfall während der Siegmusik geht wieder in die Kampfmusik", () => {
    const d = new MusicDirector(seq(0.2));
    d.step(0, false, false);
    d.step(1, true, false);
    d.step(2, false, false);
    expect(d.step(3, true, false)).toEqual({ play: "kampf_sturm", fade: FADE_SECONDS, loop: true });
  });
});

describe("Sprecheransagen", () => {
  it("spielt nie zwei gleichzeitig und wählt nach Vorrang", () => {
    const v = new VoiceScheduler();
    expect(v.offer("bau_fertig", 0)).toBe(true); // Vorrang 1
    expect(v.offer("ueberfall", 0)).toBe(true); // Vorrang 3
    expect(v.offer("lager_voll", 0)).toBe(true); // Vorrang 2
    expect(v.next(0.1, true)).toBeNull(); // es läuft gerade eine
    expect(v.next(0.2, false)).toBe("ueberfall");
    expect(v.next(2, false)).toBe("lager_voll");
    expect(v.next(4, false)).toBe("bau_fertig");
    expect(v.next(5, false)).toBeNull();
  });

  it("hält die Wiederholsperre ein und verwirft Doppel", () => {
    const v = new VoiceScheduler();
    v.offer("zu_teuer", 0);
    expect(v.offer("zu_teuer", 0.5)).toBe(false); // schon in der Warteschlange
    expect(v.next(1, false)).toBe("zu_teuer");
    const lock = VOICE.zu_teuer.repeatSeconds;
    expect(v.offer("zu_teuer", 1 + lock - 0.1)).toBe(false);
    expect(v.offer("zu_teuer", 1 + lock + 0.1)).toBe(true);
    expect(v.next(1 + lock + 0.2, false)).toBe("zu_teuer");
  });

  it("verwirft veraltete Ansagen", () => {
    const v = new VoiceScheduler();
    v.offer("zuzug", 0);
    expect(v.next(VOICE_STALE + 1, false)).toBeNull();
    expect(v.size).toBe(0);
  });
});
