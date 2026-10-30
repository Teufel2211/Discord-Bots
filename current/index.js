import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '.env');
const envResult = dotenv.config({ path: envPath });

if (envResult.error && envResult.error.code !== 'ENOENT') {
  console.error('[VC] Bot-.env konnte nicht geladen werden:', envResult.error.message);
}
console.log(`[VC] Eigene .env: ${envResult.error ? 'nicht gefunden' : 'geladen'}`);
import { Client, GatewayIntentBits, ChannelType, ActivityType, AuditLogEvent, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  VoiceConnectionDisconnectReason,
  entersState
} from '@discordjs/voice';

const {
  DISCORD_TOKEN,
  GUILD_ID,
  VOICE_CHANNEL_ID,
  VOICE_LOG_CHANNEL_ID
} = process.env;

if (!DISCORD_TOKEN || !GUILD_ID || !VOICE_CHANNEL_ID) {
  console.error('Fehler: DISCORD_TOKEN, GUILD_ID und VOICE_CHANNEL_ID müssen in .env gesetzt sein.');
  process.exit(1);
}

// --- Leave-Grund-Anzeige: warum ist der Bot nicht mehr im VC? ---
// Gründe landen in: Konsole ([VOICE]), optional Discord-Textkanal (VOICE_LOG_CHANNEL_ID),
// Bot-Präsenz (Mitgliederliste) und stündlichem STATUS-Log. Kein Extra-Intent nötig.
let lastLeave = null; // { at: Date, reason: string }
let everConnected = false;
let lastReportAt = 0;
const REPORT_DEDUP_MS = 10_000;

function shortReason(r) {
  return r.length > 42 ? r.slice(0, 41) + '…' : r;
}

async function setPresence(inVoice, reason) {
  try {
    await client.user.setActivity(
      shortReason(inVoice ? '🟢 24/7 im VC' : `🔴 VC verlassen: ${reason}`),
      { type: ActivityType.Watching }
    );
  } catch {}
}

async function sendLog(text) {
  if (!VOICE_LOG_CHANNEL_ID) return;
  try {
    const ch = await client.channels.fetch(VOICE_LOG_CHANNEL_ID).catch(() => null);
    if (!ch || !ch.isTextBased()) {
      console.warn('[VOICE] Log-Channel nicht gefunden/kein Textkanal – nur Konsole.');
      return;
    }
    await ch.send(text).catch((e) => console.warn('[VOICE] Log-Senden fehlgeschlagen:', e?.message ?? e));
  } catch (e) {
    console.warn('[VOICE] Log-Senden fehlgeschlagen:', e?.message ?? e);
  }
}

function shouldReport() {
  const now = Date.now();
  if (now - lastReportAt < REPORT_DEDUP_MS) return false;
  lastReportAt = now;
  return true;
}

async function reportLeave(reason) {
  lastLeave = { at: new Date(), reason };
  const stamp = lastLeave.at.toLocaleString('de-DE');
  console.warn(`[VOICE] Verlassen (${stamp}): ${reason}`);
  await setPresence(false, reason);
  if (shouldReport()) {
    await sendLog(`🔴 **Voice verlassen** (${stamp})\nGrund: ${reason}\nVersuche automatisch wieder beizutreten…`);
  }
}

async function reportRejoin(channelName) {
  const first = !everConnected;
  everConnected = true;
  console.log(`[VOICE] Verbunden mit #${channelName}`);
  await setPresence(true);
  if (shouldReport()) {
    await sendLog(first ? `🟢 **Im Voice** (#${channelName})` : `🟢 **Wieder im Voice** (#${channelName})`);
  }
}

