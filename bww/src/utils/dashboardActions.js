const crypto = require('node:crypto');
const { supabaseRequest } = require('./database');
const { embedV2 } = require('./embeds');
const { lockdownGuild, restoreGuild } = require('./raidProtection');
const { openDmThread } = require('./dmRelay');

function hashCode(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
async function issueDashboardCode(guildId, userId) {
  const code = crypto.randomBytes(6).toString('hex').toUpperCase();
  const codeHash = hashCode(code);
  await supabaseRequest('bww_dashboard_logins', { method: 'POST', body: JSON.stringify({ guild_id: guildId, code_hash: codeHash, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), created_by: userId }) });
  return code;
}
async function processAction(client, action) {
  const p = action.payload || {};
  const guild = await client.guilds.fetch(action.guild_id);
  switch (action.action) {
    case 'send_message': {
      const channel = await guild.channels.fetch(p.channel_id);
      await channel.send({ content: String(p.content || '').slice(0, 1900), allowedMentions: { parse: [] } });
      return;
    }
    case 'embed_send': {
      const channel = await guild.channels.fetch(p.channel_id);
      const payload = p.embed || {};
      const message = await channel.send({ components: [embedV2(payload)], flags: 32768, allowedMentions: { parse: [] } });
      await supabaseRequest('bww_embed_messages', { method: 'POST', body: JSON.stringify({ guild_id: guild.id, channel_id: channel.id, message_id: message.id, payload, created_by: action.created_by }) });
      return;
    }
    case 'embed_edit': {
      const response = await supabaseRequest('bww_embed_messages?select=*&guild_id=eq.' + guild.id + '&id=eq.' + p.id + '&limit=1', { headers: { Prefer: 'return=representation' } });
      const [record] = await response.json();
      if (!record) throw new Error('Embed nicht gefunden.');
      const channel = await guild.channels.fetch(record.channel_id);
      const message = await channel.messages.fetch(record.message_id);
      const payload = { ...record.payload, ...(p.embed || {}) };
      await message.edit({ components: [embedV2(payload)], flags: 32768, allowedMentions: { parse: [] } });
      await supabaseRequest('bww_embed_messages?id=eq.' + record.id, { method: 'PATCH', body: JSON.stringify({ payload, updated_by: action.created_by, updated_at: new Date().toISOString() }) });
      return;
    }
    case 'raid_lockdown':
      await lockdownGuild(guild, action.created_by, p.reason || 'Dashboard-Lockdown');
      return;
    case 'raid_restore':
      if (!await restoreGuild(guild, action.created_by)) throw new Error('Kein aktiver Lockdown gefunden.');
      return;
    case 'dm_thread': {
      const user = await client.users.fetch(p.user_id);
      await openDmThread(guild.id, action.created_by, user, p.content);
      return;
    }
    case 'dm_send': {
      const user = await client.users.fetch(p.user_id);
      await user.send({ content: String(p.content || '').slice(0, 1800), allowedMentions: { parse: [] } });
      return;
    }
    default:
      throw new Error('Unbekannte Dashboard-Aktion: ' + action.action);
  }
}
async function processDashboardActions(client) {
  const response = await supabaseRequest('bww_dashboard_actions?select=*&status=eq.pending&order=created_at.asc&limit=10', { headers: { Prefer: 'return=representation' } });
  if (!response) return;
  const actions = await response.json();
  for (const action of actions) {
    const claim = await supabaseRequest('bww_dashboard_actions?id=eq.' + action.id + '&status=eq.pending', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'processing' }) });
    if (!(await claim.json()).length) continue;
    try {
      await processAction(client, action);
      await supabaseRequest('bww_dashboard_actions?id=eq.' + action.id, { method: 'PATCH', body: JSON.stringify({ status: 'completed', processed_at: new Date().toISOString(), error: null }) });
    } catch (error) {
      await supabaseRequest('bww_dashboard_actions?id=eq.' + action.id, { method: 'PATCH', body: JSON.stringify({ status: 'failed', processed_at: new Date().toISOString(), error: String(error.message).slice(0, 1000) }) }).catch(() => {});
    }
  }
}
module.exports = { issueDashboardCode, processDashboardActions, hashCode };
