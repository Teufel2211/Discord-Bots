import { canExecuteCommand, hasExplicitCommandAllow } from "./command-permissions.js";
import {
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Client
} from "discord.js";
import type { createDatabase } from "../database.js";

type Database = ReturnType<typeof createDatabase>;
type RecordType = "warning" | "note" | "promotion";

export const staffCommand = new SlashCommandBuilder()
  .setName("personal")
  .setDescription("Verwaltet interne Personalakten.")
  .addSubcommand((s) => s.setName("verwarnen").setDescription("Dokumentiert eine Verwarnung.")
    .addUserOption((o) => o.setName("mitglied").setDescription("Betroffenes Mitglied.").setRequired(true))
    .addStringOption((o) => o.setName("grund").setDescription("Grund der Verwarnung.").setMaxLength(1000).setRequired(true)))
  .addSubcommand((s) => s.setName("notiz").setDescription("Fügt eine interne Personalnotiz hinzu.")
    .addUserOption((o) => o.setName("mitglied").setDescription("Betroffenes Mitglied.").setRequired(true))
    .addStringOption((o) => o.setName("text").setDescription("Interne Notiz.").setMaxLength(1000).setRequired(true)))
  .addSubcommand((s) => s.setName("befoerdern").setDescription("Dokumentiert eine Beförderung.")
    .addUserOption((o) => o.setName("mitglied").setDescription("Befördertes Mitglied.").setRequired(true))
    .addStringOption((o) => o.setName("neuer-rang").setDescription("Neuer Rang oder neue Position.").setMaxLength(100).setRequired(true))
    .addStringOption((o) => o.setName("grund").setDescription("Optionale Begründung.").setMaxLength(900).setRequired(false)))
  .addSubcommand((s) => s.setName("historie").setDescription("Zeigt die letzten Personalvorgänge.")
    .addUserOption((o) => o.setName("mitglied").setDescription("Mitglied; ohne Auswahl serverweite Übersicht.").setRequired(false)));

export function attachStaff(client: Client, database: Database): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "personal") return;
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
      const enabled = await database.query<{ enabled: boolean }>(
        "SELECT enabled FROM \"SC_module_settings\" WHERE guild_id = $1 AND module_key = 'staff'",
        [interaction.guild.id]
      );
      if (!enabled.rows[0]?.enabled) {
        await interaction.reply({ content: "Die Mitarbeiterverwaltung ist im Dashboard nicht aktiviert.", ephemeral: true });
        return;
      }

      const sub = interaction.options.getSubcommand();
      if (sub === "historie") {
        const member = interaction.options.getUser("mitglied");
        const result = await database.query<{
          record_type: RecordType; target_id: string; actor_id: string; details: string; created_at: Date;
        }>(
          "SELECT record_type, target_id, actor_id, details, created_at FROM \"SC_staff_records\" WHERE guild_id = $1 " +
          (member ? "AND target_id = $2 " : "") + "ORDER BY created_at DESC LIMIT 10",
          member ? [interaction.guild.id, member.id] : [interaction.guild.id]
        );
        const embed = new EmbedBuilder().setColor(0x7188ff).setTitle(member ? "Personalhistorie · " + member.username : "Letzte Personalvorgänge");
        if (!result.rows.length) embed.setDescription("Keine Einträge vorhanden.");
        else embed.setDescription(result.rows.map((row) => {
          const label = row.record_type === "warning" ? "Verwarnung" : row.record_type === "promotion" ? "Beförderung" : "Notiz";
          return "**" + label + "** · <@" + row.target_id + ">\\n" + row.details.slice(0, 500) +
            "\\nVon <@" + row.actor_id + "> · <t:" + Math.floor(new Date(row.created_at).getTime() / 1000) + ":R>";
        }).join("\\n\\n").slice(0, 4000));
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
      }

      const target = interaction.options.getUser("mitglied", true);
      if (target.bot) {
        await interaction.reply({ content: "Bot-Konten können nicht in Personalakten aufgenommen werden.", ephemeral: true });
        return;
      }
      let recordType: RecordType;
      let details: string;
      if (sub === "verwarnen") {
        recordType = "warning";
        details = interaction.options.getString("grund", true).trim();
      } else if (sub === "befoerdern") {
        recordType = "promotion";
        const rank = interaction.options.getString("neuer-rang", true).trim();
        const reason = interaction.options.getString("grund")?.trim();
        details = "Neuer Rang: " + rank + (reason ? " · " + reason : "");
      } else {
        recordType = "note";
        details = interaction.options.getString("text", true).trim();
      }
      if (!details) {
        await interaction.reply({ content: "Der Eintrag darf nicht leer sein.", ephemeral: true });
        return;
      }
      await database.query(
        "INSERT INTO \"SC_staff_records\" (record_id, guild_id, target_id, actor_id, record_type, details) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)",
        [interaction.guild.id, target.id, interaction.user.id, recordType, details]
      );
      await database.query(
        "INSERT INTO \"SC_audit_logs\" (guild_id, actor_id, action, target_id, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)",
        [interaction.guild.id, interaction.user.id, "staff." + recordType, target.id, JSON.stringify({ details })]
      );
      const label = recordType === "warning" ? "Verwarnung" : recordType === "promotion" ? "Beförderung" : "Personalnotiz";
      await interaction.reply({ content: label + " für <@" + target.id + "> wurde vertraulich gespeichert.", ephemeral: true });
    } catch (error) {
      console.error("[staff] Personalvorgang fehlgeschlagen:", error);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Der Personalvorgang konnte nicht gespeichert werden.", ephemeral: true }).catch(() => undefined);
      }
    }
  });
}