function describeDisconnect(discState) {
  if (!discState || discState.status !== VoiceConnectionStatus.Disconnected) return 'Verbindung verloren';
  switch (discState.reason) {
    case VoiceConnectionDisconnectReason.Manual:
      return 'Manuell getrennt (Restart/Shutdown)';
    case VoiceConnectionDisconnectReason.AdapterUnavailable:
      return 'Netzwerk weg (Adapter antwortet nicht)';
    case VoiceConnectionDisconnectReason.EndpointRemoved:
      return 'Discord gab keinen Voice-Endpunkt (Störung)';
    case VoiceConnectionDisconnectReason.WebSocketClose: {
      const code = discState.closeCode;
      if (code === 4014) return 'Voice-Sitzung beendet (Kick oder Discord-Neustart)';
      if (code === 4006 || code === 4009) return `Sitzung abgelaufen/ungültig (Code ${code}, Netzwerk)`;
      return `Voice-Socket geschlossen (Code ${code ?? '?'})`;
    }
    default:
      return 'Verbindung verloren';
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

client.on('error', (error) => {
  console.error('[CLIENT ERROR]', error);
});

client.on('warn', (warning) => {
  console.warn('[CLIENT WARN]', warning);
});

client.on('shardDisconnect', (event, shardId) => {
  console.warn(`[SHARD ${shardId}] Gateway getrennt (Code ${event?.code}) – discord.js verbindet automatisch neu.`);
});

client.on('shardReconnecting', (shardId) => {
  console.warn(`[SHARD ${shardId}] Gateway-Reconnect läuft...`);
});

client.on('shardResume', (shardId, replayed) => {
  console.log(`[SHARD ${shardId}] Gateway-Session fortgesetzt (${replayed} Events nachgeholt).`);
});

// --- Büro-System: Warteraum mit Move-/Ablehnen-Buttons ---
// Joint jemand (außer Bot) den Warte-Voice-Channel, postet der Bot ein Embed mit
// "Herein moven" / "Ablehnen" in den Büro-Textkanal. Klickbar nur mit Move-Recht.
// Env: WAITING_ROOM_CHANNEL_ID (leer = Feature aus),
// OFFICE_CHANNEL_ID (Fallback: VOICE_LOG_CHANNEL_ID),
// OFFICE_TARGET_CHANNEL_ID (Fallback: VOICE_CHANNEL_ID = Bot-Channel).
// Kein Extra-Intent nötig (Buttons laufen über Interactions).
const WAITING_ROOM = process.env.WAITING_ROOM_CHANNEL_ID || null;
const OFFICE_CHANNEL = process.env.OFFICE_CHANNEL_ID || VOICE_LOG_CHANNEL_ID || null;
const OFFICE_TARGET = process.env.OFFICE_TARGET_CHANNEL_ID || VOICE_CHANNEL_ID;
const officePending = new Map(); // userId -> messageId

async function getOfficeChannel() {
  if (!WAITING_ROOM || !OFFICE_CHANNEL) return null;
  try {
    const ch = await client.channels.fetch(OFFICE_CHANNEL).catch(() => null);
    if (!ch || !ch.isTextBased()) {
      console.warn('[BÜRO] Büro-Channel nicht gefunden/kein Textkanal.');
      return null;
    }
    return ch;
  } catch {
    return null;
  }
}

function officeButtons(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`office:move:${userId}`).setLabel('Herein moven').setStyle(ButtonStyle.Success).setEmoji('✅'),
      new ButtonBuilder().setCustomId(`office:dismiss:${userId}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger).setEmoji('❌')
    )
  ];
}

async function officeRequestJoin(member) {
  if (officePending.has(member.id)) return;
  const ch = await getOfficeChannel();
  if (!ch) return;
  const stamp = new Date().toLocaleString('de-DE');
  const embed = new EmbedBuilder()
    .setTitle(`⏳ Warteraum: ${member.displayName ?? member.user.username}`)
    .setDescription(`<@${member.id}> wartet seit ${stamp} im Warteraum.\nHerein moven oder ablehnen?`)
    .setColor(0xf5a623)
    .setTimestamp();
  try {
    const msg = await ch.send({ embeds: [embed], components: officeButtons(member.id) });
    officePending.set(member.id, msg.id);
    console.log(`[BÜRO] ${member.user.tag} im Warteraum – Anfrage ${msg.id} gepostet.`);
  } catch (e) {
    console.warn('[BÜRO] Anfrage-Post fehlgeschlagen:', e?.message ?? e);
  }
}

async function officeRequestResolve(userId, resultText, color) {
  const msgId = officePending.get(userId);
  officePending.delete(userId);
  if (!msgId) return;
  try {
    const ch = await getOfficeChannel();
    if (!ch) return;
    const msg = await ch.messages.fetch(msgId).catch(() => null);
    if (!msg || !msg.embeds.length) return;
    const done = EmbedBuilder.from(msg.embeds[0])
      .setColor(color)
      .setDescription(`${msg.embeds[0].description}\n\n**${resultText}**`);
    await msg.edit({ embeds: [done], components: [] }).catch(() => {});
  } catch {}
}

// Büro-Buttons: Herein moven / Ablehnen (nur mit Move-Recht klickbar)
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isButton()) return;
    const [scope, action, userId] = (interaction.customId || '').split(':');
    if (scope !== 'office' || !userId) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.MoveMembers)) {
      await interaction.reply({ content: '❌ Du brauchst das Move-Recht.', ephemeral: true }).catch(() => {});
      return;
    }
    if (action === 'dismiss') {
      await officeRequestResolve(userId, `❌ Abgelehnt von ${interaction.user.tag}`, 0xe74c3c);
      await interaction.reply({ content: 'Abgelehnt.', ephemeral: true }).catch(() => {});
      return;
    }
    if (action === 'move') {
      const guild = interaction.guild;
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member || member.voice.channelId !== WAITING_ROOM) {
        await officeRequestResolve(userId, '🚪 War schon weg – nichts gemovt', 0x808080);
        await interaction.reply({ content: 'Person ist nicht mehr im Warteraum.', ephemeral: true }).catch(() => {});
        return;
      }
      const target = guild.channels.cache.get(OFFICE_TARGET) ?? await guild.channels.fetch(OFFICE_TARGET).catch(() => null);
      if (!target || target.type !== ChannelType.GuildVoice) {
        await interaction.reply({ content: '❌ Ziel-Channel ungültig (OFFICE_TARGET_CHANNEL_ID prüfen).', ephemeral: true }).catch(() => {});
        return;
      }
      try {
        await member.voice.setChannel(target.id);
      } catch (e) {
        await interaction.reply({ content: `❌ Moven fehlgeschlagen (Bot braucht Move-Recht): ${e?.message ?? e}`, ephemeral: true }).catch(() => {});
        return;
      }
      await officeRequestResolve(userId, `✅ Gemovt nach #${target.name} von ${interaction.user.tag}`, 0x2ecc71);
      await interaction.reply({ content: `✅ Gemovt nach #${target.name}.`, ephemeral: true }).catch(() => {});
    }
  } catch (e) {
    console.warn('[BÜRO] Button-Auswertung fehlgeschlagen:', e?.message ?? e);
  }
});
// Wer hat gekickt? Sucht im Audit-Log nach frischem Disconnect/Move gegen den Bot.
// Braucht "Audit-Log einsehen"-Recht – ohne Recht still null (Fallback-Text greift).
async function findKickExecutor(guild) {
  try {
    if (!guild) return null;
    for (const type of [AuditLogEvent.MemberDisconnect, AuditLogEvent.MemberMove]) {
      const logs = await guild.fetchAuditLogs({ type, limit: 3 }).catch(() => null);
      const hit = logs?.entries.find(
        (e) => e.target?.id === client.user.id && Date.now() - e.createdTimestamp < 15_000
      );
      if (hit?.executor) return hit.executor.tag ?? hit.executor.username;
    }
  } catch {}
  return null;
}

