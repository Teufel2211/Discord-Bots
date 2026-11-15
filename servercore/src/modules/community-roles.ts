import { canExecuteCommand, hasExplicitCommandAllow } from "./command-permissions.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
  Events, PermissionFlagsBits, PermissionsBitField, SlashCommandBuilder, StringSelectMenuBuilder,
  type Client
} from "discord.js";
import { randomUUID } from "node:crypto";
import type { createDatabase } from "../database.js";

type Database = ReturnType<typeof createDatabase>;
type PanelRole = { id: string; label: string };
type RolePanel = {
  panel_id: string; guild_id: string; channel_id: string; message_id: string;
  roles: PanelRole[]; selection_mode: "single" | "multiple";
};

const forbiddenSelfRolePermissions = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageEvents
];

function hasForbiddenSelfRolePermissions(permissions: string | Readonly<PermissionsBitField>): boolean {
  const bitfield = typeof permissions === "string"
    ? new PermissionsBitField(BigInt(permissions))
    : permissions;
  return forbiddenSelfRolePermissions.some((permission) => bitfield.has(permission));
}

function isSafeSelfRole(
  role: { id: string; managed: boolean; position: number; permissions: Readonly<PermissionsBitField> },
  guildId: string,
  botHighestRolePosition: number
): boolean {
  return role.id !== guildId &&
    !role.managed &&
    role.position < botHighestRolePosition &&
    !hasForbiddenSelfRolePermissions(role.permissions);
}


