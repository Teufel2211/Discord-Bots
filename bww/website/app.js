const crypto = require('node:crypto');
const express = require('express');
const path = require('node:path');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || '';
const COOKIE = 'bww_dashboard_session';
const SESSION_DAYS = 7;
const ACTIONS = new Set(['send_message', 'embed_send', 'embed_edit', 'raid_lockdown', 'raid_restore', 'dm_send', 'dm_thread']);
const loginAttempts = new Map();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function cookieValue(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}
function configured() { return Boolean(SUPABASE_URL && SUPABASE_KEY); }
async function db(path, options = {}) {
  if (!configured()) throw new Error('Supabase ist für das Dashboard nicht konfiguriert.');
  const response = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error('Datenbankfehler (' + response.status + '): ' + (await response.text()).slice(0, 300));
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
function page(title, body, user) {
  const groups = [
    ['START', [['dashboard','⌂','Übersicht']]],
    ['PERSONAL', [['personalakten','▤','Personalakten'],['einheiten','⌘','Einheiten']]],
    ['SICHERHEIT & KOMMUNIKATION', [['raid','◈','Raid Protection'],['dm','✉','DM-System'],['tickets','▣','Tickets']]],
    ['INHALTE', [['embeds','▧','Embed-Editor'],['giveaways','✦','Giveaways']]],
    ['SYSTEM', [['einstellungen','⚙','Einstellungen'],['protokoll','≡','Aktivitätsprotokoll']]]
  ];
  const activeKey = groups.flatMap(([,items])=>items).find(([key]) => title.toLowerCase().includes(key) || (key === 'dashboard' && title === 'Übersicht'))?.[0] || '';
  const navigation = groups.map(([label,items]) => '<div class="nav-group"><span class="nav-label">' + label + '</span>' + items.map(([key,icon,text]) => '<a class="nav-link ' + (activeKey===key?'active':'') + '" href="/' + key + '"><span class="nav-icon" aria-hidden="true">' + icon + '</span><span>' + text + '</span>' + (activeKey===key?'<i class="nav-current"></i>':'') + '</a>').join('') + '</div>').join('');
  return '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101713"><title>' + escapeHtml(title) + ' · BWW Verwaltung</title><link rel="stylesheet" href="/style.css"><script defer src="/dashboard.js"></script></head><body><aside class="sidebar"><a class="brand" href="/dashboard"><span class="brand-mark">B</span><span class="brand-copy"><strong>BUNDESWEHR</strong><small>WALDSTÄDT · CONTROL</small></span></a><div class="server-switch"><span class="server-avatar">W</span><span><small>AKTIVER SERVER</small><strong>Bundeswehr Waldstädt</strong></span><span class="server-dot"></span></div><nav aria-label="Hauptnavigation">' + navigation + '</nav><div class="sidebar-footer"><div class="user-avatar">' + escapeHtml(String(user.user_id).slice(-2)) + '</div><div class="user-meta"><small>ANGEMELDET</small><strong>' + escapeHtml(user.user_id) + '</strong></div><form method="post" action="/logout"><button class="logout-button" type="submit" aria-label="Abmelden" title="Abmelden">↗</button></form></div></aside><main><div class="topbar"><div class="breadcrumbs"><span>WALDSTÄDT</span><b>/</b><strong>' + escapeHtml(title.toUpperCase()) + '</strong></div><div class="topbar-right"><span class="live-indicator"><i></i> SYSTEM VERBUNDEN</span><span class="topbar-date">' + new Date().toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}) + '</span></div></div><header class="page-heading"><div><span class="eyebrow">VERWALTUNGSZENTRUM <b>•</b> ' + escapeHtml(title.toUpperCase()) + '</span><h1>' + escapeHtml(title) + '</h1><p class="page-subtitle">Zentrale Verwaltung · Bundeswehr Waldstädt</p></div><span class="page-status"><i></i> Live-Verbindung</span></header><div class="page-content">' + body + '</div><footer class="app-footer"><span>BWW <b>CONTROL CENTER</b></span><span>INTERNES VERWALTUNGSSYSTEM</span></footer></main></body></html>';
}
function alertBox(message, type = 'ok') { return '<div class="notice ' + type + '">' + escapeHtml(message) + '</div>'; }
function card(title, content) { return '<section class="panel"><h2>' + title + '</h2>' + content + '</section>'; }
function table(headers, rows) {
  return '<div class="table-wrap"><table><thead><tr>' + headers.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + (rows.length ? rows.map((row) => '<tr>' + row.map((cell) => '<td>' + cell + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + headers.length + '" class="muted">Keine Einträge vorhanden.</td></tr>') + '</tbody></table></div>';
}
function field(label, name, value = '', type = 'text', required = false, placeholder = '') {
  return '<label>' + label + '<input name="' + name + '" type="' + type + '" value="' + escapeHtml(value) + '" ' + (required ? 'required' : '') + (placeholder ? ' placeholder="' + escapeHtml(placeholder) + '"' : '') + '></label>';
}
function textarea(label, name, value = '', required = false) {
  return '<label>' + label + '<textarea name="' + name + '" rows="4" ' + (required ? 'required' : '') + '>' + escapeHtml(value) + '</textarea></label>';
}
function select(label, name, options, selected = '') {
  return '<label>' + label + '<select name="' + name + '">' + options.map(([value, text]) => '<option value="' + escapeHtml(value) + '" ' + (value === selected ? 'selected' : '') + '>' + escapeHtml(text) + '</option>').join('') + '</select></label>';
}
function button(text, cls = '') { return '<button class="button ' + cls + '" type="submit">' + escapeHtml(text) + '</button>'; }
function form(action, content, cls = '') { return '<form class="' + cls + '" method="post" action="' + action + '">' + content + '</form>'; }

async function loadSession(req) {
  const token = cookieValue(req, COOKIE);
  if (!token || token.length < 40) return null;
  const rows = await db('bww_dashboard_sessions?select=id,guild_id,user_id,expires_at&token_hash=eq.' + hash(token) + '&revoked_at=is.null&expires_at=gt.' + encodeURIComponent(new Date().toISOString()) + '&limit=1', { headers: { Prefer: 'return=representation' } });
  return rows?.[0] || null;
}
app.use(async (req, res, next) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  if (req.path === '/login' || req.path === '/health' || req.path === '/style.css') return next();
  try {
    req.dashboardSession = await loadSession(req);
    if (!req.dashboardSession) return res.redirect('/login');
    next();
  } catch (error) {
    console.error('[BWW Dashboard] Session-Prüfung fehlgeschlagen:', error.message);
    res.status(503).send('Dashboard-Datenbank vorübergehend nicht erreichbar.');
  }
});
function requireSession(req, res, next) {
  if (!req.dashboardSession) return res.redirect('/login');
  next();
}
async function queueAction(req, action, payload) {
  if (!ACTIONS.has(action)) throw new Error('Nicht erlaubte Aktion.');
  await db('bww_dashboard_actions', { method: 'POST', body: JSON.stringify({ guild_id: req.dashboardSession.guild_id, action, payload, created_by: req.dashboardSession.user_id }) });
}
async function getSettings(guildId) {
  const rows = await db('bww_guild_settings?select=settings&guild_id=eq.' + guildId + '&limit=1', { headers: { Prefer: 'return=representation' } });
  return rows?.[0]?.settings || {};
}
async function audit(guildId, userId, actorId, eventType, oldValue, newValue, details = {}) {
  await db('bww_personalakte_events', { method: 'POST', body: JSON.stringify({ guild_id: guildId, user_id: userId, actor_id: actorId, event_type: eventType, old_value: oldValue, new_value: newValue, details }) });
}

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.redirect('/dashboard'));
app.get('/login', (_req, res) => res.send('<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BWW Login</title><link rel="stylesheet" href="/style.css"></head><body class="login-page"><main class="login"><div class="brand"><span class="brand-mark">B</span><div><strong>BWW</strong><small>Waldstädt · Verwaltung</small></div></div><span class="eyebrow">SICHERER ZUGANG</span><h1>Dashboard Login</h1><p>Erstelle zuerst im Discord mit <code>/dashboard-code</code> einen einmaligen Login-Code.</p><form method="post" action="/login"><label>Einmalcode<input name="code" maxlength="12" minlength="12" autocomplete="one-time-code" required autofocus></label><button class="button" type="submit">Anmelden</button></form><small class="muted">Der Code ist einmalig und nur 5 Minuten gültig.</small></main></body></html>'));
app.post('/login', async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0];
    const state = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + 10 * 60 * 1000 };
    if (state.resetAt < Date.now()) { state.count = 0; state.resetAt = Date.now() + 10 * 60 * 1000; }
    if (state.count >= 8) return res.status(429).send('Zu viele Login-Versuche. Bitte später erneut versuchen.');
    state.count += 1; loginAttempts.set(ip, state);
    const code = String(req.body.code || '').trim().toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(code)) return res.status(400).send('Ungültiger Login-Code.');
    const rows = await db('bww_dashboard_logins?code_hash=eq.' + hash(code) + '&used_at=is.null&expires_at=gt.' + encodeURIComponent(new Date().toISOString()), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ used_at: new Date().toISOString() }) });
    const login = rows?.[0];
    if (!login) return res.status(401).send('Der Code ist ungültig, abgelaufen oder wurde bereits verwendet. <a href="/login">Zurück</a>');
    const token = crypto.randomBytes(32).toString('hex');
    await db('bww_dashboard_sessions', { method: 'POST', body: JSON.stringify({ token_hash: hash(token), guild_id: login.guild_id, user_id: login.created_by, expires_at: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() }) });
    res.setHeader('Set-Cookie', COOKIE + '=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (SESSION_DAYS * 86400) + (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
    res.redirect('/dashboard');
  } catch (error) {
    console.error('[BWW Dashboard] Login fehlgeschlagen:', error.message);
    res.status(503).send('Login derzeit nicht möglich. Bitte später erneut versuchen.');
  }
});
app.post('/logout', requireSession, async (req, res) => {
  await db('bww_dashboard_sessions?token_hash=eq.' + hash(cookieValue(req, COOKIE)), { method: 'PATCH', body: JSON.stringify({ revoked_at: new Date().toISOString() }) }).catch(() => {});
  res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
  res.redirect('/login');
});

