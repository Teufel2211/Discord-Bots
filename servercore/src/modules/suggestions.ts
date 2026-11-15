import { canExecuteCommand, hasExplicitCommandAllow } from "./command-permissions.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, Events,
  PermissionFlagsBits, SlashCommandBuilder, type Client
} from "discord.js";
import { randomUUID } from "node:crypto";
import type { createDatabase } from "../database.js";

type Database = ReturnType<typeof createDatabase>;
type Status = "pending" | "approved" | "rejected" | "implemented";
type Suggestion = {
  suggestion_id: string; guild_id: string; author_id: string; channel_id: string;
  message_id: string | null; content: string; status: Status; reviewed_by: string | null;
  review_note: string | null; created_at: Date;
};
type Counts = { up: string; down: string };

export const suggestionCommand = new SlashCommandBuilder()
  .setName("vorschlag").setDescription("Verwaltet Vorschläge für diesen Server.")
  .addSubcommand((s) => s.setName("setup").setDescription("Richtet das Vorschlagsystem ein.")
    .addChannelOption((o) => o.setName("kanal").setDescription("Kanal für neue Vorschläge.").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addRoleOption((o) => o.setName("teamrolle").setDescription("Rolle, die Vorschläge bearbeiten darf.").setRequired(true)))
  .addSubcommand((s) => s.setName("senden").setDescription("Reicht einen neuen Vorschlag ein.")
    .addStringOption((o) => o.setName("text").setDescription("Beschreibe deinen Vorschlag.").setMinLength(10).setMaxLength(3000).setRequired(true)))
  .addSubcommand((s) => s.setName("status").setDescription("Zeigt deine letzten Vorschläge."));

function label(status: Status): string {
  return status === "approved" ? "Angenommen" : status === "rejected" ? "Abgelehnt" : status === "implemented" ? "Umgesetzt" : "Offen";
}
function color(status: Status): number {
  return status === "approved" ? 0x2ecc71 : status === "rejected" ? 0xe74c3c : status === "implemented" ? 0x3498db : 0x7188ff;
}
function voteRow(id: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("sc:suggestion:up:" + id).setLabel("Dafür").setEmoji("👍").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("sc:suggestion:down:" + id).setLabel("Dagegen").setEmoji("👎").setStyle(ButtonStyle.Secondary)
  );
}
function reviewRow(id: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("sc:suggestion:approved:" + id).setLabel("Annehmen").setEmoji("✅").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId("sc:suggestion:rejected:" + id).setLabel("Ablehnen").setEmoji("❌").setStyle(ButtonStyle.Danger).setDisabled(disabled),
    new ButtonBuilder().setCustomId("sc:suggestion:implemented:" + id).setLabel("Umgesetzt").setEmoji("🚀").setStyle(ButtonStyle.Primary).setDisabled(disabled)
  );
}
function embed(row: Suggestion, counts: Counts): EmbedBuilder {
  return new EmbedBuilder().setColor(color(row.status)).setTitle("💡 Community-Vorschlag")
    .setDescription(row.content.slice(0, 4000))
    .addFields(
      { name: "Eingereicht von", value: "<@" + row.author_id + ">", inline: true },
      { name: "Status", value: label(row.status), inline: true },
      { name: "Abstimmung", value: "👍 " + counts.up + " · 👎 " + counts.down, inline: true }
    ).setFooter({ text: "ServerCore · " + row.suggestion_id });
}
async function counts(database: Database, id: string): Promise<Counts> {
  const result = await database.query<{ vote: number; count: string }>(
    "SELECT vote, COUNT(*)::text AS count FROM \"SC_suggestion_votes\" WHERE suggestion_id = $1 GROUP BY vote", [id]
  );
  return { up: result.rows.find((r) => r.vote === 1)?.count ?? "0", down: result.rows.find((r) => r.vote === -1)?.count ?? "0" };
}
async function refresh(client: Client, database: Database, row: Suggestion): Promise<void> {
  if (!row.message_id) return;
  const guild = await client.guilds.fetch(row.guild_id);
  const channel = await guild.channels.fetch(row.channel_id);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const message = await channel.messages.fetch(row.message_id);
  await message.edit({ embeds: [embed(row, await counts(database, row.suggestion_id))],
    components: [voteRow(row.suggestion_id), reviewRow(row.suggestion_id, row.status !== "pending")] });
}
async function notifyAuthor(client: Client, row: Suggestion): Promise<void> {
  try {
    const user = await client.users.fetch(row.author_id);
    const guild = await client.guilds.fetch(row.guild_id);
    await user.send({ embeds: [new EmbedBuilder().setColor(color(row.status)).setTitle("Update zu deinem Vorschlag")
      .setDescription("Dein Vorschlag auf **" + guild.name + "** wurde aktualisiert.")
      .addFields({ name: "Neuer Status", value: label(row.status) })] });
  } catch { /* DMs may be disabled; the decision is still persisted. */ }
}

