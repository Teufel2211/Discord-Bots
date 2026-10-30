const { MessageFlags } = require('discord.js');
const { getGuildSettings, saveGuildSettings } = require('./database');
const { embedV2 } = require('./embeds');

const V2 = MessageFlags.IsComponentsV2;
let running = false;

async function processRecurringMessages(client) {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    for (const guild of client.guilds.cache.values()) {
      try {
        const settings = await getGuildSettings(guild.id);
        const entries = Array.isArray(settings.recurringMessages) ? settings.recurringMessages : [];
        const due = entries.filter(entry => entry.active && entry.nextRunAt && new Date(entry.nextRunAt).getTime() <= now);
        if (!due.length) continue;

        // Persist the next deadlines before sending so a restart cannot resend the same due occurrence.
        for (const entry of due) {
          entry.nextRunAt = new Date(now + Math.max(60_000, Number(entry.intervalMs) || 60_000)).toISOString();
          entry.lastAttemptAt = new Date(now).toISOString();
        }
        await saveGuildSettings(guild.id, settings);

        for (const entry of due) {
          try {
            const channel = await client.channels.fetch(entry.channelId).catch(() => null);
            if (!channel?.isTextBased()) throw new Error('Zielkanal nicht gefunden oder nicht textbasiert.');
            const container = embedV2({ description: entry.text || '', image: entry.image || '', color: entry.color || '#5865F2' });
            await channel.send({ components: [container], flags: V2, allowedMentions: { parse: [] } });
            entry.lastSentAt = new Date().toISOString();
            entry.lastError = '';
          } catch (error) {
            entry.lastError = String(error.message || error).slice(0, 500);
            console.error('[BWW] Wiederkehrende Nachricht fehlgeschlagen:', entry.id, entry.lastError);
          }
        }
        await saveGuildSettings(guild.id, settings);
      } catch (error) {
        console.error('[BWW] Wiederholungs-Scheduler fehlgeschlagen:', guild.id, error.message);
      }
    }
  } finally {
    running = false;
  }
}

function startRecurringMessageLoop(client) {
  processRecurringMessages(client).catch(() => {});
  setInterval(() => processRecurringMessages(client).catch(() => {}), 15_000);
}

module.exports = { startRecurringMessageLoop, processRecurringMessages };