export const rolePanelCommand = new SlashCommandBuilder()
  .setName("rollenpanel")
  .setDescription("Erstellt ein Self-Role-Panel.")
  .addSubcommand((sub) => sub.setName("erstellen").setDescription("Veröffentlicht ein Rollen-Auswahlpanel.")
    .addChannelOption((o) => o.setName("kanal").setDescription("Textkanal").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((o) => o.setName("titel").setDescription("Titel des Panels").setMaxLength(100).setRequired(true))
    .addStringOption((o) => o.setName("beschreibung").setDescription("Beschreibung").setMaxLength(1000).setRequired(true))
    .addStringOption((o) => o.setName("rollen").setDescription("Eine Zeile pro Rolle: ID|Anzeigename (max. 25)").setMaxLength(2500).setRequired(true))
    .addStringOption((o) => o.setName("modus").setDescription("Auswahlmodus").addChoices({ name: "Einzelauswahl", value: "single" }, { name: "Mehrfachauswahl", value: "multiple" }).setRequired(true)));

export const verificationCommand = new SlashCommandBuilder()
  .setName("verifizierung")
  .setDescription("Konfiguriert das Server-Verifizierungssystem.")
  .addSubcommand((sub) => sub.setName("setup").setDescription("Erstellt ein Verifizierungs-Panel.")
    .addChannelOption((o) => o.setName("kanal").setDescription("Textkanal").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addRoleOption((o) => o.setName("verifiziert").setDescription("Rolle nach der Freigabe").setRequired(true))
    .addRoleOption((o) => o.setName("unverifiziert").setDescription("Optionale Rolle, die danach entfernt wird.")))
  .addSubcommand((sub) => sub.setName("deaktivieren").setDescription("Deaktiviert die Verifizierung."));

function parseRoles(raw: string): PanelRole[] | null {
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 1 || lines.length > 25) return null;
  const roles: PanelRole[] = [];
  for (const line of lines) {
    const [rawId, ...labelParts] = line.split("|");
    const id = rawId?.trim() ?? "";
    const label = labelParts.join("|").trim();
    if (!/^\d{17,20}$/.test(id) || !label || label.length > 100 || roles.some((role) => role.id === id)) return null;
    roles.push({ id, label });
  }
  return roles;
}

function roleMenu(panel: RolePanel): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("sc:roles:select:" + panel.panel_id)
    .setPlaceholder("Rollen auswählen")
    .setMinValues(1)
    .setMaxValues(panel.selection_mode === "single" ? 1 : panel.roles.length)
    .addOptions(panel.roles.map((role) => ({ label: role.label, value: role.id })));
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

export function attachCommunityRoles(client: Client, database: Database): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === "rollenpanel") {
        if (!(await canExecuteCommand(interaction, database))) return;
        if (!interaction.guild) {
          await interaction.reply({ content: "Dieser Befehl funktioniert nur auf einem Server.", ephemeral: true });
          return;
        }
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles) && !(await hasExplicitCommandAllow(interaction, database))) {
          await interaction.reply({ content: "Du benötigst die Berechtigung „Rollen verwalten“.", ephemeral: true });
          return;
        }
        const channelOption = interaction.options.getChannel("kanal", true);
        const channel = await interaction.guild.channels.fetch(channelOption.id);
        const roles = parseRoles(interaction.options.getString("rollen", true));
        if (!channel || channel.type !== ChannelType.GuildText) {
          await interaction.reply({ content: "Bitte wähle einen normalen Textkanal.", ephemeral: true });
          return;
        }
        if (!roles) {
          await interaction.reply({ content: "Ungültige Rollenliste. Verwende pro Zeile Rollen-ID|Anzeigename (1–25 Rollen).", ephemeral: true });
          return;
        }
        const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
        if (!channel.permissionsFor(botMember)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
          await interaction.reply({ content: "Mir fehlen im Zielkanal die Rechte zum Senden oder Einbetten.", ephemeral: true });
          return;
        }
        const actorMember = await interaction.guild.members.fetch(interaction.user.id);
        for (const item of roles) {
          const role = await interaction.guild.roles.fetch(item.id);
          if (!role || !isSafeSelfRole(role, interaction.guild.id, botMember.roles.highest.position) ||
              (interaction.guild.ownerId !== interaction.user.id && role.position >= actorMember.roles.highest.position)) {
            await interaction.reply({ content: "Die Rolle " + item.label + " kann vom Bot nicht sicher verwaltet werden. Prüfe die Rollen-Hierarchie.", ephemeral: true });
            return;
          }
        }
        await interaction.deferReply({ ephemeral: true });
        const panel: RolePanel = {
          panel_id: randomUUID(), guild_id: interaction.guild.id, channel_id: channel.id, message_id: "",
          roles, selection_mode: interaction.options.getString("modus", true) as "single" | "multiple"
        };
        const embed = new EmbedBuilder()
          .setColor(0x647dff)
          .setTitle(interaction.options.getString("titel", true))
          .setDescription(interaction.options.getString("beschreibung", true))
          .addFields({ name: "Auswahl", value: panel.selection_mode === "single" ? "Du kannst eine Rolle auswählen." : "Wähle Rollen aus, um sie hinzuzufügen oder wieder zu entfernen. Nicht ausgewählte Rollen bleiben unverändert." })
          .setFooter({ text: "ServerCore · Self-Role-Panels" });
        const message = await channel.send({ embeds: [embed], components: roleMenu(panel), allowedMentions: { parse: [] } });
        panel.message_id = message.id;
        try {
          await database.query(
            "INSERT INTO \"SC_role_panels\" (panel_id,guild_id,channel_id,message_id,title,description,roles,selection_mode,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)",
            [panel.panel_id, panel.guild_id, panel.channel_id, panel.message_id, embed.data.title, embed.data.description, JSON.stringify(panel.roles), panel.selection_mode, interaction.user.id]
          );
          await database.query(
            "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,'roles.panel_created',$3,$4::jsonb)",
            [panel.guild_id, interaction.user.id, panel.panel_id, JSON.stringify({ channelId: channel.id, roleCount: roles.length, mode: panel.selection_mode })]
          );
          await database.query(
            "INSERT INTO \"SC_module_settings\" (guild_id,module_key,enabled,config,updated_at) VALUES ($1,'role-panels',TRUE,'{}'::jsonb,NOW()) " +
            "ON CONFLICT (guild_id,module_key) DO UPDATE SET enabled=TRUE,updated_at=NOW()",
            [panel.guild_id]
          );
        } catch (error) {
          await message.delete().catch(() => undefined);
          throw error;
        }
        await interaction.editReply("Self-Role-Panel wurde in " + channel.toString() + " veröffentlicht.");
        return;
      }

      if (interaction.isChatInputCommand() && interaction.commandName === "verifizierung") {
        if (!(await canExecuteCommand(interaction, database))) return;
        if (!interaction.guild) {
          await interaction.reply({ content: "Dieser Befehl funktioniert nur auf einem Server.", ephemeral: true });
          return;
        }
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !(await hasExplicitCommandAllow(interaction, database))) {
          await interaction.reply({ content: "Du benötigst die Berechtigung „Server verwalten“.", ephemeral: true });
          return;
        }
        if (interaction.options.getSubcommand() === "deaktivieren") {
          await database.query(
            "UPDATE \"SC_module_settings\" SET enabled = FALSE, updated_at = NOW() WHERE guild_id = $1 AND module_key = 'verification'",
            [interaction.guild.id]
          );
          await database.query(
            "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action) VALUES ($1,$2,'verification.disabled')",
            [interaction.guild.id, interaction.user.id]
          );
          await interaction.reply({ content: "Das Verifizierungssystem wurde deaktiviert.", ephemeral: true });
          return;
        }
        const channelOption = interaction.options.getChannel("kanal", true);
        const channel = await interaction.guild.channels.fetch(channelOption.id);
        const verifiedRole = interaction.options.getRole("verifiziert", true);
        const unverifiedRole = interaction.options.getRole("unverifiziert");
        const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
        if (!channel || channel.type !== ChannelType.GuildText) {
          await interaction.reply({ content: "Bitte wähle einen normalen Textkanal.", ephemeral: true });
          return;
        }
        const actorMember = await interaction.guild.members.fetch(interaction.user.id);
        if (verifiedRole.id === interaction.guild.id || verifiedRole.managed ||
            verifiedRole.position >= botMember.roles.highest.position ||
            (interaction.guild.ownerId !== interaction.user.id && verifiedRole.position >= actorMember.roles.highest.position) ||
            hasForbiddenSelfRolePermissions(verifiedRole.permissions) ||
            (unverifiedRole && (unverifiedRole.id === interaction.guild.id || unverifiedRole.managed ||
              unverifiedRole.position >= botMember.roles.highest.position ||
              (interaction.guild.ownerId !== interaction.user.id && unverifiedRole.position >= actorMember.roles.highest.position) ||
              hasForbiddenSelfRolePermissions(unverifiedRole.permissions) || unverifiedRole.id === verifiedRole.id))) {
          await interaction.reply({ content: "Die ausgewählten Rollen sind nicht sicher verwaltbar. Prüfe die Rollen-Hierarchie.", ephemeral: true });
          return;
        }
        if (!channel.permissionsFor(botMember)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
          await interaction.reply({ content: "Mir fehlen im Zielkanal die Rechte zum Senden oder Einbetten.", ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const message = await channel.send({
          embeds: [new EmbedBuilder().setColor(0x39b980).setTitle("Server-Verifizierung")
            .setDescription("Klicke auf **Verifizieren**, um die Serverfreigabe zu erhalten. Dies ist eine Regeln-/Mitgliedschaftsprüfung und keine Identitäts- oder Altersprüfung.")
            .setFooter({ text: "ServerCore · Verifizierung" })],
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId("sc:verification:verify").setLabel("Verifizieren").setEmoji("✅").setStyle(ButtonStyle.Success)
          )],
          allowedMentions: { parse: [] }
        });
        const config = { channelId: channel.id, messageId: message.id, verifiedRoleId: verifiedRole.id, unverifiedRoleId: unverifiedRole?.id ?? null };
        try {
          await database.query(
            "INSERT INTO \"SC_module_settings\" (guild_id,module_key,enabled,config,updated_at) VALUES ($1,'verification',TRUE,$2::jsonb,NOW()) ON CONFLICT (guild_id,module_key) DO UPDATE SET enabled=TRUE,config=EXCLUDED.config,updated_at=NOW()",
            [interaction.guild.id, JSON.stringify(config)]
          );
          await database.query(
            "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,'verification.configured',$3,$4::jsonb)",
            [interaction.guild.id, interaction.user.id, message.id, JSON.stringify(config)]
          );
        } catch (error) {
          await message.delete().catch(() => undefined);
          throw error;
        }
        await interaction.editReply("Verifizierung wurde in " + channel.toString() + " eingerichtet.");
        return;
      }

      if (interaction.isStringSelectMenu() && interaction.customId.startsWith("sc:roles:select:")) {
        if (!interaction.guild) {
          await interaction.reply({ content: "Server nicht erkannt.", ephemeral: true });
          return;
        }
        const moduleState = await database.query<{ enabled: boolean }>(
          "SELECT enabled FROM \"SC_module_settings\" WHERE guild_id=$1 AND module_key='role-panels'",
          [interaction.guild.id]
        );
        if (!moduleState.rows[0]?.enabled) {
          await interaction.reply({ content: "Self-Role-Panels sind auf diesem Server derzeit deaktiviert.", ephemeral: true });
          return;
        }
        const panelId = interaction.customId.slice("sc:roles:select:".length);
        const found = await database.query<RolePanel>(
          "SELECT panel_id,guild_id,channel_id,message_id,roles,selection_mode FROM \"SC_role_panels\" WHERE panel_id=$1 AND guild_id=$2 AND active=TRUE",
          [panelId, interaction.guild.id]
        );
        const panel = found.rows[0];
        if (!panel || panel.channel_id !== interaction.channelId || panel.message_id !== interaction.message.id) {
          await interaction.reply({ content: "Dieses Rollenpanel ist nicht mehr aktiv.", ephemeral: true });
          return;
        }
        if (interaction.values.length < 1 || interaction.values.some((value) => !panel.roles.some((role) => role.id === value))) {
          await interaction.reply({ content: "Ungültige Rollenauswahl.", ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
        const selected = new Set(interaction.values);
        // In multiple mode each chosen option is a toggle: existing roles are removed,
        // missing roles are added. Unselected options are left untouched.
        const toAdd = panel.roles.filter((role) => selected.has(role.id) && !member.roles.cache.has(role.id));
        const toRemove = panel.selection_mode === "single"
          ? panel.roles.filter((role) => !selected.has(role.id) && member.roles.cache.has(role.id))
          : panel.roles.filter((role) => selected.has(role.id) && member.roles.cache.has(role.id));
        for (const item of [...toAdd, ...toRemove]) {
          const role = await interaction.guild.roles.fetch(item.id);
          if (!role || !isSafeSelfRole(role, interaction.guild.id, botMember.roles.highest.position) ||
              !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            await interaction.editReply("Mindestens eine Rolle kann wegen fehlender Rechte oder der Rollen-Hierarchie nicht geändert werden.");
            return;
          }
        }
        if (toRemove.length) await member.roles.remove(toRemove.map((role) => role.id), "ServerCore Self-Role-Panel");
        if (toAdd.length) await member.roles.add(toAdd.map((role) => role.id), "ServerCore Self-Role-Panel");
        await database.query(
          "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,'roles.panel_selection',$3,$4::jsonb)",
          [interaction.guild.id, interaction.user.id, panelId, JSON.stringify({ added: toAdd.map((role) => role.id), removed: toRemove.map((role) => role.id) })]
        );
        await interaction.editReply("Deine Rollen wurden aktualisiert.");
        return;
      }

      if (interaction.isButton() && interaction.customId === "sc:verification:verify") {
        if (!interaction.guild) {
          await interaction.reply({ content: "Server nicht erkannt.", ephemeral: true });
          return;
        }
        const result = await database.query<{ enabled: boolean; config: { channelId?: string; messageId?: string; verifiedRoleId?: string; unverifiedRoleId?: string | null } }>(
          "SELECT enabled,config FROM \"SC_module_settings\" WHERE guild_id=$1 AND module_key='verification'",
          [interaction.guild.id]
        );
        const config = result.rows[0]?.config;
        if (!result.rows[0]?.enabled || !config?.verifiedRoleId || config.channelId !== interaction.channelId || config.messageId !== interaction.message.id) {
          await interaction.reply({ content: "Dieses Verifizierungs-Panel ist nicht mehr aktiv.", ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const verifiedRole = await interaction.guild.roles.fetch(config.verifiedRoleId);
        const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
        if (!verifiedRole) {
          await interaction.editReply("Die konfigurierte Verifizierungsrolle existiert nicht mehr. Bitte kontaktiere das Serverteam.");
          return;
        }
        if (member.roles.cache.has(verifiedRole.id)) {
          await interaction.editReply("Du bist bereits verifiziert.");
          return;
        }
        if (!isSafeSelfRole(verifiedRole, interaction.guild.id, botMember.roles.highest.position) ||
            !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await interaction.editReply("Die Verifizierungsrolle kann derzeit nicht vergeben werden. Bitte kontaktiere das Serverteam.");
          return;
        }
        if (!member.roles.cache.has(verifiedRole.id)) await member.roles.add(verifiedRole, "ServerCore verification");
        if (config.unverifiedRoleId) {
          const unverifiedRole = await interaction.guild.roles.fetch(config.unverifiedRoleId);
          if (unverifiedRole && isSafeSelfRole(unverifiedRole, interaction.guild.id, botMember.roles.highest.position) &&
              botMember.permissions.has(PermissionFlagsBits.ManageRoles) && member.roles.cache.has(unverifiedRole.id)) {
            await member.roles.remove(unverifiedRole, "ServerCore verification completed");
          }
        }
        await database.query(
          "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,'verification.completed',$3,$4::jsonb)",
          [interaction.guild.id, interaction.user.id, interaction.user.id, JSON.stringify({ panelMessageId: interaction.message.id, verifiedRoleId: verifiedRole.id })]
        );
        await interaction.editReply("Du wurdest erfolgreich verifiziert. Willkommen!");
      }
    } catch (error) {
      console.error("[community-roles] Interaction fehlgeschlagen:", error);
      if (interaction.isRepliable()) {
        const message = "Die Aktion ist fehlgeschlagen. Prüfe Bot-Rechte und Rollen-Hierarchie.";
        if (interaction.deferred) await interaction.editReply(message).catch(() => undefined);
        else if (!interaction.replied) await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
      }
    }
  });
}

