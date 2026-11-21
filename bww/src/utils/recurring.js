const { MessageFlags } = require('discord.js');
const { getGuildSettings, saveGuildSettings } = require('./database');
const { embedV2 } = require('./embeds');
const { migrateDiscordImageUrl } = require('./recurringImages');

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
            if (entry.image && /https?:\/\/(?:cdn|media)\.discordapp\.net\//i.test(entry.image)) {
              entry.image = await migrateDiscordImageUrl(entry.image, guild.id);
              await saveGuildSettings(guild.id, settings);
            }
            let channel;
            try {
              channel = await client.channels.fetch(entry.channelId);
            } catch (error) {
              // Discord error 10003 means the channel was deleted or the stored ID is invalid.
              if (Number(error?.code) === 10003) channel = null;
              else throw error;
            }

            if (!channel || channel.guildId !== guild.id || !channel.isTextBased()) {
              entry.active = false;
              entry.disabledAt = new Date().toISOString();
              entry.lastError = 'Zielkanal fehlt, gehört zu einem anderen Server oder ist nicht textbasiert. Nachricht wurde automatisch deaktiviert.';
              console.warn('[BWW] Wiederkehrende Nachricht automatisch deaktiviert:', entry.id, 'Kanal:', entry.channelId || '(keine Kanal-ID)');
              continue;
            }

            const container = embedV2({ description: entry.text || '', image: entry.image || '', color: entry.color || '#5865F2' });
            await channel.send({ components: [container], flags: V2, allowedMentions: { parse: [] } });
            entry.lastSentAt = new Date().toISOString();
            entry.lastError = '';
          } catch (error) {
            const discordCode = Number(error?.code);
            if ([10003, 50001, 50013].includes(discordCode)) {
              // Unknown channel, missing channel access, or missing send permission:
              // disable the entry until an administrator fixes the target and re-enables it.
              entry.active = false;
              entry.disabledAt = new Date().toISOString();
              entry.lastError = 'Discord-Ziel nicht verfügbar oder keine Sendeberechtigung (Code ' + discordCode + '). Nachricht wurde deaktiviert.';
              console.warn('[BWW] Wiederkehrende Nachricht wegen Discord-Berechtigungs-/Kanalfehler deaktiviert:', entry.id, entry.lastError);
            } else {
              entry.lastError = String(error.message || error).slice(0, 500);
              console.error('[BWW] Wiederkehrende Nachricht fehlgeschlagen:', entry.id, entry.lastError);
            }
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
  setInterval(() => processRecurringMessages(client).catch(() => {}), 60_000);
}

module.exports = { startRecurringMessageLoop, processRecurringMessages };
