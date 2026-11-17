import { defineConfig } from "vite";

// Das Spiel liegt im Projektstamm (index.html, src/). Die Sprites aus assets/ werden unverändert
// unter der Basis-URL ausgeliefert (publicDir = assets, also z. B. ./buildings/vorgerendert/sheet.json), damit Blender-Pipeline und Spiel dieselben Dateien nutzen.
export default defineConfig({
  base: "./",
  publicDir: "assets",
  server: { port: 5173, host: "127.0.0.1" },
  build: { outDir: "dist", assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
} as never);