app.get('/dashboard', requireSession, async (req, res) => {
  const g = req.dashboardSession.guild_id;
  const [guilds, units, personnel, tickets, giveaways, status] = await Promise.all([
    db('bww_guilds?select=name,member_count&guild_id=eq.' + g + '&limit=1', { headers: { Prefer: 'return=representation' } }).catch(() => []),
    db('bww_units?select=id&guild_id=eq.' + g, { headers: { Prefer: 'return=representation' } }).catch(() => []),
    db('bww_personalakten?select=user_id&guild_id=eq.' + g, { headers: { Prefer: 'return=representation' } }).catch(() => []),
    db('bww_tickets?select=id&guild_id=eq.' + g + '&status=eq.open', { headers: { Prefer: 'return=representation' } }).catch(() => []),
    db('bww_giveaways?select=id&guild_id=eq.' + g + '&status=eq.active', { headers: { Prefer: 'return=representation' } }).catch(() => []),
    db('bww_bot_status?select=status,updated_at,ping_ms,uptime_seconds&id=eq.primary&limit=1', { headers: { Prefer: 'return=representation' } }).catch(() => [])
  ]);
  const guild = guilds?.[0] || {};
  const bot = status?.[0] || {};
  const body = '<div class="stats"><div class="stat"><small>Mitglieder</small><strong>' + (guild.member_count ?? '—') + '</strong></div><div class="stat"><small>Personalakten</small><strong>' + personnel.length + '</strong></div><div class="stat"><small>Einheiten</small><strong>' + units.length + '</strong></div><div class="stat"><small>Offene Tickets</small><strong>' + tickets.length + '</strong></div><div class="stat"><small>Aktive Giveaways</small><strong>' + giveaways.length + '</strong></div></div>' + card('Serverstatus', '<div class="status-row"><span class="status ' + (bot.status === 'online' ? '' : 'off') + '"><i></i> ' + escapeHtml(bot.status || 'Unbekannt') + '</span><span class="muted">Letztes Update: ' + escapeHtml(bot.updated_at ? new Date(bot.updated_at).toLocaleString('de-DE') : 'Keine Daten') + '</span><span class="muted">Ping: ' + escapeHtml(bot.ping_ms ?? '—') + ' ms</span></div>') + card('Schnellaktionen', '<div class="actions">' + form('/actions/send', field('Kanal-ID','channel_id','','text',true) + textarea('Nachricht','content','',true) + button('Nachricht senden'), 'form-grid') + form('/actions/raid-lockdown','<p>Alle Textkanäle für @everyone sperren.</p>' + button('Lockdown aktivieren','danger')) + form('/actions/raid-restore','<p>Gespeicherte Kanalrechte wiederherstellen.</p>' + button('Lockdown aufheben')) + '</div>');
  res.send(page('Übersicht', body, req.dashboardSession));
});

