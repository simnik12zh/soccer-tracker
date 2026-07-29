# Claude Code Prompt — Session-Typ "Mediale Kette rechts"

> Alles ab hier in Claude Code einfügen.

---

Ich erweitere meine Soccer-Training-Tracker-PWA um einen zweiten geführten Session-Typ. Es gibt bereits den Kombi-Block als geführte Session — bau den neuen Typ nach demselben Muster.

## Vorgehen

Arbeite in zwei Schritten und **stoppe nach Schritt 1** für Review.

**Schritt 1:** Datenmodell + Player-Komponente + Einstieg über die Today-View. Voll funktionsfähig, aber ohne Verknüpfung mit Readiness-Check-in und Journey.

**Schritt 2:** Integration (Readiness, Next-up-Zeile, Journey-Auswertung).

## Erst lesen, dann bauen

Bevor du Code schreibst: schau dir in `App.jsx` an, wie der bestehende Kombi-Block aufgebaut ist — Naming, State-Handling, wie Sessions geloggt werden, wie das Bottom-Sheet aufgerufen wird, welche Style-Konventionen gelten. Der neue Session-Typ soll sich nahtlos einfügen und **keine neuen Dependencies** einführen. Fasse mir kurz zusammen, welchen Konventionen du folgst, bevor du loslegst.

## Fachlicher Hintergrund

Rehab-Programm für eine insertionsnahe Tendinopathie des Semimembranosus (rechtes Knie innen, proximaler Ansatz am Sitzbein). Kern ist Isometrie täglich, exzentrische Belastung kommt phasenweise dazu. Steuergrösse ist nicht der Kalender, sondern Schmerz ≤3/10 während der Übung und der Zustand am Folgemorgen.

## Datenmodell

