const { PermissionFlagsBits } = require('discord.js');
const { supabaseRequest } = require('./database');

const joinWindows = new Map();
const DEFAULTS = Object.freeze({ enabled: false, joinThreshold: 6, windowSeconds: 12, minAccountAgeDays: 0, autoLockdown: true });

async function getRaidSettings(guildId) {
  const { getGuildSettings } = require('./database');
  const settings = await getGuildSettings(guildId);
  return { ...DEFAULTS, ...(settings.raidProtection || {}) };
}
async function saveRaidSettings(guildId, raidProtection, actorId) {
  const { patchGuildSettings } = require('./database');
  return patchGuildSettings(guildId, { raidProtection }, actorId);
}
async function recordRaidEvent(guildId, userId, eventType, details = {}) {
  await supabaseRequest('bww_raid_events', { method: 'POST', body: JSON.stringify({ guild_id: guildId, user_id: userId || null, event_type: eventType, details }) });
}
async function lockdownGuild(guild, actorId, reason = 'Automatische Raid-Erkennung') {
  const { data: existing } = await (await supabaseRequest('bww_raid_lockdowns?select=id&guild_id=eq.' + guild.id + '&restored_at=is.null&limit=1', { headers: { Prefer: 'return=representation' } })).json().then(data => ({ data }));
  if (existing?.length) return existing[0].id;
  const response = await supabaseRequest('bww_raid_lockdowns', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ guild_id: guild.id, reason: String(reason).slice(0, 500), created_by: actorId || null }) });
  const [lockdown] = await response.json();
  if (!lockdown?.id) throw new Error('Lockdown konnte nicht gespeichert werden.');
  const everyone = guild.roles.everyone;
  for (const channel of guild.channels.cache.values()) {
    if (!channel.isTextBased?.() || !channel.permissionOverwrites?.edit) continue;
    const previous = channel.permissionOverwrites.cache.get(everyone.id);
    const fields = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads'];
    const snapshot = Object.fromEntries(fields.map((field) => [field, previous?.allow?.has(PermissionFlagsBits[field]) ? true : previous?.deny?.has(PermissionFlagsBits[field]) ? false : null]));
    await supabaseRequest('bww_raid_lockdown_channels', { method: 'POST', body: JSON.stringify({ lockdown_id: lockdown.id, guild_id: guild.id, channel_id: channel.id, had_overwrite: Boolean(previous), send_messages: snapshot.SendMessages, send_messages_in_threads: snapshot.SendMessagesInThreads, create_public_threads: snapshot.CreatePublicThreads }) });
    await channel.permissionOverwrites.edit(everyone, { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false }, { reason }).catch((error) => console.warn('[BWW Raid] Kanal konnte nicht gesperrt werden:', channel.id, error.message));
  }
  await recordRaidEvent(guild.id, null, 'lockdown_started', { lockdownId: lockdown.id, reason });
  return lockdown.id;
}
async function restoreGuild(guild, actorId) {
  const response = await supabaseRequest('bww_raid_lockdowns?select=id&guild_id=eq.' + guild.id + '&restored_at=is.null&order=created_at.desc&limit=1', { headers: { Prefer: 'return=representation' } });
  const [lockdown] = await response.json();
  if (!lockdown) return false;
  const channelsResponse = await supabaseRequest('bww_raid_lockdown_channels?select=*&lockdown_id=eq.' + lockdown.id + '&restored_at=is.null', { headers: { Prefer: 'return=representation' } });
  const snapshots = await channelsResponse.json();
  for (const snapshot of snapshots) {
    const channel = await guild.channels.fetch(snapshot.channel_id).catch(() => null);
    if (!channel?.permissionOverwrites) continue;
    const previous = {
      SendMessages: snapshot.send_messages,
      SendMessagesInThreads: snapshot.send_messages_in_threads,
      CreatePublicThreads: snapshot.create_public_threads
    };
    if (!snapshot.had_overwrite && Object.values(previous).every((value) => value === null)) {
      await channel.permissionOverwrites.delete(guild.roles.everyone, 'BWW Raid-Lockdown aufgehoben').catch(() => {});
    } else {
      await channel.permissionOverwrites.edit(guild.roles.everyone, previous, { reason: 'BWW Raid-Lockdown aufgehoben' }).catch(() => {});
    }
    await supabaseRequest('bww_raid_lockdown_channels?id=eq.' + snapshot.id, { method: 'PATCH', body: JSON.stringify({ restored_at: new Date().toISOString() }) });
  }
  await supabaseRequest('bww_raid_lockdowns?id=eq.' + lockdown.id, { method: 'PATCH', body: JSON.stringify({ restored_at: new Date().toISOString() }) });
  await recordRaidEvent(guild.id, null, 'lockdown_restored', { lockdownId: lockdown.id, actorId });
  return true;
}
async function handleMemberJoin(member, client) {
  const config = await getRaidSettings(member.guild.id).catch(() => DEFAULTS);
  if (!config.enabled) return;
  const now = Date.now();
  const cutoff = now - Math.max(1, Number(config.windowSeconds) || 12) * 1000;
  const joins = (joinWindows.get(member.guild.id) || []).filter((time) => time >= cutoff);
  joins.push(now);
  joinWindows.set(member.guild.id, joins);
  const accountAgeDays = (now - member.user.createdTimestamp) / 86400000;
  const suspiciousAge = Number(config.minAccountAgeDays) > 0 && accountAgeDays < Number(config.minAccountAgeDays);
  await recordRaidEvent(member.guild.id, member.id, 'member_join', { accountAgeDays: Math.floor(accountAgeDays), joinsInWindow: joins.length });
  if (config.autoLockdown && (joins.length >= Math.max(2, Number(config.joinThreshold) || 6) || suspiciousAge)) {
    const reason = suspiciousAge ? 'Raid-Schutz: Konto zu neu' : 'Raid-Schutz: ungewöhnlich viele Beitritte';
    await lockdownGuild(member.guild, client.user?.id, reason);
  }
}
module.exports = { DEFAULTS, getRaidSettings, saveRaidSettings, lockdownGuild, restoreGuild, handleMemberJoin, recordRaidEvent };
