const path = require('node:path');

process.on('uncaughtExceptionMonitor', (error, origin) => {
  console.error('[BWW FATAL] Uncaught exception (' + origin + '):', error?.stack || error);
});
process.on('warning', (warning) => {
  console.warn('[BWW NODE WARNING]', warning?.stack || warning);
});
process.on('exit', (code) => {
  console.log('[BWW] Node-Prozess beendet. Exit-Code:', code);
});

const envPath = path.resolve(__dirname, '../../bww/.env');
const envResult = require('dotenv').config({ path: envPath });

if (envResult.error && envResult.error.code !== 'ENOENT') {
  console.error('[BWW] Bot-.env konnte nicht geladen werden:', envResult.error.message);
}
console.log(`[BWW] Eigene .env: ${envResult.error ? 'nicht gefunden' : 'geladen'}`);
const { Client, GatewayIntentBits, Partials, REST, Routes, Events, MessageFlags } = require('discord.js');
const { commands } = require('./commands');
const welcome = require('./events/welcome');
const { embedV2 } = require('./utils/embeds');
const interactions = require('./events/interactions');
const { startGiveawayLoop } = require('./utils/giveaway');
const { startRecurringMessageLoop } = require('./utils/recurring');
const { updateStatusMessage, ensureStatusMessage, formatUptime } = require('./utils/status');
const { getGuildSettings, getRealtimeClient, syncBotStatus, syncGuilds, markOffline } = require('./utils/database');
const { processDashboardActions } = require('./utils/dashboardActions');
const { handleMemberJoin } = require('./utils/raidProtection');
const { relayDmReply } = require('./utils/dmRelay');
const { recordMessageActivity } = require('./utils/personnel');

const token = process.env.DISCORD_TOKEN || '';
if (!token) {
  console.error('DISCORD_TOKEN fehlt in den Umgebungsvariablen.');
  process.exit(1);
}
console.log('[BWW] Token geladen.');
console.log('[BWW] Module geladen; initialisiere Discord-Client …');

function logRuntimeMemory(label) {
  const memory = process.memoryUsage();
  const mb = value => (value / 1024 / 1024).toFixed(1) + ' MB';
  console.log('[BWW Runtime] ' + label + ' | RSS=' + mb(memory.rss) +
    ', Heap=' + mb(memory.heapUsed) + '/' + mb(memory.heapTotal) +
    ', External=' + mb(memory.external));
}
logRuntimeMemory('Start');
const runtimeMemoryTimer = setInterval(() => logRuntimeMemory('Heartbeat'), 60_000);
runtimeMemoryTimer.unref();

// Diagnose für frühe Prozessabbrüche: SIGABRT selbst ist nicht per JavaScript
// abfangbar, aber Fehler vor dem Abbruch sollen im Host-Log sichtbar werden.
process.on('uncaughtExceptionMonitor', (error, origin) => {
  console.error('[BWW FATAL] Unbehandelte Exception:', { origin, stack: error?.stack || String(error) });
});
process.on('warning', (warning) => {
  console.warn('[BWW NODE WARNING]', warning?.stack || warning);
});
process.on('exit', (code) => {
  console.log('[BWW] Node-Prozess beendet. Exit-Code:', code);
});


let dashboardActionsChannel = null;
let dashboardActionsRealtimeClient = null;
let dashboardActionsFallbackTimer = null;
let statusSyncTimer = null;
let guildSyncTimer = null;
let dashboardActionsRunning = false;
let dashboardActionsRerun = false;

async function processDashboardActionsSafely(client) {
  if (dashboardActionsRunning) {
    dashboardActionsRerun = true;
    return;
  }
  dashboardActionsRunning = true;
  try {
    do {
      dashboardActionsRerun = false;
      await processDashboardActions(client);
    } while (dashboardActionsRerun);
  } catch (error) {
    console.error('[BWW Dashboard] Aktionsverarbeitung fehlgeschlagen:', error.message);
  } finally {
    dashboardActionsRunning = false;
  }
}

function startDashboardActionsFallback(client) {
  if (dashboardActionsFallbackTimer) return;
  console.warn('[BWW Dashboard] Supabase-Realtime nicht verbunden; Fallback-Abfrage alle 60 Sekunden aktiviert.');
  dashboardActionsFallbackTimer = setInterval(() => {
    processDashboardActionsSafely(client);
  }, 60_000);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
  partials: [Partials.GuildMember, Partials.Channel],
});

console.log('[BWW] Discord-Client initialisiert.');
client.on('error', (error) => console.error('[BWW DISCORD ERROR]', error?.stack || error));
client.on('shardError', (error, shardId) => console.error('[BWW SHARD ERROR]', shardId, error?.stack || error));
client.on('shardDisconnect', (event, shardId) => console.warn('[BWW SHARD DISCONNECT]', shardId, event?.code, event?.reason || ''));
client.on('warn', (warning) => console.warn('[BWW DISCORD WARNING]', warning));
client.on('shardReconnecting', (shardId) => console.warn('[BWW SHARD RECONNECTING]', shardId));



