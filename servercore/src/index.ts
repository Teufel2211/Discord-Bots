import { canExecuteCommand, hasExplicitCommandAllow } from "./modules/command-permissions.js";
import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(process.cwd(), "servercore/.env") });

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type TextChannel
} from "discord.js";
import { randomUUID } from "node:crypto";
import { attachAntiRaid } from "./modules/anti-raid.js";
import { applicationCommand, attachApplications } from "./modules/applications.js";
import { attachServerLogs, serverLogsCommand } from "./modules/server-logs.js";
import { attachStaff, staffCommand } from "./modules/staff.js";
import { attachSuggestions, suggestionCommand } from "./modules/suggestions.js";
import { attachModeration, moderationCommand } from "./modules/moderation.js";
import { attachAutoMod, autoModCommand } from "./modules/automod.js";
import { attachGreetings, greetingsCommand } from "./modules/greetings.js";
import { attachCommunityRoles, rolePanelCommand, verificationCommand } from "./modules/community-roles.js";
import { attachRecurringMessages, recurringMessagesCommand } from "./modules/recurring-messages.js";
import { attachCustomPanels, customPanelCommand } from "./modules/custom-panels.js";
import { attachGiveaways, giveawayCommand } from "./modules/giveaways.js";
import { attachCommandPermissions, commandPermissionsCommand } from "./modules/command-permissions.js";
import {
  closeDatabase,
  createDatabase,
  runMigrations
} from "./database.js";

type TicketPanelRow = {
  panel_id: string;
  guild_id: string;
  category_id: string;
  support_role_id: string;
  log_channel_id: string;
  title: string;
  description: string;
  questions: string[];
  categories: { label: string; category_id: string; support_role_id: string; log_channel_id: string }[];
  active: boolean;
};

type TicketRow = {
  ticket_id: string;
  guild_id: string;
  panel_id: string;
  channel_id: string;
  opener_id: string;
  support_role_id: string;
  log_channel_id: string;
  status: "open" | "closing" | "closed";
  claimed_by: string | null;
};

async function main(): Promise<void> {
const token = process.env.DISCORD_BOT_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
if (!token) throw new Error("DISCORD_BOT_TOKEN is required.");
if (!supabaseUrl) throw new Error("SUPABASE_URL is required.");
if (!supabaseSecretKey) throw new Error("SUPABASE_SECRET_KEY is required.");

const database = createDatabase(supabaseUrl, supabaseSecretKey);
try {
  await runMigrations(database);

const ticketCommand = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Verwaltet das ServerCore-Ticketsystem.")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("panel")
      .setDescription("Erstellt ein Ticket-Panel in diesem Kanal.")
      .addStringOption((option) =>
        option
          .setName("title")
          .setDescription("Titel des Ticket-Panels.")
          .setMaxLength(100)
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("description")
          .setDescription("Erklärung für deine Mitglieder.")
          .setMaxLength(1000)
          .setRequired(true)
      )
      .addChannelOption((option) =>
        option
          .setName("category")
          .setDescription("Kategorie für neu erstellte Ticket-Kanäle.")
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true)
      )
      .addRoleOption((option) =>
        option
          .setName("support-role")
          .setDescription("Rolle, die Tickets sehen und übernehmen darf.")
          .setRequired(true)
      )
      .addChannelOption((option) =>
        option
          .setName("log-channel")
          .setDescription("Textkanal für geschlossene Tickets und Transkripte.")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  );

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Prüft, ob ServerCore erreichbar ist."),
  new SlashCommandBuilder()
    .setName("servercore")
    .setDescription("Zeigt den Status des ServerCore-Bots."),
  ticketCommand,
  applicationCommand,
  serverLogsCommand,
  staffCommand,
  suggestionCommand,
  moderationCommand,
  autoModCommand,
  greetingsCommand,
  rolePanelCommand,
  verificationCommand,
  recurringMessagesCommand,
  customPanelCommand,
  giveawayCommand,
  commandPermissionsCommand
];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildModeration]
});

attachAutoMod(client, database);
attachGreetings(client, database);
attachCommunityRoles(client, database);
attachRecurringMessages(client, database);
attachCustomPanels(client, database);
attachGiveaways(client, database);
attachCommandPermissions(client, database);