// Kick/Move/Delete erkennen: ändert sich der Voice-State des Bots selbst,
// melden wir den Grund. Netzwerk-Abbrüche kommen hier NICHT an –
// die meldet der Connection-Handler (s. unten).
client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    // Büro: jemand (außer Bot) betritt/verlässt den Warteraum
    if (WAITING_ROOM && client.user && oldState.id !== client.user.id) {
      if (newState.channelId === WAITING_ROOM && oldState.channelId !== WAITING_ROOM) {
        const m = newState.member ?? await newState.guild.members.fetch(oldState.id).catch(() => null);
        if (m && !m.user.bot) await officeRequestJoin(m);
      } else if (oldState.channelId === WAITING_ROOM && newState.channelId !== WAITING_ROOM) {
        await officeRequestResolve(oldState.id, '🚪 Hat den Warteraum verlassen', 0x808080);
      }
    }
    if (oldState.id !== client.user.id) return;

    // Discord kann einen verspäteten Voice-State-Event liefern, obwohl die
    // bestehende VoiceConnection bereits wieder stabil im Ziel-Channel ist.
    // In diesem Fall keinesfalls einen Leave/Kick melden oder neu verbinden.
    if (
      connection &&
      connection.state.status === VoiceConnectionStatus.Ready &&
      connection.joinConfig.channelId === VOICE_CHANNEL_ID
    ) {
      return;
    }

    if (oldState.channelId && !newState.channelId) {
      const channel = await client.channels.fetch(oldState.channelId).catch(() => null);
      if (!channel) {
        await reportLeave('Voice-Channel wurde gelöscht');
      } else {
        const who = await findKickExecutor(oldState.guild);
        await reportLeave(who
          ? `Voice-Channel verlassen: #${channel.name ?? oldState.channelId} (Aktion von ${who})`
          : `Voice-State meldet Verlassen von #${channel.name ?? oldState.channelId}`);
      }
    } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      console.warn(`[VOICE] Wurde nach #${newState.channel?.name ?? newState.channelId} verschoben – prüfe Ziel-Channel.`);
      joinTargetChannel().catch(console.error);
    }
  } catch (e) {
    console.warn('[VOICE] voiceStateUpdate-Auswertung fehlgeschlagen:', e?.message ?? e);
  }
});

