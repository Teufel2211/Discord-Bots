# Design: Dauer-Giveaway als Serien-Dashboard

## Ziel

Der dauerhafte Giveaway-Modus soll sich im Admin-Bereich deutlich vom normalen Giveaway mit Countdown unterscheiden. Er wird als fortlaufende Giveaway-Serie dargestellt.

## Bestätigte Ansicht

Variante B („Serien-Dashboard“):

- deutlicher Status „Dauerhafte Giveaway-Serie“
- Statusanzeige „Serie aktiv“
- Rundennummer, zum Beispiel „Runde 3 · manuelles Ende“
- sichtbarer Teilnehmer-Pool mit Teilnehmeranzahl
- primärer Button „Runde beenden“
- sekundärer Hinweis beziehungsweise Button für „Nächste Runde“ nach dem Ende
- kein Countdown und keine automatische Endzeit im Dauer-Modus

## Verhalten

- Der Admin startet die erste Runde manuell.
- Der Admin beendet die Runde manuell und zieht dadurch den Gewinner.
- Beim Start der nächsten Runde werden alle bisherigen Teilnehmer übernommen.
- Der Gewinner der letzten Runde wird automatisch aus dem übernommenen Pool entfernt.
- Die nächste Runde startet ausschließlich durch eine erneute Admin-Aktion.
- Die bestehenden Rollen- und Gewinnchance-Einstellungen bleiben erhalten und werden auf den übernommenen Pool neu angewendet.
- Normale zeitgesteuerte Giveaways behalten ihre bisherige Countdown-Ansicht.

## Technische Umsetzung

- Die Admin-Seite erhält eine eigene Darstellung abhängig von `state.persistentMode`.
- Im aktiven Dauer-Modus wird der Countdown-Bereich durch Serienstatus, Runde und Teilnehmer-Pool ersetzt.
- Nach dem Ende wird eine Aktion zum manuellen Start der nächsten Runde angezeigt.
- Die bestehende API- und Supabase-Logik für Teilnehmerübernahme und Gewinner-Ausschluss wird weiterverwendet.
- Die öffentliche Giveaway-Seite zeigt weiterhin nur den öffentlichen Status und die Teilnehmerzahl.

## Prüfung

- Dauer-Modus ohne `endsAt` zeigt keinen Countdown.
- Manuelles Beenden erzeugt einen Gewinner und beendet die aktuelle Runde.
- Die nächste manuell gestartete Runde übernimmt Teilnehmer ohne den letzten Gewinner.
- Zeitgesteuerte Giveaways bleiben unverändert.