```js
const MK_EXERCISES = {
  bridge:     { name: "Long-Lever Bridge", side: "einbeinig rechts", type: "hold",
                cue: "Rückenlage, rechte Ferse am Boden, Knie nur ~20–30° gebeugt. Linkes Bein anheben, Oberschenkel parallel. Becken hoch bis Schulter–Hüfte–Knie eine Linie bilden.",
                watch: "Becken kippt nicht zur linken Seite. Kein Hohlkreuz." },
  knieflex:   { name: "Knieflexion isometrisch", side: "Bauchlage, rechts", type: "hold",
                cue: "Becken bleibt unten. Rechtes Knie ~30–45° beugen, Fuss leicht nach innen drehen. Linkes Bein über den rechten Knöchel kreuzen und dagegenhalten.",
                watch: "~70 % Kraft, gleichmässig aufbauen. Hüfte hebt nicht ab." },
  balance:    { name: "Balance mit Rotation", side: "Stand rechts", type: "reps", reps: "6 pro Richtung",
                cue: "Einbeinig rechts, Knie minimal gebeugt. Oberkörper langsam nach innen und aussen drehen, bis kurz vor die Schmerzgrenze.",
                watch: "Knie bleibt über dem zweiten Zeh. Kein Schwung." },
  stepdown:   { name: "Step-Downs", side: "rechts", type: "reps", reps: "8 Wdh.",
                cue: "Auf einer Stufe (20–30 cm) rechts stehen. Linke Ferse langsam Richtung Boden senken, antippen, kontrolliert hoch.",
                watch: "Rechtes Knie bleibt über der Fussmitte, kippt nicht nach innen." },
  glutemed:   { name: "Glute Med", side: "Seitlage rechts", type: "reps", reps: "12 Wdh.",
                cue: "Beine gestreckt, rechtes Bein oben. Bein leicht nach hinten und nach oben führen.",
                watch: "Becken bleibt senkrecht, rollt nicht nach hinten weg." },
  copenhagen: { name: "Copenhagen Plank", side: "rechts", type: "hold",
                cue: "Seitstütz auf dem rechten Unterarm, linkes Knie auf einer Bank. Becken anheben, Körper gerade.",
                watch: "Nur wenn schmerzfrei. Kurzversion: unteres Knie am Boden." },
  sldl:       { name: "Single-Leg RDL", side: "rechts", type: "reps", reps: "8 Wdh. · 3–4 s runter",
                cue: "Auf rechts stehen, Kurzhantel in der linken Hand. Hüfte nach hinten schieben, linkes Bein streckt sich nach hinten.",
                watch: "Rücken gerade. Bewegung kommt aus der Hüfte, nicht aus dem Knie." },
  slider:     { name: "Slider-Curls", side: "beidbeinig", type: "reps", reps: "6 Wdh. · langsam",
                cue: "Rückenlage, Fersen auf Slidern oder Handtuch, Becken hoch. Fersen langsam wegschieben, dann zurückziehen.",
                watch: "Becken bleibt oben über die ganze Bewegung." },
  nordic:     { name: "Nordics", side: "beidbeinig", type: "reps", reps: "5 Wdh. · nur exzentrisch",
                cue: "Kniend, Fersen fixiert. Oberkörper gestreckt langsam nach vorne fallen lassen, so lange wie möglich bremsen.",
                watch: "Nur die Absenkbewegung zählt. Mit den Händen abfangen." },
};

// hold = Haltezeit in s, rest = Pause in s
const MK_BLOCKS = {
  A:     { label: "Block A", title: "Isometrie", freq: "täglich",
           items: [ { ex: "bridge", sets: 5, hold: 45, rest: 60 },
                    { ex: "knieflex", sets: 4, hold: 40, rest: 45 } ] },
  Akurz: { label: "Block A kurz", title: "Isometrie · Erhaltung", freq: "abends",
           items: [ { ex: "bridge", sets: 3, hold: 30, rest: 45 },
                    { ex: "knieflex", sets: 3, hold: 30, rest: 45 } ] },
  B:     { label: "Block B", title: "Kontrolle", freq: "3× pro Woche",
           items: [ { ex: "balance", sets: 3, rest: 45 },
                    { ex: "stepdown", sets: 3, rest: 60 },
                    { ex: "glutemed", sets: 3, rest: 45 },
                    { ex: "copenhagen", sets: 3, hold: 20, rest: 45 } ] },
};

// Block C ist phasenabhängig
const MK_STRENGTH = {
  1: [],
  2: [ { ex: "sldl", sets: 3, rest: 90 } ],
  3: [ { ex: "sldl", sets: 3, rest: 90 }, { ex: "slider", sets: 3, rest: 90 } ],
  4: [ { ex: "sldl", sets: 3, rest: 90 }, { ex: "slider", sets: 3, rest: 90 }, { ex: "nordic", sets: 3, rest: 120 } ],
};
```

## Phasenlogik

Vier Phasen: 1 = Woche 1–2, 2 = Woche 3–4, 3 = Woche 5–6, 4 = ab Woche 7.

Die Phase wird aus einem `mkStartDate` abgeleitet (wird beim allerersten Start der Session gesetzt), aber **nicht automatisch hochgeschaltet**. Regel:

- Berechne die kalendarisch fällige Phase aus dem Startdatum.
- Ist sie höher als die aktuell aktive, zeig auf der Startseite des Session-Typs einen Hinweis: *"Woche X erreicht — Phase Y freischalten?"* mit Bestätigungs-Button.
- Freischalten nur, wenn die letzten 5 geloggten Sessions alle Schmerz ≤3 hatten. Sonst zeig stattdessen: *"Noch nicht — Schmerzwerte über 3 in den letzten Einheiten."*
- Manuelles Zurückstufen muss jederzeit möglich sein (bei Verschlechterung).

Das ist bewusst so: die Progression ist zustandsgesteuert, der Kalender ist nur der Vorschlag.

## Player-Verhalten

State-Machine pro Übung: `ready → (hold | work) → rest → (hold | work) → …`

- `ready`: 6 s vor der ersten Übung, 15 s beim Übungswechsel ("Position einnehmen" / "Wechsel").
- `hold`: Countdown über `hold`-Sekunden. Läuft automatisch ab.
- `work`: kein Countdown, Button "Satz erledigt" beendet den Satz.
- `rest`: Countdown über `rest`-Sekunden, zeigt an, was als Nächstes kommt. "Pause überspringen" möglich.
- Nach dem letzten Satz der letzten Übung → Abschlussbildschirm.

