# Twitch-Chat-Overlay – Design-Spezifikation

## Ziel

Der bestehende Node.js-Twitch-Bot erhält ein lokales, transparentes Chat-Overlay für OBS oder Streamlabs. Das Overlay zeigt Twitch-Chat und relevante Chat-Ereignisse live im Stream an.

## Bestätigte Anforderungen

- Kompaktes Layout mit niedriger visueller Belastung.
- Einbindung als transparente Browser-Quelle in OBS/Streamlabs.
- Live-Verteilung ohne Polling.
- Anzeige neuer Chatnachrichten sowie relevanter Twitch-Ereignisse: Subs/Resubs, Cheers, Raids, Bans/Timeouts und gelöschte Nachrichten.
- Twitch-Nutzerfarben und verfügbare Badges sollen übernommen werden.
- Die letzten 8–12 Einträge bleiben sichtbar; neue Nachrichten erscheinen unten, alte werden automatisch entfernt.
- Gelöschte Nachrichten werden aus dem Overlay entfernt.
- Die Seite bleibt bei Verbindungsproblemen geöffnet und zeigt einen dezenten Status an.
- Overlay-URL, Startanleitung und OBS-Einstellungen werden in der README dokumentiert.

## Architektur

Der Bot bleibt die einzige Verbindung zu Twitch. `tmi.js` empfängt Twitch-Ereignisse. Ein lokaler HTTP-Server liefert die Overlay-Seite aus und ein WebSocket-Kanal verteilt normalisierte Ereignisse an verbundene Browser-Quellen.

### Komponenten

1. **Twitch-Client** – bestehende `tmi.js`-Verbindung und Listener für Chat- und Systemereignisse.
2. **Event-Normalisierung** – wandelt unterschiedliche Twitch-Payloads in ein gemeinsames Format um:
   `type`, `username`, `message`, `color`, `badges`, `timestamp`, `id` und optionale Eventdaten.
3. **Overlay-Server** – lokaler HTTP-Server für statische Dateien sowie WebSocket-Server für Live-Ereignisse.
4. **Overlay-UI** – transparente, kompakte HTML/CSS/JavaScript-Seite mit Statusanzeige, Nachrichtenliste und automatischer Bereinigung.

## Datenfluss

1. Twitch sendet ein Ereignis an `tmi.js`.
2. Der Bot prüft und normalisiert das Ereignis.
3. Der Server sendet das normalisierte Ereignis an alle verbundenen Overlay-Clients.
4. Das Overlay rendert den Eintrag und begrenzt die sichtbare Liste.
5. Bei Löschereignissen entfernt das Overlay den betroffenen Eintrag anhand seiner Nachrichten-ID.

## Verhalten und Fehlerfälle

- WebSocket-Verbindung wird automatisch wiederhergestellt.
- Bei nicht erreichbarem Bot bleibt der transparente Hintergrund erhalten; der Status wird sichtbar, aber streamtauglich dezent angezeigt.
- Nachrichten werden auf eine sichere Maximalgröße begrenzt und als Text bzw. kontrollierte DOM-Knoten gerendert, damit Chat-Inhalte kein HTML ausführen können.
- Der HTTP-/WebSocket-Server bindet standardmäßig nur an `localhost`.
- Die bestehende Bot-Authentifizierung und `.env`-Konfiguration bleiben unverändert.

## Test- und Abnahmekriterien

- `npm start` startet Bot und Overlay-Server mit gültiger `.env`.
- Die Overlay-Seite ist lokal erreichbar und hat einen transparenten Hintergrund.
- Eine normale Chatnachricht erscheint innerhalb kurzer Zeit im Overlay.
- Nutzername und Twitch-Farbe werden korrekt angezeigt.
- Mehr als 12 Einträge führen nicht zu unbegrenztem Wachstum.
- Ein Löschereignis entfernt die zugehörige Nachricht.
- WebSocket-Trennung wird angezeigt und nach Wiederverbindung automatisch behoben.
- Die README erklärt URL, OBS-Browser-Quelle, Breite/Höhe und Startablauf.

## Ausdrücklich nicht im Umfang

- Öffentliche Bereitstellung über das Internet.
- Ein zweiter Twitch-Login ausschließlich für das Overlay.
- Persistente Chat-Historie oder Datenbank.
- Moderationsaktionen aus der Overlay-Oberfläche.
