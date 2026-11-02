# BWW Webdashboard

Das Dashboard läuft als Vercel-Serverless-App unter `bww/website` und verwendet ausschließlich die bestehende BWW-Supabase-Datenbank.

## Login
1. Im BWW-Discord-Server als Administrator `/dashboard-code` ausführen.
2. Den einmaligen 12-stelligen Code auf der Dashboard-Loginseite eingeben.
3. Der Code verfällt nach fünf Minuten und kann nur einmal verwendet werden. Die Sitzung läuft nach sieben Tagen ab.

## Benötigte serverseitige Umgebungsvariablen
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Es werden keine Supabase-Schlüssel an den Browser ausgeliefert. Sitzungen werden als SHA-256-Hash gespeichert; das Cookie ist HttpOnly und SameSite=Lax.

## Bereiche
- Übersicht und Bot-Status
- Digitale Personalakten
- Kompanien, Züge und Gruppen
- Raid Protection und Lockdown-Protokoll
- Components-V2-Embeds senden und bearbeiten
- DM-Versand über die Bot-Aktionswarteschlange
- Aktions- und Personalprotokoll

Dashboard-Aktionen werden in `bww_dashboard_actions` geschrieben und vom laufenden Bot abgearbeitet. Der Bot muss online sein, damit Aktionen ausgeführt werden.
