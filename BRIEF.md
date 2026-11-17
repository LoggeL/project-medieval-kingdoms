# PROJECT: MEDIEVAL KINGDOMS – Briefing

> Anforderungen des Auftraggebers vom 16.11.2026, als Markdown gegliedert.
> Dazu zwei Wünsche: zuerst ein kreatives Konzept, und eine 2D-isometrische Darstellung, weil 3D seiner Einschätzung nach weniger gut wirkt.
> Projektname: PROJECT: MEDIEVAL KINGDOMS (festgelegt von Logge, 16.11.2026).

Ein umfangreiches, spielbares Echtzeit-Strategiespiel (RTS). Mechaniken und Spielgefühl orientieren sich an klassischen Strategiespielen wie Stronghold, Stronghold Crusader und Age of Empires, das Spiel soll aber eine eigenständige Identität bekommen. Zeitraum: Hochmittelalter bis Spätmittelalter mit ersten Schießpulverwaffen und Pike-and-Shot-Einheiten. Die Vorgaben sind verbindlich.

## 1. Grundlegende Spielidee

- 2D-isometrische Spielwelt, hochwertiger, detailverliebter Pixelart-Stil
- Sichtbarer und lebendiger Basisbau
- Komplexes Wirtschaftssystem mit **physisch sichtbaren Warenströmen**
- Militärisches Einheiten- und Technologiesystem
- Umfangreiche Befestigungs- und Verteidigungsmechaniken
- Individuell ausbaubare Siedlungen und Burgen
- **Keine klassischen Zeitalter**: Fortschritt nur über Forschung und das Freischalten einzelner Einheiten und Gebäude

Der Spieler übernimmt eine mittelalterliche Siedlung, entwickelt sie wirtschaftlich und militärisch und errichtet eine befestigte Stadt bzw. Burganlage. Das Spiel mischt Wirtschaftssimulation, Städtebau, Burgensimulation und klassisches RTS.

**Wichtigstes Designprinzip: Die Spielwelt muss leben.** Einheiten, Arbeiter, Tiere, Gebäude, Waren und Produktionsprozesse werden möglichst physisch in der Welt dargestellt. Ressourcen sind nicht nur abstrakte Zahlen in einem Menü.

## 2. Grafikstil und Spielwelt

### 2.1 Grafikstil
- Detaillierte Pixelart-Sprites, lebendige und abwechslungsreiche Farbpalette
- Natürlich wirkende Licht- und Schatteneffekte
- Detailreiche Gebäude mit sichtbaren Dächern, Fenstern, Türen und architektonischen Elementen
- Animierte Details: Rauch, wehende Fahnen, flackernde Feuer, Wasserbewegung, arbeitende Figuren
- Individuelle Animationen für sämtliche Einheiten: Gehen, Rennen, Arbeiten, Kämpfen, Sterben, Interagieren
- Jahreszeitliche und atmosphärische Veränderungen, soweit technisch sinnvoll
- Nicht steril oder minimalistisch, sondern wie eine handgezeichnete, lebendige mittelalterliche Welt

### 2.2 Isometrische Perspektive
- Klassische 2:1-Isometrie
- Karte in festen Stufen drehbar (z. B. 90-Grad-Schritte)
- Mehrere Zoomstufen, flüssige Kamerabewegung
- Gebäude und Einheiten werden aus allen Kamerawinkeln korrekt dargestellt
- Gebäudeplatzierung auf einem nachvollziehbaren isometrischen Raster
- Einheiten bewegen sich sinnvoll um Gebäude, Mauern und Hindernisse
- Die Rotation ist **keine rein optische Kameradrehung**: Gebäude, Einheiten, Orientierung und Platzierungslogik müssen in jeder Ansicht korrekt funktionieren.

## 3. Spielwelt und Karten

Landschaftstypen: Wälder und Lichtungen, fruchtbare Ebenen, Hügel und Gebirge, Flüsse und Seen, Küsten, Steinbrüche, Erzvorkommen, landwirtschaftliche Flächen, Sümpfe.

Die Landschaft bietet unterschiedliche wirtschaftliche und strategische Möglichkeiten:
- Steinbrüche nur an geeigneten Felsformationen
- Holzfäller brauchen Wald
- Landwirtschaft braucht geeignete Anbauflächen
- Minen brauchen Rohstoffvorkommen
- Flüsse und Straßen beeinflussen den Transport

