const { supabaseRequest } = require('./database');
const { MessageFlags } = require('discord.js');

async function openDmThread(guildId, requesterId, recipient, firstMessage) {
  const active = await supabaseRequest('bww_dm_threads?select=id&recipient_id=eq.' + recipient.id + '&status=eq.open&limit=1', { headers: { Prefer: 'return=representation' } });
  if ((await active.json()).length) throw new Error('Für diesen Nutzer existiert bereits ein offener DM-Dialog.');
  const response = await supabaseRequest('bww_dm_threads', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ guild_id: guildId, requester_id: requesterId, recipient_id: recipient.id }) });
  const [thread] = await response.json();
  if (!thread?.id) throw new Error('DM-Dialog konnte nicht gespeichert werden.');
  try {
    await recipient.send({ content: '📨 **Nachricht vom BWW-Team**\n\n' + String(firstMessage).slice(0, 1800) + '\n\nDu kannst direkt auf diese Nachricht antworten. Deine Antwort wird an den zuständigen Mitarbeiter weitergeleitet.', allowedMentions: { parse: [] } });
  } catch (error) {
    await supabaseRequest('bww_dm_threads?id=eq.' + thread.id, { method: 'PATCH', body: JSON.stringify({ status: 'closed', closed_at: new Date().toISOString() }) });
    throw new Error('Die DM konnte nicht zugestellt werden. Der Nutzer hat möglicherweise Direktnachrichten deaktiviert.');
  }
  return thread.id;
}
async function relayDmReply(message, client) {
  if (!message || message.author?.bot || message.guild) return false;
  const response = await supabaseRequest('bww_dm_threads?select=*&status=eq.open&or=(requester_id.eq.' + message.author.id + ',recipient_id.eq.' + message.author.id + ')&order=created_at.desc&limit=1', { headers: { Prefer: 'return=representation' } });
  const [thread] = await response.json();
  if (!thread) return false;
  const targetId = message.author.id === thread.recipient_id ? thread.requester_id : thread.recipient_id;
  const target = await client.users.fetch(targetId).catch(() => null);
  if (!target) return false;
  const direction = message.author.id === thread.recipient_id ? 'Antwort des Empfängers' : 'Nachricht des Mitarbeiters';
  await target.send({ content: '📩 **' + direction + '**\n\n' + String(message.content || '').slice(0, 1800), allowedMentions: { parse: [] } });
  await supabaseRequest('bww_dm_threads?id=eq.' + thread.id, { method: 'PATCH', body: JSON.stringify({ last_message_at: new Date().toISOString() }) });
  return true;
}
async function closeDmThread(guildId, threadId) {
  await supabaseRequest('bww_dm_threads?id=eq.' + threadId + '&guild_id=eq.' + guildId + '&status=eq.open', { method: 'PATCH', body: JSON.stringify({ status: 'closed', closed_at: new Date().toISOString() }) });
}
module.exports = { openDmThread, relayDmReply, closeDmThread };
