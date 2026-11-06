const { PermissionFlagsBits } = require('discord.js');

const panelCreateOptions = [
  { name: 'name', description: 'Panel-Name (z.B. test, nur a-z0-9-_ )', type: 3, required: true },
  { name: 'intro', description: 'Text ganz oben im Panel', type: 3, required: false },
  { name: 'button1_label', description: 'Button 1 Name', type: 3, required: false },
  { name: 'button1_text', description: 'Button 1 Antwort', type: 3, required: false },
  { name: 'button2_label', description: 'Button 2 Name', type: 3, required: false },
  { name: 'button2_text', description: 'Button 2 Antwort', type: 3, required: false },
  { name: 'button3_label', description: 'Button 3 Name', type: 3, required: false },
  { name: 'button3_text', description: 'Button 3 Antwort', type: 3, required: false },
  { name: 'button4_label', description: 'Button 4 Name', type: 3, required: false },
  { name: 'button4_text', description: 'Button 4 Antwort', type: 3, required: false },
  { name: 'button5_label', description: 'Button 5 Name', type: 3, required: false },
  { name: 'button5_text', description: 'Button 5 Antwort', type: 3, required: false },
  { name: 'button6_label', description: 'Button 6 Name', type: 3, required: false },
  { name: 'button6_text', description: 'Button 6 Antwort', type: 3, required: false },
  { name: 'button7_label', description: 'Button 7 Name', type: 3, required: false },
  { name: 'button7_text', description: 'Button 7 Antwort', type: 3, required: false },
  { name: 'button8_label', description: 'Button 8 Name', type: 3, required: false },
  { name: 'button8_text', description: 'Button 8 Antwort', type: 3, required: false },
  { name: 'button9_label', description: 'Button 9 Name', type: 3, required: false },
  { name: 'button9_text', description: 'Button 9 Antwort', type: 3, required: false },
  { name: 'button10_label', description: 'Button 10 Name', type: 3, required: false },
  { name: 'button10_text', description: 'Button 10 Antwort', type: 3, required: false },
];

