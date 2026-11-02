# BWW – Bundeswehr Waldstädt Discord-Bot

Der BWW-Bot ist der Discord-Bot für **Bundeswehr Waldstädt**. Er bündelt Nachrichten, Moderation, Verifizierung, Tickets, Giveaways, Umfragen, benutzerdefinierte Panels und Serverstatus in einem Bot.

> **Wichtig:** Nachrichten, Panels, Tickets, Statusmeldungen und weitere gestaltete Bot-Ausgaben verwenden Discord **Components V2**. Der Bot setzt dafür keine klassischen Discord-Embeds ein.

## Inhaltsverzeichnis

- [Voraussetzungen](#voraussetzungen)
- [Installation und Start](#installation-und-start)
- [Umgebungsvariablen](#umgebungsvariablen)
- [Supabase einrichten](#supabase-einrichten)
- [Ersteinrichtung auf Discord](#ersteinrichtung-auf-discord)
- [Slash-Commands](#slash-commands)
- [Berechtigungen](#berechtigungen)
- [Funktionen im Detail](#funktionen-im-detail)
- [Lokale Bot-Daten](#lokale-bot-daten)
- [Fehlerbehebung](#fehlerbehebung)

## Voraussetzungen

- Node.js **24.17.0 oder neuer**
- Ein Discord-Bot mit aktiviertem **Server Members Intent**
- Bot-Einladung mit den benötigten Server- und Kanalberechtigungen
- Supabase-Projekt für die serverbezogenen Einstellungen
- Zugriff auf das Repository und die BWW-Quelldateien

Die Abhängigkeiten werden im Hauptverzeichnis des Multi-Bot-Repositories verwaltet. Das Verzeichnis `bww/` besitzt deshalb keine eigene vollständige Dependency-Liste.

## Installation und Start

### Betrieb über den Multi-Bot-Loader (empfohlen)

Der BWW-Bot ist in das gemeinsame Repository integriert. Der Start erfolgt im Repository-Hauptverzeichnis:

```bash
npm install
npm start
```

Der zentrale Loader synchronisiert die vorgesehenen Bot-Dateien und startet die konfigurierten Prozesse. Für den normalen KataBump-Betrieb sollte der im Repository eingerichtete Startprozess verwendet werden.

### BWW direkt starten

Wenn die Abhängigkeiten bereits im Repository-Hauptverzeichnis installiert sind, kann der BWW-Einstiegspunkt direkt gestartet werden:

```bash
node bww/src/index.js
```

Der Bot lädt seine eigene Konfigurationsdatei aus `bww/.env`.

## Umgebungsvariablen

Lege die benötigten Variablen in der für BWW vorgesehenen Datei `bww/.env` beziehungsweise in der Prozessumgebung des Hosters an:

| Variable | Erforderlich | Beschreibung |
|---|---:|---|
| `DISCORD_TOKEN` | Ja | Bot-Token des BWW-Discord-Bots |
| `SUPABASE_URL` | Für Speicherung | URL des Supabase-Projekts |
| `SUPABASE_SECRET_KEY` | Für Speicherung | Serverseitiger Supabase-Schlüssel mit Zugriff auf die benötigte Tabelle |

**Sicherheit:**
- Tokens und Schlüssel niemals committen oder in Discord veröffentlichen.
- Keine Supabase-Schlüssel mit privilegierten Rechten an Clients oder öffentliche Webseiten ausliefern.
- Bei Verdacht auf Offenlegung betroffene Zugangsdaten im jeweiligen Anbieter erneuern.
- Die Datei `.env` gehört nicht in Git.

Ohne vollständige Supabase-Konfiguration kann der Bot zwar Standardwerte laden, Einstellungen, die gespeichert werden müssen, können dann aber nicht dauerhaft eingerichtet werden.

## Supabase einrichten

Der Bot speichert die serverbezogenen Einstellungen in der Tabelle:

```text
bww_guild_settings
```

Der Code erwartet folgende Spalten:

| Spalte | Verwendung |
|---|---|
| `guild_id` | Discord-Server-ID; eindeutiger Schlüssel |
| `settings` | JSONB mit den Einstellungen des Servers |
| `updated_by` | Discord-ID des auslösenden Benutzers beziehungsweise des Systems |
| `updated_at` | Zeitpunkt der letzten Änderung |

Die Tabelle muss für den vom Bot verwendeten serverseitigen Supabase-Schlüssel les- und beschreibbar sein. Der Bot greift über die Supabase-REST-Schnittstelle darauf zu.

In `settings` werden unter anderem Welcome-, Verify-, Ticket- und Status-Einstellungen, Command-Berechtigungen sowie wiederkehrende Nachrichten gespeichert.

## Ersteinrichtung auf Discord

1. Lade den Bot auf deinen Discord-Server ein.
2. Stelle sicher, dass seine Rolle oberhalb der Rollen liegt, die er verwalten soll.
3. Gib ihm mindestens die für die aktivierten Funktionen benötigten Berechtigungen, beispielsweise Nachrichten senden, Nachrichtenverlauf lesen, Kanäle verwalten und Rollen verwalten.
4. Trage die Umgebungsvariablen ein und starte den Bot.
5. Beim Start registriert der Bot seine Slash-Commands global bei Discord.
6. Führe die Setup-Commands als Serveradministrator aus.

Die wichtigsten Setup-Schritte:

- `/setup-welcome` – Begrüßungskanal und Begrüßungstext konfigurieren.
- `/setup-verify` – Verifizierungskanal und Verifizierungsrolle konfigurieren.
- `/setup-ticket` – Ticket-Kategorie und Support-Rolle konfigurieren.
- `/setup-status` – Statusnachricht in einem Textkanal erstellen.
- `/setup-permission` – Rollen für unterstützte Commands freischalten.

## Slash-Commands

Die folgende Übersicht beschreibt die im aktuellen Command-Register definierten Befehle.

### Nachrichten und Gestaltung

| Command | Beschreibung |
|---|---|
| `/nachricht` | Sendet eine Components-V2-Nachricht mit Text sowie optionalem Titel und Bild-URL. |
| `/embed` | Erstellt eine gestaltete Components-V2-Nachricht mit Titel, Text, Bild, Thumbnail, Farbe und Footer. Ein Bild kann als URL oder Upload angegeben werden. |
| `/nachricht-wiederholen` | Richtet eine wiederkehrende Nachricht mit Intervall, Einheit und optionalem Kanal, Farbe und Bild ein. |
| `/wiederholung-stoppen` | Stoppt eine gespeicherte wiederkehrende Nachricht anhand ihrer ID. |
| `/wiederholung-liste` | Zeigt die gespeicherten wiederkehrenden Nachrichten. |

**Beispiele:**

```text
/nachricht text: Willkommen bei Bundeswehr Waldstädt titel: BWW | Bundeswehr Waldstädt
/embed text: Wichtige Ankündigung titel: Information farbe: #5865F2
/nachricht-wiederholen text: Bitte lest die Regeln intervall: 2 einheit: stunden
```

Bei `/nachricht-wiederholen` sind als Einheiten Minuten, Stunden und Tage verfügbar. Das Intervall muss mindestens 1 betragen. Die wiederkehrenden Nachrichten werden serverbezogen in Supabase gespeichert und vom Scheduler regelmäßig geprüft.

### Panels

| Command | Beschreibung |
|---|---|
| `/panel-create` | Erstellt und sendet ein benutzerdefiniertes Panel mit Intro und bis zu 10 direkt konfigurierbaren Buttons. |
| `/panel-send` | Sendet ein bereits gespeichertes Panel erneut. |
| `/panel-add-button` | Fügt einem gespeicherten Panel einen weiteren Button hinzu. |
| `/panel-list` | Zeigt alle gespeicherten Panels. |
| `/panel-delete` | Löscht ein Panel und entfernt die vom Bot gespeicherten Panel-Nachrichten, soweit sie erreichbar sind. |

Bei `/panel-create` müssen für jeden Button sowohl ein Label als auch ein Antworttext angegeben werden. Weitere Buttons können mit `/panel-add-button` hinzugefügt werden. Die gespeicherten Panels liegen lokal in `bww/config/panels.json`.

### Verifizierung, Tickets und Community

| Command | Beschreibung |
|---|---|
| `/setup-welcome` | Konfiguriert den Begrüßungskanal, den Text und optional einen Titel. |
| `/setup-verify` | Konfiguriert den Verifizierungskanal, die Rolle und den Nachrichtentext. |
| `/verify` | Sendet das konfigurierte Verifizierungs-Panel. |
| `/setup-ticket` | Konfiguriert die Ticket-Kategorie und die Support-Rolle. |
| `/ticket` | Sendet das Ticket-Panel. |
| `/umfrage` | Erstellt eine Umfrage mit zwei bis fünf Antwortoptionen und Live-Zähler. |

Ticket-Gründe im aktuellen System:
- Allgemeine Frage
- Problem / Bug
- Bewerbung
- Spieler melden
- Sonstiges

Ein Ticket wird als eigener, zugriffsbeschränkter Textkanal erstellt. Der Ersteller und die konfigurierte Support-Rolle erhalten Zugriff. Der Ticket-Schließen-Button löscht den Ticket-Kanal nach Bestätigung.

### Giveaways

| Command | Beschreibung |
|---|---|
| `/giveaway` | Startet ein Giveaway mit Preis, Laufzeit in Sekunden und optionaler Gewinneranzahl. |

Teilnehmer können über die Giveaway-Schaltflächen teilnehmen oder ihre Teilnahme zurückziehen. Das Giveaway kann automatisch nach Ablauf enden. Berechtigte Mitarbeiter können es vorzeitig beenden oder nach Ende eine neue Ziehung durchführen.

Giveaway-Daten werden lokal in `bww/config/giveaways.json` gespeichert. Bei einem Neustart prüft der Scheduler aktive Giveaways und beendet abgelaufene Verlosungen.

### Status und Wartung

| Command | Beschreibung |
|---|---|
| `/setup-status` | Erstellt die Statusnachricht in einem ausgewählten Textkanal. |
| `/wartung` | Aktiviert oder deaktiviert den Wartungsmodus und aktualisiert die Statusnachricht. |

Unterstützte Status:
- 🟢 Online
- 🟡 Wartungsarbeiten
- 🔴 Offline

Die Statusnachricht wird regelmäßig aktualisiert. Beim regulären Herunterfahren versucht der Bot, den Status auf Offline zu setzen.

### Moderation und Rollenverwaltung

| Command | Beschreibung |
|---|---|
| `/kick` | Entfernt ein Mitglied vom Server. |
| `/ban` | Bannt einen Benutzer. |
| `/unban` | Hebt einen Ban anhand des Benutzers auf. |
| `/timeout` | Versetzt ein Mitglied für eine angegebene Anzahl Minuten in den Timeout. |
| `/giverole` | Gibt einem Mitglied eine Rolle. |
| `/removerole` | Entfernt eine Rolle von einem Mitglied. |

### Verwaltung und Hilfe

| Command | Beschreibung |
|---|---|
| `/setup` | Zeigt die Setup-Hilfe. |
| `/setup-permission` | Erlaubt oder entfernt eine Rolle für einen unterstützten Command. |
| `/restart` | Beendet den Bot-Prozess kontrolliert über den Host-Prozessmanager, damit dieser ihn neu starten kann. |

## Berechtigungen

Es gibt zwei Ebenen:

1. **Discord-Administrator:** Administratoren dürfen die Setup-Commands ausführen. Auch `/restart` ist Administratoren vorbehalten.
2. **Command-Rollen:** Für Commands, die die zentrale Berechtigungsprüfung verwenden, können zusätzliche Rollen mit `/setup-permission` freigeschaltet werden. Administratoren sind davon ausgenommen.

Wichtige Sonderfälle:
- `/nachricht-wiederholen` ist zusätzlich ausdrücklich auf Administratoren beschränkt.
- Giveaway-Verwaltungsaktionen (vorzeitiges Beenden und erneute Ziehung) benötigen Administratorrechte oder eine für `giveaway` freigeschaltete Rolle.
- Das Schließen eines Tickets ist für Administratoren, die konfigurierte Support-Rolle und den Ticket-Ersteller möglich.
- Setup-Commands können nur Administratoren verwenden.

Die Bot-Rolle muss in der Discord-Rollenhierarchie oberhalb der Rollen liegen, die der Bot vergeben oder entfernen soll.

## Funktionen im Detail

### Components V2

Die zentrale Implementierung befindet sich in `bww/src/utils/embeds.js`. Unterstützte Bausteine sind unter anderem:
- Textbereiche und Titel
- Trenner
- Mediengalerien
- Bereiche mit Thumbnail oder Button
- Button-Reihen
- Auswahlmenüs
- Akzentfarben

Die Commands `/nachricht` und `/embed` verwenden denselben Components-V2-Builder.

### Platzhalter im Welcome-Text

Für `/setup-welcome` sind diese Platzhalter verfügbar:

| Platzhalter | Bedeutung |
|---|---|
| `{user}` | Erwähnung des neuen Mitglieds |
| `{username}` | Discord-Benutzername |
| `{displayname}` | Anzeigename |
| `{server}` | Servername |
| `{id}` | Discord-Benutzer-ID |
| `{count}` | Aktuelle Mitgliederanzahl |

Beispiel:

```text
Willkommen {user} auf {server}! Du bist Mitglied Nummer {count}.
```

### Status-Aktualisierung

Der Bot synchronisiert den konfigurierten Statuskanal beim Start und danach regelmäßig. Falls die Statusnachricht gelöscht wurde, versucht der Bot, sie neu zu erstellen.

## Lokale Bot-Daten

Folgende Dateien werden vom Bot zur Laufzeit verwendet beziehungsweise angelegt:

| Datei | Inhalt |
|---|---|
| `bww/config/panels.json` | Gespeicherte Custom-Panels und zugehörige Nachrichten-IDs |
| `bww/config/giveaways.json` | Giveaways, Teilnahmen und Gewinnerhistorie |

Diese Dateien enthalten Laufzeitdaten. Bei Backups müssen sie zusammen mit der Supabase-Konfiguration berücksichtigt werden. Sie sollten nicht versehentlich durch Deployments oder Synchronisationen überschrieben werden.

## Fehlerbehebung

### Bot startet nicht

- Prüfe, ob `DISCORD_TOKEN` gesetzt ist.
- Prüfe die Node.js-Version (mindestens 24.17.0).
- Prüfe die Start- und Prozesslogs des Hosters.

### Slash-Commands fehlen oder sind veraltet

- Prüfe die Logs auf Fehler bei der Slash-Command-Registrierung.
- Der Bot registriert Commands beim Start global bei Discord.
- Nach Änderungen an `bww/src/commands/index.js` den BWW-Prozess neu starten und die Aktualisierung der globalen Commands abwarten.

### Einstellungen werden nicht gespeichert

- Prüfe `SUPABASE_URL` und `SUPABASE_SECRET_KEY`.
- Prüfe, ob die Tabelle `bww_guild_settings` mit den erwarteten Spalten existiert.
- Prüfe die Berechtigungen des serverseitigen Supabase-Schlüssels und die Supabase-Logs.

### Rollen können nicht vergeben werden

- Prüfe, ob der Bot die Berechtigung **Rollen verwalten** besitzt.
- Verschiebe die Bot-Rolle in der Rollenliste über die Zielrolle.

### Tickets können nicht erstellt werden

- Prüfe die Konfiguration mit `/setup-ticket`.
- Prüfe, ob die ausgewählte Kategorie noch existiert.
- Prüfe, ob der Bot Kanäle verwalten darf.

### Components V2-Nachrichten schlagen fehl

- Prüfe, ob der Bot aktuelle Discord.js-Abhängigkeiten aus dem Repository verwendet.
- Prüfe Bild-URLs und die Inhalte der Nachricht.
- Prüfe die Fehlermeldung in den Bot-Logs.

---

**Projekt:** Bundeswehr Waldstädt (BWW)  
**Repository:** [Teufel2211/Discord-Bots](https://github.com/Teufel2211/Discord-Bots)  
**Bot-Verzeichnis:** `bww/`
