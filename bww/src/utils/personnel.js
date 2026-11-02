const { supabaseRequest } = require('./database');
const { listUnits } = require('./units');
const activityCheckAt = new Map();

async function getRecord(guildId, userId) {
  const response = await supabaseRequest('bww_personalakten?select=*&guild_id=eq.' + guildId + '&user_id=eq.' + userId + '&limit=1', { headers: { Prefer: 'return=representation' } });
  return (await response.json())[0] || null;
}
async function ensureRecord(guildId, userId, actorId) {
  let record = await getRecord(guildId, userId);
  if (record) return record;
  const response = await supabaseRequest('bww_personalakten', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ guild_id: guildId, user_id: userId, created_by: actorId, updated_by: actorId }) });
  [record] = await response.json();
  await addEvent(guildId, userId, actorId, 'created', null, 'Rekrut', {});
  return record;
}
async function addEvent(guildId, userId, actorId, eventType, oldValue, newValue, details = {}) {
  await supabaseRequest('bww_personalakte_events', { method: 'POST', body: JSON.stringify({ guild_id: guildId, user_id: userId, actor_id: actorId, event_type: eventType, old_value: oldValue, new_value: newValue, details }) });
}
async function updateRecord(guildId, userId, actorId, patch) {
  const current = await ensureRecord(guildId, userId, actorId);
  await supabaseRequest('bww_personalakten?guild_id=eq.' + guildId + '&user_id=eq.' + userId, { method: 'PATCH', body: JSON.stringify({ ...patch, updated_by: actorId, updated_at: new Date().toISOString() }) });
  return { ...current, ...patch };
}
async function getEvents(guildId, userId) {
  const response = await supabaseRequest('bww_personalakte_events?select=*&guild_id=eq.' + guildId + '&user_id=eq.' + userId + '&order=created_at.desc&limit=50', { headers: { Prefer: 'return=representation' } });
  return response.json();
}

async function recordMessageActivity(guildId, userId) {
  const key = guildId + ':' + userId;
  const now = Date.now();
  if (now - (activityCheckAt.get(key) || 0) < 30 * 60 * 1000) return false;
  activityCheckAt.set(key, now);
  const record = await getRecord(guildId, userId);
  if (!record) return false;
  const last = record.last_activity_at ? new Date(record.last_activity_at).getTime() : 0;
  if (now - last < 30 * 60 * 1000) return false;
  const timestamp = new Date(now).toISOString();
  await supabaseRequest('bww_personalakten?guild_id=eq.' + guildId + '&user_id=eq.' + userId, {
    method: 'PATCH',
    body: JSON.stringify({ last_activity_at: timestamp, updated_at: timestamp })
  });
  await addEvent(guildId, userId, null, 'activity', null, 'Serveraktivität erfasst', { source: 'discord_message', timestamp });
  return true;
}

async function getUnitName(unitId, guildId) {
  if (!unitId) return 'Keine Einheit';
  const units = await listUnits(guildId);
  return units.find((unit) => unit.id === unitId)?.name || 'Unbekannte Einheit';
}
module.exports = { getRecord, ensureRecord, updateRecord, addEvent, getEvents, getUnitName, recordMessageActivity };
