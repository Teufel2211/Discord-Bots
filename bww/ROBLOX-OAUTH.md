# Roblox-OAuth-Verknüpfung (BWW)

## Funktion

- `/roblox-panel` sendet das dauerhafte Embed mit dem Button **Mit Roblox anmelden** (nur Administratoren).
- Der Button startet den offiziellen Roblox-OAuth-2.0-Authorization-Code-Flow mit PKCE.
- Nach Zustimmung liest der Bot die Roblox-ID und den Anzeigenamen aus dem Userinfo-Endpunkt.
- Die Roblox-ID wird als stabile Kennung gespeichert; der Roblox-Anzeigename wird als Discord-Servernickname gesetzt.
- `/roblox-status` zeigt die Verknüpfung des ausführenden Mitglieds.
- `/roblox-unlink` trennt die Verknüpfung und versucht, den vorherigen Servernickname wiederherzustellen.

Der Bot fragt niemals das Roblox-Passwort ab und speichert keine OAuth-Access- oder Refresh-Tokens.

## Voraussetzungen

1. Eine Roblox-OAuth-App im [Roblox Creator Dashboard](https://create.roblox.com/dashboard/credentials) registrieren.
2. Als App-Kategorie **Account Linking Tools** verwenden.
3. Die Scopes `openid` und `profile` freigeben.
4. Eine öffentliche HTTPS-Callback-Adresse registrieren, zum Beispiel:
   `https://DEINE-DOMAIN/roblox/callback`
5. Diese HTTPS-Adresse muss per Reverse Proxy an den BWW-Bot-Container auf den konfigurierten Callback-Port weitergeleitet werden. Der Bot stellt selbst nur den HTTP-Endpunkt bereit; TLS/HTTPS muss der Reverse Proxy übernehmen.

## Umgebungsvariablen

Diese Variablen in der BWW-Bot-Umgebung bzw. in `bww/.env` setzen:

| Variable | Beispiel | Bedeutung |
| --- | --- | --- |
| `ROBLOX_CLIENT_ID` | `deine-client-id` | Client-ID aus dem Roblox Creator Dashboard |
| `ROBLOX_REDIRECT_URI` | `https://DEINE-DOMAIN/roblox/callback` | Exakt dieselbe URL wie in der Roblox-App registriert |
| `BWW_OAUTH_PORT` | `3000` | Interner HTTP-Port des Callback-Servers |

Bei PKCE wird gemäß Roblox-Dokumentation kein Client-Secret im Bot benötigt. Keine Zugangsdaten in den Quellcode committen.

## Hosting / Netzwerk

Der Port aus `BWW_OAUTH_PORT` muss im Container erreichbar sein. Ein HTTPS-Reverse-Proxy muss Anfragen für den Pfad `/roblox/callback` unverändert an den BWW-Container-Port weiterleiten. Die externe URL und die in Roblox eingetragene Redirect-URI müssen exakt übereinstimmen.

Wenn KataBump für den Bot-Container keinen HTTPS-Reverse-Proxy bzw. keine Weiterleitung einer eigenen Domain auf einen zusätzlichen Container-Port bereitstellt, muss dafür ein separater HTTPS-Endpunkt (z. B. ein kleiner Web-Service) eingerichtet werden. Ohne erreichbaren HTTPS-Callback kann Roblox den OAuth-Flow nicht abschließen.

## Discord-Berechtigungen

Der Bot benötigt **Spitznamen verwalten**. Seine höchste Rolle muss über den Rollen der Mitglieder stehen, deren Nickname geändert werden soll. Wenn Discord die Änderung verweigert, bleibt die Roblox-Verknüpfung gespeichert; der Callback zeigt dann einen entsprechenden Hinweis.

## Sicherheit

- OAuth-State ist zufällig, einmalig und zehn Minuten gültig.
- PKCE verwendet SHA-256 (S256).
- Der Authorization Code wird einmalig am Token-Endpunkt eingelöst.
- Es werden nur die Scopes `openid profile` angefordert.
- Verknüpfungen werden in den vorhandenen BWW-Guild-Einstellungen in Supabase gespeichert.
