# 08 – UI und UX

> Status: **Entwurf v1** (16.11.2026)

## Bildschirmaufteilung

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ⚜ Gold 1.240  👥 86/120  ☺ 72%  🍞 14 Tage  ▦ Lager 64%  ▣ Kornk. 41%   │  ← Kopfleiste (dunkles Holz, Eisenbeschläge)
│                         ✒ „Herbst 1187: Die erste Steinmauer steht.“    │  ← Chronik-Zeile
├──────────────────────────────────────────────────────────────┬───────────┤
│                                                              │ Pergament │
│                                                              │ Auswahl:  │
│                       Spielwelt                              │ Porträt,  │
│                                                              │ Status,   │
│                                                              │ Befehle,  │
│                                                              │ Ausbau    │
├────────────┬─────────────────────────────────────────────────┴───────────┤
│  Minikarte │ [Siedlung][Nahrung][Rohstoffe][Handwerk][Lager][Militär]    │  ← Fußleiste (Stein)
│  (drehbar) │ [Wehrbau][Forschung][Zierde]   ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢           │
└────────────┴─────────────────────────────────────────────────────────────┘
```

- **Kopfleiste:** immer sichtbar. Jeder Wert öffnet per Klick eine Detailansicht (z. B. Nahrung nach Sorten, Lager nach Waren).
- **Chronik-Zeile:** neueste Ereignisse. Ein Klick springt in der Welt dorthin, `Leertaste` springt zum letzten Ereignis.
- **Seitenleiste rechts (Pergament):** erscheint nur bei Auswahl. Sie zeigt Porträt bzw. Gebäudebild, Zustand, Arbeiter, Produktionsfortschritt, Lagerbestand des Gebäudes, Ausbau und Befehle.
- **Fußleiste:** Baukategorien als Reiter, darunter ein Raster mit Bausymbolen. Links die Minikarte, die sich mit der Kamera dreht und die Blickrichtung zeigt.

## Material und Stil

- **Kopfleiste:** dunkles Eichenholz mit Eisenbändern und Nieten
- **Fußleiste:** behauene Steinplatte mit eingelassenen Holzrahmen für Symbole
- **Seitenleiste:** Pergament mit Wachssiegel bei Gebäuden und Wappenschild bei Einheiten
- **Ornamente** nur an Ecken und Trennern, nie im Inhaltsbereich
- **Schrift:** gebrochene Zierschrift (Textura-artig) nur für Überschriften. Für Text und Zahlen eine klare Pixel-Serifenschrift, Zahlen immer gut lesbar. Freie Schriften mit passender Lizenz werden gesucht, oder eigene als Bitmap-Font gebaut.
- **Icons:** kleine handgezeichnete Pixel-Icons (16 × 16 und 32 × 32) mit einheitlicher Kontur und Lichtrichtung

## Einheitenraster

Gebäude wie die Kaserne zeigen im Auswahlpanel ein Raster, in dem **jede Zeile eine Entwicklungslinie** ist und die Spalten den Fortschritt zeigen:

```
Kaserne
 Speer:     [Waffenknecht] [Speerkämpfer] [Hellebardier🔒] [Pikenier🔒]
 Schwert:   [Milizsoldat🔒] [Schwertkämpfer] [Gep. Fußknecht🔒]
 Sturm:     [Leiterträger]
 Unterst.:  [Bannerträger🔒] [Trommler🔒] [Feldscher🔒]
```

- Unter jedem Symbol: Goldkosten und kleine Symbole für die nötige Ausrüstung. Fehlt etwas im Lager, ist dieses Symbol rot.
- **Gesperrt:** entsättigt mit Schloss. Der Tooltip nennt die fehlende Forschung bzw. das fehlende Gebäude, ein Klick darauf öffnet den Forschungsbaum an dieser Stelle.
- **Detailkarte** (Rechtsklick oder langes Halten): Werte, Schadensart, Rüstungsklasse, „stark gegen“ und „schwach gegen“, Sold, Zeitraum.
- Das Raster skaliert: Jede Ausbildungsstätte hat ihr eigenes Raster, so bleibt es auch bei 35+ Einheiten übersichtlich.

## Forschungsbaum

Eigener Vollbild-Bildschirm als **Pergamentrolle**, nach Forschungsstätten in drei Spalten. Verbindungslinien zeigen die Voraussetzungen, Doktrin-Gabelungen sind als Wappenschild mit zwei Hälften dargestellt. Laufende Forschung zeigt den Fortschritt und die noch fehlenden Waren.

## Overlays (Taste `O` und Symbolleiste)

| Overlay | Zeigt |
|---|---|
| **Warenfluss** | animierte Linien für die Hauptströme der letzten Minuten, dicker bei mehr Verkehr, rot bei Staus und Wartezeiten |
| **Lager** | Füllstand je Lager als Balken über dem Gebäude |
| **Probleme** | Symbole über Gebäuden: keine Arbeiter, kein Rohstoff, Lager voll, kein Weg |
| **Wehr** | Reichweiten von Türmen und Schützen, Wehrgänge hervorgehoben, freie und besetzte Posten |
| **Fruchtbarkeit / Rohstoffe** | Bodenqualität und verbleibende Vorräte |

## Steuerung

| Aktion | Eingabe |
|---|---|
| Kamera bewegen | `WASD`, Pfeiltasten, Bildschirmrand, mittlere Maustaste ziehen |
| Drehen | `Q` / `E` (90°, kurze Überblendung) |
| Zoomen | Mausrad (rastet auf Stufen ein) |
| Gebäude drehen beim Bauen | `R` |
| Gruppen | `Strg + 1–9` setzen, `1–9` wählen, zweimal = Kamera hin |
| Bergfried | `H` |
| Pause | `P` (Bauen und Befehle auch in der Pause möglich) |
| Durchsicht | `Tab` (Mauern und Dächer absenken) |

## Skalierung

Die UI wird in **ganzzahligen Faktoren** skaliert (1×, 2×, 3×), passend zur Auflösung. Zielauflösungen sind 1920 × 1080 (UI 2×) und 2560 × 1440 (UI 2× oder 3×). Die Spielwelt hat ihren eigenen Zoom.

## Rückmeldung ohne Text

Die Welt zeigt Zustände zuerst: Ruhende Arbeiter sitzen, volle Lager quellen über, ein Gebäude ohne Arbeiter hat dunkle Fenster. Erst dann kommen Symbole, erst dann Text. Die Chronik meldet nur Wichtiges.