let reconnectTimer = null;
let reconnectAttempts = 0;
let notReadySince = null;
let connection = null;
let stopping = false;
let resetting = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 5 * 60_000;

function reconnectDelay() {
  return Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
}

async function performJoinTargetChannel() {
  if (stopping) return;

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(VOICE_CHANNEL_ID);

    if (!channel || channel.type !== ChannelType.GuildVoice) {
      throw new Error('VOICE_CHANNEL_ID ist kein normaler Voice-Channel.');
    }

    if (!channel.joinable) {
      throw new Error('Der Bot kann dem Voice-Channel nicht beitreten. Prüfe Connect/Speak-Rechte.');
    }

    // Bereits im Ziel-Channel: eine laufende Verbindung weiterverwenden.
    if (connection && connection.joinConfig.channelId === channel.id) {
      if (connection.state.status === VoiceConnectionStatus.Ready) return;
      if (
        connection.state.status === VoiceConnectionStatus.Signalling ||
        connection.state.status === VoiceConnectionStatus.Connecting ||
        connection.state.status === VoiceConnectionStatus.Disconnected
      ) {
        const existing = connection;
        await entersState(existing, VoiceConnectionStatus.Ready, 30_000);
        if (connection === existing) {
          reconnectAttempts = 0;
          notReadySince = null;
          return;
        }
      }
    }

    if (connection) {
      try { connection.destroy(); } catch {}
      connection = null;
    }

    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true, // Holder braucht nichts zu hören – spart Empfang/Bandbreite
      selfMute: false
    });

    const current = connection;

    current.on('error', (error) => {
      console.error('[VOICE ERROR]', error?.message ?? error);
      reportLeave(`Voice-Fehler: ${error?.message ?? error}`).catch(() => {});
      try { current.destroy(); } catch {}
      if (connection === current) connection = null;
      scheduleReconnect();
    });

    current.on(VoiceConnectionStatus.Disconnected, async () => {
      const discState = current.state.status === VoiceConnectionStatus.Disconnected ? current.state : null;
      const reason = describeDisconnect(discState);
      // Bei 4014 entscheidet der voiceStateUpdate-Handler (Kick vs. Discord-Neustart) – hier nicht doppelt melden.
      const isMaybeKick = discState?.reason === VoiceConnectionDisconnectReason.WebSocketClose && discState?.closeCode === 4014;
      if (!isMaybeKick) {
        await reportLeave(reason).catch(() => {});
      } else {
        console.warn('[VOICE] Verbindung getrennt (4014) – warte voiceStateUpdate ab (Kick oder Discord-Neustart).');
        lastLeave = { at: new Date(), reason: `${reason} – warte Bestätigung` };
      }
      console.warn('[VOICE] Reconnect wird versucht.');

      try {
        await Promise.race([
          entersState(current, VoiceConnectionStatus.Signalling, 5_000),
          entersState(current, VoiceConnectionStatus.Connecting, 5_000)
        ]);
      } catch {
        try { current.destroy(); } catch {}
        if (connection === current) connection = null;
        scheduleReconnect();
      }
    });

    current.on(VoiceConnectionStatus.Destroyed, () => {
      if (connection === current) connection = null;
      if (!stopping) scheduleReconnect();
    });

    await entersState(current, VoiceConnectionStatus.Ready, 30_000);
    reconnectAttempts = 0;
    notReadySince = null;
    await reportRejoin(`${channel.name} (${channel.id})`).catch(() => {});
  } catch (error) {
    console.error('[VOICE] Beitritt fehlgeschlagen:', error?.message ?? error);
    try { connection?.destroy(); } catch {}
    connection = null;
    scheduleReconnect();
  }
}

