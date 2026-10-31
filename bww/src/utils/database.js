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
  permissions: {}
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
    recurringMessages: Array.isArray(parsed.recurringMessages) ? parsed.recurringMessages : [],
    robloxLinks: parsed.robloxLinks && typeof parsed.robloxLinks === 'object' && !Array.isArray(parsed.robloxLinks) ? parsed.robloxLinks : {}
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
    permissions: { ...current.permissions, ...(patch?.permissions || {}) },
    robloxLinks: { ...current.robloxLinks, ...(patch?.robloxLinks || {}) }
  });
  return saveGuildSettings(guildId, next, updatedBy);
}

module.exports = {
  DEFAULT_SETTINGS,
  isConfigured,
  getGuildSettings,
  saveGuildSettings,
  patchGuildSettings,
};