app.post('/actions/send', requireSession, async (req,res) => {
  const channelId=String(req.body.channel_id||'').trim(), content=String(req.body.content||'').trim().slice(0,1900);
  if(!/^\d{15,22}$/.test(channelId)||!content)return res.status(400).send('Kanal-ID oder Nachricht ungültig.');
  await queueAction(req,'send_message',{channel_id:channelId,content});
  res.redirect('/dashboard');
});
app.post('/actions/raid-lockdown', requireSession, async (req,res) => {
  await queueAction(req,'raid_lockdown',{reason:'Dashboard-Lockdown durch '+req.dashboardSession.user_id});
  res.redirect('/dashboard');
});
app.post('/actions/raid-restore', requireSession, async (req,res) => {
  await queueAction(req,'raid_restore',{});
  res.redirect('/dashboard');
});

app.get('/personalakten', requireSession, async (req, res) => {
  const g = req.dashboardSession.guild_id;
  const [rows, units] = await Promise.all([
    db('bww_personalakten?select=user_id,rank,joined_at,unit_id,last_activity_at,updated_at&guild_id=eq.' + g + '&order=updated_at.desc&limit=100', { headers: { Prefer: 'return=representation' } }),
    db('bww_units?select=id,name&guild_id=eq.' + g + '&order=name.asc&limit=100', { headers: { Prefer: 'return=representation' } })
  ]);
  const options = [['','Keine Einheit'], ...units.map((u) => [u.id,u.name])];
  const rowsHtml = rows.map((r) => ['<code>' + escapeHtml(r.user_id) + '</code>',escapeHtml(r.rank),escapeHtml(r.joined_at || '—'),escapeHtml(units.find((u) => u.id === r.unit_id)?.name || '—'),escapeHtml(r.last_activity_at ? new Date(r.last_activity_at).toLocaleDateString('de-DE') : '—')]);
  const body = card('Personalakte anlegen / aktualisieren', form('/personalakten/save', field('Discord User-ID','user_id','', 'text',true) + field('Rang','rank','Rekrut','text',true) + field('Eintrittsdatum','joined_at','','date') + select('Einheit','unit_id',options) + button('Akte speichern'), 'form-grid')) + card('Verlaufseintrag hinzufügen', form('/personalakten/event', field('Discord User-ID','user_id','','text',true) + select('Eintragstyp','event_type',[['promotion','Beförderung'],['warning','Verwarnung'],['activity','Aktivität']]) + field('Neuer Rang / Grund / Aktivität','value','','text',true) + button('Eintrag speichern'),'form-grid')) + card('Soldatenakten', table(['Discord-ID','Rang','Eintritt','Einheit','Letzte Aktivität'], rowsHtml));
  res.send(page('Personalakten', body, req.dashboardSession));
});
app.post('/personalakten/save', requireSession, async (req, res) => {
  const g = req.dashboardSession.guild_id, userId = String(req.body.user_id || '').trim(), rank = String(req.body.rank || 'Rekrut').trim().slice(0,100), joined = String(req.body.joined_at || '').trim() || null, unit = String(req.body.unit_id || '').trim() || null;
  if (!/^\d{15,22}$/.test(userId) || (joined && !/^\d{4}-\d{2}-\d{2}$/.test(joined))) return res.status(400).send('User-ID oder Datum ungültig.');
  const old = await db('bww_personalakten?select=rank&guild_id=eq.' + g + '&user_id=eq.' + userId + '&limit=1', { headers: { Prefer: 'return=representation' } });
  await db('bww_personalakten?on_conflict=guild_id,user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ guild_id:g,user_id:userId,rank,joined_at:joined,unit_id:unit,updated_by:req.dashboardSession.user_id }) });
  await audit(g,userId,req.dashboardSession.user_id,'rank_change',old?.[0]?.rank || null,rank,{source:'dashboard'});
  res.redirect('/personalakten');
});
app.post('/personalakten/event', requireSession, async (req, res) => {
  const g=req.dashboardSession.guild_id, userId=String(req.body.user_id||''), type=String(req.body.event_type||''), value=String(req.body.value||'').slice(0,1000);
  if (!/^\d{15,22}$/.test(userId) || !['promotion','warning','activity'].includes(type) || !value) return res.status(400).send('Ungültiger Akteneintrag.');
  const current=await db('bww_personalakten?select=rank&guild_id=eq.'+g+'&user_id=eq.'+userId+'&limit=1',{headers:{Prefer:'return=representation'}});
  if (!current.length) return res.status(404).send('Personalakte nicht gefunden.');
  if (type==='promotion') await db('bww_personalakten?guild_id=eq.'+g+'&user_id=eq.'+userId,{method:'PATCH',body:JSON.stringify({rank:value,updated_by:req.dashboardSession.user_id,updated_at:new Date().toISOString()})});
  if (type==='activity') await db('bww_personalakten?guild_id=eq.'+g+'&user_id=eq.'+userId,{method:'PATCH',body:JSON.stringify({last_activity_at:new Date().toISOString()})});
  await audit(g,userId,req.dashboardSession.user_id,type,current[0].rank,type==='promotion'?value:value,{source:'dashboard'});
  res.redirect('/personalakten');
});

app.get('/einheiten', requireSession, async (req,res) => {
  const g=req.dashboardSession.guild_id;
  const units=await db('bww_units?select=id,name,unit_type,parent_id,responsibilities&guild_id=eq.'+g+'&order=unit_type.asc,name.asc&limit=100',{headers:{Prefer:'return=representation'}});
  const options=[['','Keine übergeordnete Einheit'],...units.map(u=>[u.id,u.name+' ('+u.unit_type+')'])];
  const body=card('Neue Einheit',form('/einheiten/create',select('Typ','unit_type',[['kompanie','Kompanie'],['zug','Zug'],['gruppe','Gruppe']]) + field('Name','name','','text',true) + select('Übergeordnete Einheit','parent_id',options) + field('Zuständigkeit','responsibilities') + button('Einheit erstellen'),'form-grid'))+card('Mitglied zuweisen',form('/einheiten/member',select('Einheit','unit_id',units.map(u=>[u.id,u.name]))+field('Discord User-ID','user_id','','text',true)+select('Position','position',[['mitglied','Mitglied'],['leiter','Leiter'],['stellvertreter','Stellvertreter']])+button('Mitglied zuweisen'),'form-grid'))+card('Einheitenstruktur',table(['Name','Typ','Übergeordnet','Zuständigkeit'],units.map(u=>[escapeHtml(u.name),escapeHtml(u.unit_type),escapeHtml(units.find(p=>p.id===u.parent_id)?.name||'—'),escapeHtml(u.responsibilities||'—')])));
  res.send(page('Einheiten',body,req.dashboardSession));
});
app.post('/einheiten/create',requireSession,async(req,res)=>{
  const g=req.dashboardSession.guild_id, type=String(req.body.unit_type||''), name=String(req.body.name||'').trim(), parent=String(req.body.parent_id||'').trim()||null;
  if(!['kompanie','zug','gruppe'].includes(type)||!name||name.length>100)return res.status(400).send('Ungültige Einheit.');
  if(type==='kompanie' && parent)return res.status(400).send('Eine Kompanie darf keine übergeordnete Einheit haben.');
  if(type!=='kompanie'){
    if(!parent)return res.status(400).send('Ein Zug benötigt eine Kompanie, eine Gruppe benötigt einen Zug.');
    const parents=await db('bww_units?select=id,unit_type&guild_id=eq.'+g+'&id=eq.'+parent+'&limit=1',{headers:{Prefer:'return=representation'}});
    if(!parents.length || parents[0].unit_type!==(type==='zug'?'kompanie':'zug'))return res.status(400).send('Die übergeordnete Einheit passt nicht zur Hierarchie.');
  }
  await db('bww_units',{method:'POST',body:JSON.stringify({guild_id:g,unit_type:type,name,parent_id:parent,responsibilities:String(req.body.responsibilities||'').slice(0,1000),created_by:req.dashboardSession.user_id})});
  res.redirect('/einheiten');
});

app.post('/einheiten/member',requireSession,async(req,res)=>{
  const g=req.dashboardSession.guild_id,unitId=String(req.body.unit_id||''),userId=String(req.body.user_id||''),position=String(req.body.position||'mitglied');
  if(!/^\d{15,22}$/.test(userId)||!['mitglied','leiter','stellvertreter'].includes(position))return res.status(400).send('Mitgliedsdaten ungültig.');
  const unit=await db('bww_units?select=id&guild_id=eq.'+g+'&id=eq.'+unitId+'&limit=1',{headers:{Prefer:'return=representation'}});
  if(!unit.length)return res.status(404).send('Einheit nicht gefunden.');
  await db('bww_unit_members?on_conflict=unit_id,user_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({guild_id:g,unit_id:unitId,user_id:userId,position,assigned_by:req.dashboardSession.user_id})});
  await db('bww_unit_audit_logs',{method:'POST',body:JSON.stringify({guild_id:g,unit_id:unitId,actor_id:req.dashboardSession.user_id,action:'member_assigned_dashboard',details:{userId,position}})});
  res.redirect('/einheiten');
});

app.get('/raid',requireSession,async(req,res)=>{
  const g=req.dashboardSession.guild_id,[settings,events,lockdowns]=await Promise.all([getSettings(g),db('bww_raid_events?select=event_type,user_id,details,created_at&guild_id=eq.'+g+'&order=created_at.desc&limit=50',{headers:{Prefer:'return=representation'}}),db('bww_raid_lockdowns?select=reason,created_at,restored_at&guild_id=eq.'+g+'&order=created_at.desc&limit=10',{headers:{Prefer:'return=representation'}})]);
  const raid=settings.raidProtection||{};
  const body=card('Raid-Schutz Einstellungen',form('/raid/settings', '<label class="check"><input type="checkbox" name="enabled" value="true" '+(raid.enabled?'checked':'')+'> Automatische Join-Raid-Erkennung aktiv</label>'+field('Join-Schwelle','joinThreshold',raid.joinThreshold??6,'number',true)+field('Zeitfenster in Sekunden','windowSeconds',raid.windowSeconds??12,'number',true)+field('Mindest-Kontoalter in Tagen (0 = aus)','minAccountAgeDays',raid.minAccountAgeDays??0,'number',true)+button('Einstellungen speichern'))) + card('Raid-Ereignisse',table(['Zeit','Ereignis','Nutzer','Details'],events.map(e=>[escapeHtml(new Date(e.created_at).toLocaleString('de-DE')),escapeHtml(e.event_type),escapeHtml(e.user_id||'—'),escapeHtml(JSON.stringify(e.details||{}))])))+card('Lockdown-Verlauf',table(['Grund','Gestartet','Status'],lockdowns.map(l=>[escapeHtml(l.reason),escapeHtml(new Date(l.created_at).toLocaleString('de-DE')),l.restored_at?'Aufgehoben':'<strong>Aktiv</strong>'])));
  res.send(page('Raid Protection',body,req.dashboardSession));
});
app.post('/raid/settings',requireSession,async(req,res)=>{
  const g=req.dashboardSession.guild_id, settings=await getSettings(g);
  settings.raidProtection={...(settings.raidProtection||{}),enabled:req.body.enabled==='true',joinThreshold:Math.max(2,Math.min(30,Number(req.body.joinThreshold)||6)),windowSeconds:Math.max(5,Math.min(120,Number(req.body.windowSeconds)||12)),minAccountAgeDays:Math.max(0,Math.min(365,Number(req.body.minAccountAgeDays)||0)),autoLockdown:true};
  await db('bww_guild_settings?on_conflict=guild_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({guild_id:g,settings,updated_by:req.dashboardSession.user_id,updated_at:new Date().toISOString()})});
  res.redirect('/raid');
});

app.get('/embeds',requireSession,async(req,res)=>{
  const g=req.dashboardSession.guild_id,records=await db('bww_embed_messages?select=id,message_id,payload,updated_at&guild_id=eq.'+g+'&order=updated_at.desc&limit=50',{headers:{Prefer:'return=representation'}});
  const rows=records.map(r=>[escapeHtml(r.payload?.title||'Ohne Titel'),'<code>'+escapeHtml(r.message_id)+'</code>',escapeHtml(new Date(r.updated_at).toLocaleString('de-DE')),form('/embeds/edit',field('Embed-ID','id',r.id,'hidden')+field('Titel','title',r.payload?.title||'')+textarea('Text','description',r.payload?.description||'')+field('Bild-URL','image',r.payload?.image||'')+button('Änderungen einreihen'))]);
  const body=card('Neues Components-V2-Embed',form('/embeds/send',field('Kanal-ID','channel_id','','text',true)+field('Titel','title')+textarea('Text','description','',true)+field('Bild-URL','image')+field('Farbe (HEX)','color','#2F3136')+button('Embed senden'),'form-grid'))+card('Gespeicherte Embeds',table(['Titel','Nachrichten-ID','Aktualisiert','Bearbeiten'],rows));
  res.send(page('Embeds',body,req.dashboardSession));
});
app.post('/embeds/send',requireSession,async(req,res)=>{
  const embed={title:String(req.body.title||'').slice(0,256),description:String(req.body.description||'').slice(0,4000),image:String(req.body.image||'').slice(0,1000),color:String(req.body.color||'#2F3136')};
  if(!req.body.channel_id||!embed.description)return res.status(400).send('Kanal-ID und Text sind erforderlich.');
  await queueAction(req,'embed_send',{channel_id:String(req.body.channel_id),embed});
  res.redirect('/embeds');
});
app.post('/embeds/edit',requireSession,async(req,res)=>{
  const id=String(req.body.id||''),embed={title:String(req.body.title||'').slice(0,256),description:String(req.body.description||'').slice(0,4000),image:String(req.body.image||'').slice(0,1000)};
  const exists=await db('bww_embed_messages?select=id&guild_id=eq.'+req.dashboardSession.guild_id+'&id=eq.'+id+'&limit=1',{headers:{Prefer:'return=representation'}});
  if(!exists.length)return res.status(404).send('Embed nicht gefunden.');
  await queueAction(req,'embed_edit',{id,embed});
  res.redirect('/embeds');
});

app.get('/dm',requireSession,async(req,res)=>{const threads=await db('bww_dm_threads?select=id,requester_id,recipient_id,status,last_message_at,created_at&guild_id=eq.'+req.dashboardSession.guild_id+'&status=eq.open&order=last_message_at.desc&limit=50',{headers:{Prefer:'return=representation'}});const rows=threads.map(t=>[escapeHtml(t.requester_id),escapeHtml(t.recipient_id),escapeHtml(new Date(t.last_message_at).toLocaleString('de-DE')),form('/dm/close',field('Dialog-ID','id',t.id,'hidden')+button('Dialog schließen','danger'))]);const body=card('Nachricht über den Bot senden',form('/dm/send',field('Discord User-ID','user_id','','text',true)+textarea('Nachricht','content','',true)+button('DM senden'))+'<p class="muted">Antworten des Empfängers werden an den Mitarbeiter weitergeleitet, der den Dialog gestartet hat.</p>')+card('Offene DM-Dialoge',table(['Mitarbeiter','Empfänger','Letzte Nachricht','Aktion'],rows));res.send(page('DM-System',body,req.dashboardSession));});
app.post('/dm/close',requireSession,async(req,res)=>{
  const id=String(req.body.id||'');
  await db('bww_dm_threads?id=eq.'+id+'&guild_id=eq.'+req.dashboardSession.guild_id+'&status=eq.open',{method:'PATCH',body:JSON.stringify({status:'closed',closed_at:new Date().toISOString()})});
  res.redirect('/dm');
});
app.post('/dm/send',requireSession,async(req,res)=>{
  const userId=String(req.body.user_id||''),content=String(req.body.content||'').trim().slice(0,1800);
  if(!/^\d{15,22}$/.test(userId)||!content)return res.status(400).send('Nutzer-ID oder Nachricht ungültig.');
  await queueAction(req,'dm_thread',{user_id:userId,content});
  res.redirect('/dm');
});
app.get('/tickets',requireSession,async(req,res)=>{
  const rows=await db('bww_tickets?select=id,owner_id,reason,status,priority,claimed_by,created_at,updated_at&guild_id=eq.'+req.dashboardSession.guild_id+'&order=created_at.desc&limit=100',{headers:{Prefer:'return=representation'}});
  const body=card('Ticketübersicht',table(['Ticket-ID','Ersteller','Grund','Status','Priorität','Bearbeiter','Erstellt'],rows.map(t=>[escapeHtml(t.id),escapeHtml(t.owner_id),escapeHtml(t.reason),escapeHtml(t.status),escapeHtml(t.priority),escapeHtml(t.claimed_by||'—'),escapeHtml(new Date(t.created_at).toLocaleString('de-DE'))])));
  res.send(page('Tickets',body,req.dashboardSession));
});
app.get('/giveaways',requireSession,async(req,res)=>{
  const rows=await db('bww_giveaways?select=id,prize,status,winner_count,end_at,current_winners,created_at&guild_id=eq.'+req.dashboardSession.guild_id+'&order=created_at.desc&limit=100',{headers:{Prefer:'return=representation'}});
  const body=card('Giveaway-Verwaltung',table(['Preis','Status','Gewinner','Ende','Aktuelle Gewinner'],rows.map(g=>[escapeHtml(g.prize),escapeHtml(g.status),escapeHtml(g.winner_count),escapeHtml(g.end_at?new Date(g.end_at).toLocaleString('de-DE'):'—'),escapeHtml(JSON.stringify(g.current_winners||[]))])));
  res.send(page('Giveaways',body,req.dashboardSession));
});
app.get('/einstellungen',requireSession,async(req,res)=>{
  const settings=await getSettings(req.dashboardSession.guild_id);
  const body=card('Server-Einstellungen', '<p class="muted">Zentrale Konfiguration aus bww_guild_settings. Die sicherheitsrelevanten Bereiche werden in den jeweiligen Verwaltungsseiten geändert.</p><pre class="settings-json">'+escapeHtml(JSON.stringify(settings,null,2))+'</pre>');
  res.send(page('Einstellungen',body,req.dashboardSession));
});

app.get('/protokoll',requireSession,async(req,res)=>{
  const g=req.dashboardSession.guild_id;
  const [actions,personnel,raid]=await Promise.all([
    db('bww_dashboard_actions?select=action,status,error,created_by,created_at,processed_at&guild_id=eq.'+g+'&order=created_at.desc&limit=50',{headers:{Prefer:'return=representation'}}),
    db('bww_personalakte_events?select=user_id,actor_id,event_type,new_value,created_at&guild_id=eq.'+g+'&order=created_at.desc&limit=50',{headers:{Prefer:'return=representation'}}),
    db('bww_raid_events?select=user_id,event_type,created_at&guild_id=eq.'+g+'&order=created_at.desc&limit=50',{headers:{Prefer:'return=representation'}})
  ]);
  const rows=[...actions.map(a=>[new Date(a.created_at).toLocaleString('de-DE'),'Dashboard: '+a.action,a.status,a.error||'—']),...personnel.map(e=>[new Date(e.created_at).toLocaleString('de-DE'),'Personalakte: '+e.event_type,e.user_id,e.new_value||'—']),...raid.map(e=>[new Date(e.created_at).toLocaleString('de-DE'),'Raid: '+e.event_type,e.user_id||'—','—'])].sort((a,b)=>new Date(b[0].split('.').reverse().join('-'))-new Date(a[0].split('.').reverse().join('-'))).slice(0,100);
  res.send(page('Protokoll',card('Letzte Aktionen',table(['Zeit','Aktion','Status / Nutzer','Details'],rows.map(r=>r.map(escapeHtml)))),req.dashboardSession));
});

app.use((error,req,res,_next)=>{console.error('[BWW Dashboard]',error.stack||error.message);res.status(500).send('Interner Dashboard-Fehler.');});
module.exports = app;
if (require.main === module) {
  const port=Number(process.env.PORT)||3000;
  app.listen(port,()=>console.log('[BWW Dashboard] Lauscht auf Port '+port));
}
