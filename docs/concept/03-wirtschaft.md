# 03 – Wirtschaft und Warenströme

> Status: **Entwurf v1** (16.11.2026). Zahlen sind Balancing-Startwerte, keine Festlegung.

## Grundprinzip: Waren sind Dinge

Eine Ware existiert in der Simulation immer **an einem Ort**: als Stapel in einem Lager, auf dem Hof eines Produktionsgebäudes, auf dem Rücken eines Trägers oder auf einem Karren. Der Lagerbestand in der Ressourcenleiste ist nur die **Summe aller sichtbaren Lagerstapel**. Es gibt keinen unsichtbaren Zähler, der stattdessen hochzählt.

## Waren

| Gruppe | Ware | Lager | Quelle |
|---|---|---|---|
| **Baustoffe** | Holz | Lagerplatz | Holzfäller |
| | Stein | Lagerplatz | Steinbruch |
| | Pech | Lagerplatz | Pechsieder (Nadelwald, Sumpf) |
| | Schilf | Lagerplatz | Schilfschneider (Sumpf), für Dächer |
| **Metall** | Eisenerz | Lagerplatz | Eisenmine |
| | Holzkohle | Lagerplatz | Köhler (Holz → Holzkohle) |
| | Eisen | Lagerplatz | Schmelzhütte (Erz + Holzkohle) |
| **Nahrung** | Getreide | Kornkammer | Getreidehof |
| | Mehl | Kornkammer | Mühle (Wind- oder Wassermühle) |
| | Brot | Kornkammer | Bäckerei |
| | Fleisch | Kornkammer | Jäger, Schweinehof |
| | Käse | Kornkammer | Milchhof (Kühe, liefern auch Häute) |
| | Äpfel | Kornkammer | Obstgarten |
| | Fisch | Kornkammer | Fischer |
| **Genuss** | Hopfen → Bier | Lagerplatz → Gasthaus | Hopfengarten → Brauerei |
| **Textil und Leder** | Wolle, Flachs | Lagerplatz | Schäferei, Flachsfeld |
| | Stoff | Lagerplatz | Weberei |
| | Häute → Leder | Lagerplatz | Milchhof, Jäger → Gerberei |
| **Ausrüstung** | Werkzeug | Lagerplatz | Werkzeugmacher (Eisen + Holz) |
| | Waffen (Speer, Bogen, Armbrust, Schwert, Streitkolben, Hellebarde, Pike, Büchse) | Lagerplatz | Drechsler, Bogner, Armbruster, Waffenschmied, Büchsenmacher |
| | Rüstungen (Gambeson, Lederwams, Kettenhemd, Plattenharnisch, Schild) | Lagerplatz | Schneider, Gerberei, Kettenschmied, Plattner, Schildmacher |
| | Pferde | Weide | Gestüt |
| **Pulver** | Salpeter, Schwefel → Pulver | Lagerplatz | Salpetersieder (Viehmist), Schwefel nur über Handel → Pulvermühle |
| **Wert** | Gold | Schatzkammer im Bergfried | Steuern, Markt, Zölle |

## Lagerhaltung

### Lagerplatz (Materiallager)
- Ein **Lagerplatz-Modul** ist ein offener Hof von 3 × 3 Tiles mit **9 Slots**. Jeder Slot fasst eine Warenart.
- Jede Ware hat ein Slot-Limit (Holz 24, Stein 16, Eisen 12, Waffen 12 …) und **4–6 sichtbare Füllstufen**: Holz liegt als Stammstapel, Stein als Quaderblock, Eisen als Barrenstapel, Waffen in Gestellen, Rüstungen auf Ständern, Pech in Fässern.
- **Erweiterung:** Weitere Module müssen direkt angrenzend gebaut werden. Ein zusammenhängender Lagerplatz zählt als ein Lager, damit Träger nicht zwischen Inseln pendeln. Ein zweiter, getrennter Lagerplatz ist möglich (zum Beispiel am Steinbruch) und verkürzt Wege.
- **Forschung „Überdachte Lager“:** Holzdach, +50 % Kapazität pro Slot, Schutz vor Regen-Verderb (falls Verderb kommt).

