# Konzeptseite

Baut die Abschnitte „Figurentests aus Blender“ und „Gebäude aus Blender“ in die Konzeptseite [docs/konzept-seite.html](../../docs/konzept-seite.html) ein.

```sh
python3 tools/konzeptseite/build.py                  # aktualisiert docs/konzept-seite.html
python3 tools/konzeptseite/build.py --page andere.html
```

Braucht Python 3 mit Pillow. Vorher müssen Figuren und Gebäude gebaut sein (`tools/blender/build.sh`, `tools/blender/build_buildings.sh`).

| Datei | Aufgabe |
|---|---|
| `build.py` | liest `assets/figures/<stil>/` und `tools/blender/styles/`, schreibt je Stil `atlas.png`, bettet Atlanten und Schrittbild als Data-URI ein und ersetzt die markierten Blöcke in der Seite |
| `figlab.section.html` | Inhalt des Abschnitts (Texte, Bedienelemente) |
| `figlab.css` | Gestaltung des Abschnitts, nutzt die Farbvariablen der Seite |
| `figlab.js` | Bühne, Drehen, Gehen, Teamtausch per Palette, Vergleich der Stile |
| `bauten.section.html`, `bauten.css`, `bauten.js` | Gebäudeszene: Weltraster 12 × 12, Drehung nach den Formeln aus Kapitel 09, topologische Zeichenreihenfolge, nachgestellter Warenweg Holzfäller → Hof → Lager, Schützen auf Posten mit Vorderteil; Galerie aller Ansichten |

**Marker:** `<!-- FIGLAB -->`, `/* FIGLAB-CSS */`, `<!-- FIGLAB-JS -->` sowie `<!-- BAUTEN -->`, `/* BAUTEN-CSS */`, `<!-- BAUTEN-JS -->`, jeweils mit schließendem Gegenstück. Das Skript ersetzt nur, was zwischen den Markern steht, und lässt sich beliebig oft ausführen. Fehlen die Marker, fügt es die Blöcke an festen Stellen der Seite ein.

**Der Rest der Seite** (Szene, Zeitleiste, Schaubilder, UI-Modell) hat keine eigene Quelle, `docs/konzept-seite.html` ist selbst die Quelle. Änderungen daran direkt in der Datei machen, außerhalb der Marker.

**Format:** Die Seite ist eine Artifact-Quelle ohne `<!doctype>`, `<html>` und `<body>`, das Gerüst ergänzt erst die Veröffentlichung. Zum lokalen Ansehen in ein Gerüst packen:

```sh
mkdir -p .local/vorschau && { printf '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'; cat docs/konzept-seite.html; printf '</body></html>'; } > .local/vorschau/index.html
```

Veröffentlicht ist die Seite als Artifact (Link in [docs/STATUS.md](../../docs/STATUS.md)), neu veröffentlicht wird von Hand.
