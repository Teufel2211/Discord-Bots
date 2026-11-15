import { canExecuteCommand, hasExplicitCommandAllow } from "./command-permissions.js";
import {
  ChannelType,
  type Client,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type Message,
  type PartialMessage
} from "discord.js";
import type { createDatabase } from "../database.js";

type Database = ReturnType<typeof createDatabase>;
type LogConfig = { logChannelId?: string };

export const serverLogsCommand = new SlashCommandBuilder()
  .setName("serverlogs")
  .setDescription("Konfiguriert die ServerCore-Serverprotokolle.")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("setup")
      .setDescription("Legt den Kanal für Serverprotokolle fest.")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Textkanal für Ereignisprotokolle.")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  );

async function getLogChannel(client: Client, database: Database, guildId: string) {
  const result = await database.query<{ enabled: boolean; config: LogConfig }>(
    "SELECT enabled, config FROM \"SC_module_settings\" WHERE guild_id = $1 AND module_key = 'server-logs'",
    [guildId]
  );
  const setting = result.rows[0];
  if (!setting?.enabled || !setting.config?.logChannelId) return null;
  const channel = await client.channels.fetch(setting.config.logChannelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText || channel.guildId !== guildId) return null;
  return channel;
}

async function writeLog(
  client: Client,
  database: Database,
  guild: Guild,
  title: string,
  description: string,
  color = 0x7188ff,
  fields: { name: string; value: string; inline?: boolean }[] = []
): Promise<void> {
  const channel = await getLogChannel(client, database, guild.id);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title.slice(0, 256))
    .setDescription(description.slice(0, 4000))
    .addFields(fields.slice(0, 10).map((field) => ({
      name: field.name.slice(0, 256),
      value: (field.value || "—").slice(0, 1024),
      inline: field.inline ?? false
    })))
    .setFooter({ text: "ServerCore · Serverprotokolle" })
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function resolveGuild(message: Message | PartialMessage): Promise<Guild | null> {
  if (message.guild) return message.guild;
  if (!message.guildId) return null;
  return message.client.guilds.fetch(message.guildId).catch(() => null);
}

