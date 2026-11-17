# 07 – Art Direction und Grafik-Pipeline

> Status: **Entwurf v1** (16.11.2026)

## Look in drei Worten

**Warm, dicht, lebendig.** Eine Welt wie ein liebevoll gemaltes Wimmelbild: erdige Grundtöne, satte Akzente durch Wappen, Banner und Feuer, überall kleine Bewegung. Klar lesbar trotz Detailfülle, denn Spielobjekte heben sich durch Kontrast und Umriss vom Gelände ab.

## Technische Eckwerte

| Wert | Vorschlag | Begründung |
|---|---|---|
| Projektion | 2:1-Dimetrie (klassische Pixel-Isometrie) | saubere Pixelkanten, Genre-Standard |
| Tile | **64 × 32 px** | genug Platz für Detail, 1080p zeigt bei Zoom 2× gut 30 Tiles in der Breite |
| Höhenstufe | 16 px | eine halbe Tile-Höhe |
| Figur | **ca. 28–32 px** hoch (Reiter ca. 40 px) | Ausrüstung muss erkennbar sein |
| Zoomstufen | 1×, 2×, 3× ganzzahlig, dazu 0,5× Übersicht | pixelscharf, Übersicht vorgerechnet verkleinert |
| Blickrichtungen | Figuren 8, Gebäude 4 Ansichten | Pflicht durch die 90°-Drehung |
| Palette | feste Hauptpalette mit ca. 64 Farben, dazu Teamfarben-Rampen | Einheitlichkeit über alle Quellen |
| Licht | **relativ zur Kamera** von oben links | gleich gute Lesbarkeit in jeder Drehung |

## Palette

- **Gelände:** Moos- und Grasgrün, Ocker, Lehmbraun, Schiefergrau, gedecktes Flussblau
- **Bauwerke:** Sandstein, Kalkweiß, Holzbraun, Schindelgrau, Ziegelrot, Strohgelb
- **Akzente:** Wappenfarben (Rot, Blau, Gelb, Grün, Weiß, Schwarz) für Banner, Wappenröcke, Schilde, also Teamfarben
- **Licht:** Feuer, Glut und Fackelorange für Nacht und Schmieden

Teamfarben entstehen per **Palettentausch** auf markierten Pixeln (Wappenrock, Banner, Schild). Ein Sprite dient so für alle Spieler.

## Das Kernproblem: Menge

Die Drehung vervielfacht den Bedarf. Eine grobe Rechnung für den Release-Kern:

- **Einheiten:** 36 Typen × 6 Animationen × 8 Richtungen × ca. 8 Frames ≈ **14.000 Frames**
- **Gebäude:** 70 Gebäude × 4 Ansichten × 1–3 Stufen, dazu Bauphasen und Animationen ≈ **1.500 Bilder**
- **Mauer-Autotiles, Gelände, Effekte:** einige Hundert

Von Hand gepixelt ist das ohne großes Art-Team nicht zu schaffen. Deshalb:

## Pipeline-Vorschlag: Hybrid mit 3D als Werkzeug

| Asset-Art | Weg | Warum |
|---|---|---|
| **Gebäude, Mauern, Türme, Belagerungsgerät** | Low-Poly-3D in Blender → Iso-Kamera → Pixel-Render → Nacharbeit | vier Ansichten gratis, Bauphasen und Schadensstufen als Modell-Varianten |
| **Figuren und Tiere** | Ein gemeinsames Grund-Rig mit austauschbarer Ausrüstung → Render in 8 Richtungen | **alle 36 Einheitentypen aus einem Skelett und einem Satz Animationen** |
| **Gelände-Tiles** | Von Hand bzw. prozedural mit Varianten | flach, keine Drehprobleme, Übergänge per Autotiling |
| **Effekte** (Rauch, Feuer, Funken, Staub, Wasser) | Partikel und Shader im Spiel | bewegt sich frei, kostet keine Frames |
| **UI, Icons, Konzeptbilder** | KI-Bildgenerierung (Codex-Bridge) plus Nacharbeit | keine Drehung nötig |