client.once(Events.ClientReady, async (bot) => {
  logRuntimeMemory('Discord Ready');
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    await rest.put(Routes.applicationCommands(bot.user.id), { body: commands });
    console.log(`BWW Bot online als ${bot.user.tag}`);
  } catch (err) {
    console.error('Slash-Command Registrierung fehlgeschlagen:', err.message);
    console.log(`BWW Bot online als ${bot.user.tag} (Commands nicht aktualisiert)`);
  }

  startGiveawayLoop(client);
  startRecurringMessageLoop(client);
  const syncDashboardStatus = () => syncBotStatus(client, 'online').catch((err) => console.error('[BWW Dashboard] Status-Sync fehlgeschlagen:', err.message));
  const syncGuildMetadata = () => syncGuilds(client).catch((err) => console.error('[BWW Dashboard] Serverdaten-Sync fehlgeschlagen:', err.message));
  await Promise.all([syncDashboardStatus(), syncGuildMetadata()]);
  statusSyncTimer = setInterval(syncDashboardStatus, 60_000);
  guildSyncTimer = setInterval(syncGuildMetadata, 5 * 60_000);
  const processActions = () => processDashboardActionsSafely(client);
  await processActions();

  // Subscribe only to new dashboard actions. The initial catch-up above plus
  // another catch-up on SUBSCRIBED closes the startup/reconnect race.
  startDashboardActionsFallback(client);
  dashboardActionsRealtimeClient = getRealtimeClient();
  if (dashboardActionsRealtimeClient) {
    dashboardActionsChannel = dashboardActionsRealtimeClient
      .channel('bww-dashboard-actions')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bww_dashboard_actions' },
        () => { void processActions(); }
      )
      .subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          if (dashboardActionsFallbackTimer) {
            clearInterval(dashboardActionsFallbackTimer);
            dashboardActionsFallbackTimer = null;
          }
          console.log('[BWW Dashboard] Supabase-Realtime verbunden; Dashboard-Aktionen werden ereignisgesteuert verarbeitet.');
          void processActions();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[BWW Dashboard] Realtime-Status:', status, error?.message || '');
          startDashboardActionsFallback(client);
        }
      });
  }

  for (const guild of client.guilds.cache.values()) {
    try {
      const cfg = await getGuildSettings(guild.id);
      if (cfg.status?.enabled && cfg.status?.channelId) {
        await ensureStatusMessage(client, guild.id);
        const refreshed = await getGuildSettings(guild.id);
        if (refreshed.status?.messageId) {
          const mode = refreshed.status.mode || 'online';
          await updateStatusMessage(client, guild.id, mode, mode === 'online' ? { uptime: formatUptime(client.uptime) } : {});
        }
      }
    } catch (err) {
      console.warn('[BWW] Status-Synchronisierung fehlgeschlagen:', err.message);
    }
  }

  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        const cfg = await getGuildSettings(guild.id);
        if (cfg.status?.enabled && cfg.status?.channelId) {
          await ensureStatusMessage(client, guild.id);
          const refreshed = await getGuildSettings(guild.id);
          const mode = refreshed.status?.mode || 'online';
          if (refreshed.status?.messageId) await updateStatusMessage(client, guild.id, mode, mode === 'online' ? { uptime: formatUptime(client.uptime) } : {});
        }
      } catch {}
    }
  }, 5 * 60 * 1000);
});


client.on(Events.GuildMemberAdd, (member) => {
  Promise.resolve(welcome(member)).catch((err) => console.error('Welcome Fehler:', err.message));
  Promise.resolve(handleMemberJoin(member, client)).catch((err) => console.error('[BWW Raid] Join-Prüfung fehlgeschlagen:', err.message));
});

client.on(Events.MessageCreate, (message) => {
  if (!message.guild) {
    Promise.resolve(relayDmReply(message, client)).catch((err) => console.error('[BWW DM] Weiterleitung fehlgeschlagen:', err.message));
  } else if (!message.author.bot) {
    Promise.resolve(recordMessageActivity(message.guild.id, message.author.id)).catch((err) => console.error('[BWW Personalakte] Aktivität fehlgeschlagen:', err.message));
  }
});

client.on(Events.InteractionCreate, (interaction) => {
  Promise.resolve(interactions(interaction, client)).catch((err) => {
    console.error('Interaction Fehler:', err.stack || err.message);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      interaction.reply({ content: '❌ Unerwarteter Fehler.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });
});

async function shutdown(signal) {
  clearInterval(runtimeMemoryTimer);
  if (statusSyncTimer) clearInterval(statusSyncTimer);
  if (guildSyncTimer) clearInterval(guildSyncTimer);
  if (dashboardActionsFallbackTimer) clearInterval(dashboardActionsFallbackTimer);
  try { await markOffline(client); } catch (err) { console.error('[BWW Dashboard] Offline-Status fehlgeschlagen:', err.message); }
  if (dashboardActionsRealtimeClient && dashboardActionsChannel) {
    try { await dashboardActionsRealtimeClient.removeChannel(dashboardActionsChannel); } catch (err) {
      console.warn('[BWW Dashboard] Realtime-Kanal konnte nicht sauber geschlossen werden:', err.message);
    }
  }
  for (const guild of client.guilds.cache.values()) { try { await updateStatusMessage(client, guild.id, 'offline'); } catch {} }
  process.exit(signal === 'SIGINT' ? 130 : 143);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('[BWW] Starte Discord-Gateway-Login …');
client.login(token)
  .then(() => console.log('[BWW] Discord-Gateway-Login erfolgreich.'))
  .catch((err) => {
    console.error('[BWW] Login-Fehler:', err && (err.stack || err.message || err));
    process.exit(1);
  });
