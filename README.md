# Discord Bots

Sammlung der Discord- und Twitch-Bots.

## KataBump-Betrieb

Es gibt zwei unterstützte Betriebsarten:

### Eine KataBump-Instanz für alle drei Bots

- **Startbefehl:** \`node start-all.js\`
- **GitHub-Branch:** optional \`GITHUB_BRANCH=master\` (Standard: \`master\`)
- VC, BWW und TTV werden gestartet und alle 60 Sekunden wird GitHub geprüft.
- Nur geänderte Dateien werden aktualisiert; neue Dateien werden hinzugefügt und entfernte Dateien lokal gelöscht.
- Nur der Bot, dessen Verzeichnis betroffen ist, wird neu gestartet. Bei Änderungen an Root-Abhängigkeiten werden Abhängigkeiten installiert und alle drei Bots neu gestartet.

### Drei getrennte KataBump-Instanzen

| KataBump-Variable | Bot | Startdatei |
|---|---|---|
| \`BOT_ABBR=BWW\` | Bundeswehr Waldstädt | \`bww/src/index.js\` |
| \`BOT_ABBR=VC\` | Voice-Chat-Holder | \`current/index.js\` |
| \`BOT_ABBR=TTV\` | Twitch-Chatbot | \`twitch-chatbot/src/index.js\` |

Auf jeder Instanz lautet der Startbefehl \`npm start\`. Setze zusätzlich \`GITHUB_BRANCH=master\` und bei Bedarf \`SYNC_REQUIRED=true\`. Auch der Einzelbot-Sync prüft alle 60 Sekunden und startet nur den ausgewählten Bot neu, wenn dessen Dateien geändert wurden.

## Sync-Sicherheit und Verhalten

- Der Sync vergleicht den lokalen Git-Commit mit \`origin/<Branch>\` und verarbeitet ausschließlich Dateien, die sich zwischen diesen Commits geändert haben.
- Geänderte Dateien werden ersetzt, neue Dateien hinzugefügt und gelöschte Dateien entfernt.
- Unveränderte Dateien werden nicht neu geschrieben.
- Lokale Änderungen an Dateien, die GitHub nicht geändert hat, bleiben erhalten.
- Echte \`.env\`-Dateien sowie \`.env.*\`-Dateien (außer \`.env.example\` und \`.env.sample\`) werden beim Datei-Sync übersprungen.
- \`node_modules\` und \`.git\` werden nicht als Projektdateien synchronisiert.
- Dokumentationsänderungen (\`.md\`, \`.txt\`) lösen keinen Bot-Neustart aus.
- Änderungen an \`start-all.js\`, \`bot-sync.js\` oder \`incremental-sync.js\` werden synchronisiert, benötigen aber einen einmaligen Neustart der KataBump-Instanz, damit der Supervisor den neuen Code lädt.
- Die Root-\`package.json\` enthält die zentralen Abhängigkeiten für alle Bots.

## Bots

| Bot | Beschreibung | Ordner |
|---|---|---|
| **BWW** | Welcome, Verify, Tickets, Giveaways | \`bww/\` |
| **VC** | Voice-Chat-Holder | \`current/\` |
| **TTV** | Twitch-Chatbot | \`twitch-chatbot/\` |
