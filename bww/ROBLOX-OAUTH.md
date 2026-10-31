# Roblox-OAuth-Website (BWW)

## Website

Die eigenständige Roblox-OAuth-Website liegt unter `bww/website/` und wird direkt vom HTTP-Server des BWW-Bots ausgeliefert:

- `/` – Startseite mit Erklärung des Account-Linking-Ablaufs
- `/styles.css` – Gestaltung der Website
- `/health` – einfacher Health-Check
- `/roblox/callback` – OAuth-Callback (Pfad muss exakt zur Roblox-App passen)

Die Anmeldung wird weiterhin über den Button im Discord-Panel gestartet. Dadurch ist die Discord-Identität eindeutig an die laufende OAuth-Sitzung gebunden. Die Website fragt keine Roblox- oder Discord-Passwörter ab.

## Roblox-App konfigurieren

1. Eine Roblox-OAuth-App im [Roblox Creator Dashboard](https://create.roblox.com/dashboard/credentials) registrieren.
2. Als App-Kategorie **Account Linking Tools** verwenden.
3. Die Scopes `openid` und `profile` freigeben.
4. Als Redirect URI die öffentliche HTTPS-Adresse der Website mit Callback-Pfad eintragen, zum Beispiel:
   `https://DEINE-DOMAIN/roblox/callback`
5. Diese URL muss exakt mit `ROBLOX_REDIRECT_URI` übereinstimmen.

## Umgebungsvariablen

| Variable | Beispiel | Bedeutung |
| --- | --- | --- |
| `ROBLOX_CLIENT_ID` | `deine-client-id` | Client-ID aus dem Roblox Creator Dashboard |
| `ROBLOX_REDIRECT_URI` | `https://DEINE-DOMAIN/roblox/callback` | Exakte öffentliche HTTPS-Callback-URL |
| `BWW_OAUTH_PORT` | `3000` | Interner HTTP-Port der Website |

Bei PKCE wird gemäß Roblox-Dokumentation kein Client-Secret im Bot benötigt. Keine Zugangsdaten in den Quellcode committen.

## Hosting / Netzwerk

Der BWW-Prozess liefert Website und Callback gemeinsam auf dem Port `BWW_OAUTH_PORT` aus. Der Port muss von einem öffentlichen HTTPS-Reverse-Proxy erreichbar sein. Der Proxy muss alle Pfade (insbesondere `/`, `/styles.css` und `/roblox/callback`) an denselben BWW-Port weiterleiten. TLS/HTTPS wird am Reverse-Proxy terminiert.

Ein Aufruf von `/health` sollte `{"ok":true,"service":"bww-roblox-oauth"}` zurückgeben.

## Discord-Berechtigungen

Der Bot benötigt **Spitznamen verwalten**. Seine höchste Rolle muss über den Rollen der Mitglieder stehen, deren Nickname geändert werden soll.

## Sicherheit

- OAuth-State ist zufällig, einmalig und zehn Minuten gültig.
- PKCE verwendet SHA-256 (S256).
- Es werden nur die Scopes `openid profile` angefordert.
- Access- und Refresh-Tokens werden nicht gespeichert.
- Verknüpfungen werden in den vorhandenen BWW-Guild-Einstellungen in Supabase gespeichert.