export function attachServerLogs(client: Client, database: Database): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "serverlogs") return;
    if (!(await canExecuteCommand(interaction, database))) return;
    try {
      if (!interaction.guild) {
        await interaction.reply({ content: "Dieser Befehl funktioniert nur auf einem Server.", ephemeral: true });
        return;
      }
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !(await hasExplicitCommandAllow(interaction, database))) {
        await interaction.reply({ content: "Du benötigst die Berechtigung „Server verwalten“.", ephemeral: true });
        return;
      }
      const selectedChannel = interaction.options.getChannel("channel", true);
      const channel = await interaction.guild.channels.fetch(selectedChannel.id);
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "Bitte wähle einen Textkanal dieses Servers.", ephemeral: true });
        return;
      }
      const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
      const permissions = channel.permissionsFor(botMember);
      if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        await interaction.reply({ content: "Im ausgewählten Kanal fehlen mir „Kanal ansehen“, „Nachrichten senden“ oder „Links einbetten“.", ephemeral: true });
        return;
      }
      await database.query(
        "INSERT INTO \"SC_module_settings\" (guild_id, module_key, enabled, config, updated_at) " +
          "VALUES ($1, 'server-logs', TRUE, $2::jsonb, NOW()) " +
          "ON CONFLICT (guild_id, module_key) DO UPDATE SET enabled = TRUE, config = EXCLUDED.config, updated_at = NOW()",
        [interaction.guild.id, JSON.stringify({ logChannelId: channel.id })]
      );
      await database.query(
        "INSERT INTO \"SC_audit_logs\" (guild_id, actor_id, action, target_id, metadata) VALUES ($1, $2, 'server_logs.configured', $3, $4::jsonb)",
        [interaction.guild.id, interaction.user.id, channel.id, JSON.stringify({ channelId: channel.id })]
      );
      await interaction.reply({ content: "Serverprotokolle sind aktiviert. Ereignisse werden in " + channel.toString() + " protokolliert.", ephemeral: true });
      await writeLog(client, database, interaction.guild, "Serverprotokolle aktiviert", "Die Protokollierung wurde von <@" + interaction.user.id + "> eingerichtet.", 0x45c58a);
    } catch (error) {
      console.error("[server-logs] Setup fehlgeschlagen:", error);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Die Protokollierung konnte nicht eingerichtet werden.", ephemeral: true }).catch(() => undefined);
      }
    }
  });

  client.on(Events.MessageDelete, async (message) => {
    try {
      const guild = await resolveGuild(message);
      if (!guild || message.author?.bot) return;
      await writeLog(client, database, guild, "Nachricht gelöscht", "Eine Nachricht wurde gelöscht.", 0xe45d6d, [
        { name: "Kanal", value: message.channel.toString(), inline: true },
        { name: "Autor", value: message.author ? "<@" + message.author.id + ">" : "Nicht im Cache", inline: true },
        { name: "Nachrichten-ID", value: message.id }
      ]);
    } catch (error) {
      console.error("[server-logs] MessageDelete fehlgeschlagen:", error);
    }
  });

  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    try {
      const guild = await resolveGuild(newMessage);
      if (!guild || newMessage.author?.bot) return;
      if (oldMessage.content === newMessage.content) return;
      await writeLog(client, database, guild, "Nachricht bearbeitet", "Eine Nachricht wurde bearbeitet.", 0xe5b45e, [
        { name: "Kanal", value: newMessage.channel.toString(), inline: true },
        { name: "Autor", value: newMessage.author ? "<@" + newMessage.author.id + ">" : "Nicht im Cache", inline: true },
        { name: "Nachrichten-ID", value: newMessage.id }
      ]);
    } catch (error) {
      console.error("[server-logs] MessageUpdate fehlgeschlagen:", error);
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      await writeLog(client, database, member.guild, "Mitglied beigetreten", "<@" + member.id + "> ist dem Server beigetreten.", 0x45c58a, [
        { name: "Konto erstellt", value: "<t:" + Math.floor(member.user.createdTimestamp / 1000) + ":R>", inline: true },
        { name: "Mitgliederzahl", value: String(member.guild.memberCount), inline: true }
      ]);
    } catch (error) {
      console.error("[server-logs] GuildMemberAdd fehlgeschlagen:", error);
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      await writeLog(client, database, member.guild, "Mitglied verlassen", "<@" + member.id + "> hat den Server verlassen.", 0xe45d6d);
    } catch (error) {
      console.error("[server-logs] GuildMemberRemove fehlgeschlagen:", error);
    }
  });

  client.on(Events.GuildBanAdd, async (ban) => {
    try {
      await writeLog(client, database, ban.guild, "Mitglied gebannt", "<@" + ban.user.id + "> wurde gebannt.", 0xe45d6d);
    } catch (error) {
      console.error("[server-logs] GuildBanAdd fehlgeschlagen:", error);
    }
  });

  client.on(Events.GuildBanRemove, async (ban) => {
    try {
      await writeLog(client, database, ban.guild, "Bann aufgehoben", "Der Bann von <@" + ban.user.id + "> wurde aufgehoben.", 0x45c58a);
    } catch (error) {
      console.error("[server-logs] GuildBanRemove fehlgeschlagen:", error);
    }
  });

  client.on(Events.ChannelCreate, async (channel) => {
    try {
      if (!("guild" in channel)) return;
      await writeLog(client, database, channel.guild, "Kanal erstellt", "Ein neuer Kanal wurde erstellt: " + channel.toString(), 0x45c58a, [
        { name: "Kanal-ID", value: channel.id },
        { name: "Kanaltyp", value: String(channel.type) }
      ]);
    } catch (error) {
      console.error("[server-logs] ChannelCreate fehlgeschlagen:", error);
    }
  });

  client.on(Events.ChannelDelete, async (channel) => {
    try {
      if (!("guild" in channel)) return;
      await writeLog(client, database, channel.guild, "Kanal gelöscht", "Ein Kanal wurde gelöscht.", 0xe45d6d, [
        { name: "Kanalname", value: "name" in channel ? channel.name : "Unbekannt" },
        { name: "Kanal-ID", value: channel.id }
      ]);
    } catch (error) {
      console.error("[server-logs] ChannelDelete fehlgeschlagen:", error);
    }
  });

  client.on(Events.GuildRoleCreate, async (role) => {
    try {
      await writeLog(client, database, role.guild, "Rolle erstellt", "Die Rolle **" + role.name + "** wurde erstellt.", 0x45c58a, [
        { name: "Rollen-ID", value: role.id }
      ]);
    } catch (error) {
      console.error("[server-logs] RoleCreate fehlgeschlagen:", error);
    }
  });

  client.on(Events.GuildRoleDelete, async (role) => {
    try {
      await writeLog(client, database, role.guild, "Rolle gelöscht", "Die Rolle **" + role.name + "** wurde gelöscht.", 0xe45d6d, [
        { name: "Rollen-ID", value: role.id }
      ]);
    } catch (error) {
      console.error("[server-logs] RoleDelete fehlgeschlagen:", error);
    }
  });
}