let joinInProgress = null;

// Alle Auslöser (Voice-Events, Retry-Timer und Health-Check) teilen sich
// denselben Join-Vorgang. Parallele Versuche dürfen die Verbindung nicht
// gegenseitig zerstören und dadurch Abort-Fehler erzeugen.
function joinTargetChannel() {
  if (stopping) return Promise.resolve();
  if (joinInProgress) return joinInProgress;
  joinInProgress = performJoinTargetChannel().finally(() => {
    joinInProgress = null;
  });
  return joinInProgress;
}

function scheduleReconnect() {
  if (stopping || reconnectTimer) return;

  // Exponentieller Backoff (5s, 10s, 20s, ... max. 5 Min): schützt bei
  // längeren Discord-Störungen vor Rate-Limits. Wird bei Erfolg zurückgesetzt.
  const delay = reconnectDelay();
  reconnectAttempts += 1;

  // Fallback-Stufe 2: Nach 15, 30, 45 ... Fehlversuchen hilft Voice-Retry
  // nicht mehr (z.B. Discord-Gateway hängt) -> komplette Session neu aufbauen.
  if (reconnectAttempts % 15 === 0) {
    fullSessionReset().catch((error) => {
      console.error('[FALLBACK] Session-Reset fehlgeschlagen:', error?.message ?? error);
      scheduleReconnect();
    });
    return;
  }

  console.warn(`[VOICE] Reconnect #${reconnectAttempts} in ${Math.round(delay / 1000)}s.`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await joinTargetChannel();
    } catch (error) {
      console.error('[VOICE] Reconnect fehlgeschlagen:', error?.message ?? error);
      scheduleReconnect();
    }
  }, delay);
}

// Fallback-Stufe 2: Kompletter Neuaufbau (Gateway + Voice), wenn normale
// Reconnects dauerhaft scheitern. Zähler wird zurückgesetzt, damit sich das
// bei anhaltender Störung alle 15 Versuche wiederholt.
async function fullSessionReset() {
  if (stopping || resetting) return;
  resetting = true;
  console.warn('[FALLBACK] 15 Fehlversuche – baue komplette Discord-Session neu auf.');
  try { connection?.disconnect(); } catch {}
  await sleep(2000);
  try { connection?.destroy(); } catch {}
  connection = null;
  notReadySince = null;
  try { await client.destroy(); } catch {}
  await sleep(5000);
  reconnectAttempts = 0;
  try {
    await loginWithRetry();
    await joinTargetChannel();
  } finally {
    resetting = false;
  }
}