export function attachSuggestions(client: Client, database: Database): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === "vorschlag") {
      if (!(await canExecuteCommand(interaction, database))) return;
      try {
        if (!interaction.guild) {
          await interaction.reply({ content: "Dieser Befehl funktioniert nur auf einem Server.", ephemeral: true }); return;
        }
        const sub = interaction.options.getSubcommand();
        if (sub === "setup") {
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !(await hasExplicitCommandAllow(interaction, database))) {
            await interaction.reply({ content: "Du benötigst die Berechtigung „Server verwalten“.", ephemeral: true }); return;
          }
          const selectedChannel = interaction.options.getChannel("kanal", true);
          const role = interaction.options.getRole("teamrolle", true);
          const channel = await interaction.guild.channels.fetch(selectedChannel.id);
          if (!channel || channel.type !== ChannelType.GuildText) {
            await interaction.reply({ content: "Bitte wähle einen normalen Textkanal.", ephemeral: true }); return;
          }
          const botMember = interaction.guild.members.me;
          const perms = botMember ? channel.permissionsFor(botMember) : null;
          if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory])) {
            await interaction.reply({ content: "Mir fehlen im Vorschlagskanal Rechte zum Lesen, Senden oder Einbetten.", ephemeral: true }); return;
          }
          await database.query(
            "INSERT INTO \"SC_module_settings\" (guild_id, module_key, enabled, config, updated_at) VALUES ($1, 'suggestions', TRUE, $2::jsonb, NOW()) ON CONFLICT (guild_id, module_key) DO UPDATE SET enabled = TRUE, config = EXCLUDED.config, updated_at = NOW()",
            [interaction.guild.id, JSON.stringify({ channelId: channel.id, reviewRoleId: role.id })]
          );
          await database.query(
            "INSERT INTO \"SC_audit_logs\" (guild_id, actor_id, action, target_id, metadata) VALUES ($1, $2, 'suggestions.configured', $3, $4::jsonb)",
            [interaction.guild.id, interaction.user.id, channel.id, JSON.stringify({ reviewRoleId: role.id })]
          );
          await interaction.reply({ content: "Vorschlagssystem aktiviert. Einreichungen erscheinen in " + channel.toString() + "; bearbeiten darf sie " + role.toString() + ".", ephemeral: true });
          return;
        }
        const setting = await database.query<{ enabled: boolean; config: { channelId?: string; reviewRoleId?: string } }>(
          "SELECT enabled, config FROM \"SC_module_settings\" WHERE guild_id = $1 AND module_key = 'suggestions'", [interaction.guild.id]
        );
        if (!setting.rows[0]?.enabled || !setting.rows[0].config.channelId || !setting.rows[0].config.reviewRoleId) {
          await interaction.reply({ content: "Das Vorschlagssystem ist noch nicht eingerichtet. Ein Administrator muss zuerst /vorschlag setup ausführen.", ephemeral: true }); return;
        }
        if (sub === "status") {
          const result = await database.query<Suggestion>(
            "SELECT suggestion_id, guild_id, author_id, channel_id, message_id, content, status, reviewed_by, review_note, created_at FROM \"SC_suggestions\" WHERE guild_id = $1 AND author_id = $2 ORDER BY created_at DESC LIMIT 5",
            [interaction.guild.id, interaction.user.id]
          );
          if (!result.rows.length) {
            await interaction.reply({ content: "Du hast bisher keine Vorschläge eingereicht.", ephemeral: true }); return;
          }
          const history = new EmbedBuilder().setColor(0x7188ff).setTitle("Deine letzten Vorschläge")
            .setDescription(result.rows.map((r) => "**" + label(r.status) + "** · " + r.content.slice(0, 180).replace(/\n/g, " ") + "\nID: " + r.suggestion_id.slice(0, 8)).join("\n\n").slice(0, 4000));
          await interaction.reply({ embeds: [history], ephemeral: true }); return;
        }
        const content = interaction.options.getString("text", true).trim();
        if (content.length < 10) {
          await interaction.reply({ content: "Ein Vorschlag muss mindestens 10 Zeichen enthalten.", ephemeral: true }); return;
        }
        await interaction.deferReply({ ephemeral: true });
        const channel = await interaction.guild.channels.fetch(setting.rows[0].config.channelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
          await interaction.editReply("Der konfigurierte Vorschlagskanal wurde nicht gefunden. Bitte Setup erneut ausführen."); return;
        }
        const id = randomUUID();
        const inserted = await database.query<Suggestion>(
          "INSERT INTO \"SC_suggestions\" (suggestion_id, guild_id, author_id, channel_id, content) VALUES ($1, $2, $3, $4, $5) RETURNING suggestion_id, guild_id, author_id, channel_id, message_id, content, status, reviewed_by, review_note, created_at",
          [id, interaction.guild.id, interaction.user.id, channel.id, content]
        );
        const suggestion = inserted.rows[0];
        if (!suggestion) throw new Error("Suggestion insert returned no row.");
        try {
          const message = await channel.send({ embeds: [embed(suggestion, { up: "0", down: "0" })],
            components: [voteRow(id), reviewRow(id)], allowedMentions: { parse: [] } });
          await database.query("UPDATE \"SC_suggestions\" SET message_id = $1 WHERE suggestion_id = $2", [message.id, id]);
          await database.query(
            "INSERT INTO \"SC_audit_logs\" (guild_id, actor_id, action, target_id, metadata) VALUES ($1, $2, 'suggestions.submitted', $3, $4::jsonb)",
            [interaction.guild.id, interaction.user.id, id, JSON.stringify({ channelId: channel.id, messageId: message.id })]
          );
          await interaction.editReply("Dein Vorschlag wurde eingereicht: " + message.url);
        } catch (error) {
          await database.query("DELETE FROM \"SC_suggestions\" WHERE suggestion_id = $1", [id]); throw error;
        }
      } catch (error) {
        console.error("[suggestions] Command fehlgeschlagen:", error);
        if (interaction.isRepliable()) {
          const message = "Der Vorschlag konnte nicht verarbeitet werden. Bitte prüfe die Bot-Rechte und versuche es erneut.";
          if (interaction.deferred) await interaction.editReply(message).catch(() => undefined);
          else if (!interaction.replied) await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
        }
      }
      return;
    }
    if (!interaction.isButton() || !interaction.guild) return;
    const [prefix, moduleName, action, id] = interaction.customId.split(":");
    if (prefix !== "sc" || moduleName !== "suggestion" || !action || !id) return;
    try {
      const result = await database.query<Suggestion>(
        "SELECT suggestion_id, guild_id, author_id, channel_id, message_id, content, status, reviewed_by, review_note, created_at FROM \"SC_suggestions\" WHERE suggestion_id = $1 AND guild_id = $2",
        [id, interaction.guild.id]
      );
      const row = result.rows[0];
      if (!row) { await interaction.reply({ content: "Dieser Vorschlag existiert nicht mehr.", ephemeral: true }); return; }
      if (action === "up" || action === "down") {
        if (row.status !== "pending") { await interaction.reply({ content: "Die Abstimmung ist bereits geschlossen.", ephemeral: true }); return; }
        const vote = action === "up" ? 1 : -1;
        const removed = await database.query(
          "DELETE FROM \"SC_suggestion_votes\" WHERE suggestion_id = $1 AND user_id = $2 AND vote = $3 RETURNING vote",
          [id, interaction.user.id, vote]
        );
        if (removed.rowCount === 0) {
          await database.query(
            "INSERT INTO \"SC_suggestion_votes\" (suggestion_id, user_id, vote) VALUES ($1, $2, $3) ON CONFLICT (suggestion_id, user_id) DO UPDATE SET vote = EXCLUDED.vote, updated_at = NOW()",
            [id, interaction.user.id, vote]
          );
        }
        await refresh(client, database, row);
        await interaction.reply({ content: removed.rowCount ? "Deine Stimme wurde entfernt." : "Deine Stimme wurde gespeichert.", ephemeral: true }); return;
      }
      if (action === "approved" || action === "rejected" || action === "implemented") {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        const config = await database.query<{ config: { reviewRoleId?: string } }>(
          "SELECT config FROM \"SC_module_settings\" WHERE guild_id = $1 AND module_key = 'suggestions' AND enabled = TRUE", [interaction.guild.id]
        );
        const roleId = config.rows[0]?.config.reviewRoleId;
        if ((!roleId || !member.roles.cache.has(roleId)) && !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({ content: "Nur das zuständige Team darf Vorschläge bearbeiten.", ephemeral: true }); return;
        }
        const updated = await database.query<Suggestion>(
          "UPDATE \"SC_suggestions\" SET status = $1, reviewed_by = $2, updated_at = NOW() WHERE suggestion_id = $3 AND guild_id = $4 AND status = 'pending' RETURNING suggestion_id, guild_id, author_id, channel_id, message_id, content, status, reviewed_by, review_note, created_at",
          [action, interaction.user.id, id, interaction.guild.id]
        );
        if (!updated.rows[0]) { await interaction.reply({ content: "Dieser Vorschlag wurde bereits bearbeitet.", ephemeral: true }); return; }
        const decided = updated.rows[0];
        await database.query(
          "INSERT INTO \"SC_audit_logs\" (guild_id, actor_id, action, target_id, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)",
          [interaction.guild.id, interaction.user.id, "suggestions." + action, id, JSON.stringify({ authorId: decided.author_id })]
        );
        await refresh(client, database, decided);
        await notifyAuthor(client, decided);
        await interaction.reply({ content: "Vorschlag wurde auf „" + label(decided.status) + "“ gesetzt. Der Einreicher wurde per DM informiert, sofern Nachrichten empfangen werden können.", ephemeral: true });
      }
    } catch (error) {
      console.error("[suggestions] Button fehlgeschlagen:", error);
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "Die Aktion konnte nicht verarbeitet werden.", ephemeral: true }).catch(() => undefined);
    }
  });
}
