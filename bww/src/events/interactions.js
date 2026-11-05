const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { isAllowed } = require('../commands');
const { getGuildSettings, saveGuildSettings, supabaseRequest } = require('../utils/database');
const { embedV2, verifyComponents } = require('../utils/embeds');
const { ticketContainer, createTicket, TICKET_REASONS } = require('../utils/tickets');
const { loadGiveaways, saveGiveaways, giveawayContainer, startGiveaway, finalizeGiveaway, rerollGiveaway, updateGiveawayMessage, recordGiveawayEvent, recordGiveawayEntry, getGiveawayAudit } = require('../utils/giveaway');
const { getPanel, setPanel, deletePanel, loadPanels, panelContainer, buttonResponseContainer, addPanelMessage } = require('../utils/panels');
const { createStatusMessage, updateStatusMessage } = require('../utils/status');
const { handleUnitCommand, listUnits } = require('../utils/units');
const { issueDashboardCode } = require('../utils/dashboardActions');
const { getRaidSettings, saveRaidSettings, lockdownGuild, restoreGuild } = require('../utils/raidProtection');
const { openDmThread } = require('../utils/dmRelay');
const personnel = require('../utils/personnel');

const EPHEMERAL = { flags: MessageFlags.Ephemeral };
const V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL_V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

function selfRoleIsAssignable(role, botMember) {
  if (!role || role.managed || role.id === role.guild.id) return false;
  if (!botMember || botMember.roles.highest.comparePositionTo(role) <= 0) return false;
  const dangerous = PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild |
    PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageChannels |
    PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageWebhooks |
    PermissionFlagsBits.ManageEvents | PermissionFlagsBits.ManageNicknames |
    PermissionFlagsBits.ManageThreads | PermissionFlagsBits.ManageGuildExpressions |
    PermissionFlagsBits.KickMembers | PermissionFlagsBits.BanMembers |
    PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.MentionEveryone;
  return !role.permissions.has(dangerous);
}
function buildSelfRoleRow(messageId, roles) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('bww_selfroles_' + messageId)
    .setPlaceholder('Wähle deine Rollen aus …')
    .setMinValues(0)
    .setMaxValues(roles.length)
    .addOptions(roles.map(role => ({ label: role.name.slice(0, 100), value: role.id, description: ('Rolle: ' + role.name).slice(0, 100) })));
  return new ActionRowBuilder().addComponents(menu);
}

function hasGiveawayManagePermission(interaction, config) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const roles = config.permissions['giveaway'] || [];
  return roles.some(id => interaction.member?.roles?.cache?.has(id));
}
function canCloseTicket(interaction, config) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (config.ticket.roleId && interaction.member?.roles?.cache?.has(config.ticket.roleId)) return true;
  if (interaction.channel?.name?.startsWith('ticket-') && interaction.channel?.permissionOverwrites?.cache?.has(interaction.user.id)) return true;
  return false;
}