**Kein klassischer Nebel des Krieges.** Die ganze Karte ist sichtbar, gegnerische Einheiten, Gebäude und Bewegungen ebenfalls.

## 4. Basisbau und Burgenbau

Stark an Stronghold orientiert.

### 4.1 Gebäudeplatzierung
Frei auf geeigneten Flächen im isometrischen Raster. Gebäude brauchen unterschiedlich viel Platz, Gelände kann die Platzierung einschränken, Gebäude lassen sich an Straßen anbinden und sollen sich harmonisch ins Stadtbild einfügen.

### 4.2 Befestigungsanlagen
Palisaden, Steinmauern, verstärkte Mauern, verschiedene Mauertürme, Wachtürme, Schießscharten, Burgtore, Zugbrücken, Wehrgänge, Zinnen, Gräben, Fallgatter, Torhäuser, Belagerungsabwehr. Mauern lassen sich flexibel bauen, der Spieler gestaltet eigene Befestigungslinien.

### 4.3 Einheiten auf Mauern (besonders wichtig)
- Einheiten können auf Mauern positioniert werden
- Automatische Verteilung auf freie Mauerabschnitte
- Türme bieten zusätzliche Stationierungsplätze
- Fernkämpfer greifen von Mauern aus an, Nahkämpfer verteidigen Wehrgänge
- Zugang über Treppen und Türme
- Taktischer Verteidigungsbonus auf Mauern
- Passende Bewegungs- und Kampfanimationen für stationierte Einheiten

Die Mauerverteidigung ist ein eigenständiger, wichtiger Teil des Spiels.

## 5. Wirtschaft und sichtbare Produktion

Eine der wichtigsten Mechaniken, orientiert an Stronghold. Ressourcen werden physisch sichtbar produziert, transportiert und eingelagert. Ein Gebäude, das nach Zeit X nur eine Zahl erhöht, reicht nicht.

### 5.1 Ressourcen
Holz, Stein, Eisen, Nahrung, Getreide, Mehl, Brot, Fleisch, Leder, Stoff, Werkzeuge, Waffen, Rüstungen, Gold. Weitere können hinzukommen.

### 5.2 Sichtbare Produktion (Beispiele)
- **Holzfäller:** Arbeiter verlassen das Gebäude, laufen zu Bäumen, fällen sie sichtbar, sammeln Stämme und bringen das Holz zum Lagerhaus.
- **Steinbruch:** Arbeiter bauen Stein ab, Blöcke werden sichtbar gesammelt, Ochsenkarren fahren sie über die Wege zum Lagerhaus.
- **Bauernhof:** Felder werden bearbeitet, Getreide wächst sichtbar, wird geerntet und in die Kornkammer gebracht.
- **Bäckerei:** Mehl wird angeliefert und verarbeitet, Brot sichtbar produziert und zur Kornkammer gebracht.
- **Waffenschmiede:** Rohstoffe werden angeliefert, Schmiede arbeiten am Amboss, fertige Waffen werden eingelagert.

### 5.3 Physischer Warentransport
Zu Fuß, mit Handkarren, Ochsenkarren, Pferdewagen oder anderen passenden Transportmitteln, jeweils sichtbar und animiert. Transportwege werden sinnvoll berechnet, Straßen erhöhen die Geschwindigkeit.

### 5.4 Lagerhaltung
- **Stockpile (Materiallager):** Holz, Stein, Eisen, Waffen, Werkzeuge, Baumaterialien
- **Granary (Kornkammer):** Getreide, Mehl, Brot, Fleisch, sonstige Lebensmittel

Eingelagerte Waren sind sichtbar (Holzstapel, Steinblöcke, Getreidesäcke, Fässer, Kisten). Die Kapazität ist begrenzt und durch zusätzliche Lager oder Erweiterungen ausbaubar. Ist das Lager voll, drosseln oder stoppen die Produktionsgebäude.

### 5.5 Wirtschaftskreisläufe
Die Produktionsstufen greifen tatsächlich ineinander, zum Beispiel:
- Getreidefarm → Kornkammer → Mühle → Bäckerei → Kornkammer
- Eisenmine → Stockpile → Schmelzhütte → Stockpile → Waffenschmiede → Stockpile

## 6. Militär und Einheitensystem

Umfangreich, viele Einheiten unterschiedlicher Qualität, Ausrüstung und Kosten. Keine Zeitalter, Freischaltung über Forschung.

