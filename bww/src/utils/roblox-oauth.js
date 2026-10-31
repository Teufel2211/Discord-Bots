const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getGuildSettings, saveGuildSettings } = require('./database');

const pending = new Map();
const WEBSITE_DIR = path.resolve(__dirname, '../../website');
const AUTH = 'https://apis.roblox.com/oauth/v1/authorize';
const TOKEN = 'https://apis.roblox.com/oauth/v1/token';
const USERINFO = 'https://apis.roblox.com/oauth/v1/userinfo';

function cfg() {
  return {
    clientId: String(process.env.ROBLOX_CLIENT_ID || '').trim(),
    redirectUri: String(process.env.ROBLOX_REDIRECT_URI || '').trim(),
    port: Number.parseInt(process.env.BWW_OAUTH_PORT || '3000', 10),
  };
}

function isConfigured() {
  const c = cfg();
  return Boolean(c.clientId && c.redirectUri && Number.isInteger(c.port) && c.port > 0);
}

function createAuthorizationUrl(discordUserId, guildId) {
  const c = cfg();
  if (!isConfigured()) throw new Error('Roblox OAuth ist noch nicht konfiguriert.');

  const state = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  pending.set(state, {
    discordUserId,
    guildId,
    verifier,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const url = new URL(AUTH);
  url.search = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    scope: 'openid profile',
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  }).toString();
  return url.toString();
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(html);
}

function page(title, message, success = false) {
  const esc = value => String(value).replace(/[&<>"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[ch]));
  return '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#10131d"><title>' +
    esc(title) + ' · BWW Roblox Link</title><link rel="stylesheet" href="/styles.css"></head><body><main class="shell"><a class="brand" href="/">BWW <span>ROBLOX LINK</span></a><section class="hero result"><div class="symbol ' +
    (success ? 'success' : 'error') + '">' + (success ? '✓' : '!') + '</div><p class="eyebrow">KONTO-VERKNÜPFUNG</p><h1>' +
    esc(title) + '</h1><p class="lead">' + esc(message) + '</p><p class="hint">Du kannst dieses Fenster jetzt schließen und zu Discord zurückkehren.</p><a class="button secondary" href="/">Zur Startseite</a></section><footer>Bundeswehr Waldstädt · Sichere Anmeldung über Roblox OAuth 2.0</footer></main></body></html>';
}

async function finish(client, session, code) {
  const c = cfg();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    code_verifier: session.verifier,
  });
  const tokenRes = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) {
    throw new Error('Roblox-Token-Austausch fehlgeschlagen (HTTP ' + tokenRes.status + ').');
  }

  const userRes = await fetch(USERINFO, {
    headers: { Authorization: 'Bearer ' + token.access_token },
  });
  const profile = await userRes.json().catch(() => ({}));
  if (!userRes.ok || !profile.sub) {
    throw new Error('Roblox-Profil konnte nicht gelesen werden (HTTP ' + userRes.status + ').');
  }

  const displayName = String(profile.name || profile.nickname || '').trim().slice(0, 32);
  if (!displayName) throw new Error('Roblox hat keinen gültigen Anzeigenamen zurückgegeben.');

  const settings = await getGuildSettings(session.guildId);
  settings.robloxLinks = settings.robloxLinks || {};
  const previous = settings.robloxLinks[session.discordUserId];
  const guild = client.guilds.cache.get(session.guildId);
  if (!guild) throw new Error('Der Discord-Server ist nicht verfügbar.');

  const member = await guild.members.fetch(session.discordUserId);
  const previousNickname = previous?.previousNickname ?? member.nickname ?? null;
  settings.robloxLinks[session.discordUserId] = {
    robloxId: String(profile.sub),
    displayName,
    username: String(profile.preferred_username || ''),
    profileUrl: String(profile.profile || ''),
    previousNickname,
    linkedAt: new Date().toISOString(),
  };
  await saveGuildSettings(session.guildId, settings, session.discordUserId);

  let nicknameUpdated = true;
  try {
    await member.setNickname(displayName, 'Roblox-OAuth-Kontoverknüpfung');
  } catch (error) {
    nicknameUpdated = false;
    console.warn('[BWW] Roblox-Link gespeichert, Discord-Nickname konnte nicht geändert werden:', error.message);
  }
  return { displayName, nicknameUpdated };
}

function startRobloxOAuthServer(client) {
  if (!isConfigured()) {
    console.warn('[BWW] Roblox OAuth nicht gestartet: ROBLOX_CLIENT_ID oder ROBLOX_REDIRECT_URI fehlt.');
    return null;
  }

  const c = cfg();
  const callback = new URL(c.redirectUri);
  const server = http.createServer(async (req, res) => {
    let current;
    try {
      current = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    } catch {
      res.writeHead(400).end('Bad Request');
      return;
    }

    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' }).end('Method Not Allowed');
      return;
    }

    if (current.pathname === '/') {
      const file = path.join(WEBSITE_DIR, 'index.html');
      if (!fs.existsSync(file)) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Roblox OAuth website is not installed.');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(fs.readFileSync(file));
      return;
    }

    if (current.pathname === '/styles.css') {
      const file = path.join(WEBSITE_DIR, 'styles.css');
      if (!fs.existsSync(file)) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(fs.readFileSync(file));
      return;
    }

    if (current.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, service: 'bww-roblox-oauth' }));
      return;
    }

    if (current.pathname !== callback.pathname) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    const state = current.searchParams.get('state');
    const session = state ? pending.get(state) : null;
    if (state) pending.delete(state);

    if (!session || session.expiresAt < Date.now()) {
      sendHtml(res, 400, page('Anmeldung abgelaufen', 'Bitte starte die Roblox-Verknüpfung erneut über das Panel in Discord.'));
      return;
    }
    if (current.searchParams.get('error')) {
      sendHtml(res, 400, page('Anmeldung abgebrochen', 'Roblox hat die Anmeldung nicht bestätigt. Du kannst es jederzeit erneut über Discord versuchen.'));
      return;
    }
    const code = current.searchParams.get('code');
    if (!code) {
      sendHtml(res, 400, page('Ungültige Rückmeldung', 'Der Roblox-Autorisierungscode fehlt.'));
      return;
    }

    try {
      const result = await finish(client, session, code);
      const msg = result.nicknameUpdated
        ? 'Dein Roblox-Anzeigename „' + result.displayName + '“ wurde erfolgreich verknüpft und als Discord-Servername gesetzt.'
        : 'Dein Roblox-Konto „' + result.displayName + '“ wurde verknüpft. Discord konnte den Servernamen nicht ändern. Prüfe die Berechtigung „Spitznamen verwalten“ und die Rollenposition des Bots.';
      sendHtml(res, 200, page('Roblox erfolgreich verknüpft', msg, true));
    } catch (error) {
      console.error('[BWW] Roblox OAuth Callback:', error.message);
      sendHtml(res, 500, page('Verknüpfung fehlgeschlagen', 'Die Verknüpfung konnte nicht abgeschlossen werden. Kehre zu Discord zurück und starte den Vorgang erneut.'));
    }
  });

  server.listen(c.port, '0.0.0.0', () => {
    console.log('[BWW] Roblox OAuth Website und Callback laufen auf Port ' + c.port + '.');
  });
  server.on('error', error => console.error('[BWW] Roblox OAuth HTTP-Server:', error.message));
  return server;
}

module.exports = { isConfigured, createAuthorizationUrl, startRobloxOAuthServer };