attachAntiRaid(client, database);
attachApplications(client, database);
attachServerLogs(client, database);
attachStaff(client, database);
attachSuggestions(client, database);
attachModeration(client, database);

async function registerGuild(guild: {
  id: string;
  name: string;
  ownerId: string;
}): Promise<void> {
  await database.query(
    "INSERT INTO \"SC_guilds\" (guild_id, name, owner_id, active) " +
      "VALUES ($1, $2, $3, TRUE) " +
      "ON CONFLICT (guild_id) DO UPDATE SET " +
      "name = EXCLUDED.name, owner_id = EXCLUDED.owner_id, active = TRUE",
    [guild.id, guild.name, guild.ownerId]
  );
}

async function createTicketPanel(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Dieser Befehl funktioniert nur auf einem Discord-Server.",
      ephemeral: true
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) && !(await hasExplicitCommandAllow(interaction, database))) {
    await interaction.reply({
      content: "Du benötigst die Berechtigung „Kanäle verwalten“.",
      ephemeral: true
    });
    return;
  }

  const title = interaction.options.getString("title", true);
  const description = interaction.options.getString("description", true);
  const category = interaction.options.getChannel("category", true);
  const supportRole = interaction.options.getRole("support-role", true);
  const logChannel = interaction.options.getChannel("log-channel", true);

  if (category.type !== ChannelType.GuildCategory) {
    await interaction.reply({
      content: "Die ausgewählte Kategorie ist ungültig.",
      ephemeral: true
    });
    return;
  }

  if (logChannel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "Der Log-Kanal muss ein normaler Textkanal sein.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const panelChannel = await interaction.guild.channels.fetch(
    interaction.channelId
  );

  if (!panelChannel || panelChannel.type !== ChannelType.GuildText) {
    await interaction.editReply(
      "Das Panel kann nur in einem normalen Textkanal erstellt werden."
    );
    return;
  }

  const panelId = randomUUID();
  await database.query(
    "INSERT INTO \"SC_ticket_panels\" " +
      "(panel_id, guild_id, panel_channel_id, category_id, support_role_id, log_channel_id, title, description, created_by) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      panelId,
      interaction.guild.id,
      panelChannel.id,
      category.id,
      supportRole.id,
      logChannel.id,
      title,
      description,
      interaction.user.id
    ]
  );

  const embed = new EmbedBuilder()
    .setColor(0x7188ff)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "ServerCore Ticketsystem" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("sc:ticket:create:" + panelId)
      .setLabel("Ticket erstellen")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary)
  );

  try {
    const message = await panelChannel.send({
      embeds: [embed],
      components: [row]
    });
    await database.query(
      "UPDATE \"SC_ticket_panels\" SET panel_message_id = $1 WHERE panel_id = $2",
      [message.id, panelId]
    );
    await interaction.editReply(
      "Ticket-Panel wurde in diesem Kanal erstellt."
    );
  } catch (error) {
    await database.query(
      "DELETE FROM \"SC_ticket_panels\" WHERE panel_id = $1",
      [panelId]
    );
    console.error("[ticket] Panel konnte nicht gesendet werden:", error);
    await interaction.editReply(
      "Das Panel konnte nicht gesendet werden. Prüfe meine Kanalrechte."
    );
  }
}