### 6.1 Einheitengruppen
Infanterie, Speerträger, Schwertkämpfer, Stangenwaffenkämpfer, Fernkämpfer, Armbrustschützen, Kavallerie, Belagerungseinheiten, frühe Schießpulvereinheiten.

### 6.2 Technologische Entwicklung (historisch plausibel)
- Infanterie: Waffenknecht → Milizsoldat → Speerkämpfer → professioneller Schwertkämpfer → gepanzerter Fußsoldat → Hellebardier → Doppelsöldner → Landsknecht
- Bogenschütze → erfahrener Langbogenschütze
- Einfache Armbrust → schwere Armbrust
- Leichte Reiterei → gepanzerte Ritter
- Frühe Arkebusiere → spezialisierte Schützen
- Speerträger → Pikenier

Die Liste ist eine Orientierung und soll um passende historische Einheiten ergänzt werden.

### 6.3 Forschungssystem
Zentraler Fortschrittsmechanismus. Beispiele: verbesserte Metallverarbeitung, neue Schmiedetechniken, verbesserte Rüstung, neue Waffenarten, verbesserte Landwirtschaft, effizientere Transportmittel, Belagerungstechnik, frühe Schießpulvertechnologie, militärische Ausbildung. Forschung kostet Ressourcen und Zeit, hat Voraussetzungen und erzwingt strategische Entscheidungen. Man muss nicht alles erforschen, um erfolgreich zu sein.

### 6.4 Einheitenausbildung
Gebäude: Kaserne, Bogenschießplatz, Reitstall, Armbrustschießplatz, Waffenhof, Schießpulverwerkstatt. Voraussetzungen je Einheit: Bevölkerung, Gold, Nahrung, Waffen, Rüstungen, Forschung, freigeschaltete Gebäude. Einheiten sind optisch klar unterscheidbar, hochwertige Einheiten brauchen bessere Ausrüstung und sind teurer.

## 7. Kampfsystem

Klassisches Echtzeit-Kampfsystem: Einzel- und Mehrfachauswahl, Auswahlrahmen, Gruppen, Bewegen, Angreifen, Halteposition, Patrouille, Formation, Rückzug, Stationierung auf Mauern. Einheiten haben unterschiedliche Reichweiten, Lebenspunkte, Rüstungswerte und Schadensarten. Formation und Gelände spielen eine taktische Rolle:
- Pikeniere sind stark gegen Kavallerie
- Schwertkämpfer sind vielseitige Nahkämpfer
- Armbrustschützen sind stark gegen schwer gepanzerte Gegner
- Arkebusiere haben hohe Durchschlagskraft, laden aber langsam nach
- Kavallerie eignet sich für schnelle Angriffe und Flankenmanöver

## 8. Benutzeroberfläche

Fest am Bildschirmrand verankert und optisch Teil der mittelalterlichen Welt.

### 8.1 Gestaltung
Steinoptik, dunkles Holz, Metallbeschläge, Pergament, dezente mittelalterliche Ornamente, gut lesbare Schrift, kleine handgezeichnete Icons. Hochwertig, aber nicht überladen.

### 8.2 Aufteilung
- **Oben:** Ressourcen, Gold, Bevölkerung, Nahrung, Lagerkapazität, aktuelle Ereignisse
- **Unten:** Einheiten- und Gebäudemenü, Bauoptionen, Produktion, Militär, Verteidigung, Forschung
- **Links oder rechts:** Auswahl (Einheit/Gebäude) mit Infos, Produktionsstatus, Verbesserungen, Befehlen

### 8.3 Einheitenraster
Jede Einheit hat ein eigenes Icon, Kosten und Voraussetzungen werden angezeigt, gesperrte Einheiten sind sichtbar, aber ausgegraut. Ein Klick zeigt Details. Das Raster bleibt auch bei vielen Einheiten übersichtlich.

## 9. Gebäude und Infrastruktur

Kategorien: Wohnen, Landwirtschaft, Rohstoffgewinnung, Verarbeitung, Lagerhaltung, Militär, Forschung, Verteidigung, Infrastruktur, Dekoration.

Jedes Gebäude hat: eigenes Pixelart-Sprite, Baukosten, Bauzeit, Funktion, Produktionswerte, benötigte Ressourcen, mögliche Verbesserungen und, wo sinnvoll, eigene Animationen. Gebäude können optisch verschiedene Ausbaustufen haben.

## 10. Animationen und lebendige Welt