module.exports = async (interaction, client) => {
  try {
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'farbe') {
      const palette = [['Discord-Blau','#5865F2'],['Rot','#ED4245'],['Grün','#57F287'],['Gelb','#FEE75C'],['Lila','#9B59B6'],['Orange','#E67E22'],['Türkis','#1ABC9C'],['Pink','#EB459E'],['Weiß','#FFFFFF'],['Schwarz','#23272A'],['Dunkelgrau','#2F3136']];
      const raw = String(focused.value || '').trim();
      const query = raw.toLowerCase();
      const matches = palette.filter(([name,hex]) => name.toLowerCase().includes(query) || hex.toLowerCase().includes(query));
      const cleanHex = raw.replace(/^#/, '');
      if (/^[0-9a-fA-F]{6}$/.test(cleanHex)) matches.unshift(['Benutzerdefiniert', `#${cleanHex.toUpperCase()}`]);
      return interaction.respond(matches.slice(0,25).map(([name,value]) => ({ name: `${name} (${value})`, value })));
    }
    return interaction.respond([]);
  }
  const config = await getGuildSettings(interaction.guildId);
  if (interaction.isButton() && interaction.customId === 'bww_verify') {
    if (!config.verify.roleId) return interaction.reply({ content: '❌ Keine Verifizierungsrolle eingerichtet.', ...EPHEMERAL });
    const role = interaction.guild.roles.cache.get(config.verify.roleId) || await interaction.guild.roles.fetch(config.verify.roleId).catch(() => null);
    if (!role) return interaction.reply({ content: '❌ Die Verifizierungsrolle existiert nicht mehr.', ...EPHEMERAL });
    if (interaction.member.roles.cache.has(role.id)) return interaction.reply({ content: '✅ Du bist bereits verifiziert.', ...EPHEMERAL });
    try { await interaction.member.roles.add(role); } catch { return interaction.reply({ content: '❌ Ich konnte die Rolle nicht vergeben. Prüfe meine Rollenposition.', ...EPHEMERAL }); }
    return interaction.reply({ content: '✅ Du wurdest erfolgreich verifiziert.', ...EPHEMERAL });
  }
  if (interaction.isButton() && interaction.customId === 'bww_ticket_close') {
    if (!canCloseTicket(interaction, config)) return interaction.reply({ content: '❌ Du darfst dieses Ticket nicht schließen.', ...EPHEMERAL });
    await interaction.reply({ content: '🔒 Ticket wird geschlossen und gelöscht…', ...EPHEMERAL });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith('bww_panel_')) {
    const parts = interaction.customId.split('_');
    const idx = parseInt(parts.pop(), 10);
    const name = parts.slice(2).join('_');
    const panel = getPanel(name);
    if (!panel || !panel.buttons[idx]) return interaction.reply({ content: '❌ Panel oder Button nicht gefunden.', ...EPHEMERAL });
    const button = panel.buttons[idx];
    const container = buttonResponseContainer(name, button);
    return interaction.reply({ components: [container], flags: EPHEMERAL_V2, allowedMentions: { parse: [] } });
  }
  if (interaction.isButton() && interaction.customId.startsWith('bww_giveaway_')) {
    const parts = interaction.customId.split('_'); const action = parts[2]; const id = parts.slice(3).join('_');
    if (!['join', 'leave', 'end', 'reroll'].includes(action)) return;
    const list = loadGiveaways(); const g = list.find(x => x.id === id);
    if (action === 'join') {
      if (!g || !g.active) return interaction.reply({ content: '❌ Dieses Giveaway ist bereits beendet.', ...EPHEMERAL });
      const member = interaction.member;
      if (g.requiredRoleId && !member?.roles?.cache?.has(g.requiredRoleId)) return interaction.reply({ content: '❌ Für dieses Giveaway benötigst du die erforderliche Rolle.', ...EPHEMERAL });
      const accountAgeDays = Math.floor((Date.now() - interaction.user.createdTimestamp) / 86400000);
      const serverAgeDays = member?.joinedTimestamp ? Math.floor((Date.now() - member.joinedTimestamp) / 86400000) : 0;
      if (accountAgeDays < (g.minAccountAgeDays || 0)) return interaction.reply({ content: '❌ Dein Discord-Konto ist noch nicht alt genug. Erforderlich: ' + g.minAccountAgeDays + ' Tage.', ...EPHEMERAL });
      if (serverAgeDays < (g.minServerAgeDays || 0)) return interaction.reply({ content: '❌ Du bist noch nicht lange genug auf diesem Server. Erforderlich: ' + g.minServerAgeDays + ' Tage.', ...EPHEMERAL });
      if (g.entries.includes(interaction.user.id)) return interaction.reply({ content: '❌ Du nimmst bereits teil.', ...EPHEMERAL });
      const entryCount = 1 + (g.bonusRoleId && member?.roles?.cache?.has(g.bonusRoleId) ? (g.bonusEntries || 0) : 0);
      g.entries.push(interaction.user.id); g.entryCounts ||= {}; g.entryCounts[interaction.user.id] = entryCount; saveGiveaways(list);
      await recordGiveawayEntry(g, interaction.user.id, 'join', entryCount);
      await recordGiveawayEvent(g, interaction.user.id, 'joined', { entryCount, accountAgeDays, serverAgeDays });
      await updateGiveawayMessage(client, g);
      return interaction.reply({ content: '🎉 Du nimmst jetzt am Giveaway teil!' + (entryCount > 1 ? ' Du hast ' + entryCount + ' Lose.' : ''), ...EPHEMERAL });
    }
    if (action === 'leave') {
      if (!g || !g.active) return interaction.reply({ content: '❌ Dieses Giveaway ist bereits beendet.', ...EPHEMERAL });
      const idx = g.entries.indexOf(interaction.user.id); if (idx === -1) return interaction.reply({ content: '❌ Du nimmst nicht an diesem Giveaway teil.', ...EPHEMERAL });
      g.entries.splice(idx, 1); if (g.entryCounts) delete g.entryCounts[interaction.user.id]; saveGiveaways(list);
      await recordGiveawayEntry(g, interaction.user.id, 'leave');
      await recordGiveawayEvent(g, interaction.user.id, 'left');
      await updateGiveawayMessage(client, g);
      return interaction.reply({ content: '👋 Du hast das Giveaway verlassen.', ...EPHEMERAL });
    }
    if (action === 'end' || action === 'reroll') {
      if (!hasGiveawayManagePermission(interaction, config)) return interaction.reply({ content: '❌ Du darfst das Giveaway nicht verwalten.', ...EPHEMERAL });
      if (action === 'end') {
        if (!g || !g.active) return interaction.reply({ content: '❌ Dieses Giveaway ist bereits beendet.', ...EPHEMERAL });
        const winners = await finalizeGiveaway(client, g, interaction.user.id);
        return interaction.reply({ content: winners.length ? `✅ Giveaway beendet. Gewinner: ${winners.map(w => `<@${w}>`).join(', ')}` : '✅ Giveaway beendet. Keine Teilnehmer.', ...EPHEMERAL });
      } else {
        const res = await rerollGiveaway(client, id, interaction.user.id);
        if (!res.ok) return interaction.reply({ content: `❌ ${res.error}`, ...EPHEMERAL });
        const winText = res.winners.length ? res.winners.map(w => `<@${w}>`).join(', ') : 'Keine Teilnehmer übrig 😔';
        return interaction.reply({ content: `🔁 Neu gezogen: ${winText}`, ...EPHEMERAL });
      }
    }
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('bww_selfroles_')) {
    const messageId = interaction.customId.slice('bww_selfroles_'.length);
    const panel = config.selfRoles?.panels?.[messageId];
    if (!panel || interaction.message?.id !== messageId) return interaction.reply({ content: '❌ Dieses Self-Role-Panel ist nicht mehr konfiguriert.', ...EPHEMERAL });
    const botMember = await interaction.guild.members.fetchMe();
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const configuredRoles = [];
    for (const roleId of panel.roleIds || []) {
      const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
      if (role && selfRoleIsAssignable(role, botMember)) configuredRoles.push(role);
    }
    if (!configuredRoles.length) return interaction.reply({ content: '❌ Für dieses Panel sind keine gültigen, vom Bot verwaltbaren Rollen mehr vorhanden.', ...EPHEMERAL });
    const allowedIds = new Set(configuredRoles.map(role => role.id));
    const selectedIds = new Set(interaction.values.filter(id => allowedIds.has(id)));
    const removeIds = configuredRoles.filter(role => member.roles.cache.has(role.id) && !selectedIds.has(role.id)).map(role => role.id);
    const addIds = configuredRoles.filter(role => selectedIds.has(role.id) && !member.roles.cache.has(role.id)).map(role => role.id);
    try {
      if (removeIds.length) await member.roles.remove(removeIds, 'Self-Role-Auswahl');
      if (addIds.length) await member.roles.add(addIds, 'Self-Role-Auswahl');
      const selectedNames = configuredRoles.filter(role => selectedIds.has(role.id)).map(role => role.name);
      return interaction.reply({ content: selectedNames.length ? '✅ Deine Rollen wurden aktualisiert: ' + selectedNames.map(name => '**' + name + '**').join(', ') : '✅ Deine Self-Rollen wurden entfernt.', ...EPHEMERAL });
    } catch (error) {
      console.error('[BWW Self-Roles] Rollenänderung fehlgeschlagen:', error.message);
      return interaction.reply({ content: '❌ Rollen konnten nicht geändert werden. Prüfe die Rollenposition und die Berechtigung „Rollen verwalten“ des Bots.', ...EPHEMERAL });
    }
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'bww_ticket_select') {
    const reason = TICKET_REASONS.find(r => r.value === interaction.values[0]);
    const res = await createTicket(interaction.guild, config, interaction.user, reason ? reason.label : interaction.values[0]);
    if (!res.ok) return interaction.reply({ content: `❌ ${res.error}`, ...EPHEMERAL });
    return interaction.reply({ content: `✅ Ticket erstellt: ${res.channel}`, ...EPHEMERAL });
  }
  if (!interaction.isChatInputCommand()) return;
  const command = interaction.commandName;
  if (command === 'selfrollen-panel') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Nur Administratoren dürfen Self-Role-Panels erstellen.', ...EPHEMERAL });
    const channel = interaction.options.getChannel('kanal', true);
    if (!channel.isTextBased() || !channel.messages) return interaction.reply({ content: '❌ Bitte wähle einen normalen Textkanal.', ...EPHEMERAL });
    const botMember = await interaction.guild.members.fetchMe();
    const channelPermissions = channel.permissionsFor(botMember);
    if (!channelPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return interaction.reply({ content: '❌ Mir fehlen im Zielkanal die Rechte zum Ansehen, Schreiben oder Einbetten von Links.', ...EPHEMERAL });
    const roleIds = [];
    for (let i = 1; i <= 10; i++) {
      const role = interaction.options.getRole('rolle' + i);
      if (!role) continue;
      if (roleIds.includes(role.id)) continue;
      if (!selfRoleIsAssignable(role, botMember)) return interaction.reply({ content: '❌ Die Rolle **' + role.name + '** ist nicht als Self-Role geeignet. Sie ist verwaltet, zu hoch oder besitzt gefährliche Berechtigungen.', ...EPHEMERAL });
      roleIds.push(role.id);
    }
    if (!roleIds.length) return interaction.reply({ content: '❌ Gib mindestens eine Rolle über rolle1 bis rolle10 an.', ...EPHEMERAL });
    const roles = roleIds.map(id => interaction.guild.roles.cache.get(id)).filter(Boolean);
    const title = (interaction.options.getString('titel') || 'Wähle deine Rollen').slice(0, 200);
    const description = (interaction.options.getString('beschreibung') || 'Wähle eine oder mehrere Rollen aus dem Menü. Deine Auswahl kannst du jederzeit ändern.').slice(0, 1800);
    const message = await channel.send({ content: '**' + title + '**\n' + description + '\n\n' + roles.map(role => '• ' + role.name).join('\n'), allowedMentions: { parse: [] } });
    await message.edit({ components: [buildSelfRoleRow(message.id, roles)], allowedMentions: { parse: [] } });
    config.selfRoles = config.selfRoles || { panels: {} };
    config.selfRoles.panels = config.selfRoles.panels || {};
    config.selfRoles.panels[message.id] = { channelId: channel.id, roleIds };
    await saveGuildSettings(interaction.guildId, config, interaction.user.id);
    return interaction.reply({ content: '✅ Self-Role-Panel wurde in ' + channel + ' erstellt. Mitglieder können ihre Rollen jetzt selbst auswählen.', ...EPHEMERAL });
  }
  if (command.startsWith('einheit-')) return handleUnitCommand(interaction, config);
  if (command.startsWith('setup-')) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Nur Administratoren dürfen das Setup ändern.', ...EPHEMERAL });
    if (command === 'setup-welcome') { config.welcome = { enabled: true, channelId: interaction.options.getChannel('channel').id, title: interaction.options.getString('title') || '', message: interaction.options.getString('text', true) }; await saveGuildSettings(interaction.guildId, config, interaction.user.id); return interaction.reply({ content: '✅ Welcome-System gespeichert.', ...EPHEMERAL }); }
    if (command === 'setup-verify') { config.verify = { enabled: true, channelId: interaction.options.getChannel('channel').id, roleId: interaction.options.getRole('role').id, message: interaction.options.getString('text', true) }; await saveGuildSettings(interaction.guildId, config, interaction.user.id); return interaction.reply({ content: '✅ Verify-System gespeichert.', ...EPHEMERAL }); }
    if (command === 'setup-ticket') { config.ticket = { enabled: true, categoryId: interaction.options.getChannel('kategorie').id, roleId: interaction.options.getRole('rolle').id }; await saveGuildSettings(interaction.guildId, config, interaction.user.id); return interaction.reply({ content: '✅ Ticket-System gespeichert.', ...EPHEMERAL }); }
    if (command === 'setup-status') {
      const channel = interaction.options.getChannel('channel');
      try {
        const sent = await createStatusMessage(channel, 'online', { reason: 'Initial' });
        config.status = { enabled: true, channelId: channel.id, messageId: sent.id, mode: 'online' };
        await saveGuildSettings(interaction.guildId, config, interaction.user.id);
        return interaction.reply({ content: `✅ Status-Embed in ${channel} erstellt (🟢 Online).`, ...EPHEMERAL });
      } catch (err) { return interaction.reply({ content: `❌ Status-Embed fehlgeschlagen: ${err.message}`, ...EPHEMERAL }); }
    }
    const name = interaction.options.getString('command', true); const role = interaction.options.getRole('role'); const allow = interaction.options.getBoolean('erlauben', true); config.permissions[name] ||= []; if (allow && !config.permissions[name].includes(role.id)) config.permissions[name].push(role.id); if (!allow) config.permissions[name] = config.permissions[name].filter(id => id !== role.id); await saveGuildSettings(interaction.guildId, config, interaction.user.id); return interaction.reply({ content: `✅ Rolle ${role} für /${name} ${allow ? 'erlaubt' : 'entfernt'}.`, ...EPHEMERAL });
  }
  if (command === 'restart') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Nur Administratoren dürfen den Bot neu starten.', ...EPHEMERAL });
    await interaction.reply({ content: '🔄 Bot wird neu gestartet…', ...EPHEMERAL }); setTimeout(() => process.exit(0), 1000); return;
  }
  if (command === 'wartung') {
    if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
    const aktiv = interaction.options.getBoolean('aktiv', true);
    const grund = interaction.options.getString('grund') || '';
    const mode = aktiv ? 'maintenance' : 'online';
    config.status = config.status || {};
    config.status.mode = mode;
    await saveGuildSettings(interaction.guildId, config, interaction.user.id);
    const ok = await updateStatusMessage(client, interaction.guildId, mode, { reason: grund });
    return interaction.reply({ content: ok ? `${aktiv ? '🟡 Wartung aktiviert' : '🟢 Wartung deaktiviert'}${grund ? ': ' + grund : ''}` : `✅ Modus auf ${mode} gesetzt (kein Status-Channel konfiguriert).`, ...EPHEMERAL });
  }
  if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
  if (command === 'panel-create') {
    if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
    const rawName = interaction.options.getString('name', true);
    const name = rawName.toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 32);
    if (!name) return interaction.reply({ content: '❌ Ungültiger Panel-Name (nur a-z0-9-_).', ...EPHEMERAL });
    const intro = interaction.options.getString('intro') || '';
    const buttons = [];
    for (let i = 1; i <= 10; i++) {
      const label = interaction.options.getString(`button${i}_label`);
      const text = interaction.options.getString(`button${i}_text`);
      if (label && text) buttons.push({ label: label.slice(0, 80), text });
      else if (label || text) return interaction.reply({ content: `❌ Button ${i} braucht Label UND Text.`, ...EPHEMERAL });
    }
    if (!buttons.length) return interaction.reply({ content: '❌ Mindestens ein Button (Label+Text) nötig.', ...EPHEMERAL });
    const panel = { intro: intro || `Panel ${name}`, buttons, messages: [], createdAt: Date.now(), createdBy: interaction.user.id };
    setPanel(name, panel);
    try { const sent = await interaction.channel.send({ components: [panelContainer(panel, name)], flags: V2, allowedMentions: { parse: [] } }); addPanelMessage(name, sent.channelId || interaction.channelId, sent.id); return interaction.reply({ content: `✅ Panel \`${name}\` gespeichert und gesendet (${buttons.length} Buttons).`, ...EPHEMERAL }); } catch (err) { return interaction.reply({ content: `❌ Panel gespeichert, Senden fehlgeschlagen: ${err.message}`, ...EPHEMERAL }); }
  }
  if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
  if (command === 'panel-add-button') {
    if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
    const name = interaction.options.getString('name', true).toLowerCase();
    const panel = getPanel(name);
    if (!panel) return interaction.reply({ content: `❌ Panel \`${name}\` nicht gefunden.`, ...EPHEMERAL });
    if (panel.buttons.length >= 50) return interaction.reply({ content: '❌ Max 50 Buttons erreicht.', ...EPHEMERAL });
    const label = interaction.options.getString('label', true).slice(0, 80);
    const text = interaction.options.getString('text', true);
    panel.buttons.push({ label, text });
    setPanel(name, panel);
    return interaction.reply({ content: `✅ Button \`${label}\` zu Panel \`${name}\` hinzugefügt (${panel.buttons.length} total). Nutze \`/panel-send name:${name}\` zum Aktualisieren.`, ...EPHEMERAL });
  }
  if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
  if (command === 'panel-send') {
    if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
    const name = interaction.options.getString('name', true).toLowerCase();
    const panel = getPanel(name);
    if (!panel) return interaction.reply({ content: `❌ Panel \`${name}\` nicht gefunden.`, ...EPHEMERAL });
    try { const sent = await interaction.channel.send({ components: [panelContainer(panel, name)], flags: V2 }); addPanelMessage(name, sent.channelId || interaction.channelId, sent.id); return interaction.reply({ content: `✅ Panel \`${name}\` gesendet.`, ...EPHEMERAL }); } catch (err) { return interaction.reply({ content: `❌ Senden fehlgeschlagen: ${err.message}`, ...EPHEMERAL }); }
  }
  if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
  if (command === 'panel-delete') {
    if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
    const name = interaction.options.getString('name', true).toLowerCase();
    const panel = getPanel(name);
    if (!panel) return interaction.reply({ content: `❌ Panel \`${name}\` nicht gefunden.`, ...EPHEMERAL });
    let deletedCount = 0;
    const msgs = panel.messages || [];
    for (const m of msgs) {
      try {
        const ch = await client.channels.fetch(m.channelId).catch(() => null);
        if (!ch || !ch.isTextBased()) continue;
        const msg = await ch.messages.fetch(m.messageId).catch(() => null);
        if (msg) { await msg.delete().catch(() => {}); deletedCount++; }
      } catch {}
    }
    deletePanel(name);
    return interaction.reply({ content: `✅ Panel \`${name}\` gelöscht (${deletedCount} Nachricht(en) entfernt).`, ...EPHEMERAL });
  }
  if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
  if (command === 'panel-list') {
    if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
    const panels = loadPanels();
    const names = Object.keys(panels);
    if (!names.length) return interaction.reply({ content: '📭 Keine Panels gespeichert.', ...EPHEMERAL });
    const container = new ContainerBuilder().setAccentColor(0x2F3136);
    const lines = names.map(n => `• \`${n}\` – ${panels[n].buttons.length} Buttons – ${(panels[n].intro || '').slice(0, 80)}`).join('\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Gespeicherte Panels (${names.length})\n${lines}`));
    return interaction.reply({ components: [container], flags: EPHEMERAL_V2 });
  }
  if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
  if (command === 'kick') {
    const member = interaction.options.getMember('user'); const reason = interaction.options.getString('grund') || 'Kein Grund angegeben';
    if (!member) return interaction.reply({ content: '❌ Mitglied nicht gefunden.', ...EPHEMERAL });
    if (!member.kickable) return interaction.reply({ content: '❌ Ich kann dieses Mitglied nicht kicken.', ...EPHEMERAL });
    try { await member.kick(reason); } catch { return interaction.reply({ content: '❌ Kick fehlgeschlagen.', ...EPHEMERAL }); }
    return interaction.reply({ content: `👢 ${member.user.tag} wurde gekickt.\n**Grund:** ${reason}`, ...EPHEMERAL });
  }
  if (command === 'ban') {
    const user = interaction.options.getUser('user'); const reason = interaction.options.getString('grund') || 'Kein Grund angegeben';
    if (!user) return interaction.reply({ content: '❌ Benutzer nicht gefunden.', ...EPHEMERAL });
    try { await interaction.guild.bans.create(user.id, { reason }); } catch { return interaction.reply({ content: '❌ Ban fehlgeschlagen. Prüfe Rechte/Rollenposition.', ...EPHEMERAL }); }
    return interaction.reply({ content: `🔨 ${user.tag} wurde gebannt.\n**Grund:** ${reason}`, ...EPHEMERAL });
  }
  if (command === 'unban') {
    const user = interaction.options.getUser('user'); if (!user) return interaction.reply({ content: '❌ Benutzer nicht gefunden.', ...EPHEMERAL });
    try { await interaction.guild.bans.remove(user.id); } catch { return interaction.reply({ content: '❌ Unban fehlgeschlagen (war der User gebannt?).', ...EPHEMERAL }); }
    return interaction.reply({ content: `✅ ${user.tag} wurde entbannt.`, ...EPHEMERAL });
  }
  if (command === 'timeout') {
    const member = interaction.options.getMember('user'); const minutes = interaction.options.getInteger('dauer'); const reason = interaction.options.getString('grund') || 'Kein Grund angegeben';
    if (!member) return interaction.reply({ content: '❌ Mitglied nicht gefunden.', ...EPHEMERAL });
    if (!member.moderatable) return interaction.reply({ content: '❌ Ich kann dieses Mitglied nicht pausieren.', ...EPHEMERAL });
    const ms = minutes * 60 * 1000; try { await member.timeout(ms, reason); } catch { return interaction.reply({ content: '❌ Timeout fehlgeschlagen.', ...EPHEMERAL }); }
    return interaction.reply({ content: `⏰ ${member.user.tag} wurde für ${minutes} Minute(n) pausiert.\n**Grund:** ${reason}`, ...EPHEMERAL });
  }
  if (command === 'giverole') {
    const member = interaction.options.getMember('user'); const role = interaction.options.getRole('rolle');
    if (!member) return interaction.reply({ content: '❌ Mitglied nicht gefunden.', ...EPHEMERAL });
    if (!role) return interaction.reply({ content: '❌ Rolle nicht gefunden.', ...EPHEMERAL });
    if (member.roles.cache.has(role.id)) return interaction.reply({ content: '❌ Der User hat die Rolle bereits.', ...EPHEMERAL });
    try { await member.roles.add(role); } catch { return interaction.reply({ content: '❌ Rolle konnte nicht vergeben werden. Prüfe Hierarchie.', ...EPHEMERAL }); }
    return interaction.reply({ content: `✅ ${member.user.tag} hat die Rolle ${role} erhalten.`, ...EPHEMERAL });
  }
  if (command === 'removerole') {
    const member = interaction.options.getMember('user'); const role = interaction.options.getRole('rolle');
    if (!member) return interaction.reply({ content: '❌ Mitglied nicht gefunden.', ...EPHEMERAL });
    if (!role) return interaction.reply({ content: '❌ Rolle nicht gefunden.', ...EPHEMERAL });
    if (!member.roles.cache.has(role.id)) return interaction.reply({ content: '❌ Der User hat diese Rolle nicht.', ...EPHEMERAL });
    try { await member.roles.remove(role); } catch { return interaction.reply({ content: '❌ Rolle konnte nicht entfernt werden.', ...EPHEMERAL }); }
    return interaction.reply({ content: `✅ ${member.user.tag} wurde die Rolle ${role} entfernt.`, ...EPHEMERAL });
  }
  if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
  if (command === 'nachricht-wiederholen') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Nur Administratoren dürfen wiederkehrende Nachrichten einrichten.', ...EPHEMERAL });
    const text = interaction.options.getString('text', true).slice(0, 4000);
    const amount = interaction.options.getInteger('intervall', true);
    const unit = interaction.options.getString('einheit', true);
    const multipliers = { minuten: 60_000, stunden: 3_600_000, tage: 86_400_000 };
    const intervalMs = amount * multipliers[unit];
    if (!multipliers[unit] || intervalMs < 60_000 || intervalMs > 365 * 86_400_000) return interaction.reply({ content: '❌ Ungültiges Intervall.', ...EPHEMERAL });
    const channel = interaction.options.getChannel('kanal') || interaction.channel;
    if (!channel?.isTextBased()) return interaction.reply({ content: '❌ Bitte einen Textkanal auswählen.', ...EPHEMERAL });
    const attachment = interaction.options.getAttachment('bild');
    const color = interaction.options.getString('farbe') || '#5865F2';
    const id = Math.random().toString(36).slice(2, 8).toUpperCase();
    const schedule = { id, active: true, channelId: channel.id, text, image: attachment?.url || '', color, intervalMs, intervalLabel: `${amount} ${unit}`, nextRunAt: new Date(Date.now() + intervalMs).toISOString(), createdAt: new Date().toISOString(), createdBy: interaction.user.id };
    config.recurringMessages = [...(config.recurringMessages || []), schedule];
    try {
      await saveGuildSettings(interaction.guildId, config, interaction.user.id);
      const container = embedV2({ description: text, image: schedule.image, color });
      await channel.send({ components: [container], flags: V2, allowedMentions: { parse: [] } });
      return interaction.reply({ content: `✅ Wiederholung eingerichtet (ID: \`${id}\`). Erste Nachricht wurde gesendet. Nächste Sendung in ${amount} ${unit}. Stoppen mit \`/wiederholung-stoppen id:${id}\`.`, ...EPHEMERAL });
    } catch (err) { return interaction.reply({ content: `❌ Wiederholung konnte nicht eingerichtet werden: ${err.message}`, ...EPHEMERAL }); }
  }
  if (command === 'wiederholung-stoppen') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Nur Administratoren dürfen Wiederholungen stoppen.', ...EPHEMERAL });
    const id = interaction.options.getString('id', true).trim().toUpperCase();
    const item = (config.recurringMessages || []).find(entry => entry.id === id && entry.active);
    if (!item) return interaction.reply({ content: '❌ Keine aktive Wiederholung mit dieser ID gefunden.', ...EPHEMERAL });
    item.active = false; item.stoppedAt = new Date().toISOString();
    await saveGuildSettings(interaction.guildId, config, interaction.user.id);
    return interaction.reply({ content: `🛑 Wiederholung \`${id}\` wurde deaktiviert.`, ...EPHEMERAL });
  }
  if (command === 'wiederholung-liste') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Nur Administratoren dürfen Wiederholungen anzeigen.', ...EPHEMERAL });
    const active = (config.recurringMessages || []).filter(entry => entry.active);
    if (!active.length) return interaction.reply({ content: '📭 Es gibt keine aktiven Wiederholungen.', ...EPHEMERAL });
    const lines = active.map(entry => `• ID \`${entry.id}\` – <#${entry.channelId}> – alle ${entry.intervalLabel}`).join('\n');
    return interaction.reply({ content: `**Aktive Wiederholungen**\n${lines}`, ...EPHEMERAL });
  }
  if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
  if (command === 'embed') {
    if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
    const text = interaction.options.getString('text', true);
    const title = interaction.options.getString('titel') || '';
    const attachment = interaction.options.getAttachment('bild');
    const image = attachment?.url || interaction.options.getString('bild_url') || '';
    const thumbnail = interaction.options.getString('thumbnail') || '';
    const color = interaction.options.getString('farbe') || '';
    const footer = interaction.options.getString('footer') || '';
    const container = embedV2({ title, description: text, image, thumbnail, color, footer });
    try {
      const message = await interaction.channel.send({ components: [container], flags: V2, allowedMentions: { parse: [] } });
      await supabaseRequest('bww_embed_messages', { method: 'POST', body: JSON.stringify({ guild_id: interaction.guildId, channel_id: interaction.channelId, message_id: message.id, payload: { title, description: text, image, thumbnail, color, footer }, created_by: interaction.user.id }) });
      return interaction.reply({ content: '✅ Components-V2-Embed gesendet und für spätere Bearbeitung gespeichert. Nachrichten-ID: `' + message.id + '`', ...EPHEMERAL });
    } catch (err) {
      return interaction.reply({ content: `❌ Components-V2-Embed konnte nicht gesendet werden: ${err.message}`, ...EPHEMERAL });
    }
  }
  if (command === 'nachricht') {
    const text = interaction.options.getString('text', true);
    const title = interaction.options.getString('titel') || '';
    const image = interaction.options.getString('bild') || '';
    const container = embedV2({ title, description: text, image });
    try {
      await interaction.channel.send({ components: [container], flags: V2, allowedMentions: { parse: [] } });
      return interaction.reply({ content: '✅ Components-V2-Embed gesendet.', ...EPHEMERAL });
    } catch (err) {
      return interaction.reply({ content: `❌ Components-V2-Embed konnte nicht gesendet werden: ${err.message}`, ...EPHEMERAL });
    }
  }
  if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
  if (command === 'dashboard-code') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: '❌ Nur Server-Administratoren dürfen Dashboard-Codes erstellen.', ...EPHEMERAL });
    const code = await issueDashboardCode(interaction.guildId, interaction.user.id);
    return interaction.reply({ content: '**Dashboard-Login-Code**\n\n`' + code + '`\n\nDer Code ist einmalig und 5 Minuten gültig. Öffne das BWW-Dashboard und gib ihn dort ein. Teile ihn mit niemandem.', ...EPHEMERAL });
  }
  if (command === 'raid-schutz') {
    const current = await getRaidSettings(interaction.guildId);
    const next = { ...current, enabled: interaction.options.getBoolean('aktiv', true), joinThreshold: interaction.options.getInteger('beitritte') ?? current.joinThreshold, windowSeconds: interaction.options.getInteger('zeitfenster') ?? current.windowSeconds, minAccountAgeDays: interaction.options.getInteger('kontoalter') ?? current.minAccountAgeDays, autoLockdown: true };
    await saveRaidSettings(interaction.guildId, next, interaction.user.id);
    return interaction.reply({ content: '✅ Raid-Schutz ' + (next.enabled ? 'aktiviert' : 'deaktiviert') + '. Schwelle: ' + next.joinThreshold + ' Beitritte in ' + next.windowSeconds + ' Sekunden; Mindest-Kontoalter: ' + next.minAccountAgeDays + ' Tage.', ...EPHEMERAL });
  }
  if (command === 'raid-lockdown') {
    const id = await lockdownGuild(interaction.guild, interaction.user.id, 'Manueller Lockdown durch ' + interaction.user.tag);
    return interaction.reply({ content: '🔒 Raid-Lockdown aktiviert. ID: `' + id + '`', ...EPHEMERAL });
  }
  if (command === 'raid-entsperren') {
    const restored = await restoreGuild(interaction.guild, interaction.user.id);
    return interaction.reply({ content: restored ? '🔓 Lockdown aufgehoben; vorherige Kanalrechte wurden wiederhergestellt.' : 'ℹ️ Es ist kein aktiver Lockdown vorhanden.', ...EPHEMERAL });
  }
  if (command === 'dm-senden') {
    const recipient = interaction.options.getUser('user', true);
    const message = interaction.options.getString('nachricht', true);
    if (recipient.bot || recipient.id === interaction.user.id) return interaction.reply({ content: '❌ Bitte wähle einen anderen Nutzer (keinen Bot).', ...EPHEMERAL });
    const id = await openDmThread(interaction.guildId, interaction.user.id, recipient, message);
    return interaction.reply({ content: '✅ DM an <@' + recipient.id + '> gesendet. Antworten werden dir per DM weitergeleitet. Dialog-ID: `' + id + '`', ...EPHEMERAL });
  }
  if (command === 'personalakte' || command === 'personalakte-setzen' || command === 'personalakte-befordern' || command === 'personalakte-verwarnen' || command === 'personalakte-aktivitaet') {
    const target = interaction.options.getUser('user', true);
    if (target.bot) return interaction.reply({ content: '❌ Bots erhalten keine Personalakte.', ...EPHEMERAL });
    if (command === 'personalakte') {
      const record = await personnel.ensureRecord(interaction.guildId, target.id, interaction.user.id);
      const [events, unitName] = await Promise.all([personnel.getEvents(interaction.guildId, target.id), personnel.getUnitName(record.unit_id, interaction.guildId)]);
      const promotions = events.filter((event) => event.event_type === 'promotion');
      const warnings = events.filter((event) => event.event_type === 'warning');
      const activity = events.filter((event) => event.event_type === 'activity');
      const history = events.slice(0, 8).map((event) => '• ' + event.event_type + ': ' + (event.new_value || event.details?.reason || event.details?.description || '—') + ' (<t:' + Math.floor(new Date(event.created_at).getTime() / 1000) + ':R>)').join('\n') || 'Noch keine Einträge.';
      const text = '## Digitale Personalakte\n**Soldat:** <@' + target.id + '>\n**Rang:** ' + record.rank + '\n**Einheit:** ' + unitName + '\n**Eintritt:** ' + (record.joined_at || 'Nicht hinterlegt') + '\n**Beförderungen:** ' + promotions.length + '\n**Verwarnungen:** ' + warnings.length + '\n**Aktivitätseinträge:** ' + activity.length + '\n\n**Verlauf**\n' + history;
      return interaction.reply({ content: text.slice(0, 1950), ...EPHEMERAL });
    }
    if (command === 'personalakte-setzen') {
      const rank = interaction.options.getString('rang', true).slice(0, 100);
      const joined = interaction.options.getString('eintritt');
      const unitName = interaction.options.getString('einheit');
      if (joined && !/^\d{4}-\d{2}-\d{2}$/.test(joined)) return interaction.reply({ content: '❌ Eintrittsdatum muss YYYY-MM-DD sein.', ...EPHEMERAL });
      let unitId = null;
      if (unitName) {
        const unit = (await listUnits(interaction.guildId)).find((item) => item.name.toLowerCase() === unitName.toLowerCase());
        if (!unit) return interaction.reply({ content: '❌ Einheit nicht gefunden.', ...EPHEMERAL });
        unitId = unit.id;
      }
      const before = await personnel.ensureRecord(interaction.guildId, target.id, interaction.user.id);
      const patch = { rank, ...(joined ? { joined_at: joined } : {}), ...(unitName ? { unit_id: unitId } : {}) };
      await personnel.updateRecord(interaction.guildId, target.id, interaction.user.id, patch);
      await personnel.addEvent(interaction.guildId, target.id, interaction.user.id, 'rank_change', before.rank, rank, { unitName: unitName || null, joinedAt: joined || null });
      return interaction.reply({ content: '✅ Personalakte von <@' + target.id + '> aktualisiert.', ...EPHEMERAL });
    }
    if (command === 'personalakte-befordern') {
      const nextRank = interaction.options.getString('neuer_rang', true).slice(0, 100);
      const reason = interaction.options.getString('grund') || '';
      const before = await personnel.ensureRecord(interaction.guildId, target.id, interaction.user.id);
      await personnel.updateRecord(interaction.guildId, target.id, interaction.user.id, { rank: nextRank });
      await personnel.addEvent(interaction.guildId, target.id, interaction.user.id, 'promotion', before.rank, nextRank, { reason: reason.slice(0, 500) });
      return interaction.reply({ content: '🎖️ <@' + target.id + '> wurde in der Personalakte von **' + before.rank + '** zu **' + nextRank + '** befördert.', ...EPHEMERAL });
    }
    if (command === 'personalakte-verwarnen') {
      const reason = interaction.options.getString('grund', true).slice(0, 1000);
      await personnel.ensureRecord(interaction.guildId, target.id, interaction.user.id);
      await personnel.addEvent(interaction.guildId, target.id, interaction.user.id, 'warning', null, reason, {});
      return interaction.reply({ content: '⚠️ Verwarnung in der Personalakte von <@' + target.id + '> eingetragen.', ...EPHEMERAL });
    }
    const description = interaction.options.getString('beschreibung', true).slice(0, 1000);
    await personnel.ensureRecord(interaction.guildId, target.id, interaction.user.id);
    await personnel.updateRecord(interaction.guildId, target.id, interaction.user.id, { last_activity_at: new Date().toISOString() });
    await personnel.addEvent(interaction.guildId, target.id, interaction.user.id, 'activity', null, description, {});
    return interaction.reply({ content: '✅ Aktivität in der Personalakte von <@' + target.id + '> dokumentiert.', ...EPHEMERAL });
  }
  if (command === 'embed-bearbeiten') {
    const messageId = interaction.options.getString('nachricht_id', true);
    const response = await supabaseRequest('bww_embed_messages?select=*&guild_id=eq.' + interaction.guildId + '&message_id=eq.' + messageId + '&limit=1', { headers: { Prefer: 'return=representation' } });
    const [record] = await response.json();
    if (!record) return interaction.reply({ content: '❌ Diese Nachricht ist nicht als bearbeitbares BWW-Embed gespeichert. Nutze zuerst /embed.', ...EPHEMERAL });
    const payload = { ...record.payload };
    const title = interaction.options.getString('titel');
    const description = interaction.options.getString('text');
    const image = interaction.options.getString('bild_url');
    if (title !== null) payload.title = title;
    if (description !== null) payload.description = description;
    if (image !== null) payload.image = image;
    if (title === null && description === null && image === null) return interaction.reply({ content: '❌ Gib mindestens titel, text oder bild_url an.', ...EPHEMERAL });
    const channel = await interaction.guild.channels.fetch(record.channel_id);
    const message = await channel.messages.fetch(record.message_id);
    await message.edit({ components: [embedV2(payload)], flags: V2, allowedMentions: { parse: [] } });
    await supabaseRequest('bww_embed_messages?id=eq.' + record.id, { method: 'PATCH', body: JSON.stringify({ payload, updated_by: interaction.user.id, updated_at: new Date().toISOString() }) });
    return interaction.reply({ content: '✅ Components-V2-Embed wurde bearbeitet.', ...EPHEMERAL });
  }
  if (command === 'ticket') {
    try { await interaction.channel.send({ components: [ticketContainer(config)], flags: V2 }); return interaction.reply({ content: '✅ Ticket-Panel gesendet.', ...EPHEMERAL }); } catch (err) { return interaction.reply({ content: `❌ Ticket-Panel fehlgeschlagen: ${err.message}`, ...EPHEMERAL }); }
  }
  if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
  if (command === 'giveaway') {
    const prize = interaction.options.getString('preis', true); const winners = Math.max(1, interaction.options.getInteger('gewinner') || 1); const durationMs = interaction.options.getInteger('dauer') * 1000 || 60000;
    try {
      const requiredRole = interaction.options.getRole('pflichtrolle');
      const bonusRole = interaction.options.getRole('bonusrolle');
      const bonusEntries = interaction.options.getInteger('bonuslose') || 0;
      if (bonusEntries > 0 && !bonusRole) return interaction.reply({ content: '❌ Für Bonuslose musst du auch eine Bonusrolle auswählen.', ...EPHEMERAL });
      const created = await startGiveaway(interaction.channel, prize, durationMs, winners, {
        guildId: interaction.guildId, createdBy: interaction.user.id,
        conditions: interaction.options.getString('bedingungen') || '',
        requiredRoleId: requiredRole?.id || '',
        minAccountAgeDays: interaction.options.getInteger('kontoalter') || 0,
        minServerAgeDays: interaction.options.getInteger('serveralter') || 0,
        bonusRoleId: bonusRole?.id || '', bonusEntries
      });
      return interaction.reply({ content: '✅ Giveaway gestartet! ID: `' + created.id + '`', ...EPHEMERAL });
    } catch (err) { return interaction.reply({ content: `❌ Giveaway fehlgeschlagen: ${err.message}`, ...EPHEMERAL }); }
  }
  if (!isAllowed(interaction, config)) return interaction.reply({ content: '❌ Du darfst diesen Command nicht benutzen.', ...EPHEMERAL });
  if (command === 'giveaway-protokoll') {
    if (!hasGiveawayManagePermission(interaction, config)) return interaction.reply({ content: '❌ Du darfst das Giveaway-Protokoll nicht einsehen.', ...EPHEMERAL });
    const id = interaction.options.getString('id', true).trim();
    const events = await getGiveawayAudit(interaction.guildId, id);
    if (!events.length) return interaction.reply({ content: '📭 Für diese Giveaway-ID wurde kein Protokoll gefunden.', ...EPHEMERAL });
    const labels = { created: 'Erstellt', joined: 'Teilnahme', left: 'Teilnahme zurückgezogen', ended: 'Beendet', reroll: 'Neuziehung' };
    const lines = events.map(event => {
      const when = Math.floor(new Date(event.created_at).getTime() / 1000);
      const actor = event.actor_id ? '<@' + event.actor_id + '>' : 'System';
      const detail = event.event_type === 'joined' ? ' · Lose: ' + (event.details?.entryCount || 1) :
        event.event_type === 'ended' || event.event_type === 'reroll' ? ' · Gewinner: ' + ((event.details?.winners || []).map(id => '<@' + id + '>').join(', ') || 'Keine') : '';
      return '• <t:' + when + ':f> — **' + (labels[event.event_type] || event.event_type) + '** — ' + actor + detail;
    });
    return interaction.reply({ content: ('## Giveaway-Protokoll · ' + id + '\n' + lines.join('\n')).slice(0, 1900), ...EPHEMERAL });
  }
  if (command === 'verify') {
    try { config.verify.channelId = interaction.channelId; config.verify.enabled = true; await saveGuildSettings(interaction.guildId, config, interaction.user.id); await interaction.channel.send({ components: [verifyComponents(config)], flags: V2, allowedMentions: { parse: [] } }); return interaction.reply({ content: '✅ Verify-Panel gesendet.', ...EPHEMERAL }); } catch (err) { return interaction.reply({ content: `❌ Verify-Panel fehlgeschlagen: ${err.message}`, ...EPHEMERAL }); }
  }
  if (command === 'setup') {
    const container = new ContainerBuilder().setAccentColor(0x2F3136);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('## BWW Setup\n`/setup-welcome` [channel] [text] [title?] → Welcome\n`/setup-verify` → Verify\n`/setup-ticket` [kategorie] [rolle] → Ticket\n`/setup-status` [channel] → Status-Embed\n`/setup-permission` → Command-Berechtigungen\n`/restart` → Bot neu starten\n`/wartung` → Wartung an/aus\n`/panel-create` → Custom Panel (10 Buttons) speichern+senden\n`/panel-add-button` → Button hinzufügen\n`/panel-send`/`/panel-delete`/`/panel-list` → Panels verwalten\n`/nachricht-wiederholen` → Nachricht regelmäßig senden\n`/wiederholung-stoppen`/`/wiederholung-liste` → Wiederholungen verwalten\n`/embed` → Embed mit HEX-Farbe und Bild-Upload\n`/kick`, `/ban`, `/unban`, `/timeout` → Moderation\n`/giverole`, `/removerole` → Rollen verwalten\n`/selfrollen-panel` → Self-Role-Menü erstellen\n`/einheit-erstellen` → Kompanien, Züge und Gruppen\n`/einheit-liste`, `/einheit-info` → Einheiten anzeigen\n`/einheit-mitglied`, `/einheit-entfernen` → Personalverwaltung'));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**Welcome-Platzhalter:**\n`{user}` → Ping\n`{username}` → Name\n`{displayname}` → Server-Nickname\n`{server}` → Servername\n`{id}` → User-ID\n`{count}` → Mitgliederzahl\n\nDer Avatar des Users erscheint automatisch oben rechts.'));
    return interaction.reply({ components: [container], flags: EPHEMERAL_V2 });
  }
  } catch (err) {
    console.error('Interaction Handler Fehler:', err.stack || err.message);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Unerwarteter Fehler.', ...EPHEMERAL }).catch(() => {});
    }
  }
};