### Wie aus 3D Pixelart wird
1. Modelle bewusst einfach halten, mit flachen Farben bzw. kleinen handgemalten Texturen aus der Hauptpalette
2. Orthografische Kamera mit 2:1-Winkel (Höhenwinkel ca. 30°, Drehung 45°), vier bzw. acht Positionen
3. Rendern in doppelter oder vierfacher Auflösung, dann Verkleinern ohne Glättung und **Farbreduktion auf die Hauptpalette**
4. **Umrisslinie** als Nachbearbeitung (dunkle, farbige Kontur), Licht in 3–4 harten Stufen
5. Helden-Assets (Bergfried, Torhaus, Hauptfiguren) von Hand nachpixeln
6. Ein Skript packt alles in Texturatlanten mit Metadaten (Ankerpunkt, Grundriss, Frames)

**Der Einwand aus dem Briefing, 3D wirke weniger gut, stimmt für 3D-Spiele.** Hier sieht der Spieler kein 3D: Er sieht Pixelart, die konsequent aus einer festen Kamera kommt. Etliche bekannte Pixelart-Spiele arbeiten so. Der Stil steht und fällt mit Schritt 3–5, deshalb ist der **Look-Test** der erste Arbeitsschritt.

### Wer baut die Modelle?
Claude kann Blender per Python-Skript steuern. Einfache, kantige Mittelalterbauten (Kisten, Dächer, Fachwerk, Zinnen) lassen sich **prozedural aus Bausteinen** erzeugen. Für Figuren und Animationen ist ein frei lizenziertes Grund-Rig sinnvoll. Wenn Sebastian oder jemand im Team Blender oder Aseprite beherrscht, ist das ein großer Hebel.

## Lebendigkeit

- **Gebäude-Animationen** als kleine Schleifen-Overlays: Schornsteinrauch, Mühlenflügel, Wasserrad, Feuer in der Esse
- **Umgebung:** wiegende Bäume (Shader), fliegende Vögel, laufende Hühner, grasende Pferde und Kühe, Kinder, Hunde
- **Wasser** animiert per Shader (Wellen, Glitzern), Uferschaum als Tile-Animation
- **Fahnen** als Sprite-Animation in 4 Windrichtungen
- **Tageszeit:** Farbkorrektur per Farbtabelle (Morgengrau, Mittag, goldene Stunde, Nacht in Blau), nachts additive Lichtquellen an Fackeln, Fenstern und Schmieden
- **Wetter:** Regen und Schnee als Partikel, nasse und verschneite Gelände-Varianten per Palettentausch

## Animationen pro Figur

Pflicht: Stehen (mit Atmen), Gehen, Rennen, Tragen (gehend mit Last), Arbeiten (berufsspezifisch), Angriff (waffenspezifisch), Treffer, Sterben, Leiche. Dazu Klettern (Leiter), Schießen über Zinnen und Jubeln.

## Look-Test (erster Arbeitsschritt)

1. **Stimmungsbild** per Codex: eine Burgsiedlung in Isometrie, Abendstimmung. Das legt Palette und Atmosphäre fest.
2. **Ein Mauerturm mit zwei Mauerstücken** über die Blender-Pipeline, in allen vier Ansichten.
3. **Eine Figur** (Speerkämpfer) gehend in 8 Richtungen.
4. Alles zusammen auf einem kleinen Gelände-Stück, drehbar im Browser.

Wenn das überzeugt, ist die Pipeline bestätigt (ADR 0003). Wenn nicht, wird früh auf mehr Handarbeit oder kleinere Figuren umgeschwenkt.

## Figurentest aus Blender (17.11.2026)

Punkt 3 des Look-Tests ist als erster Test umgesetzt, Werkzeuge in [tools/blender/](../../tools/blender/README.md), Ergebnisse in `assets/figures/`.