Die Welt wirkt nie statisch: Rauch aus Schornsteinen, Schmiede am Amboss, Holzträger, Ochsen vor Karren, grasende Pferde, Bauern auf Feldern, Wachen auf Mauern, Fahnen im Wind, bewegtes Wasser, flackerndes Feuer, Händler mit Waren. Jede Einheit hat eine erkennbare Identität, die Animationen sind flüssig und abwechslungsreich.

## 11. Technische Umsetzung

Passende Engine bzw. passendes Framework. Die Architektur unterstützt: isometrisches Tile-System, große Karten, viele gleichzeitige Einheiten, effiziente Pfadfindung, modulare Gebäude und Einheiten, Ressourcen- und Wirtschaftssystem, Forschungsbaum, Kamerarotation und Zoom, Animationen, Speichersystem.

Saubere Trennung von Spielmechanik, Darstellung, UI und Daten. Wiederverwendbare Komponenten und datenbasierte Definitionen für Einheiten, Gebäude, Ressourcen und Technologien. Die Performance hält auch bei vielen arbeitenden Figuren, ohne unnötig teure Berechnungen pro Animation oder Warentransport.

## 12. Entwicklungsprozess

Kein oberflächlicher Prototyp mit Platzhaltergrafiken, wo es schon besser geht. Modular und schrittweise:

1. **Grundlegende Spielwelt:** isometrische Karte, Kamera, Rotation, Zoom, Pixelart-Darstellung, Raster, Gebäudeplatzierung
2. **Wirtschaft:** Ressourcen, Produktionsgebäude, Arbeiter, physischer Transport, Lagerhäuser, Kornkammern
3. **Basisbau:** Wohngebäude, Straßen, Produktion, Mauern, Türme, Tore, Stationierung auf Mauern
4. **Militär:** Einheiten, Rekrutierung, Kampf, Formationen, Verteidigung
5. **Forschung:** Forschungsbaum, Voraussetzungen, neue Einheiten, neue Gebäude, Verbesserungen
6. **Polishing:** Animationen, Sound, UI, Performance, Atmosphäre, Details

## 13. Verbindliche Qualitätsanforderungen

- Echte isometrische 2D-Perspektive
- Detaillierte, lebendige, stilistisch einheitliche Pixelart
- Kamera in festen Stufen drehbar, mehrere Zoomstufen
- Wirtschaft beruht auf sichtbarer, physischer Produktion
- Arbeiter transportieren Waren tatsächlich
- Waren sind in Lagerhäusern und Kornkammern sichtbar, Lagerkapazität ist erweiterbar
- Mauern und Türme sind taktisch nutzbar, Einheiten können darauf stationiert werden
- Keine klassischen Zeitalter, Freischaltung einzeln über Forschung
- UI mit mittelalterlichem Charakter
- Einheitenmenü unterstützt zahlreiche Einheiten

**Keine Kernmechanik darf durch rein kosmetische Darstellung ersetzt werden.** Ein Steinbruch, der nur einen Wert erhöht, reicht nicht: Ein Arbeiter muss tatsächlich Stein abbauen und transportieren. Ein Lagerhaus, das nur eine Zahl zeigt, reicht nicht: Die Waren müssen sichtbar sein. Eine Mauer, die nur Dekoration ist, reicht nicht: Sie muss begehbar und militärisch nutzbar sein.

## 14. Auftrag

Zuerst eine durchdachte technische und spielerische Konzeption. Festzulegen ist:
- Engine bzw. Framework
- Funktionsweise des isometrischen Koordinatensystems
- Umsetzung von Kamerarotation und Zoom
- Technische Umsetzung der sichtbaren Produktion
- Funktionsweise von Arbeitern und Transportwegen
- Modularer Aufbau von Gebäuden und Einheiten
- Funktionsweise des Forschungs- und Freischaltsystems

Danach ein erster spielbarer Prototyp mit:
- Detailreicher isometrischer Landschaft
- Kamera mit Rotation und Zoom
- Auswahl- und Platzierungssystem für Gebäude
- Holzfäller, der Bäume fällt
- Steinbruch mit sichtbarer Steingewinnung
- Arbeitern, die Ressourcen physisch transportieren
- Lagerhaus mit sichtbar wachsendem Bestand
- Einfacher Kaserne
- Mindestens drei unterschiedlichen Militäreinheiten
- Erster begehbarer Mauer mit stationierbaren Einheiten
- Mittelalterlichem UI

Entscheidend ist nicht die Menge an Features, sondern dass die Kernmechaniken wirklich funktionieren und visuell überzeugen.