Weitere Anforderungen:

- Timer **timestamp-basiert** (Ziel-Endzeit in einer ref, Intervall vergleicht gegen `Date.now()`), nicht per Dekrement — sonst driftet er, wenn der Screen schlafen geht.
- Signalton bei 3/2/1 und beim Phasenwechsel über die Web Audio API (Oszillator, keine Audiodatei). In try/catch, stumm ist akzeptabel.
- `navigator.wakeLock` anfordern solange die Session läuft, beim Verlassen freigeben. In try/catch.
- Steuerung: Pause/Weiter, +10 s, Satz-/Pause-Skip, Session abbrechen.
- Grosse Zahlen, tabular-nums, hoher Kontrast — die Session wird auf dem Boden liegend bedient, oft aus schrägem Winkel.
- Cue und "Achte auf"-Zeile der aktuellen Übung sind während der Ausführung sichtbar, nicht hinter einem Tap versteckt.
- Satzfortschritt als Balkenreihe (ein Segment pro Satz).

## Abschluss und Logging

Nach der letzten Übung: Schmerzabfrage 0–10 als Button-Reihe. Rückmeldung im UI:
- ≤3 → "Im grünen Bereich. Entscheidend bleibt der Zustand morgen früh."
- \>3 → "Über 3 — nächstes Mal Haltezeit oder Intensität runter. Übung nicht streichen."

Log-Eintrag:

```js
{ type: "mk", date: "YYYY-MM-DD", block: "A", phase: 2, pain: 2,
  completedSets: 9, totalSets: 9, durationSec: 612 }
```

Abgebrochene Sessions werden ebenfalls geloggt (mit `completedSets < totalSets`), ohne Schmerzabfrage.

## Storage

Neue Felder im State-Objekt → **Storage-Key bumpen**, sonst kollidiert es mit bestehendem localStorage. Migration: alte Daten übernehmen, neue Felder mit Defaults auffüllen, nichts wegwerfen.

Neu: `mkStartDate`, `mkPhase`, `mkLog[]`.

## Schritt 2 — Integration

Erst nach meinem Go:

1. **Readiness-Check-in:** dritte Ampel "Knie innen rechts" neben Hüfte und Beinen. Der Wert fliesst in den Coach-Kontext ein. Steht die Ampel auf rot, zeigt die Today-View bei Block A den Hinweis, heute nur eine Einheit mit kürzeren Haltezeiten zu machen.
2. **Next up:** Block A erscheint in der Next-up-Zeile, solange er heute nicht geloggt ist. An Trainingstagen mit dem Zusatz "20–30 Min vor dem Training".
3. **Journey:** kleine Verlaufsgrafik Schmerzwert über Zeit, mit Referenzlinie bei 3. Darunter die Morgen-Ampel als farbige Punktreihe — der Zusammenhang zwischen Dosis und Folgetag ist die eigentliche Information.

## Nicht machen

- Keine statischen Dehnübungen und kein Foam Rolling in dieses Programm aufnehmen, auch nicht als optionale Ergänzung. Bei einer gereizten Sehne ist das kontraproduktiv.
- Keine automatische Phasenprogression ohne Bestätigung.
- Keine neuen Dependencies.

## Abnahme Schritt 1

- [ ] Session ist über die Today-View startbar, alle vier Blöcke
- [ ] Halte- und Pausen-Timer laufen korrekt durch, inklusive Übungswechsel
- [ ] Timer driftet nicht, wenn der Screen zwischendurch aus war
- [ ] Reps-Übungen warten auf den Tap statt automatisch weiterzulaufen
- [ ] Block C ist in Phase 1 gesperrt und sichtbar als "ab Woche 3"
- [ ] Phasenvorschlag erscheint, schaltet aber nicht selbstständig
- [ ] Log wird persistiert, Storage-Key ist gebumpt, alte Daten überleben
- [ ] Läuft sauber auf Mobile, Buttons gross genug für nasse/verschwitzte Finger
