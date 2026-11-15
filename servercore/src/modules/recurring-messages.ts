import { canExecuteCommand, hasExplicitCommandAllow } from "./command-permissions.js";
import {
  ChannelType,
  type Client,
  Events,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel
} from "discord.js";
import type { createDatabase } from "../database.js";

type Database = ReturnType<typeof createDatabase>;
type ScheduledMessage = {
  message_id: string;
  guild_id: string;
  channel_id: string;
  content: string;
  interval_minutes: number;
  active: boolean;
  next_run_at: Date;
  pending_run_at?: Date | null;
  delivery_attempts?: number;
};

export const recurringMessagesCommand = new SlashCommandBuilder()
  .setName("wiederholung")
  .setDescription("Verwaltet wiederkehrende Nachrichten.")
  .addSubcommand((sub) => sub.setName("erstellen").setDescription("Plant eine wiederkehrende Nachricht.")
    .addChannelOption((o) => o.setName("kanal").setDescription("Zielkanal").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((o) => o.setName("nachricht").setDescription("Zu veröffentlichender Text").setMaxLength(2000).setRequired(true))
    .addIntegerOption((o) => o.setName("intervall").setDescription("Abstand in Minuten (mindestens 15)").setMinValue(15).setMaxValue(43200).setRequired(true)))
  .addSubcommand((sub) => sub.setName("liste").setDescription("Zeigt geplante Nachrichten."))
  .addSubcommand((sub) => sub.setName("pause").setDescription("Pausiert eine Nachricht.")
    .addStringOption((o) => o.setName("id").setDescription("ID aus /wiederholung liste").setRequired(true)))
  .addSubcommand((sub) => sub.setName("fortsetzen").setDescription("Setzt eine Nachricht fort.")
    .addStringOption((o) => o.setName("id").setDescription("ID aus /wiederholung liste").setRequired(true)))
  .addSubcommand((sub) => sub.setName("loeschen").setDescription("Löscht eine geplante Nachricht.")
    .addStringOption((o) => o.setName("id").setDescription("ID aus /wiederholung liste").setRequired(true)));

export function attachRecurringMessages(client: Client, database: Database): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "wiederholung") return;
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
      const sub = interaction.options.getSubcommand();
      if (sub === "erstellen") {
        const selected = interaction.options.getChannel("kanal", true);
        const channel = await interaction.guild.channels.fetch(selected.id);
        if (!channel || channel.type !== ChannelType.GuildText) {
          await interaction.reply({ content: "Bitte wähle einen Textkanal dieses Servers.", ephemeral: true });
          return;
        }
        const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
        if (!channel.permissionsFor(botMember)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
          await interaction.reply({ content: "Mir fehlen im Zielkanal die Rechte „Kanal ansehen“ oder „Nachrichten senden“.", ephemeral: true });
          return;
        }
        const content = interaction.options.getString("nachricht", true).trim();
        const interval = interaction.options.getInteger("intervall", true);
        if (!content) {
          await interaction.reply({ content: "Die Nachricht darf nicht leer sein.", ephemeral: true });
          return;
        }
        const result = await database.query<{ message_id: string; next_run_at: Date }>(
          "INSERT INTO \"SC_recurring_messages\" (guild_id, channel_id, content, interval_minutes, created_by, next_run_at) VALUES ($1,$2,$3,$4,$5,NOW() + ($4 * INTERVAL '1 minute')) RETURNING message_id,next_run_at",
          [interaction.guild.id, channel.id, content, interval, interaction.user.id]
        );
        const created = result.rows[0];
        if (!created) throw new Error("Insert der wiederkehrenden Nachricht lieferte keinen Datensatz.");
        await database.query(
          "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,'recurring_message.created',$3,$4::jsonb)",
          [interaction.guild.id, interaction.user.id, created.message_id, JSON.stringify({ channelId: channel.id, intervalMinutes: interval })]
        );
        await interaction.reply({ content: "Wiederkehrende Nachricht erstellt. ID: `" + created.message_id + "`. Erste Veröffentlichung: <t:" + Math.floor(new Date(created.next_run_at).getTime() / 1000) + ":R>.", ephemeral: true });
        return;
      }
      if (sub === "liste") {
        const result = await database.query<ScheduledMessage>(
          "SELECT message_id,guild_id,channel_id,content,interval_minutes,active,next_run_at FROM \"SC_recurring_messages\" WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 25",
          [interaction.guild.id]
        );
        if (!result.rows.length) {
          await interaction.reply({ content: "Es sind keine wiederkehrenden Nachrichten eingerichtet.", ephemeral: true });
          return;
        }
        const lines = result.rows.map((row) => "`" + row.message_id + "` · <#" + row.channel_id + "> · alle " + row.interval_minutes + " Min. · " + (row.active ? "aktiv" : "pausiert") + " · " + row.content.slice(0, 90).replace(/\n/g, " "));
        await interaction.reply({ content: lines.join("\n").slice(0, 1900), ephemeral: true });
        return;
      }
      const id = interaction.options.getString("id", true);
      const active = sub === "fortsetzen";
      const result = sub === "loeschen"
        ? await database.query("DELETE FROM \"SC_recurring_messages\" WHERE guild_id=$1 AND message_id=$2 RETURNING message_id", [interaction.guild.id, id])
        : await database.query("UPDATE \"SC_recurring_messages\" SET active=$3, next_run_at=CASE WHEN $3 THEN NOW() + (interval_minutes * INTERVAL '1 minute') ELSE next_run_at END, updated_at=NOW() WHERE guild_id=$1 AND message_id=$2 RETURNING message_id", [interaction.guild.id, id, active]);
      if (!result.rowCount) {
        await interaction.reply({ content: "Diese Nachrichten-ID wurde auf diesem Server nicht gefunden.", ephemeral: true });
        return;
      }
      await database.query(
        "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,$3,$4,'{}'::jsonb)",
        [interaction.guild.id, interaction.user.id, sub === "loeschen" ? "recurring_message.deleted" : active ? "recurring_message.resumed" : "recurring_message.paused", id]
      );
      await interaction.reply({ content: sub === "loeschen" ? "Nachricht wurde gelöscht." : active ? "Nachricht wurde fortgesetzt. Der nächste Versand erfolgt nach einem vollständigen Intervall." : "Nachricht wurde pausiert.", ephemeral: true });
    } catch (error) {
      console.error("[recurring-messages] Befehl fehlgeschlagen:", error);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Die wiederkehrende Nachricht konnte nicht verarbeitet werden.", ephemeral: true }).catch(() => undefined);
      }
    }
  });

  const processDueMessages = async () => {
    const due = await database.query<ScheduledMessage>(
      "WITH candidates AS (SELECT message_id FROM \"SC_recurring_messages\" WHERE active=TRUE AND ((delivery_pending=FALSE AND next_run_at<=NOW()) OR (delivery_pending=TRUE AND COALESCE(delivery_retry_after,NOW())<=NOW() AND COALESCE(delivery_lease_until,NOW())<=NOW())) ORDER BY COALESCE(pending_run_at,next_run_at) ASC LIMIT 25 FOR UPDATE SKIP LOCKED) UPDATE \"SC_recurring_messages\" AS scheduled SET delivery_pending=TRUE,pending_run_at=CASE WHEN scheduled.delivery_pending THEN scheduled.pending_run_at ELSE scheduled.next_run_at END,next_run_at=CASE WHEN scheduled.delivery_pending THEN scheduled.next_run_at ELSE NOW() + (scheduled.interval_minutes * INTERVAL '1 minute') END,delivery_attempts=CASE WHEN scheduled.delivery_pending THEN scheduled.delivery_attempts ELSE 0 END,delivery_lease_until=NOW()+INTERVAL '5 minutes',delivery_retry_after=NULL,last_attempt_at=NOW(),updated_at=NOW() FROM candidates WHERE scheduled.message_id=candidates.message_id RETURNING scheduled.message_id,scheduled.guild_id,scheduled.channel_id,scheduled.content,scheduled.interval_minutes,scheduled.active,scheduled.next_run_at,scheduled.pending_run_at,scheduled.delivery_attempts"
    );
    for (const row of due.rows) {
      try {
        const channel = await client.channels.fetch(row.channel_id);
        if (!channel || channel.type !== ChannelType.GuildText || channel.guildId !== row.guild_id) {
          throw new Error("Zielkanal nicht verfügbar oder kein Textkanal.");
        }
        const occurrence = Math.floor(new Date(row.pending_run_at ?? row.next_run_at).getTime() / 1000).toString(36);
        const nonce = (row.message_id.replace(/-/g, "").slice(0, 12) + occurrence).slice(0, 25);
        await (channel as TextChannel).send({
          content: row.content,
          allowedMentions: { parse: [] },
          nonce,
          enforceNonce: true
        });
        const connection = await database.connect();
        try {
          await connection.query("BEGIN");
          await connection.query(
            "UPDATE \"SC_recurring_messages\" SET last_sent_at=NOW(),last_error=NULL,next_run_at=CASE WHEN next_run_at<=NOW() THEN NOW() + (interval_minutes * INTERVAL '1 minute') ELSE next_run_at END,delivery_pending=FALSE,pending_run_at=NULL,delivery_attempts=0,delivery_retry_after=NULL,delivery_lease_until=NULL,updated_at=NOW() WHERE message_id=$1",
            [row.message_id]
          );
          await connection.query(
            "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,NULL,'recurring_message.sent',$2,$3::jsonb)",
            [row.guild_id, row.message_id, JSON.stringify({ channelId: row.channel_id, scheduledFor: row.pending_run_at })]
          );
          await connection.query("COMMIT");
        } catch (error) {
          await connection.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          connection.release();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : "Unbekannter Versandfehler";
        await database.query(
          "UPDATE \"SC_recurring_messages\" SET last_error=$2,delivery_attempts=delivery_attempts+1,delivery_retry_after=NOW()+LEAST(360,POWER(2,LEAST(delivery_attempts,8))) * INTERVAL '1 minute',delivery_lease_until=NULL,updated_at=NOW() WHERE message_id=$1",
          [row.message_id, message]
        );
        await database.query(
          "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,NULL,'recurring_message.failed',$2,$3::jsonb)",
          [row.guild_id, row.message_id, JSON.stringify({ channelId: row.channel_id, error: message, scheduledFor: row.pending_run_at })]
        ).catch((auditError) => console.error("[recurring-messages] Fehler-Audit fehlgeschlagen:", auditError));
        console.error("[recurring-messages] Versand fehlgeschlagen:", row.message_id, error);
      }
    }
  };
  const timer = setInterval(() => void processDueMessages().catch((error) => console.error("[recurring-messages] Scheduler fehlgeschlagen:", error)), 15_000);
  timer.unref();
  void processDueMessages().catch((error) => console.error("[recurring-messages] Initialer Scheduler fehlgeschlagen:", error));
}
