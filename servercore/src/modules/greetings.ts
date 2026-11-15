import { canExecuteCommand, hasExplicitCommandAllow } from "./command-permissions.js";
import {
  ChannelType,
  type Client,
  Events,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import type { createDatabase } from "../database.js";

type Database = ReturnType<typeof createDatabase>;
type GreetingConfig = {
  welcomeChannelId?: string;
  welcomeMessage?: string;
  goodbyeChannelId?: string;
  goodbyeMessage?: string;
};

export const greetingsCommand = new SlashCommandBuilder()
  .setName("begruesung")
  .setDescription("Konfiguriert Willkommens- und Abschiedsnachrichten.")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("willkommen")
      .setDescription("Richtet die Nachricht für neue Mitglieder ein.")
      .addChannelOption((option) =>
        option.setName("kanal").setDescription("Zielkanal").addChannelTypes(ChannelType.GuildText).setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("nachricht").setDescription("Nachricht mit optionalen Platzhaltern").setMaxLength(1800).setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("abschied")
      .setDescription("Richtet die Nachricht für austretende Mitglieder ein.")
      .addChannelOption((option) =>
        option.setName("kanal").setDescription("Zielkanal").addChannelTypes(ChannelType.GuildText).setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("nachricht").setDescription("Nachricht mit optionalen Platzhaltern").setMaxLength(1800).setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("deaktivieren")
      .setDescription("Deaktiviert eine der beiden Nachrichten.")
      .addStringOption((option) =>
        option
          .setName("typ")
          .setDescription("Welche Nachricht soll deaktiviert werden?")
          .setRequired(true)
          .addChoices(
            { name: "Willkommen", value: "welcome" },
            { name: "Abschied", value: "goodbye" }
          )
      )
  );

async function loadConfig(database: Database, guildId: string) {
  const result = await database.query<{ enabled: boolean; config: GreetingConfig }>(
    "SELECT enabled, config FROM \"SC_module_settings\" WHERE guild_id = $1 AND module_key = 'greetings'",
    [guildId]
  );
  return result.rows[0] ?? { enabled: false, config: {} };
}

function renderMessage(template: string, member: { id: string; user: { username: string; tag: string }; guild: { name: string; memberCount: number } }): string {
  return template
    .replaceAll("{user}", "<@" + member.id + ">")
    .replaceAll("{username}", member.user.username)
    .replaceAll("{tag}", member.user.tag)
    .replaceAll("{server}", member.guild.name)
    .replaceAll("{memberCount}", String(member.guild.memberCount))
    .slice(0, 2000);
}

export function attachGreetings(client: Client, database: Database): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "begruesung") return;
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

      const subcommand = interaction.options.getSubcommand();
      const current = await loadConfig(database, interaction.guild.id);
      const config: GreetingConfig = { ...current.config };

      if (subcommand === "deaktivieren") {
        const kind = interaction.options.getString("typ", true);
        if (kind === "welcome") {
          delete config.welcomeChannelId;
          delete config.welcomeMessage;
        } else {
          delete config.goodbyeChannelId;
          delete config.goodbyeMessage;
        }
        const enabled = Boolean(config.welcomeChannelId || config.goodbyeChannelId);
        await database.query(
          "INSERT INTO \"SC_module_settings\" (guild_id, module_key, enabled, config, updated_at) VALUES ($1, 'greetings', $2, $3::jsonb, NOW()) ON CONFLICT (guild_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled, config = EXCLUDED.config, updated_at = NOW()",
          [interaction.guild.id, enabled, JSON.stringify(config)]
        );
        await interaction.reply({ content: (kind === "welcome" ? "Willkommensnachrichten" : "Abschiedsnachrichten") + " wurden deaktiviert.", ephemeral: true });
        return;
      }

      const selected = interaction.options.getChannel("kanal", true);
      const channel = await interaction.guild.channels.fetch(selected.id);
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "Bitte wähle einen Textkanal dieses Servers.", ephemeral: true });
        return;
      }
      const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
      const permissions = channel.permissionsFor(botMember);
      if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
        await interaction.reply({ content: "Im ausgewählten Kanal fehlen mir „Kanal ansehen“ oder „Nachrichten senden“.", ephemeral: true });
        return;
      }

      const message = interaction.options.getString("nachricht", true).trim();
      if (!message) {
        await interaction.reply({ content: "Die Nachricht darf nicht leer sein.", ephemeral: true });
        return;
      }
      if (subcommand === "willkommen") {
        config.welcomeChannelId = channel.id;
        config.welcomeMessage = message;
      } else {
        config.goodbyeChannelId = channel.id;
        config.goodbyeMessage = message;
      }

      await database.query(
        "INSERT INTO \"SC_module_settings\" (guild_id, module_key, enabled, config, updated_at) VALUES ($1, 'greetings', TRUE, $2::jsonb, NOW()) ON CONFLICT (guild_id, module_key) DO UPDATE SET enabled = TRUE, config = EXCLUDED.config, updated_at = NOW()",
        [interaction.guild.id, JSON.stringify(config)]
      );
      await database.query(
        "INSERT INTO \"SC_audit_logs\" (guild_id, actor_id, action, target_id, metadata) VALUES ($1, $2, 'greetings.configured', $3, $4::jsonb)",
        [interaction.guild.id, interaction.user.id, channel.id, JSON.stringify({ type: subcommand })]
      );
      await interaction.reply({
        content: (subcommand === "willkommen" ? "Willkommensnachrichten" : "Abschiedsnachrichten") + " sind jetzt in " + channel.toString() + " aktiviert. Platzhalter: {user}, {username}, {tag}, {server}, {memberCount}.",
        ephemeral: true
      });
    } catch (error) {
      console.error("[greetings] Konfiguration fehlgeschlagen:", error);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Die Begrüßungseinstellungen konnten nicht gespeichert werden.", ephemeral: true }).catch(() => undefined);
      }
    }
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const setting = await loadConfig(database, member.guild.id);
      const channelId = setting.config?.welcomeChannelId;
      const template = setting.config?.welcomeMessage;
      if (!setting.enabled || !channelId || !template) return;
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText || channel.guildId !== member.guild.id) return;
      await channel.send({
        content: renderMessage(template, member),
        allowedMentions: { users: [member.id], parse: [] }
      });
    } catch (error) {
      console.error("[greetings] Willkommensnachricht fehlgeschlagen:", error);
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      const setting = await loadConfig(database, member.guild.id);
      const channelId = setting.config?.goodbyeChannelId;
      const template = setting.config?.goodbyeMessage;
      if (!setting.enabled || !channelId || !template) return;
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText || channel.guildId !== member.guild.id) return;
      await channel.send({
        content: renderMessage(template, member),
        allowedMentions: { users: [member.id], parse: [] }
      });
    } catch (error) {
      console.error("[greetings] Abschiedsnachricht fehlgeschlagen:", error);
    }
  });
}