### Kornkammer
- Geschlossener Speicher mit offener Seite, in die man hineinsieht: **Säcke, Fässer, Körbe und Räucherwürste**, die sichtbar mehr werden. 2 × 3 Tiles, 6 Slots.
- Erweiterung durch weitere Kornkammern im Umkreis von 6 Tiles, die als Verbund gelten.
- Die Kornkammer verteilt Nahrung. Im Prototyp geschieht das abstrakt pro Kopf, später tragen Mägde Körbe zu den Wohnvierteln.

### Volles Lager
Ist kein passender Slot frei, **wartet** der Träger mit seiner Last am Produktionsgebäude (Sprechblasen-Symbol „Lager voll“). Das Gebäude produziert weiter, bis der eigene Hofstapel voll ist (z. B. 4 Einheiten), dann ruht die Arbeit sichtbar: Der Holzfäller setzt sich auf einen Baumstumpf.

## Transport: drei Stufen

| Stufe | Wer | Kapazität | Wege | Freischaltung |
|---|---|---|---|---|
| **1. Selbstträger** | Jeder Arbeiter holt seine Rohstoffe selbst und bringt sein Produkt selbst ins Lager | 1 Einheit (Holz, Stein: 1; Getreide: 2 Säcke) | Gelände, Straße schneller | Start |
| **2. Handkarren** | Arbeiter schieben einen Handkarren | 3 Einheiten, langsamer im Gelände | bevorzugt Straße | Forschung „Schubkarren und Handwagen“ |
| **3. Fuhrwesen** | Fuhrleute aus dem **Fuhrhof** mit Ochsenkarren bzw. später Pferdewagen | Ochse: 8 bei Tempo 0,7, Pferd: 8 bei Tempo 1,2 | **nur Straßen** mit vollem Tempo, im Gelände ×0,3 | Fuhrhof (Ochsen), Forschung „Kummet“ (Pferde) |

**Großmengen-Produzenten** (Steinbruch, Mine, Getreidehof in der Ernte) arbeiten mit **Hofstapeln**: Die Arbeiter legen ab, Fuhrleute holen ab. Ohne Fuhrhof tragen die Arbeiter selbst, aber langsam. So entsteht Stronghold-Gefühl am Anfang und echte Logistik-Planung später.

**Tagelöhner** übernehmen alle Fahrten, die keinem Gebäude gehören: Baumaterial zu Baustellen, Umlagerung zwischen Lagern, Bergung von Ausrüstung.

## Wie Arbeit abläuft: Arbeitszyklen

Jedes Produktionsgebäude beschreibt in seinen Daten einen **Arbeitszyklus** aus Schritten. Die Simulation führt ihn aus, die Darstellung zeigt zu jedem Schritt die passende Animation.

**Holzfäller** (1 Arbeiter, ca. 1 Holz pro 30 s):
1. Nächsten freien, ausgewachsenen Baum im Radius 10 reservieren
2. Hingehen
3. Fällen (3 × Axtschlag-Animation, der Baum kippt mit Staubwolke)
4. Entasten und zersägen (Säge-Animation), dabei bleibt ein Stumpf zurück
5. Holzbündel auf die Schulter, zurück zur Hütte, auf den Hofstapel
6. Ist der Hofstapel ≥ 1 und kein Fuhrmann zuständig: zum Lagerplatz tragen

**Steinbruch** (3 Arbeiter, ca. 1 Stein pro 20 s gesamt):
1. Arbeiter schlagen am Fels Blöcke (Spitzhacke, Funken, Steinsplitter). Der Fels schrumpft in Stufen.
2. Ein Arbeiter bedient den Kran bzw. die Rolle und hebt Blöcke auf den Hofstapel.
3. Ochsenkarren (aus dem Fuhrhof) holen 8 Blöcke ab und fahren über die Straße zum Lagerplatz. Ohne Fuhrhof tragen Arbeiter einzeln.