async function handleTicketCreate(
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
  panelId: string,
  categoryIndex = 0
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Der Server konnte nicht erkannt werden.",
      ephemeral: true
    });
    return;
  }

  const panelResult = await database.query<TicketPanelRow>(
    "SELECT panel_id, guild_id, category_id, support_role_id, log_channel_id, title, description, questions, categories, active " +
      "FROM \"SC_ticket_panels\" WHERE panel_id = $1 AND guild_id = $2 AND active = TRUE",
    [panelId, interaction.guild.id]
  );
  const panel = panelResult.rows[0];

  if (!panel) {
    await interaction.reply({ content: "Dieses Ticket-Panel ist nicht mehr aktiv.", ephemeral: true });
    return;
  }

  const selectedCategory = panel.categories?.[categoryIndex];
  if (interaction.isButton() && panel.categories?.length > 0) {
    const menu = new StringSelectMenuBuilder().setCustomId("sc:ticket:category:" + panelId).setPlaceholder("Ticketbereich auswählen").addOptions(panel.categories.slice(0, 25).map((item, index) => ({ label: item.label.slice(0, 100), value: String(index) })));
    await interaction.reply({ content: "Wähle aus, worum es bei deinem Ticket geht:", components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)], ephemeral: true });
    return;
  }
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && panel.questions.length > 0) {
    const modal = new ModalBuilder().setCustomId("sc:ticket:submit:" + panelId + ":" + categoryIndex).setTitle(panel.title.slice(0, 45));
    for (let index = 0; index < Math.min(panel.questions.length, 5); index += 1) {
      const question = panel.questions[index] ?? "Frage " + (index + 1);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("answer_" + index).setLabel(question.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setPlaceholder("Deine Antwort …")));
    }
    await interaction.showModal(modal);
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const answers = interaction.isModalSubmit() ? panel.questions.slice(0, 5).map((question, index) => ({ question, answer: interaction.fields.getTextInputValue("answer_" + index).trim() })) : [];
  const ticketCategoryId = selectedCategory?.category_id ?? panel.category_id;
  const ticketSupportRoleId = selectedCategory?.support_role_id ?? panel.support_role_id;
  const ticketLogChannelId = selectedCategory?.log_channel_id ?? panel.log_channel_id;

  const existing = await database.query<TicketRow>(
    "SELECT ticket_id, guild_id, panel_id, channel_id, opener_id, support_role_id, log_channel_id, status, claimed_by " +
      "FROM \"SC_tickets\" WHERE guild_id = $1 AND opener_id = $2 AND status = 'open' LIMIT 1",
    [interaction.guild.id, interaction.user.id]
  );

  if (existing.rows[0]) {
    await interaction.editReply(
      "Du hast bereits ein offenes Ticket: <#" +
        existing.rows[0].channel_id +
        ">."
    );
    return;
  }

  const ticketId = randomUUID();
  const botUserId =
    interaction.guild.members.me?.id ?? interaction.client.user?.id;
  if (!botUserId) {
    await interaction.editReply(
      "Die Bot-Identität konnte nicht ermittelt werden. Bitte versuche es erneut."
    );
    return;
  }

  const safeName =
    interaction.user.username
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 70) || interaction.user.id.slice(-6);
  const channel = await interaction.guild.channels.create({
    name: "ticket-" + safeName,
    type: ChannelType.GuildText,
    parent: ticketCategoryId,
    topic:
      "ServerCore ticket " +
      ticketId +
      " | opener " +
      interaction.user.id,
    permissionOverwrites: [
      {
        id: interaction.guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      },
      {
        id: botUserId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ManageChannels
        ]
      },
      {
        id: ticketSupportRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      }
    ]
  });

  try {
    const dbClient = await database.connect();
    try {
      await dbClient.query("BEGIN");
      await dbClient.query(
        "INSERT INTO \"SC_tickets\" " +
          "(ticket_id, guild_id, panel_id, channel_id, opener_id, support_role_id, log_channel_id, answers) " +
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)",
        [
          ticketId,
          interaction.guild.id,
          panelId,
          channel.id,
          interaction.user.id,
          ticketSupportRoleId,
          ticketLogChannelId,
          JSON.stringify(answers)
        ]
      );
      await dbClient.query(
        "INSERT INTO \"SC_audit_logs\" (guild_id, actor_id, action, target_id, metadata) " +
          "VALUES ($1, $2, 'ticket.opened', $3, $4::jsonb)",
        [
          interaction.guild.id,
          interaction.user.id,
          ticketId,
          JSON.stringify({
            channelId: channel.id,
            panelId
          })
        ]
      );
      await dbClient.query("COMMIT");
    } catch (error) {
      await dbClient.query("ROLLBACK");
      throw error;
    } finally {
      dbClient.release();
    }

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x7188ff)
      .setTitle("Ticket erstellt")
      .setDescription(
        "Hallo <@" +
          interaction.user.id +
          ">! Beschreibe dein Anliegen hier. Das Support-Team wird sich melden."
      )
      .addFields(
        ...(selectedCategory ? [{ name: "Ticketbereich", value: selectedCategory.label, inline: false }] : []),
        ...(answers.length > 0 ? answers.map((item) => ({ name: item.question.slice(0, 256), value: item.answer.slice(0, 1024) || "—", inline: false })) : []),
        {
          name: "Erstellt von",
          value: "<@" + interaction.user.id + ">",
          inline: true
        },
        {
          name: "Status",
          value: "Offen",
          inline: true
        }
      )
      .setFooter({
        text: "ServerCore · Ticket-ID " + ticketId.slice(0, 8)
      });

    const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("sc:ticket:claim:" + ticketId)
        .setLabel("Übernehmen")
        .setEmoji("🙋")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("sc:ticket:close:" + ticketId)
        .setLabel("Schließen")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content:
        "<@" +
        interaction.user.id +
        "> <@&" +
        panel.support_role_id +
        ">",
      embeds: [welcomeEmbed],
      components: [controls],
      allowedMentions: {
        users: [interaction.user.id],
        roles: [panel.support_role_id]
      }
    });

    await interaction.editReply(
      "Dein Ticket wurde erstellt: " + channel.toString()
    );
  } catch (error) {
    await database.query(
      "DELETE FROM \"SC_tickets\" WHERE ticket_id = $1",
      [ticketId]
    ).catch(() => undefined);
    await channel
      .delete("Ticket konnte nicht vollständig erstellt werden")
      .catch(() => undefined);

    if ((error as { code?: string }).code === "23505") {
      await interaction.editReply("Du hast bereits ein offenes Ticket.");
      return;
    }

    console.error("[ticket] Erstellung fehlgeschlagen:", error);
    await interaction.editReply(
      "Das Ticket konnte nicht erstellt werden. Bitte versuche es erneut oder wende dich an das Team."
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function buildTranscript(channel: TextChannel): Promise<Buffer> {
  const collected: Message[] = [];
  let before: string | undefined;
  const maxMessages = 2000;

  while (collected.length < maxMessages) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {})
    });
    if (batch.size === 0) break;
    collected.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100 || !before) break;
  }

  collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const entries = collected.map((message) => {
    const author = escapeHtml(message.author.tag);
    const timestamp = escapeHtml(
      message.createdAt.toLocaleString("de-DE", {
        timeZone: "Europe/Berlin"
      })
    );
    const body = escapeHtml(message.cleanContent).replace(/\n/g, "<br>");
    const attachments = [...message.attachments.values()]
      .map((attachment) => {
        const url = escapeHtml(attachment.url);
        const name = escapeHtml(attachment.name ?? "Datei");
        return '<a href="' + url + '">' + name + "</a>";
      })
      .join(" · ");

    return (
      '<article class="message"><header><strong>' +
      author +
      "</strong><time>" +
      timestamp +
      "</time></header><div>" +
      (body || "<em>[Kein Textinhalt]</em>") +
      (attachments
        ? '<p class="attachments">' + attachments + "</p>"
        : "") +
      "</div></article>"
    );
  }).join("\n");

  const html =
    '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Ticket-Transkript</title><style>" +
    "body{margin:0;padding:32px;background:#0b1020;color:#e8ecfb;font:14px system-ui,sans-serif}" +
    "main{max-width:900px;margin:auto}.message{padding:16px;margin:12px 0;border:1px solid #303a5c;border-radius:10px;background:#121a30}" +
    "header{display:flex;justify-content:space-between;gap:20px;color:#b9c5e8}time{color:#8794b7;font-size:12px}" +
    ".message div{line-height:1.65;overflow-wrap:anywhere}.attachments a{color:#9eafff}" +
    "</style></head><body><main><h1>Ticket-Transkript</h1><p>" +
    escapeHtml(channel.guild.name) +
    " · #" +
    escapeHtml(channel.name) +
    "</p><p>Nachrichten: " +
    collected.length +
    (collected.length >= maxMessages
      ? " (auf 2.000 begrenzt)"
      : "") +
    "</p>" +
    entries +
    "</main></body></html>";

  return Buffer.from(html, "utf8");
}