client.once('clientReady', async () => {
  console.log(`Bot online: ${client.user.tag}`);
  console.log('Starte 24/7-Voice-Verbindung...');
  setPresence(true);

  // Beim (Re-)Start zuerst eine hängende alte Session verlassen, dann joinen.
  // Räumt Geister weg, wenn der alte Container per SIGKILL starb.
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const me = await guild.members.fetchMe().catch(() => null);
    if (me?.voice?.channelId) {
      console.log('[VOICE] Alte Session gefunden – verlasse sie erst.');
    }
    await me?.voice?.disconnect().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch {}

  await joinTargetChannel();

  // Sicherheitsnetz alle 30s:
  // 1) Keine Verbindung -> sofort neu joinen.
  // 2) Verbindung hängt >90s in nicht-Ready (ohne Destroyed) -> killen + neu joinen.
  //    Kurze Connecting-Phasen und Disconnect-Recovery (<90s) bleiben unangetastet.
  setInterval(() => {
    if (stopping) return;
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
      connection = null;
      notReadySince = null;
      joinTargetChannel().catch(console.error);
      return;
    }
    if (connection.state.status !== VoiceConnectionStatus.Ready) {
      if (!notReadySince) {
        notReadySince = Date.now();
        return;
      }
      if (Date.now() - notReadySince > 90_000) {
        console.warn(`[VOICE] Verbindung hängt seit >90s im Status ${connection.state.status} – neu aufbauen.`);
        try { connection.destroy(); } catch {}
        connection = null;
        notReadySince = null;
        joinTargetChannel().catch(console.error);
      }
    } else {
      notReadySince = null;
    }
  }, 30_000);

  // Stündlicher Lebenszeichen-Log fürs KataBump-Panel (inkl. letztem Leave-Grund).
  setInterval(() => {
    if (stopping) return;
    const up = Math.floor(process.uptime());
    const h = Math.floor(up / 3600);
    const m = Math.floor((up % 3600) / 60);
    const leaveInfo = lastLeave ? ` – Letzter Leave: ${lastLeave.reason} (${lastLeave.at.toLocaleString('de-DE')})` : ' – bisher kein Leave';
    console.log(`[STATUS] Uptime ${h}h ${m}m – Voice: ${connection?.state?.status ?? 'keine Verbindung'} – Fehlversuche: ${reconnectAttempts}${leaveInfo}`);
  }, 60 * 60_000);
});

// Sauberes Herunterfahren: Voice-Channel SOFORT verlassen (Leave-Paket an
// Discord senden), kurz warten bis es raus ist, dann erst beenden.
// So steht der Bot nicht mehr minutenlang als Geist im Channel.
let shutDown = false;
async function gracefulShutdown(signal) {
  if (shutDown) return;
  shutDown = true;
  stopping = true;
  console.log(`[${signal}] Verlasse Voice-Channel...`);
  await sendLog(`⚫ **Bot fährt herunter** (${signal}, Restart/Deploy) – joint danach neu bei.`).catch(() => {});
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try {
    // 1) Leave senden – Gateway bleibt dabei am Leben, damit das Paket rausgeht.
    connection?.disconnect();
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 2000));
  // 2) Erst jetzt alles abreißen.
  try { connection?.destroy(); } catch {}
  connection = null;
  try { await client.destroy(); } catch {}
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

process.on('uncaughtException', async (error) => {
  console.error('[UNCAUGHT EXCEPTION]', error);
  // Best-Effort: Voice verlassen, damit kein Geist im Channel bleibt.
  try { connection?.disconnect(); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 2000));
  try { connection?.destroy(); } catch {}
  connection = null;
  try { await client.destroy(); } catch {}
  process.exit(1);
});

// Fallback-Stufe 1: Beim Login unterscheiden wir Konfig- vs. Netzfehler.
// Falscher Token -> sofort Exit (braucht einen Menschen). Alles andere
// (Discord down, Netzwerk-Blip) -> endlos weiter versuchen, kein Crash-Loop.
async function loginWithRetry() {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      await client.login(DISCORD_TOKEN);
      return;
    } catch (loginError) {
      const msg = loginError?.message ?? String(loginError);
      if (/invalid token/i.test(msg)) {
        console.error('[LOGIN] Token ungültig – beende. Bitte DISCORD_TOKEN prüfen.');
        process.exit(1);
      }
      const wait = Math.min(10_000 * attempt, 60_000);
      console.error(`[LOGIN FEHLGESCHLAGEN] Versuch ${attempt} (${msg}) – neuer Versuch in ${Math.round(wait / 1000)}s.`);
      await sleep(wait);
    }
  }
}

loginWithRetry();