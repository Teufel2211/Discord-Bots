const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { supabaseRequest } = require('./database');
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

const file = path.join(__dirname, '..', '..', 'config', 'giveaways.json');

function loadGiveaways() { try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(value) ? value : []; } catch { return []; } }
function saveGiveaways(list) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, file);
  return list;
}

function giveawayContainer(g) {
  const container = new ContainerBuilder().setAccentColor(g.active ? 0x2F3136 : 0x5865F2);
  const lines = [`## ${g.active ? '🎉 Giveaway' : '🎉 Giveaway beendet'}`, `**Preis:** ${g.prize}`, `**Gewinner:** ${g.winners}`, `**Teilnehmer:** ${g.entries.length}`];
  if (g.conditions) lines.push(`**Teilnahmebedingungen:** ${g.conditions}`);
  if (g.requiredRoleId) lines.push(`**Erforderliche Rolle:** <@&${g.requiredRoleId}>`);
  if (g.minAccountAgeDays) lines.push(`**Mindest-Kontoalter:** ${g.minAccountAgeDays} Tage`);
  if (g.minServerAgeDays) lines.push(`**Mindest-Serverzeit:** ${g.minServerAgeDays} Tage`);
  if (g.bonusRoleId && g.bonusEntries) lines.push(`**Bonus:** <@&${g.bonusRoleId}> erhält ${g.bonusEntries} zusätzliche Lose`);
  if (g.active) lines.push(`**Endet:** <t:${Math.round(g.endTime / 1000)}:R>`);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  if (g.active) {
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bww_giveaway_join_${g.id}`).setLabel('🎉 Teilnehmen').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`bww_giveaway_leave_${g.id}`).setLabel('❌ Verlassen').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`bww_giveaway_end_${g.id}`).setLabel('⏹️ Beenden').setStyle(ButtonStyle.Secondary));
    container.addActionRowComponents(row);
  } else {
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bww_giveaway_reroll_${g.id}`).setLabel('🔁 Neu ziehen').setStyle(ButtonStyle.Primary));
    container.addActionRowComponents(row);
  }
  return container;
}
function giveawayMessage(g) { return giveawayContainer(g); }

