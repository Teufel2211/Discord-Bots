const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || '';

const DEFAULT_SETTINGS = Object.freeze({
  welcome: {
    enabled: false,
    channelId: '',
    title: '',
    message: 'Willkommen {user} auf dem Server! 🎉'
  },
  verify: {
    enabled: false,
    channelId: '',
    message: 'Klicke auf den Button, um dich zu verifizieren.',
    roleId: ''
  },
  ticket: {
    enabled: false,
    categoryId: '',
    roleId: ''
  },
  status: {
    enabled: false,
    channelId: '',
    messageId: '',
    mode: 'online'
  },
  permissions: {},
  raidProtection: { enabled: false, joinThreshold: 6, windowSeconds: 12, minAccountAgeDays: 0, autoLockdown: true },
  unitRoster: { channelId: '', messageId: '' },
  selfRoles: { panels: {} }
});

const settingsCache = new Map();

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function mergeSettings(value) {
  const parsed = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    welcome: { ...DEFAULT_SETTINGS.welcome, ...(parsed.welcome || {}) },
    verify: { ...DEFAULT_SETTINGS.verify, ...(parsed.verify || {}) },
    ticket: { ...DEFAULT_SETTINGS.ticket, ...(parsed.ticket || {}) },
    status: { ...DEFAULT_SETTINGS.status, ...(parsed.status || {}) },
    permissions: parsed.permissions && typeof parsed.permissions === 'object' && !Array.isArray(parsed.permissions)
      ? Object.fromEntries(Object.entries(parsed.permissions).map(([key, roles]) => [
          key,
          Array.isArray(roles) ? roles.filter((id) => typeof id === 'string') : []
        ]))
      : {},
    raidProtection: { ...DEFAULT_SETTINGS.raidProtection, ...(parsed.raidProtection || {}) },
    unitRoster: parsed.unitRoster && typeof parsed.unitRoster === 'object' ? { channelId: String(parsed.unitRoster.channelId || ''), messageId: String(parsed.unitRoster.messageId || '') } : { channelId: '', messageId: '' },
    selfRoles: { panels: parsed.selfRoles?.panels && typeof parsed.selfRoles.panels === 'object' && !Array.isArray(parsed.selfRoles.panels) ? parsed.selfRoles.panels : {} },
    recurringMessages: Array.isArray(parsed.recurringMessages) ? parsed.recurringMessages : []
  };
}

async function supabaseRequest(path, options = {}) {
  if (!isConfigured()) return null;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(`Supabase HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response;
}

async function getGuildSettings(guildId) {
  if (!guildId) return cloneDefaults();
  const cached = settingsCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.settings;

  if (!isConfigured()) return cloneDefaults();

  const response = await supabaseRequest(
    `bww_guild_settings?select=settings&guild_id=eq.${encodeURIComponent(guildId)}&limit=1`,
    { headers: { Prefer: 'return=representation' } }
  );
  const rows = response ? await response.json() : [];
  const settings = mergeSettings(rows?.[0]?.settings);
  settingsCache.set(guildId, { settings, expiresAt: Date.now() + 5000 });
  return settings;
}

async function saveGuildSettings(guildId, settings, updatedBy = null) {
  if (!guildId) throw new Error('guildId fehlt.');
  if (!isConfigured()) throw new Error('Supabase ist nicht konfiguriert.');

  const normalized = mergeSettings(settings);
  await supabaseRequest('bww_guild_settings?on_conflict=guild_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      guild_id: guildId,
      settings: normalized,
      updated_by: updatedBy ? String(updatedBy).slice(0, 100) : null,
      updated_at: new Date().toISOString()
    })
  });

  settingsCache.set(guildId, { settings: normalized, expiresAt: Date.now() + 5000 });
  return normalized;
}

async function patchGuildSettings(guildId, patch, updatedBy = null) {
  const current = await getGuildSettings(guildId);
  const next = mergeSettings({
    ...current,
    ...patch,
    welcome: { ...current.welcome, ...(patch?.welcome || {}) },
    verify: { ...current.verify, ...(patch?.verify || {}) },
    ticket: { ...current.ticket, ...(patch?.ticket || {}) },
    status: { ...current.status, ...(patch?.status || {}) },
    permissions: { ...current.permissions, ...(patch?.permissions || {}) }
  });
  return saveGuildSettings(guildId, next, updatedBy);
}


async function syncBotStatus(client, status = 'online') {
  if (!isConfigured()) return;
  const memberCount = client.guilds.cache.reduce((sum, guild) => sum + Number(guild.memberCount || 0), 0);
  await supabaseRequest('bww_bot_status?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: 'primary',
      bot_user_id: client.user?.id || null,
      bot_tag: client.user?.tag || null,
      guild_count: client.guilds.cache.size,
      member_count: memberCount,
      ping_ms: Number.isFinite(client.ws.ping) ? Math.round(client.ws.ping) : null,
      uptime_seconds: Math.floor((client.uptime || 0) / 1000),
      status,
      updated_at: new Date().toISOString()
    })
  });
}
async function syncGuilds(client) {
  if (!isConfigured()) return;
  for (const guild of client.guilds.cache.values()) {
    await supabaseRequest('bww_guilds?on_conflict=guild_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        guild_id: guild.id,
        name: guild.name,
        member_count: Number(guild.memberCount || 0),
        icon_url: guild.iconURL({ size: 128 }) || null,
        updated_at: new Date().toISOString()
      })
    });
  }
}
async function markOffline(client) {
  if (!isConfigured()) return;
  await supabaseRequest('bww_bot_status?id=eq.primary', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'offline', updated_at: new Date().toISOString(), uptime_seconds: Math.floor((client.uptime || 0) / 1000) })
  });
}

module.exports = {
  DEFAULT_SETTINGS,
  isConfigured,
  getGuildSettings,
  saveGuildSettings,
  patchGuildSettings,
  supabaseRequest,
  syncBotStatus,
  syncGuilds,
  markOffline,
};
