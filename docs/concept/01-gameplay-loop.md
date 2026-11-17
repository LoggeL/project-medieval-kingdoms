# 01 – Spielablauf und Spielmodi

> Status: **Entwurf v1** (16.11.2026)

## Kernschleife

```
Siedler anlocken → Arbeitsplätze und Wohnraum schaffen → Rohstoffe gewinnen
      ↑                                                        ↓
Zufriedenheit sichern ← Nahrung und Güter verteilen ← Waren verarbeiten und lagern
      ↓
Überschuss → Gold, Forschung, Ausrüstung → Befestigung und Armee → Bedrohungen abwehren / Gegner erobern
```

## Verlauf einer Partie

| Phase | Zeit | Was passiert | Spielgefühl |
|---|---|---|---|
| **Gründung** | 0–10 min | Start mit Herrenhof, Lagerplatz, Kornkammer und 8–12 Siedlern. Holzfäller, Steinbruch und Äcker entstehen, erste Hütten. | Ruhig, die Welt erwacht |
| **Aufbau** | 10–30 min | Erste Produktionsketten (Mühle, Bäckerei), mehr Lager, Straßen, Palisade, erste Waffenknechte. Ein erster Raubritter-Überfall testet die Verteidigung. | Planen, optimieren |
| **Ausbau** | 30–60 min | Steinmauern, Türme, Eisen und Schmieden, Forschung mit ersten Doktrin-Entscheidungen, Armee aus mehreren Einheitentypen. | Abwägen, spezialisieren |
| **Entscheidung** | 60–90 min | Belagerung durch den Gegner oder eigener Feldzug: Belagerungsgerät, Mauerverteidigung, eventuell Pulver. | Spannung, Taktik |

## Bevölkerung

- **Siedler kommen** zum Herrenhof, wenn Wohnraum frei ist und die Zufriedenheit über der Schwelle liegt. Sie gehen wieder, wenn sie dauerhaft unzufrieden sind.
- **Arbeit:** Jedes Produktionsgebäude hat Arbeitsplätze. Siedler ohne Arbeitsplatz werden zu **Tagelöhnern**. Sie tragen Baumaterial zu Baustellen, helfen beim Bau, heben Gräben aus und bergen Ausrüstung nach Kämpfen. Arbeitslosigkeit ist also nicht verschwendet, aber unproduktiv.
- **Soldaten** werden aus Tagelöhnern rekrutiert. Wer viele Soldaten will, braucht Bevölkerung und damit Wohnraum und Nahrung.
- **Zufriedenheit** setzt sich zusammen aus:
  - Nahrung (Menge **und** Vielfalt: Brot, Fleisch, Käse, Äpfel …)
  - Steuern (Gold gegen Zufriedenheit, wie ein Regler)
  - Glaube (Kapelle, Kirche, Kloster in Reichweite)
  - Gasthaus und Bier
  - Ordnung (Wachen, Galgen oder Pranger erhöhen die Ordnung, senken aber die Zufriedenheit)
  - Ereignisse (Brände, Seuchen, Siege)

## Bedrohungen

- **Natur:** Wölfe reißen Vieh und greifen einzelne Arbeiter an. Feuer breitet sich in Holzvierteln aus (Brunnen und Wassereimer-Ketten).
- **Raubritter und Söldnerhaufen:** angekündigte Überfälle mit steigender Stärke. Sie testen früh, ob Mauern und Tore funktionieren.
- **Rivalisierende Herren (KI):** bauen sichtbar ihre eigene Burg, handeln, forschen und greifen an. Da es keinen Nebel des Krieges gibt, sieht man Aufmärsche früh. Das belohnt Vorbereitung statt Reaktionsgeschwindigkeit.

## Spielmodi

| Modus | Beschreibung | Wann |
|---|---|---|
| **Freies Bauen** | Keine oder einstellbare Bedrohungen, reiner Aufbau | Prototyp-nah |
| **Gefecht** | 1–4 Herren auf einer Karte gegen KI. Sieg durch Einnahme des gegnerischen Bergfrieds | Nach M5 |
| **Belagerung** | Vorgegebene Burg: halten, bis Entsatz kommt, oder erstürmen. Ideal zum Testen der Mauermechanik | Früh als Testszenario |
| **Kampagne „Chronik der Kronmark“** | Verbundene Szenarien vom Vogt zum König | Nach Release-Kern |
| **Mehrspieler** | Gefecht gegen Menschen, deterministische Simulation (Lockstep) macht es möglich | Später, aber in der Technik vorbereiten |

## Sieg und Niederlage

- **Sieg:** Der gegnerische Bergfried (bzw. Herrenhof) wird eingenommen, also von eigenen Truppen betreten und gehalten, während dort keine Verteidiger mehr sind. Alternativ szenarioabhängige Ziele: X Jahre halten, Bevölkerung Y erreichen, Ware Z liefern.
- **Niederlage:** Der eigene Bergfried fällt.

## Zeit und Jahreszeiten

Ein Spieljahr dauert etwa 8–12 Minuten Echtzeit. Jahreszeiten wirken auf die Landwirtschaft (siehe [Welt](02-welt-und-karten.md)). Die Jahreszahl läuft als Stimmung und für die Chronik mit, löst aber **keine** Epochenwechsel aus.

## Umfang im ersten Prototyp

Freies Bauen auf einer handgebauten Karte und ein **geskripteter Überfall** von Banditen, mit dem sich Mauer, Tor und Stationierung prüfen lassen. Keine Gegner-KI, keine Zufriedenheit (Siedler kommen fest getaktet).