async function handleTicketClaim(
  interaction: ButtonInteraction,
  ticketId: string
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Server nicht erkannt.",
      ephemeral: true
    });
    return;
  }

  const result = await database.query<TicketRow>(
    "SELECT ticket_id, guild_id, panel_id, channel_id, opener_id, support_role_id, log_channel_id, status, claimed_by " +
      "FROM \"SC_tickets\" WHERE ticket_id = $1 AND guild_id = $2",
    [ticketId, interaction.guild.id]
  );
  const ticket = result.rows[0];

  if (!ticket || ticket.status !== "open") {
    await interaction.reply({
      content: "Dieses Ticket ist nicht mehr offen.",
      ephemeral: true
    });
    return;
  }

  const member = await interaction.guild.members.fetch(
    interaction.user.id
  );
  const isSupport = member.roles.cache.has(ticket.support_role_id);
  const canManage = member.permissions.has(
    PermissionFlagsBits.ManageChannels
  );

  if (!isSupport && !canManage) {
    await interaction.reply({
      content: "Nur das Support-Team darf Tickets übernehmen.",
      ephemeral: true
    });
    return;
  }

  if (ticket.claimed_by && ticket.claimed_by !== interaction.user.id) {
    await interaction.reply({
      content:
        "Dieses Ticket wurde bereits von <@" +
        ticket.claimed_by +
        "> übernommen.",
      ephemeral: true
    });
    return;
  }

  const claimUpdate = await database.query(
    "UPDATE \"SC_tickets\" SET claimed_by = $1 WHERE ticket_id = $2 AND status = 'open' " +
      "AND (claimed_by IS NULL OR claimed_by = $1) RETURNING ticket_id",
    [interaction.user.id, ticketId]
  );
  if (claimUpdate.rowCount === 0) {
    const latest = await database.query<{ claimed_by: string | null }>(
      "SELECT claimed_by FROM \"SC_tickets\" WHERE ticket_id = $1",
      [ticketId]
    );
    await interaction.reply({
      content: "Dieses Ticket wurde bereits von <@" + (latest.rows[0]?.claimed_by ?? "unbekannt") + "> übernommen.",
      ephemeral: true
    });
    return;
  }
  await database.query(
    "INSERT INTO \"SC_audit_logs\" (guild_id, actor_id, action, target_id, metadata) " +
      "VALUES ($1, $2, 'ticket.claimed', $3, $4::jsonb)",
    [
      interaction.guild.id,
      interaction.user.id,
      ticketId,
      JSON.stringify({ channelId: ticket.channel_id })
    ]
  );

  const channel = await interaction.guild.channels.fetch(
    ticket.channel_id
  );
  if (channel?.type === ChannelType.GuildText) {
    await channel.send(
      "🙋 Ticket wurde von <@" + interaction.user.id + "> übernommen."
    );
  }

  await interaction.reply({
    content: "Du bist jetzt für dieses Ticket zuständig.",
    ephemeral: true
  });
}