const commands = [
  { name: 'nachricht', description: 'Sendet ein Components-V2-Embed.', options: [
    { name: 'text', description: 'Text der Nachricht', type: 3, required: true },
    { name: 'titel', description: 'Optionaler Titel der Nachricht', type: 3, required: false },
    { name: 'bild', description: 'Optionale Bild-URL', type: 3, required: false }
  ]},
  { name: 'embed', description: 'Erstellt ein flexibles Components-V2-Embed.', options: [
    { name: 'text', description: 'Inhalt des Embeds', type: 3, required: true },
    { name: 'titel', description: 'Optionaler Titel', type: 3, required: false },
    { name: 'bild_url', description: 'Optionale Bild-URL (alternativ zum Upload)', type: 3, required: false },
    { name: 'thumbnail', description: 'Optionale Thumbnail-URL', type: 3, required: false },
    { name: 'farbe', description: 'HEX-Farbcode oder Farbauswahl', type: 3, required: false, autocomplete: true },
    { name: 'footer', description: 'Optionaler Footer', type: 3, required: false },
    { name: 'bild', description: 'Bild direkt vom PC oder Handy hochladen', type: 11, required: false }
  ]},
  { name: 'nachricht-wiederholen', description: 'Sendet eine Nachricht automatisch in einem festen Intervall.', options: [
    { name: 'text', description: 'Text der wiederkehrenden Nachricht', type: 3, required: true },
    { name: 'intervall', description: 'Abstand als Zahl (mindestens 1)', type: 4, required: true, min_value: 1, max_value: 525600 },
    { name: 'einheit', description: 'Minuten, Stunden oder Tage', type: 3, required: true, choices: [
      { name: 'Minuten', value: 'minuten' }, { name: 'Stunden', value: 'stunden' }, { name: 'Tage', value: 'tage' }
    ]},
    { name: 'kanal', description: 'Zielkanal (Standard: aktueller Kanal)', type: 7, required: false, channel_types: [0] },
    { name: 'farbe', description: 'HEX-Farbe, z. B. #5865F2', type: 3, required: false, autocomplete: true },
    { name: 'bild', description: 'Optionales Bild vom PC oder Handy', type: 11, required: false }
  ]},
  { name: 'wiederholung-stoppen', description: 'Stoppt eine gespeicherte wiederkehrende Nachricht.', options: [
    { name: 'id', description: 'ID aus /nachricht-wiederholen', type: 3, required: true }
  ]},
  { name: 'wiederholung-liste', description: 'Zeigt aktive wiederkehrende Nachrichten.' },
  { name: 'setup', description: 'Zeigt die Setup-Hilfe.' },
  { name: 'verify', description: 'Sendet das konfigurierte Verify-System.' },

  { name: 'ticket', description: 'Sendet das Ticket-Panel.' },
  { name: 'giveaway', description: 'Startet ein Giveaway mit Teilnahmebedingungen.', options: [
    { name: 'preis', description: 'Was wird verlost?', type: 3, required: true },
    { name: 'dauer', description: 'Dauer in Sekunden', type: 4, required: true, min_value: 60, max_value: 2592000 },
    { name: 'gewinner', description: 'Anzahl Gewinner (Standard: 1)', type: 4, required: false, min_value: 1, max_value: 100 },
    { name: 'bedingungen', description: 'Zusätzliche Teilnahmebedingungen', type: 3, required: false },
    { name: 'pflichtrolle', description: 'Rolle, die zur Teilnahme benötigt wird', type: 8, required: false },
    { name: 'kontoalter', description: 'Mindestalter des Discord-Kontos in Tagen', type: 4, required: false, min_value: 0, max_value: 3650 },
    { name: 'serveralter', description: 'Mindestzeit auf dem Server in Tagen', type: 4, required: false, min_value: 0, max_value: 3650 },
    { name: 'bonusrolle', description: 'Rolle für zusätzliche Lose', type: 8, required: false },
    { name: 'bonuslose', description: 'Zusätzliche Lose für Bonusrolle (max. 20)', type: 4, required: false, min_value: 1, max_value: 20 }
  ]},
  { name: 'panel-create', description: 'Erstellt und sendet ein Custom-Panel mit bis zu 10 Buttons (speichern+senden).', options: panelCreateOptions },
  { name: 'panel-send', description: 'Sendet ein gespeichertes Panel.', options: [{ name: 'name', description: 'Panel-Name', type: 3, required: true }]},
  { name: 'panel-delete', description: 'L\u00F6scht ein gespeichertes Panel.', options: [{ name: 'name', description: 'Panel-Name', type: 3, required: true }]},
  { name: 'panel-list', description: 'Listet alle gespeicherten Panels.' },
  { name: 'panel-add-button', description: 'F\u00FCgt Buttons zu Panel hinzu (unbegrenzt, 25/Seite).', options: [{ name: 'name', description: 'Panel-Name', type: 3, required: true }, { name: 'label', description: 'Button Label', type: 3, required: true }, { name: 'text', description: 'Button Antwort', type: 3, required: true }]},
  { name: 'umfrage', description: 'Erstellt Event-Umfrage mit Live-Z\u00E4hler.', options: [
    { name: 'frage', description: 'Frage', type: 3, required: true },
    { name: 'option1', description: 'Option 1', type: 3, required: true },
    { name: 'option2', description: 'Option 2', type: 3, required: true },
    { name: 'option3', description: 'Option 3', type: 3, required: false },
    { name: 'option4', description: 'Option 4', type: 3, required: false },
    { name: 'option5', description: 'Option 5', type: 3, required: false }
  ]},
  { name: 'setup-status', description: 'Status-Embed Kanal festlegen (online/offline/wartung).', options: [{ name: 'channel', description: 'Kanal f\u00FCr Status-Embed', type: 7, required: true, channel_types: [0] }]},
  { name: 'wartung', description: 'Wartungsmodus umschalten (gelb).', options: [{ name: 'aktiv', description: 'true=an, false=aus', type: 5, required: true }, { name: 'grund', description: 'Grund f\u00FCr Wartung', type: 3, required: false }]},
  { name: 'restart', description: 'Startet den Bot neu (Admin).' },
  { name: 'kick', description: 'Kickt ein Mitglied.', options: [
    { name: 'user', description: 'Mitglied', type: 6, required: true },
    { name: 'grund', description: 'Grund', type: 3, required: false }
  ]},
  { name: 'ban', description: 'Bannt einen Benutzer.', options: [
    { name: 'user', description: 'Benutzer', type: 6, required: true },
    { name: 'grund', description: 'Grund', type: 3, required: false }
  ]},
  { name: 'unban', description: 'Entbannt einen Benutzer.', options: [
    { name: 'user', description: 'Benutzer', type: 6, required: true }
  ]},
  { name: 'timeout', description: 'Pausiert ein Mitglied f\u00FCr eine Dauer.', options: [
    { name: 'user', description: 'Mitglied', type: 6, required: true },
    { name: 'dauer', description: 'Dauer in Minuten', type: 4, required: true },
    { name: 'grund', description: 'Grund', type: 3, required: false }
  ]},
  { name: 'giverole', description: 'Gibt einem Mitglied eine Rolle.', options: [
    { name: 'user', description: 'Mitglied', type: 6, required: true },
    { name: 'rolle', description: 'Rolle', type: 8, required: true }
  ]},
  { name: 'removerole', description: 'Entfernt einem Mitglied eine Rolle.', options: [
    { name: 'user', description: 'Mitglied', type: 6, required: true },
    { name: 'rolle', description: 'Rolle', type: 8, required: true }
  ]},
  { name: 'setup-welcome', description: 'Welcome-System konfigurieren.', options: [
    { name: 'channel', description: 'Welcome-Channel', type: 7, required: true, channel_types: [0] },
    { name: 'text', description: 'Welcome-Text; Platzhalter siehe /setup', type: 3, required: true },
    { name: 'title', description: 'Optionaler endloser Titel des Embeds', type: 3, required: false }
  ]},
  { name: 'setup-verify', description: 'Verify-System konfigurieren.', options: [
    { name: 'channel', description: 'Verify-Channel', type: 7, required: true, channel_types: [0] },
    { name: 'role', description: 'Verifizierungsrolle', type: 8, required: true },
    { name: 'text', description: 'Text des Verify-Embeds', type: 3, required: true }
  ]},
  { name: 'setup-ticket', description: 'Ticket-System konfigurieren.', options: [
    { name: 'kategorie', description: 'Kategorie f\u00FCr Ticket-Kan\u00E4le', type: 7, required: true, channel_types: [4] },
    { name: 'rolle', description: 'Ticket-Rolle mit Kanalzugriff', type: 8, required: true }
  ]},
  { name: 'setup-permission', description: 'Rollenberechtigung f\u00FCr Commands setzen.', options: [
    { name: 'command', description: 'Command', type: 3, required: true, choices: [{ name: 'nachricht', value: 'nachricht' }, { name: 'dashboard-code', value: 'dashboard-code' }, { name: 'raid-schutz', value: 'raid-schutz' }, { name: 'raid-lockdown', value: 'raid-lockdown' }, { name: 'raid-entsperren', value: 'raid-entsperren' }, { name: 'dm-senden', value: 'dm-senden' }, { name: 'personalakte', value: 'personalakte' }, { name: 'personalakte-setzen', value: 'personalakte-setzen' }, { name: 'personalakte-befordern', value: 'personalakte-befordern' }, { name: 'personalakte-verwarnen', value: 'personalakte-verwarnen' }, { name: 'personalakte-aktivitaet', value: 'personalakte-aktivitaet' }, { name: 'embed-bearbeiten', value: 'embed-bearbeiten' }, { name: 'embed', value: 'embed' }, { name: 'ticket', value: 'ticket' }, { name: 'giveaway', value: 'giveaway' }, { name: 'einheiten', value: 'einheiten' }, { name: 'setup-status', value: 'setup-status' }, { name: 'wartung', value: 'wartung' }, { name: 'kick', value: 'kick' }, { name: 'ban', value: 'ban' }, { name: 'unban', value: 'unban' }, { name: 'timeout', value: 'timeout' }, { name: 'giverole', value: 'giverole' }, { name: 'removerole', value: 'removerole' }, { name: 'giveaway-protokoll', value: 'giveaway-protokoll' }]},
    { name: 'role', description: 'Rolle', type: 8, required: true },
    { name: 'erlauben', description: 'true = erlauben, false = entfernen', type: 5, required: true }
  ]},

  { name: 'giveaway-protokoll', description: 'Zeigt das Protokoll eines Giveaways.', options: [{ name: 'id', description: 'Giveaway-ID aus der Startmeldung', type: 3, required: true }]},
  { name: 'selfrollen-panel', description: 'Erstellt ein gestaltetes Self-Role-Button-Panel.', options: [{"name":"kanal","description":"Textkanal für das Self-Role-Panel","type":7,"required":true,"channel_types":[0]},{"name":"beschreibung","description":"Text im Embed","type":3,"required":true},{"name":"rolle1","description":"Rolle für Button 1","type":8,"required":true},{"name":"titel","description":"Titel im Embed","type":3,"required":false},{"name":"embed_farbe","description":"HEX-Farbe des Embeds, z. B. #5865F2","type":3,"required":false},{"name":"name1","description":"Beschriftung von Button 1","type":3,"required":false},{"name":"farbe1","description":"Farbe von Button 1","type":3,"required":false,"choices":[{"name":"Blau","value":"primary"},{"name":"Grau","value":"secondary"},{"name":"Grün","value":"success"},{"name":"Rot","value":"danger"}]},{"name":"emoji1","description":"Emoji für Button 1 (optional)","type":3,"required":false},{"name":"rolle2","description":"Rolle für Button 2","type":8,"required":false},{"name":"name2","description":"Beschriftung von Button 2","type":3,"required":false},{"name":"farbe2","description":"Farbe von Button 2","type":3,"required":false,"choices":[{"name":"Blau","value":"primary"},{"name":"Grau","value":"secondary"},{"name":"Grün","value":"success"},{"name":"Rot","value":"danger"}]},{"name":"emoji2","description":"Emoji für Button 2 (optional)","type":3,"required":false},{"name":"rolle3","description":"Rolle für Button 3","type":8,"required":false},{"name":"name3","description":"Beschriftung von Button 3","type":3,"required":false},{"name":"farbe3","description":"Farbe von Button 3","type":3,"required":false,"choices":[{"name":"Blau","value":"primary"},{"name":"Grau","value":"secondary"},{"name":"Grün","value":"success"},{"name":"Rot","value":"danger"}]},{"name":"emoji3","description":"Emoji für Button 3 (optional)","type":3,"required":false},{"name":"rolle4","description":"Rolle für Button 4","type":8,"required":false},{"name":"name4","description":"Beschriftung von Button 4","type":3,"required":false},{"name":"farbe4","description":"Farbe von Button 4","type":3,"required":false,"choices":[{"name":"Blau","value":"primary"},{"name":"Grau","value":"secondary"},{"name":"Grün","value":"success"},{"name":"Rot","value":"danger"}]},{"name":"emoji4","description":"Emoji für Button 4 (optional)","type":3,"required":false},{"name":"rolle5","description":"Rolle für Button 5","type":8,"required":false},{"name":"name5","description":"Beschriftung von Button 5","type":3,"required":false},{"name":"farbe5","description":"Farbe von Button 5","type":3,"required":false,"choices":[{"name":"Blau","value":"primary"},{"name":"Grau","value":"secondary"},{"name":"Grün","value":"success"},{"name":"Rot","value":"danger"}]},{"name":"emoji5","description":"Emoji für Button 5 (optional)","type":3,"required":false}] },
  { name: 'einheit-erstellen', description: 'Erstellt eine Kompanie, einen Zug oder eine Gruppe.', options: [
    { name: 'typ', description: 'Einheitentyp', type: 3, required: true, choices: [{ name: 'Kompanie', value: 'kompanie' }, { name: 'Zug', value: 'zug' }, { name: 'Gruppe', value: 'gruppe' }] },
    { name: 'name', description: 'Name der Einheit', type: 3, required: true },
    { name: 'uebergeordnet', description: 'Kompanie für Zug bzw. Zug für Gruppe', type: 3, required: false },
    { name: 'zustaendigkeit', description: 'Aufgaben und Zuständigkeiten', type: 3, required: false }
  ]},
  { name: 'einheit-kanal', description: 'Richtet eine dauerhaft aktuelle Einheitenliste in einem öffentlichen Textkanal ein.', options: [{ name: 'kanal', description: 'Textkanal für die permanente Einheitenübersicht', type: 7, required: true, channel_types: [0] }] },
  { name: 'einheit-liste', description: 'Zeigt die Einheitenübersicht mit Kommandeuren, Stellvertretern und Mitgliedern.' },
  { name: 'einheit-info', description: 'Zeigt Mitglieder, Führung und Zuständigkeiten einer Einheit.', options: [{ name: 'name', description: 'Name der Einheit', type: 3, required: true }] },
  { name: 'einheit-bearbeiten', description: 'Ändert Name oder Zuständigkeiten einer Einheit.', options: [
    { name: 'name', description: 'Aktueller Name der Einheit', type: 3, required: true },
    { name: 'neuer_name', description: 'Neuer Name', type: 3, required: false },
    { name: 'zustaendigkeit', description: 'Neue Zuständigkeiten', type: 3, required: false }
  ]},
  { name: 'einheit-mitglied', description: 'Weist einen Kommandeur, Stellvertreter oder ein Mitglied zu.', options: [
    { name: 'name', description: 'Name der Einheit', type: 3, required: true },
    { name: 'user', description: 'Discord-Mitglied', type: 6, required: true },
    { name: 'position', description: 'Mitglied, Leiter oder Stellvertreter', type: 3, required: true, choices: [{ name: 'Mitglied', value: 'mitglied' }, { name: 'Kommandeur', value: 'leiter' }, { name: 'Stellvertretender Kommandeur', value: 'stellvertreter' }] }
  ]},
  { name: 'einheit-entfernen', description: 'Entfernt ein Mitglied aus einer Einheit.', options: [
    { name: 'name', description: 'Name der Einheit', type: 3, required: true },
    { name: 'user', description: 'Discord-Mitglied', type: 6, required: true }
  ]},
  { name: 'einheit-loeschen', description: 'Löscht eine leere untergeordnete Einheit.', options: [{ name: 'name', description: 'Name der Einheit', type: 3, required: true }]},


  { name: 'dashboard-code', description: 'Erstellt einen einmaligen Login-Code für das BWW-Webdashboard.' },
  { name: 'raid-schutz', description: 'Konfiguriert den automatischen Raid-Schutz.', options: [
    { name: 'aktiv', description: 'Raid-Schutz aktivieren oder deaktivieren', type: 5, required: true },
    { name: 'beitritte', description: 'Join-Schwelle im Zeitfenster (2–30)', type: 4, required: false, min_value: 2, max_value: 30 },
    { name: 'zeitfenster', description: 'Zeitfenster in Sekunden (5–120)', type: 4, required: false, min_value: 5, max_value: 120 },
    { name: 'kontoalter', description: 'Mindestalter eines Kontos in Tagen (0 = aus)', type: 4, required: false, min_value: 0, max_value: 365 }
  ]},
  { name: 'raid-lockdown', description: 'Sperrt Textkanäle vorübergehend für @everyone.' },
  { name: 'raid-entsperren', description: 'Hebt den aktiven Raid-Lockdown wieder auf.' },
  { name: 'dm-senden', description: 'Sendet einem Nutzer eine DM über den Bot und leitet Antworten weiter.', options: [
    { name: 'user', description: 'Empfänger der DM', type: 6, required: true },
    { name: 'nachricht', description: 'Nachricht an den Empfänger', type: 3, required: true }
  ]},
  { name: 'personalakte', description: 'Zeigt die digitale Personalakte eines Soldaten.', options: [
    { name: 'user', description: 'Soldat', type: 6, required: true }
  ]},
  { name: 'personalakte-setzen', description: 'Legt Rang, Eintrittsdatum und Einheit fest.', options: [
    { name: 'user', description: 'Soldat', type: 6, required: true },
    { name: 'rang', description: 'Aktueller Rang', type: 3, required: true },
    { name: 'eintritt', description: 'Eintrittsdatum (YYYY-MM-DD)', type: 3, required: false },
    { name: 'einheit', description: 'Einheitenname', type: 3, required: false }
  ]},
  { name: 'personalakte-befordern', description: 'Dokumentiert eine Beförderung.', options: [
    { name: 'user', description: 'Soldat', type: 6, required: true },
    { name: 'neuer_rang', description: 'Neuer Rang', type: 3, required: true },
    { name: 'grund', description: 'Begründung', type: 3, required: false }
  ]},
  { name: 'personalakte-verwarnen', description: 'Trägt eine Verwarnung in die Personalakte ein.', options: [
    { name: 'user', description: 'Soldat', type: 6, required: true },
    { name: 'grund', description: 'Grund der Verwarnung', type: 3, required: true }
  ]},
  { name: 'personalakte-aktivitaet', description: 'Dokumentiert eine Aktivität in der Personalakte.', options: [
    { name: 'user', description: 'Soldat', type: 6, required: true },
    { name: 'beschreibung', description: 'Aktivität oder Dienstereignis', type: 3, required: true }
  ]},
  { name: 'embed-bearbeiten', description: 'Bearbeitet eine zuvor mit /embed gesendete Components-V2-Nachricht.', options: [
    { name: 'nachricht_id', description: 'Discord-Nachrichten-ID', type: 3, required: true },
    { name: 'titel', description: 'Neuer Titel', type: 3, required: false },
    { name: 'text', description: 'Neuer Text', type: 3, required: false },
    { name: 'bild_url', description: 'Neue Bild-URL', type: 3, required: false }
  ]},

];

function isAllowed(interaction, config) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const commandName = interaction.commandName;
  if (!commandName) return false;
  const key = commandName === 'giveaway-protokoll' ? 'giveaway' : commandName;
  const roles = config.permissions[key] || [];
  const memberRoles = interaction.member?.roles?.cache;
  if (!memberRoles) return false;
  return roles.some(id => memberRoles.has(id));
}

module.exports = { commands, isAllowed };