- **Modelle:** `figures.py` baut acht Figuren prozedural aus Grundkörpern (Holzfäller, Tagelöhner mit Stamm, Speerträger, Schwertkämpfer, Bogenschütze, Armbrustschütze mit Pavese, gepanzerter Fußsoldat, Landsknecht). Gemeinsamer Körper mit Knie- und Knöchelgelenk, Ausrüstung und Farben als Daten in `units.json`.
- **Kamera:** orthografisch, 30° Höhe, 45° Drehung, also exakt 2:1. Die Figur dreht sich in 45°-Schritten vor der festen Kamera. Je Bild zwei Renderdurchgänge: flache Farben und reines Licht mit dem kamerafesten Studiolicht.
- **Gang:** 8 Laufbilder, Knie beugt im Schwungbein, Standbein bleibt am Boden, Füße bleiben waagerecht.
- **Pixel:** `pixelize.py` ordnet jedem Renderpixel sein Material zu und verkleinert 4:1. Jeder Block übernimmt sein häufigstes Material, Augen, Haut, Klingen, Gold und Sehnen haben Vorrang. Das Licht wird in harte Stufen gesetzt. Dadurch hat jedes Material eine feste Farbrampe, und die **Teamfarbe lässt sich exakt per Palettentausch** wechseln (Tabelle `team_swap` in `sheet.json`, Kollisionsprüfung beim Bauen).
- **Stile:** fünf Richtungen als Datendateien in `styles/` mit denselben Modellen:

| Stil | Höhe | Kennzeichen | Farben |
|---|---|---|---|
| Vorgerendert | 32 px | im Geist der Burgenbau-Klassiker um 2000: glatt schattierte Modelle, sechs Lichtstufen mit leichtem Dithering, Metallglanz, dunkler Innenrand nur auf der Schattenseite, geschlossener Schlagschatten mit weichem Saum, Sand | 256 |
| Wappen | 30 px | kräftig, größerer Kopf, schwarze Kontur, drei Lichtstufen | 73 |
| Chronik | 32 px | natürliche Proportionen, farbige Kontur, vier Lichtstufen | 144 |
| Miniatur | 40 px | größer und schlanker, Variante zu offener Frage 3 | 144 |
| Holzschnitt | 32 px | dicke schwarze Kontur, zwei Lichtstufen, Schraffur | 75 |

- **Menge:** 8 Figuren × 8 Richtungen × 9 Bilder × 5 Stile = 2.880 Sprites in knapp zwei Minuten.
- **Prüfung:** zwei Prüfrunden mit je drei unabhängigen Blickwinkeln. Wappen liegt bei Lesbarkeit vorn, Chronik bei Stimmung. Vorgerendert kam auf Logges Wunsch („etwas mehr wie Stronghold Crusader“) danach dazu.

**Erkenntnisse:** Acht Richtungen und Laufzyklus kosten keine Handarbeit. Dünne Teile brauchen eine Mindestdicke von gut einem Pixel. Gehaltene Waffen müssen gegen die Armhaltung gedreht werden. Teamfarbe muss rundum sichtbar sein, auch von der Seite (Wappenrock, Pavese, Kappe). Licht und Kontur prägen das Aussehen stärker als das Modell. Für den vorgerenderten Eindruck zählt vor allem ein durchgehender Tonverlauf: glatt schattierte Modelle, Lichtschwellen neben den Helligkeitsplateaus, wenig Dither.

**Für die Engine:** Figurenatlas ohne Mipmaps und mit Nearest-Sampling, Teamtausch vor dem Skalieren. Schlagschatten später als eigenes Blatt in eine gemeinsame Schattenebene zeichnen, damit sich Schatten in Gruppen nicht doppelt abdunkeln (im Test noch ins Sprite eingebacken).

**Grenzen:** keine Ellbogen, kein Mitdrehen des Oberkörpers, nur Stehen und Gehen, keine Nacharbeit von Hand, keine Kleinteile wie Beutel oder Scheide. Die Stile nutzen je 73–256 Farben statt einer gemeinsamen Hauptpalette von ca. 64. Dither und Schraffur hängen an der Figur, können beim Gehen aber noch leicht flimmern. Für echte Figuren braucht es ein Skelett mit Animationen.

## Gebäudetest aus Blender (17.11.2026)

Punkt 2 und 4 des Look-Tests: Mauerturm mit Mauerstücken in vier Ansichten und alles zusammen drehbar, dazu weitere Bauten. Werkzeuge in [tools/blender/](../../tools/blender/README.md), Ergebnisse in `assets/buildings/`.