async function startGiveaway(channel, prize, durationMs, winners, options = {}) {
  const safeDuration = Math.max(5000, Number(durationMs) || 60000);
  const safeWinners = Math.max(1, Number(winners) || 1);
  const safePrize = String(prize).slice(0, 256).trim() || 'Preis';
  const id = `${Date.now()}_${crypto.randomUUID()}`;
  const g = { id, prize: safePrize, winners: safeWinners, endTime: Date.now() + safeDuration, entries: [], channelId: channel.id, guildId: options.guildId || channel.guildId || channel.guild?.id || '', createdBy: options.createdBy || '', active: true, conditions: String(options.conditions || '').slice(0, 1000), requiredRoleId: options.requiredRoleId || '', minAccountAgeDays: Math.max(0, Number(options.minAccountAgeDays) || 0), minServerAgeDays: Math.max(0, Number(options.minServerAgeDays) || 0), bonusRoleId: options.bonusRoleId || '', bonusEntries: Math.max(0, Math.min(20, Number(options.bonusEntries) || 0)) };
  let sent;
  try { sent = await channel.send({ components: [giveawayContainer(g)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }); } catch (err) { throw new Error(`Giveaway-Nachricht konnte nicht gesendet werden: ${err.message}`); }
  g.messageId = sent.id;
  const list = loadGiveaways(); list.push(g); saveGiveaways(list);
  await syncGiveawayRecord(g);
  await recordGiveawayEvent(g, g.createdBy, 'created', { prize: g.prize, winnerCount: g.winners, conditions: g.conditions, requiredRoleId: g.requiredRoleId, minAccountAgeDays: g.minAccountAgeDays, minServerAgeDays: g.minServerAgeDays, bonusRoleId: g.bonusRoleId, bonusEntries: g.bonusEntries });
  return g;
}

function drawWinners(g, excluded = []) {
  const blocked = new Set(excluded);
  const pool = [...new Set(g.entries)].filter(id => !blocked.has(id));
  const drawn = [];
  while (pool.length && drawn.length < g.winners) {
    const idx = crypto.randomInt(pool.length);
    drawn.push(pool.splice(idx, 1)[0]);
  }
  return drawn;
}

async function updateGiveawayMessage(client, g) {
  try {
    const channel = client.channels.cache.get(g.channelId) || await client.channels.fetch(g.channelId).catch(() => null);
    if (!channel) return;
    const msg = await channel.messages.fetch(g.messageId).catch(() => null);
    if (msg) await msg.edit({ components: [giveawayContainer(g)], flags: MessageFlags.IsComponentsV2 });
  } catch {}
}

async function finalizeGiveaway(client, g) {
  const list = loadGiveaways();
  const stored = list.find(x => x.id === g.id);
  const target = stored || g;
  if (!target.active) return target.winnersDrawn || [];
  target.active = false;
  const winners = drawWinners(target);
  target.winnersDrawn = winners;
  target.winnerHistory = [...new Set([...(target.winnerHistory || []), ...winners])];
  target.endedAt = Date.now();
  saveGiveaways(list.map(x => (x.id === target.id ? target : x)));
  await recordDraw(target, winners, 'initial');
  await recordGiveawayEvent(target, target.createdBy, 'ended', { winners, participantCount: target.entries.length });
  const container = new ContainerBuilder().setAccentColor(0x5865F2);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🎉 Giveaway beendet\n**Preis:** ${target.prize}\n**Gewinner:** ${winners.length ? winners.map(id => `<@${id}>`).join(', ') : 'Keine Teilnehmer 😔'}`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Beendet <t:${Math.floor(Date.now() / 1000)}:F>`));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bww_giveaway_reroll_${target.id}`).setLabel('🔁 Neu ziehen').setStyle(ButtonStyle.Primary)));
  try {
    const channel = client.channels.cache.get(target.channelId) || await client.channels.fetch(target.channelId).catch(() => null);
    if (channel) { const msg = await channel.messages.fetch(target.messageId).catch(() => null); if (msg) await msg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }); }
  } catch {}
  return winners;
}

async function rerollGiveaway(client, id) {
  const list = loadGiveaways();
  const g = list.find(x => x.id === id && !x.active);
  if (!g) return { ok: false, error: 'Giveaway nicht gefunden oder noch aktiv.' };
  const winners = drawWinners(g, g.winnerHistory || g.winnersDrawn || []);
  g.winnersDrawn = winners;
  g.winnerHistory = [...new Set([...(g.winnerHistory || []), ...winners])];
  await recordDraw(g, winners, 'reroll');
  await recordGiveawayEvent(g, null, 'reroll', { winners, participantCount: g.entries.length });
  const container = new ContainerBuilder().setAccentColor(0x5865F2);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🔁 Giveaway Reroll\n**Preis:** ${g.prize}\n**Neue Gewinner:** ${winners.length ? winners.map(uid => `<@${uid}>`).join(', ') : 'Keine Teilnehmer übrig 😔'}`));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bww_giveaway_reroll_${g.id}`).setLabel('🔁 Neu ziehen').setStyle(ButtonStyle.Primary)));
  try {
    const channel = client.channels.cache.get(g.channelId) || await client.channels.fetch(g.channelId).catch(() => null);
    if (channel) { const msg = await channel.messages.fetch(g.messageId).catch(() => null); if (msg) await msg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }); }
  } catch {}
  saveGiveaways(list);
  return { ok: true, winners };
}


async function syncGiveawayRecord(g) {
  if (!g.guildId) return;
  await supabaseRequest('bww_giveaways?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: g.id, guild_id: g.guildId, channel_id: g.channelId, message_id: g.messageId || null,
      prize: g.prize, winner_count: g.winners, end_at: new Date(g.endTime).toISOString(),
      status: g.active ? 'active' : 'ended', created_by: g.createdBy || null,
      current_winners: g.winnersDrawn || [], winner_history: g.winnerHistory || [],
      required_role_id: g.requiredRoleId || null, min_account_age_days: g.minAccountAgeDays || 0,
      min_server_age_days: g.minServerAgeDays || 0, bonus_entries: g.bonusEntries || 0,
      bonus_role_id: g.bonusRoleId || null, entry_count: (g.entries || []).length, conditions: g.conditions || ''
    })
  });
}
async function recordGiveawayEvent(g, actorId, eventType, details = {}) {
  if (!g.guildId) return;
  await supabaseRequest('bww_giveaway_audit_events', {
    method: 'POST',
    body: JSON.stringify({ giveaway_id: g.id, guild_id: g.guildId, actor_id: actorId || null, event_type: eventType, details })
  });
}
async function recordGiveawayEntry(g, userId, action, entryCount = 1) {
  if (!g.guildId) return;
  if (action === 'join') {
    await supabaseRequest('bww_giveaway_entries?on_conflict=giveaway_id,user_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ giveaway_id: g.id, user_id: userId, entry_count: entryCount })
    });
  } else {
    await supabaseRequest('bww_giveaway_entries?giveaway_id=eq.' + g.id + '&user_id=eq.' + userId, { method: 'DELETE' });
  }
  await supabaseRequest('bww_giveaways?id=eq.' + g.id, { method: 'PATCH', body: JSON.stringify({ entry_count: (g.entries || []).length }) });
}
async function recordDraw(g, winners, drawType) {
  if (!g.guildId) return;
  for (let i = 0; i < winners.length; i++) {
    await supabaseRequest('bww_giveaway_winners', {
      method: 'POST',
      body: JSON.stringify({ giveaway_id: g.id, user_id: winners[i], draw_type: drawType, draw_number: i + 1 })
    });
  }
  await syncGiveawayRecord(g);
}

function startGiveawayLoop(client) {
  setTimeout(async () => {
    try { const list = loadGiveaways().filter(g => g.active); for (const g of list) { if (g.endTime <= Date.now()) await finalizeGiveaway(client, g); } } catch (e) {} finally { startGiveawayLoop(client); }
  }, 10000);
}

module.exports = { loadGiveaways, saveGiveaways, giveawayContainer, giveawayMessage, drawWinners, finalizeGiveaway, rerollGiveaway, updateGiveawayMessage, startGiveawayLoop, recordGiveawayEvent, recordGiveawayEntry, file };
