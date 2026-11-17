/**
 * Die Build-Stufe des Dockerfiles führt tsc und vitest aus. Jede Datei, die ein Test oder die Quellen von außerhalb von
 * src/, tests/ und assets/ einbinden, muss die Stufe deshalb mitkopieren, und .dockerignore darf sie nicht ausschließen.
 * Im Image selbst gibt es Dockerfile und .dockerignore nicht; dort ist der Build die Prüfung, der Test entfällt.
 * (Ohne Node-Typen im Projekt: Dateien kommen über import.meta.glob ab Projektwurzel, das fehlende Dateien auslässt.)
 */
import { describe, expect, it } from "vitest";

const raw = (m: Record<string, unknown>): string | undefined => Object.values(m)[0] as string | undefined;
// "/Dockerfile" ohne Platzhalter mag der Glob nicht (leeres Muster), [e] ist gleichwertig
const dockerfile = raw(import.meta.glob("/Dockerfil[e]", { query: "?raw", import: "default", eager: true }));
const ignore = raw(import.meta.glob("/.dockerignore", { query: "?raw", import: "default", eager: true }));
const sources = import.meta.glob(["/src/**/*.ts", "/tests/**/*.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Pfad `spec` relativ zum Ordner `dir` (beide ab Projektwurzel, mit /) auflösen. */
function join(dir: string[], spec: string): string[] {
  const parts = [...dir];
  for (const p of spec.split("/")) {
    if (p === "..") parts.pop(); else if (p !== "." && p !== "") parts.push(p);
  }
  return parts;
}

/** Einbindung `spec` in der Datei `key` (Schlüssel von import.meta.glob, ab Projektwurzel wie /src/…) → Pfad ab Projektwurzel. */
function fromRoot(key: string, spec: string): string {
  const file = join([], key);
  return join(file.slice(0, -1), spec).join("/");
}

/** Relative Einbindungen außerhalb von src/, tests/, assets/, als Pfade ab Projektwurzel. */
function outsideImports(): string[] {
  const out = new Set<string>();
  for (const [file, text] of Object.entries(sources)) {
    for (const m of text.matchAll(/(?:from\s+|import\()\s*["'](\.{1,2}\/[^"'?]+)(?:\?[^"']*)?["']/g)) {
      const rel = fromRoot(file, m[1]);
      if (!/^(src|tests|assets)\//.test(rel)) out.add(rel);
    }
  }
  return [...out].sort();
}

/** Quellen der COPY-Befehle in der Stufe "spiel" (ohne --from). */
function copiedInBuildStage(text: string): string[] {
  const stage = text.split(/^FROM /m).find((s) => /AS spiel/.test(s.split("\n")[0])) ?? "";
  const out: string[] = [];
  for (const line of stage.split("\n")) {
    const m = line.match(/^COPY\s+(?!--from)(.+)$/);
    if (m) out.push(...m[1].trim().split(/\s+/).slice(0, -1));
  }
  return out;
}

/** Bleibt die Datei im Build-Kontext? Letzte passende Regel gewinnt (vereinfacht: `*`, Präfixe, `!`-Ausnahmen). */
function inContext(rules: string, path: string): boolean {
  let keep = true;
  for (const raw of rules.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const neg = line.startsWith("!");
    const pat = (neg ? line.slice(1) : line).replace(/\/$/, "");
    const re = new RegExp(`^${pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}(/|$)`);
    if (re.test(path)) keep = neg;
  }
  return keep;
}

describe("Dockerfile: Build-Stufe hat alles, was Typprüfung und Tests brauchen", () => {
  it.skipIf(!dockerfile || !ignore)("kopiert jede eingebundene Datei außerhalb von src/, tests/, assets/ und lässt sie im Build-Kontext", () => {
    const copied = copiedInBuildStage(dockerfile!);
    expect(copied).toEqual(expect.arrayContaining(["src", "tests", "assets"]));
    const deps = outsideImports();
    expect(deps).toEqual(expect.arrayContaining(["deploy/nginx.conf", "tools/blender/buildings/buildings.json", "deploy/konzeptseite"]));
    for (const dep of deps) {
      // Einbindung ohne Endung (TypeScript-Modul) → .ts
      const file = /\.[a-z]+$/.test(dep) ? dep : `${dep}.ts`;
      expect(copied.some((c) => file === c || file.startsWith(`${c}/`)), `Dockerfile kopiert ${file} nicht`).toBe(true);
      expect(inContext(ignore!, file), `.dockerignore schließt ${file} aus`).toBe(true);
    }
  });
});