- **Bauten:** Wohnhaus (Fachwerk, Strohdach), Holzfällerhütte (Blockbau, Hofstapel in 3 Stufen), Steinbruch (Felsen mit Abbaustufen, Kran, Unterstand, Blockstapel in 3 Stufen), Lagerplatz (eingezäunt, Holz, Stein, Eisen, Fässer, Kisten und Speere in 5 Füllstufen), Kaserne (Steinsockel, Fachwerk, Ziegeldach, Banner in Teamfarbe, Übungsplatz), Mauerturm, Mauerstück, Mauertreppe, Laubbaum (2 Varianten), Tanne.
- **Bausteine statt Einzelmodelle:** `buildings.py` setzt alles aus wenigen Funktionen zusammen (Mauerwerk aus versetzten Steinen in zwei Tönen, Fachwerk, Strohdach, Schindel- und Ziegeldach, Zinnen, Türen, Fenster, Zaun, Stapel). Ein neues Gebäude ist ein Eintrag in `buildings.json` und eine kurze Bauanleitung.
- **Vier Renderdurchgänge je Ansicht:** flache Farben, Licht, Höhe über dem Boden, bei Mauer und Turm die zur Kamera zeigende Brüstung. Aus der Höhe entstehen der Schlagschatten (gleiche Richtung wie bei den Figuren) und Schatten auf Böden und Plattformen. Blenders eigene Schatten funktionieren beim Rendern ohne Fenster nicht.
- **Eine Palette für alle Stile:** Die Bauten werden einmal gerendert und in allen fünf Stilen verpixelt. Teamfarbe, Holz, Gold und Stahl übernehmen die Farbe des Stils, damit Gebäude und Figuren zusammenpassen.
- **Maßstab:** Tile-Kante 2,55 m, Höhenstufe 1,04 m, Figur 1,8 m. Wehrgang auf 3 Höhenstufen, Turmplattform auf 5, die Posten aus `buildings.json` liegen genau darauf.
- **Konzeptseite:** kleine Siedlung auf 12 × 12 Tiles. Drehung nach den Formeln aus Kapitel 09 (Ansicht = (o − r) mod 4), Zeichenreihenfolge topologisch nach Grundriss. Holzfäller, Hof, Träger und Lager sind als einfacher Ablauf nachgestellt. Schützen verteilen sich auf freie Posten, die vordere Brüstung wird nach ihnen gezeichnet und verdeckt ihre Beine.
- **Menge:** 10 Bauten, 76 Bilder je Stil, zusammen 380, in etwa anderthalb Minuten.

**Prüfrunde:** Drei unabhängige Prüfer (Pixelhandwerk, Spieltechnik, Briefing). Eingearbeitet: Dach von Kaserne und Holzfällerhütte saß versetzt, Wehrgang zeigte Mörtel statt Deckplatten, doppelte Zinnen an den Nahtstellen, Hofstapel in zwei von vier Ansichten verdeckt (jetzt auf zwei Ecken verteilt, Fels des Steinbruchs niedriger), Lagerstufen sprangen statt zu wachsen, Mauerposten auf der falschen Seite, Turmfahne fehlte im Vorderteil, Schattensprenkel, eigene Lichtskala für Gebäude, Ziegel und Schindeln einzeln, Stroh in Lagen, Laub aus vielen kleinen Büscheln, Banner mit Sparren statt Kreuz.

**Grenzen:** Noch keine Bauphasen, Schadensstufen und Animationen (Rauch, Fahnen, Kran). Mauern nur als gerades Stück, ohne Ecken, Enden, Tore und Autotiling. Große Gebäude werden im Ganzen sortiert, die Streifen-Sortierung aus Kapitel 09 fehlt. Lagerstufen füllen alle Plätze gleichzeitig. Der Schlagschatten ist ins Sprite eingebacken. Keine Nacharbeit von Hand. Bäume, Steinbruch und Kaserne ragen leicht über ihren Grundriss hinaus. Lagerplatz mit einer gemeinsamen Füllstufe für alle Waren, im Spiel braucht jede Ware ihren eigenen Stapel. Offen zur Entscheidung: Die Mauer wirkt mit 3 Höhenstufen neben den Figuren eher niedrig (4 Stufen wären 4,2 m), der Stil „Miniatur“ hat größere Figuren als die Gebäude erlauben, und Sandboden mit hellem Sandstein erinnert stark an die Wüstenburgen des Vorbilds.