async function handleTicketClose(
  interaction: ButtonInteraction,
  ticketId: string
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "Server nicht erkannt.",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const result = await database.query<TicketRow>(
    "SELECT ticket_id, guild_id, panel_id, channel_id, opener_id, support_role_id, log_channel_id, status, claimed_by " +
      "FROM \"SC_tickets\" WHERE ticket_id = $1 AND guild_id = $2",
    [ticketId, interaction.guild.id]
  );
  const ticket = result.rows[0];

  if (!ticket || ticket.status !== "open") {
    await interaction.editReply(
      ticket?.status === "closing"
        ? "Dieses Ticket wird gerade geschlossen."
        : "Dieses Ticket ist bereits geschlossen."
    );
    return;
  }

  const member = await interaction.guild.members.fetch(
    interaction.user.id
  );
  const isSupport = member.roles.cache.has(ticket.support_role_id);
  const canManage = member.permissions.has(
    PermissionFlagsBits.ManageChannels
  );

  if (
    ticket.opener_id !== interaction.user.id &&
    !isSupport &&
    !canManage
  ) {
    await interaction.editReply(
      "Nur der Ersteller oder das Support-Team darf dieses Ticket schließen."
    );
    return;
  }

  const closeLock = await database.query(
    "UPDATE \"SC_tickets\" SET status = 'closing', closed_by = $1 " +
      "WHERE ticket_id = $2 AND status = 'open' RETURNING ticket_id",
    [interaction.user.id, ticketId]
  );
  if (closeLock.rowCount === 0) {
    await interaction.editReply("Dieses Ticket wird bereits geschlossen.");
    return;
  }

  const channel = await interaction.guild.channels.fetch(
    ticket.channel_id
  );

  if (!channel || channel.type !== ChannelType.GuildText) {
    await database.query(
      "UPDATE \"SC_tickets\" SET status = 'closed', closed_by = $1, closed_at = NOW() WHERE ticket_id = $2 AND status = 'closing'",
      [interaction.user.id, ticketId]
    );
    await interaction.editReply(
      "Ticket-Kanal wurde nicht gefunden. Der Datenbankeintrag wurde geschlossen."
    );
    return;
  }

  await interaction.editReply(
    "Ticket wird geschlossen und Transkript erstellt…"
  );

  const transcript = await buildTranscript(channel);
  const transcriptFile = new AttachmentBuilder(transcript, {
    name: "ticket-" + ticketId.slice(0, 8) + "-transkript.html"
  });
  const logChannel = await interaction.guild.channels.fetch(
    ticket.log_channel_id
  );
  let transcriptUrl: string | null = null;

  if (logChannel?.type === ChannelType.GuildText) {
    const logMessage = await logChannel.send({
      content:
        "🔒 **Ticket geschlossen** · #" +
        channel.name +
        "\nErstellt von: <@" +
        ticket.opener_id +
        ">\nGeschlossen von: <@" +
        interaction.user.id +
        ">",
      files: [transcriptFile]
    });
    transcriptUrl = logMessage.attachments.first()?.url ?? null;
  } else {
    const archiveMessage = await channel.send({
      content: "Transkript (Log-Kanal nicht verfügbar):",
      files: [transcriptFile]
    });
    transcriptUrl = archiveMessage.attachments.first()?.url ?? null;
  }

  await channel.permissionOverwrites.edit(ticket.opener_id, {
    SendMessages: false,
    AddReactions: false
  });
  await channel.setName(("closed-" + channel.name).slice(0, 100));
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x747b91)
        .setTitle("Ticket geschlossen")
        .setDescription(
          "Dieses Ticket wurde von <@" +
            interaction.user.id +
            "> geschlossen. Das Transkript wurde gespeichert."
        )
        .setFooter({ text: "ServerCore Ticketsystem" })
    ],
    components: []
  });

  await database.query(
    "UPDATE \"SC_tickets\" SET status = 'closed', closed_by = $1, closed_at = NOW(), transcript_url = $2 WHERE ticket_id = $3 AND status = 'closing'",
    [interaction.user.id, transcriptUrl, ticketId]
  );
  await database.query(
    "INSERT INTO \"SC_audit_logs\" (guild_id, actor_id, action, target_id, metadata) " +
      "VALUES ($1, $2, 'ticket.closed', $3, $4::jsonb)",
    [
      interaction.guild.id,
      interaction.user.id,
      ticketId,
      JSON.stringify({
        channelId: channel.id,
        transcriptUrl
      })
    ]
  );

  await interaction.editReply(
    "Ticket geschlossen. Der Kanal bleibt als Archiv bestehen."
  );
}

