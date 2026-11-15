import { canExecuteCommand, hasExplicitCommandAllow } from "./command-permissions.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits,
  SlashCommandBuilder, StringSelectMenuBuilder, type Client
} from "discord.js";
import type { createDatabase } from "../database.js";
import { randomUUID } from "node:crypto";

type Database = ReturnType<typeof createDatabase>;
type PanelButton = { label: string; url: string };
type PanelAction = { label: string; response: string };
type StoredPanelConfig = { links: PanelButton[]; actions: PanelAction[] };

function parseActions(raw: string | null): PanelAction[] | null {
  if (!raw?.trim()) return [];
  const lines = raw.split("\\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 1 || lines.length > 25) return null;
  const actions: PanelAction[] = [];
  const labels = new Set<string>();
  for (const line of lines) {
    const separator = line.indexOf("|");
    if (separator < 1) return null;
    const label = line.slice(0, separator).trim();
    const response = line.slice(separator + 1).trim();
    if (!label || label.length > 100 || labels.has(label) || !response || response.length > 1000) return null;
    labels.add(label);
    actions.push({ label, response });
  }
  return actions;
}

function readPanelConfig(value: unknown): StoredPanelConfig {
  if (Array.isArray(value)) return { links: value as PanelButton[], actions: [] };
  if (value && typeof value === "object") {
    const config = value as Partial<StoredPanelConfig>;
    return {
      links: Array.isArray(config.links) ? config.links : [],
      actions: Array.isArray(config.actions) ? config.actions : []
    };
  }
  return { links: [], actions: [] };
}

function parseButtons(raw: string): PanelButton[] | null {
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 1 || lines.length > 5) return null;
  const result: PanelButton[] = [];
  for (const line of lines) {
    const [label, ...urlParts] = line.split("|");
    const url = urlParts.join("|").trim();
    if (!label?.trim() || label.trim().length > 80 || !/^https:\/\//i.test(url) || url.length > 512) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    } catch { return null; }
    result.push({ label: label.trim(), url });
  }
  return result;
}

export const customPanelCommand = new SlashCommandBuilder()
  .setName("custompanel")
  .setDescription("Erstellt ein individuelles Panel mit Links und interaktiven Aktionen.")
  .addSubcommand((sub) => sub.setName("erstellen").setDescription("Veröffentlicht ein eigenes Panel mit Links und optionalem Auswahlmenü.")
    .addChannelOption((o) => o.setName("kanal").setDescription("Zielkanal").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((o) => o.setName("titel").setDescription("Panel-Titel").setMaxLength(100).setRequired(true))
    .addStringOption((o) => o.setName("beschreibung").setDescription("Panel-Beschreibung").setMaxLength(4000).setRequired(true))
    .addStringOption((o) => o.setName("buttons").setDescription("Eine Zeile pro Link-Button: Beschriftung|https://URL (max. 5)").setMaxLength(3000).setRequired(true))
    .addStringOption((o) => o.setName("aktionen").setDescription("Optional: Auswahlmenü, eine Zeile je Option: Beschriftung|Antwort (max. 25)").setMaxLength(4000)))
  .addSubcommand((sub) => sub.setName("liste").setDescription("Zeigt deine veröffentlichten Panels."));

export function attachCustomPanels(client: Client, database: Database): void {
  client.on("interactionCreate", async (interaction) => {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("custompanel:select:")) {
      const panelId = interaction.customId.slice("custompanel:select:".length);
      try {
        const result = await database.query<{ buttons: unknown; active: boolean }>(
          "SELECT buttons,active FROM \"SC_custom_panels\" WHERE panel_id=$1 AND guild_id=$2",
          [panelId, interaction.guildId]
        );
        const panel = result.rows[0];
        const config = readPanelConfig(panel?.buttons);
        if (!panel?.active) {
          await interaction.reply({ content: "Dieses Panel ist nicht mehr aktiv.", ephemeral: true });
          return;
        }
        const selected = config.actions.find((action) => action.label === interaction.values[0]);
        if (!selected) {
          await interaction.reply({ content: "Diese Aktion ist nicht mehr verfügbar.", ephemeral: true });
          return;
        }
        await interaction.reply({ content: selected.response, ephemeral: true, allowedMentions: { parse: [] } });
      } catch (error) {
        console.error("[custom-panels] Action failed:", error);
        if (!interaction.replied) await interaction.reply({ content: "Die Aktion konnte nicht ausgeführt werden.", ephemeral: true }).catch(() => undefined);
      }
      return;
    }
    if (!interaction.isChatInputCommand() || interaction.commandName !== "custompanel") return;
    if (!(await canExecuteCommand(interaction, database))) return;
    try {
      if (!interaction.guild || (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !(await hasExplicitCommandAllow(interaction, database)))) {
        await interaction.reply({ content: "Du benötigst „Server verwalten“ auf einem Server.", ephemeral: true });
        return;
      }
      if (interaction.options.getSubcommand() === "liste") {
        const result = await database.query<{ panel_id: string; title: string; channel_id: string; active: boolean }>(
          "SELECT panel_id,title,channel_id,active FROM \"SC_custom_panels\" WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 20",
          [interaction.guild.id]
        );
        await interaction.reply({ content: result.rows.length ? result.rows.map((row) => "`" + row.panel_id + "` · **" + row.title + "** · <#" + row.channel_id + "> · " + (row.active ? "aktiv" : "archiviert")).join("\n").slice(0, 1900) : "Noch keine benutzerdefinierten Panels vorhanden.", ephemeral: true });
        return;
      }
      const channelOption = interaction.options.getChannel("kanal", true);
      const channel = await interaction.guild.channels.fetch(channelOption.id);
      const title = interaction.options.getString("titel", true).trim();
      const description = interaction.options.getString("beschreibung", true).trim();
      const buttons = parseButtons(interaction.options.getString("buttons", true));
      const actions = parseActions(interaction.options.getString("aktionen"));
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "Bitte wähle einen Textkanal.", ephemeral: true });
        return;
      }
      if (!title || !description || !buttons || !actions) {
        await interaction.reply({ content: "Ungültige Panel-Daten. Links: Beschriftung|https://URL. Aktionen: Beschriftung|Antwort (max. 25).", ephemeral: true });
        return;
      }
      const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
      if (!channel.permissionsFor(botMember)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        await interaction.reply({ content: "Mir fehlen im Zielkanal die Rechte zum Senden oder Einbetten.", ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const panelId = randomUUID();
      const components = [];
      if (buttons.length) {
        components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
          buttons.map((button) => new ButtonBuilder().setLabel(button.label).setStyle(ButtonStyle.Link).setURL(button.url))
        ));
      }
      if (actions.length) {
        components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("custompanel:select:" + panelId)
            .setPlaceholder("Aktion auswählen …")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(actions.map((action) => ({ label: action.label, value: action.label, description: action.response.slice(0, 100) })))
        ));
      }
      const message = await channel.send({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(description).setFooter({ text: "ServerCore · Benutzerdefiniertes Panel" })],
        components,
        allowedMentions: { parse: [] }
      });
      try {
        await database.query(
          "INSERT INTO \"SC_custom_panels\" (panel_id,guild_id,channel_id,message_id,title,description,buttons,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",
          [panelId, interaction.guild.id, channel.id, message.id, title, description, JSON.stringify({ links: buttons, actions }), interaction.user.id]
        );
        await database.query(
          "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,'custom_panel.created',$3,$4::jsonb)",
          [interaction.guild.id, interaction.user.id, panelId, JSON.stringify({ channelId: channel.id, messageId: message.id })]
        );
      } catch (error) {
        await message.delete().catch(() => undefined);
        throw error;
      }
      await interaction.editReply("Dein Panel wurde in " + channel.toString() + " veröffentlicht. ID: `" + panelId + "`.");
    } catch (error) {
      console.error("[custom-panels] Interaction fehlgeschlagen:", error);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Das benutzerdefinierte Panel konnte nicht erstellt werden.", ephemeral: true }).catch(() => undefined);
      } else if (interaction.isRepliable() && interaction.deferred) {
        await interaction.editReply("Das benutzerdefinierte Panel konnte nicht erstellt werden.").catch(() => undefined);
      }
    }
  });
}