**Getreidehof** (2 Arbeiter, Acker 6 × 6 Tiles):
1. Frühjahr: Pflügen (Ochse vor dem Pflug, wenn ein Ochse verfügbar ist), Säen
2. Sommer: Getreide wächst sichtbar in 4 Stufen
3. Herbst: Sensen-Ernte Reihe für Reihe, Garben stapeln
4. Garben auf den Hofstapel, Abtransport zur Kornkammer

**Bäckerei:** Bäcker holt 1 Mehl aus der Kornkammer, knetet, schiebt Brot in den Ofen (Feuerschein, Rauch), nimmt 4 Brote heraus, trägt sie im Korb zur Kornkammer.

**Waffenschmied:** holt 1 Eisen vom Lagerplatz, Esse glüht auf, Hammerschläge mit Funken am Amboss, Abschrecken im Wassertrog (Dampf), fertiges Schwert ins Gestell. Bei 2 Schwertern im Gestell trägt er sie zum Lagerplatz.

## Produktionsketten

```
Holz ──────────────────────────────┬─→ Bau, Bogner, Drechsler (Speere)
  └─→ Köhler → Holzkohle ─┐        │
Eisenerz (Mine) ──────────┴─→ Schmelzhütte → Eisen ─┬─→ Waffenschmied → Schwerter, Streitkolben
                                                    ├─→ Kettenschmied / Plattner → Rüstung
                                                    ├─→ Werkzeugmacher → Werkzeug
                                                    └─→ Büchsenmacher (+ Holz) → Büchsen

Getreidehof → Getreide (Kornkammer) → Mühle → Mehl (Kornkammer) → Bäckerei → Brot (Kornkammer)
Hopfengarten → Hopfen ─┐
Getreide ──────────────┴─→ Brauerei → Bier → Gasthaus
Milchhof → Käse + Häute → Gerberei → Leder ─┬─→ Lederwams
                                            └─→ Pergament (Forschung)
Schäferei → Wolle ─┐
Flachsfeld → Flachs┴─→ Weberei → Stoff → Schneider → Gambeson, Wappenröcke
Viehmist → Salpetersieder → Salpeter ─┐
Holzkohle ────────────────────────────┼─→ Pulvermühle → Pulver
Schwefel (Handel) ────────────────────┘
```

## Werkzeug als Engpass

Viele verarbeitende Gebäude brauchen beim **Bau** Werkzeug, manche auch im Betrieb gelegentlich (Verschleiß: 1 Werkzeug pro 20 Zyklen). Das verankert die Metallkette früh im Spiel, ohne dass man sofort Waffen braucht.

## Gold

- **Steuern** vom Bergfried, abhängig von Bevölkerung und Steuerregler. Der Steuereintreiber geht sichtbar durch die Wohnviertel.
- **Markt:** Kaufen und Verkaufen jeder Ware. Händler kommen mit dem Karren über die Kartenkante, laden ab und auf und fahren wieder. Ohne Straße zur Kartenkante gibt es keinen Handel.
- **Zölle:** Brücken und Tore an Handelsstraßen bringen Zoll (später).
- **Sold:** Berufssoldaten und Söldner kosten laufend Gold. Das ist der große Gold-Verbraucher.

## Auftragssystem (Technik in Kürze)

- Jeder Hofstapel meldet ein **Angebot** („2 Stein am Steinbruch“), jede Baustelle und jedes verarbeitende Gebäude eine **Nachfrage** („braucht 1 Eisen“).
- Ein Disponent gleicht beides in festen Abständen ab (nicht jedes Bild) und vergibt **Transportaufträge** an freie Träger, Karren oder Tagelöhner. Kriterium sind die Wegkosten.
- Wegkosten zu Lagern werden als **Distanzkarten** zwischengespeichert und nur bei Bauänderungen neu berechnet. So muss nicht jede Figur ständig selbst den Weg suchen.
- Details in [09 – Technik](09-technik.md).

## Umfang im ersten Prototyp

Holz und Stein, Holzfäller und Steinbruch, ein Lagerplatz mit Erweiterungsmodulen, Selbstträger, ein Fuhrhof mit Ochsenkarren für den Steinbruch. Waffen kommen im Prototyp als Startbestand im Lager vor, die Schmiedekette folgt in M4.