client.once(Events.ClientReady, async (readyClient) => {
  console.info("[bot] Eingeloggt als " + readyClient.user.tag);

  for (const guild of readyClient.guilds.cache.values()) {
    try {
      await registerGuild(guild);
    } catch (error) {
      console.error(
        "[bot] Server-Sync fehlgeschlagen:",
        guild.id,
        error
      );
    }
  }

  if (process.env.DISCORD_SYNC_COMMANDS === "false") return;
  try {
    const rest = new REST({ version: "10" }).setToken(token);
    const appId =
      process.env.DISCORD_APPLICATION_ID ??
      readyClient.application.id;
    const guildId = process.env.DISCORD_GUILD_ID;
    const route = guildId
      ? Routes.applicationGuildCommands(appId, guildId)
      : Routes.applicationCommands(appId);

    await rest.put(route, {
      body: commands.map((command) => command.toJSON())
    });
    console.info("[bot] Slash Commands registriert.");
  } catch (error) {
    console.error(
      "[bot] Command-Registrierung fehlgeschlagen:",
      error
    );
  }
});

client.on(Events.GuildCreate, (guild) => {
  void registerGuild(guild).catch((error) => {
    console.error(
      "[bot] Server-Sync fehlgeschlagen:",
      guild.id,
      error
    );
  });
});

client.on(Events.GuildDelete, (guild) => {
  void database
    .query(
      "UPDATE \"SC_guilds\" SET active = FALSE WHERE guild_id = $1",
      [guild.id]
    )
    .catch((error) => {
      console.error(
        "[bot] Server-Deaktivierung fehlgeschlagen:",
        guild.id,
        error
      );
    });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!(await canExecuteCommand(interaction, database))) return;
      if (interaction.commandName === "ping") {
        await interaction.reply({
          content:
            "Pong! Gateway-Latenz: " + client.ws.ping + " ms",
          ephemeral: true
        });
      } else if (interaction.commandName === "servercore") {
        await interaction.reply({
          content:
            "ServerCore ist online. Das Ticketsystem ist verfügbar mit /ticket panel.",
          ephemeral: true
        });
      } else if (
        interaction.commandName === "ticket" &&
        interaction.options.getSubcommand() === "panel"
      ) {
        await createTicketPanel(interaction);
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const [prefix, moduleName, action, id, categoryIndex] = interaction.customId.split(":");
      if (prefix === "sc" && moduleName === "ticket" && action === "submit" && id) await handleTicketCreate(interaction, id, Number(categoryIndex ?? 0));
      return;
    }
    if (interaction.isStringSelectMenu()) {
      const [prefix, moduleName, action, id] = interaction.customId.split(":");
      if (prefix === "sc" && moduleName === "ticket" && action === "category" && id) await handleTicketCreate(interaction, id, Number(interaction.values[0]));
      return;
    }
    if (!interaction.isButton()) return;
    const [prefix, moduleName, action, id] = interaction.customId.split(":");
    if (
      prefix !== "sc" ||
      moduleName !== "ticket" ||
      !action ||
      !id
    ) return;

    if (action === "create") {
      await handleTicketCreate(interaction, id);
    } else if (action === "claim") {
      await handleTicketClaim(interaction, id);
    } else if (action === "close") {
      await handleTicketClose(interaction, id);
    }
  } catch (error) {
    if (interaction.isButton() && interaction.guild) {
      const [, moduleName, action, ticketId] = interaction.customId.split(":");
      if (moduleName === "ticket" && action === "close" && ticketId) {
        await database.query(
          "UPDATE \"SC_tickets\" SET status = 'open', closed_by = NULL " +
            "WHERE ticket_id = $1 AND guild_id = $2 AND status = 'closing'",
          [ticketId, interaction.guild.id]
        ).catch(() => undefined);
      }
    }
    console.error("[ticket] Interaction fehlgeschlagen:", error);
    if (interaction.isRepliable()) {
      const message =
        "Die Aktion ist fehlgeschlagen. Bitte prüfe die Bot-Rechte oder versuche es erneut.";
      if (interaction.deferred) {
        await interaction.editReply(message).catch(() => undefined);
      } else if (!interaction.replied) {
        await interaction
          .reply({ content: message, ephemeral: true })
          .catch(() => undefined);
      }
    }
  }
});

client.on(Events.Error, (error) => {
  console.error("[bot] Discord-Fehler:", error);
});

const shutdown = async (signal: string) => {
  console.info("[bot] Beende Client (" + signal + ")");
  client.destroy();
  await closeDatabase(database);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(token);
} catch (error) {
  await closeDatabase(database).catch(() => undefined);
  throw error;
}
}

void main().catch((error) => {
  console.error("[SC] Start fehlgeschlagen:", error);
  process.exitCode = 1;
});
