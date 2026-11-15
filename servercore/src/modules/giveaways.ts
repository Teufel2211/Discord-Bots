import { canExecuteCommand, hasExplicitCommandAllow } from "./command-permissions.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
  Events, PermissionFlagsBits, SlashCommandBuilder, type Client, type TextChannel
} from "discord.js";
import { randomInt, randomUUID } from "node:crypto";
import type { createDatabase } from "../database.js";

type Database = ReturnType<typeof createDatabase>;
type GiveawayRow = {
  giveaway_id: string; guild_id: string; channel_id: string; message_id: string | null;
  prize: string; winner_count: number; ends_at: Date; bonus_role_id: string | null;
  bonus_entries: number; ended: boolean; winner_ids: string[];
  result_published_at?: Date | null; result_publish_attempts?: number; result_publish_after?: Date | null;
};
const buttonId = (id: string) => "giveaway:join:" + id;

async function publishGiveawayResult(client: Client, database: Database, row: GiveawayRow): Promise<void> {
  const current = await database.query<GiveawayRow>(
    "SELECT giveaway_id,guild_id,channel_id,message_id,prize,winner_count,ends_at,bonus_role_id,bonus_entries,ended,winner_ids,result_publish_attempts FROM \"SC_giveaways\" WHERE giveaway_id=$1 AND guild_id=$2 AND ended=TRUE",
    [row.giveaway_id, row.guild_id]
  );
  const giveaway = current.rows[0];
  if (!giveaway || !giveaway.message_id) return;
  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) throw new Error("Giveaway-Zielkanal ist nicht verfügbar.");
  const message = await (channel as TextChannel).messages.fetch(giveaway.message_id).catch(() => null);
  if (!message) throw new Error("Ursprüngliche Giveaway-Nachricht ist nicht verfügbar.");
  const winners = giveaway.winner_ids ?? [];
  const embed = EmbedBuilder.from(message.embeds[0] ?? new EmbedBuilder().setTitle(giveaway.prize))
    .setColor(0x747f8d)
    .setDescription("**Gewinnspiel beendet**\\n" + (winners.length ? winners.map((id) => "<@" + id + ">").join(", ") : "Keine gültigen Teilnehmer."))
    .setFooter({ text: "ServerCore Giveaway · Ergebnis veröffentlicht" });
  await message.edit({ embeds: [embed], components: [] });
  await database.query(
    "UPDATE \"SC_giveaways\" SET result_published_at=NOW(),result_publication_pending=FALSE,result_publish_error=NULL,result_publish_after=NULL,updated_at=NOW() WHERE giveaway_id=$1 AND guild_id=$2",
    [giveaway.giveaway_id, giveaway.guild_id]
  );
}

async function retryGiveawayPublication(database: Database, row: GiveawayRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
  await database.query(
    "UPDATE \"SC_giveaways\" SET result_publication_pending=TRUE,result_publish_attempts=result_publish_attempts+1,result_publish_error=$2,result_publish_after=NOW()+LEAST(360,POWER(2,LEAST(result_publish_attempts,8))) * INTERVAL '1 minute',updated_at=NOW() WHERE giveaway_id=$1 AND ended=TRUE AND result_published_at IS NULL",
    [row.giveaway_id, message]
  );
  console.error("[giveaways] Result publication deferred:", row.giveaway_id, message);
}

export const giveawayCommand = new SlashCommandBuilder()
  .setName("giveaway")
  .setDescription("Verwaltet Gewinnspiele und Bonuslose.")
  .addSubcommand((sub) => sub.setName("erstellen").setDescription("Startet ein neues Gewinnspiel.")
    .addChannelOption((o) => o.setName("kanal").setDescription("Zielkanal").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((o) => o.setName("preis").setDescription("Zu verlosender Preis").setMaxLength(200).setRequired(true))
    .addIntegerOption((o) => o.setName("dauer").setDescription("Laufzeit in Minuten").setMinValue(1).setMaxValue(43200).setRequired(true))
    .addIntegerOption((o) => o.setName("gewinner").setDescription("Anzahl der Gewinner").setMinValue(1).setMaxValue(20).setRequired(true))
    .addRoleOption((o) => o.setName("bonusrolle").setDescription("Rolle mit zusätzlichen Losen"))
    .addIntegerOption((o) => o.setName("bonuslose").setDescription("Zusätzliche Lose für Mitglieder mit Bonusrolle").setMinValue(1).setMaxValue(100)))
  .addSubcommand((sub) => sub.setName("beenden").setDescription("Beendet ein laufendes Gewinnspiel sofort.")
    .addStringOption((o) => o.setName("id").setDescription("Gewinnspiel-ID").setRequired(true)))
  .addSubcommand((sub) => sub.setName("neuauslosung").setDescription("Ersetzt einen bisherigen Gewinner.")
    .addStringOption((o) => o.setName("id").setDescription("Gewinnspiel-ID").setRequired(true))
    .addUserOption((o) => o.setName("gewinner").setDescription("Zu ersetzender Gewinner (optional, sonst der zuletzt gezogene)")))
  .addSubcommand((sub) => sub.setName("liste").setDescription("Zeigt laufende Gewinnspiele dieses Servers."));

function pickWeightedUser(participants: Array<{ user_id: string; bonus_entries: number }>): string | null {
  const totalWeight = participants.reduce((total, participant) => total + Math.max(1, 1 + participant.bonus_entries), 0);
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) return null;
  let ticket = randomInt(totalWeight);
  for (const participant of participants) {
    ticket -= Math.max(1, 1 + participant.bonus_entries);
    if (ticket < 0) return participant.user_id;
  }
  return null;
}

async function drawGiveaway(client: Client, database: Database, row: GiveawayRow, actorId: string | null): Promise<string[]> {
  const connection = await database.connect();
  let winners: string[] = [];
  let participantCount = 0;
  let claimed = false;
  try {
    await connection.query("BEGIN");
    const claim = await connection.query(
      "UPDATE \"SC_giveaways\" SET ended=TRUE,ended_at=NOW(),result_publication_pending=TRUE,updated_at=NOW() WHERE giveaway_id=$1 AND guild_id=$2 AND ended=FALSE RETURNING giveaway_id",
      [row.giveaway_id, row.guild_id]
    );
    if (!claim.rowCount) {
      await connection.query("ROLLBACK");
      const current = await database.query<{ winner_ids: string[] }>(
        "SELECT winner_ids FROM \"SC_giveaways\" WHERE giveaway_id=$1 AND guild_id=$2",
        [row.giveaway_id, row.guild_id]
      );
      return current.rows[0]?.winner_ids ?? [];
    }
    claimed = true;
    const participants = await connection.query<{ user_id: string; bonus_entries: number }>(
      "SELECT user_id,bonus_entries FROM \"SC_giveaway_entries\" WHERE giveaway_id=$1",
      [row.giveaway_id]
    );
    participantCount = participants.rows.length;
    const remaining = [...participants.rows];
    while (remaining.length && winners.length < row.winner_count) {
      const winner = pickWeightedUser(remaining);
      if (!winner) break;
      winners.push(winner);
      const winnerIndex = remaining.findIndex((participant) => participant.user_id === winner);
      if (winnerIndex >= 0) remaining.splice(winnerIndex, 1);
    }
    await connection.query("UPDATE \"SC_giveaways\" SET winner_ids=$2::text[],updated_at=NOW() WHERE giveaway_id=$1", [row.giveaway_id, winners]);
    await connection.query(
      "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,'giveaway.drawn',$3,$4::jsonb)",
      [row.guild_id, actorId, row.giveaway_id, JSON.stringify({ winnerIds: winners, participantCount })]
    );
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
  if (claimed) {
    try {
      await publishGiveawayResult(client, database, { ...row, winner_ids: winners });
    } catch (error) {
      await retryGiveawayPublication(database, row, error);
    }
  }
  return winners;
}

export function attachGiveaways(client: Client, database: Database): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith("giveaway:join:")) {
      const giveawayId = interaction.customId.slice("giveaway:join:".length);
      if (!interaction.guild) {
        await interaction.reply({ content: "Gewinnspiele können nur auf einem Server genutzt werden.", ephemeral: true });
        return;
      }
      try {
        const result = await database.query<GiveawayRow>(
          "SELECT giveaway_id,guild_id,channel_id,message_id,prize,winner_count,ends_at,bonus_role_id,bonus_entries,ended,winner_ids FROM \"SC_giveaways\" WHERE giveaway_id=$1 AND guild_id=$2",
          [giveawayId, interaction.guild.id]
        );
        const giveaway = result.rows[0];
        if (!giveaway || giveaway.ended || new Date(giveaway.ends_at).getTime() <= Date.now()) {
          await interaction.reply({ content: "Dieses Gewinnspiel ist bereits beendet.", ephemeral: true });
          return;
        }
        const joiningMember = await interaction.guild.members.fetch(interaction.user.id);
        const bonus = giveaway.bonus_role_id && joiningMember.roles.cache.has(giveaway.bonus_role_id)
          ? giveaway.bonus_entries : 0;
        const connection = await database.connect();
        let joinStatus: "inserted" | "existing" | "ended" = "ended";
        try {
          await connection.query("BEGIN");
          const locked = await connection.query<{ ended: boolean; ends_at: Date }>(
            "SELECT ended,ends_at FROM \"SC_giveaways\" WHERE giveaway_id=$1 AND guild_id=$2 FOR UPDATE",
            [giveawayId, interaction.guild.id]
          );
          const current = locked.rows[0];
          if (current && !current.ended && new Date(current.ends_at).getTime() > Date.now()) {
            const inserted = await connection.query(
              "INSERT INTO \"SC_giveaway_entries\" (giveaway_id,guild_id,user_id,bonus_entries) VALUES ($1,$2,$3,$4) ON CONFLICT (giveaway_id,user_id) DO NOTHING RETURNING user_id",
              [giveawayId, interaction.guild.id, interaction.user.id, bonus]
            );
            joinStatus = inserted.rowCount ? "inserted" : "existing";
            if (inserted.rowCount) {
              await connection.query(
                "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,'giveaway.entry_created',$3,$4::jsonb)",
                [interaction.guild.id, interaction.user.id, giveawayId, JSON.stringify({ bonusEntries: bonus })]
              );
            }
          }
          await connection.query("COMMIT");
        } catch (error) {
          await connection.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          connection.release();
        }
        if (joinStatus !== "inserted") {
          await interaction.reply({
            content: joinStatus === "existing"
              ? "Du bist bereits eingetragen. Mehrfachteilnahmen sind nicht möglich."
              : "Die Teilnahmefrist ist inzwischen abgelaufen.",
            ephemeral: true
          });
          return;
        }
        await interaction.reply({ content: bonus ? "Teilnahme bestätigt! Du hast " + (1 + bonus) + " Lose erhalten." : "Teilnahme bestätigt! Du hast ein Los erhalten.", ephemeral: true });
      } catch (error) {
        console.error("[giveaways] Join failed:", error);
        if (!interaction.replied) await interaction.reply({ content: "Deine Teilnahme konnte nicht gespeichert werden.", ephemeral: true }).catch(() => undefined);
      }
      return;
    }

    if (!interaction.isChatInputCommand() || interaction.commandName !== "giveaway") return;
    if (!(await canExecuteCommand(interaction, database))) return;
    try {
      if (!interaction.guild || (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !(await hasExplicitCommandAllow(interaction, database)))) {
        await interaction.reply({ content: "Du benötigst „Server verwalten“ auf einem Server.", ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === "erstellen") {
        const channelOption = interaction.options.getChannel("kanal", true);
        const channel = await interaction.guild.channels.fetch(channelOption.id);
        if (!channel || channel.type !== ChannelType.GuildText) {
          await interaction.reply({ content: "Bitte wähle einen Textkanal dieses Servers.", ephemeral: true });
          return;
        }
        const botMember = interaction.guild.members.me ?? await interaction.guild.members.fetchMe();
        if (!channel.permissionsFor(botMember)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
          await interaction.reply({ content: "Mir fehlen im Zielkanal die Rechte zum Senden oder Einbetten.", ephemeral: true });
          return;
        }
        const prize = interaction.options.getString("preis", true).trim();
        const duration = interaction.options.getInteger("dauer", true);
        const winnerCount = interaction.options.getInteger("gewinner", true);
        const bonusRole = interaction.options.getRole("bonusrolle");
        const bonusEntries = interaction.options.getInteger("bonuslose") ?? 0;
        if (!prize || (bonusEntries > 0 && !bonusRole) || (bonusRole && bonusEntries < 1)) {
          await interaction.reply({ content: "Gib einen Preis an. Bonuslose benötigen eine Bonusrolle und umgekehrt.", ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const id = randomUUID();
        const endsAt = new Date(Date.now() + duration * 60_000);
        const embed = new EmbedBuilder().setColor(0x57f287).setTitle("🎉 " + prize)
          .setDescription("Klicke auf **Teilnehmen**, um mitzumachen!\n\n**Gewinner:** " + winnerCount + "\n**Endet:** <t:" + Math.floor(endsAt.getTime() / 1000) + ":R>" +
            (bonusRole ? "\n**Bonuslose:** " + bonusEntries + " zusätzliche Lose für " + bonusRole.toString() : ""))
          .setFooter({ text: "ServerCore Giveaway · ID: " + id });
        const message = await (channel as TextChannel).send({
          embeds: [embed],
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(buttonId(id)).setLabel("Teilnehmen").setStyle(ButtonStyle.Success).setEmoji("🎉"))],
          allowedMentions: { parse: [] }
        });
        try {
          await database.query(
            "INSERT INTO \"SC_giveaways\" (giveaway_id,guild_id,channel_id,message_id,prize,winner_count,ends_at,bonus_role_id,bonus_entries,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
            [id, interaction.guild.id, channel.id, message.id, prize, winnerCount, endsAt, bonusRole?.id ?? null, bonusEntries, interaction.user.id]
          );
          await database.query(
            "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,'giveaway.created',$3,$4::jsonb)",
            [interaction.guild.id, interaction.user.id, id, JSON.stringify({ channelId: channel.id, prize, durationMinutes: duration, winnerCount, bonusRoleId: bonusRole?.id ?? null, bonusEntries })]
          );
        } catch (error) {
          await message.delete().catch(() => undefined);
          throw error;
        }
        await interaction.editReply("Gewinnspiel veröffentlicht! ID: `" + id + "`. Es endet <t:" + Math.floor(endsAt.getTime() / 1000) + ":R>.");
        return;
      }
      if (sub === "liste") {
        const active = await database.query<{ giveaway_id: string; channel_id: string; prize: string; ends_at: Date; winner_count: number }>(
          "SELECT giveaway_id,channel_id,prize,ends_at,winner_count FROM \"SC_giveaways\" WHERE guild_id=$1 AND ended=FALSE ORDER BY ends_at ASC LIMIT 15",
          [interaction.guild.id]
        );
        if (!active.rows.length) {
          await interaction.reply({ content: "Aktuell gibt es keine laufenden Gewinnspiele.", ephemeral: true });
          return;
        }
        const lines = active.rows.map((item) =>
          "• **" + item.prize + "** — <#" + item.channel_id + "> · " + item.winner_count +
          " Gewinner · endet <t:" + Math.floor(new Date(item.ends_at).getTime() / 1000) + ":R> · ID `" + item.giveaway_id + "`"
        );
        await interaction.reply({ content: "**Laufende Gewinnspiele**\\n" + lines.join("\\n"), ephemeral: true });
        return;
      }
      const id = interaction.options.getString("id", true);
      const found = await database.query<GiveawayRow>(
        "SELECT giveaway_id,guild_id,channel_id,message_id,prize,winner_count,ends_at,bonus_role_id,bonus_entries,ended,winner_ids FROM \"SC_giveaways\" WHERE giveaway_id=$1 AND guild_id=$2",
        [id, interaction.guild.id]
      );
      const giveaway = found.rows[0];
      if (!giveaway) {
        await interaction.reply({ content: "Dieses Gewinnspiel wurde nicht gefunden.", ephemeral: true });
        return;
      }
      if (sub === "beenden") {
        if (giveaway.ended) {
          await interaction.reply({ content: "Dieses Gewinnspiel ist bereits beendet.", ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const winners = await drawGiveaway(client, database, giveaway, interaction.user.id);
        await interaction.editReply(winners.length ? "Gewinner gezogen: " + winners.map((id) => "<@" + id + ">").join(", ") : "Gewinnspiel beendet, aber es gab keine Teilnehmer.");
        return;
      }
      if (!giveaway.ended) {
        await interaction.reply({ content: "Eine Neuauslosung ist erst nach Ende des Gewinnspiels möglich.", ephemeral: true });
        return;
      }
      const connection = await database.connect();
      let oldWinner = "";
      let nextWinner = "";
      let updatedWinners: string[] = [];
      try {
        await connection.query("BEGIN");
        const locked = await connection.query<{ winner_ids: string[]; ended: boolean }>(
          "SELECT winner_ids,ended FROM \"SC_giveaways\" WHERE giveaway_id=$1 AND guild_id=$2 FOR UPDATE",
          [id, interaction.guild.id]
        );
        const current = locked.rows[0];
        if (!current?.ended) {
          await connection.query("ROLLBACK");
          await interaction.reply({ content: "Eine Neuauslosung ist erst nach Ende des Gewinnspiels möglich.", ephemeral: true });
          return;
        }
        const previous = current.winner_ids ?? [];
        oldWinner = interaction.options.getUser("gewinner")?.id ?? previous[previous.length - 1] ?? "";
        if (!oldWinner || !previous.includes(oldWinner)) {
          await connection.query("ROLLBACK");
          await interaction.reply({ content: previous.length
            ? "Der angegebene Benutzer ist kein bisheriger Gewinner."
            : "Es gibt keinen bisherigen Gewinner, der ersetzt werden kann.", ephemeral: true });
          return;
        }
        const participants = await connection.query<{ user_id: string; bonus_entries: number }>(
          "SELECT user_id,bonus_entries FROM \"SC_giveaway_entries\" WHERE giveaway_id=$1",
          [id]
        );
        const eligible = participants.rows.filter((participant) => !previous.includes(participant.user_id));
        nextWinner = pickWeightedUser(eligible) ?? "";
        if (!nextWinner) {
          await connection.query("ROLLBACK");
          await interaction.reply({ content: "Es gibt keine weiteren Teilnehmer für einen Ersatzgewinner.", ephemeral: true });
          return;
        }
        if (!nextWinner) throw new Error("Neuauslosung lieferte keinen Gewinner.");
        updatedWinners = previous.map((winner) => winner === oldWinner ? nextWinner : winner);
        await connection.query("UPDATE \"SC_giveaways\" SET winner_ids=$2::text[],result_published_at=NULL,result_publication_pending=TRUE,result_publish_after=NOW(),result_publish_error=NULL,updated_at=NOW() WHERE giveaway_id=$1", [id, updatedWinners]);
        await connection.query(
          "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,'giveaway.redrawn',$3,$4::jsonb)",
          [interaction.guild.id, interaction.user.id, id, JSON.stringify({ previousWinners: previous, replacedWinner: oldWinner, newWinner: nextWinner })]
        );
        await connection.query("COMMIT");
      } catch (error) {
        await connection.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
      await interaction.reply({
        content: "Ersatzgewinner für <@" + oldWinner + ">: <@" + nextWinner + ">.",
        allowedMentions: { users: [oldWinner, nextWinner] },
        ephemeral: true
      });
      try {
        await publishGiveawayResult(client, database, { ...giveaway, winner_ids: updatedWinners });
      } catch (error) {
        await retryGiveawayPublication(database, giveaway, error);
      }
    } catch (error) {
      console.error("[giveaways] Command failed:", error);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Das Gewinnspiel konnte nicht verarbeitet werden.", ephemeral: true }).catch(() => undefined);
      } else if (interaction.isRepliable() && interaction.deferred) {
        await interaction.editReply("Das Gewinnspiel konnte nicht verarbeitet werden.").catch(() => undefined);
      }
    }
  });

  const finishDue = async () => {
    const due = await database.query<GiveawayRow>(
      "SELECT giveaway_id,guild_id,channel_id,message_id,prize,winner_count,ends_at,bonus_role_id,bonus_entries,ended,winner_ids FROM \"SC_giveaways\" WHERE ended=FALSE AND ends_at<=NOW() ORDER BY ends_at ASC LIMIT 20"
    );
    for (const giveaway of due.rows) {
      try {
        await drawGiveaway(client, database, giveaway, null);
      } catch (error) {
        console.error("[giveaways] Automatic draw failed:", giveaway.giveaway_id, error);
      }
    }
    const pending = await database.query<GiveawayRow>(
      "SELECT giveaway_id,guild_id,channel_id,message_id,prize,winner_count,ends_at,bonus_role_id,bonus_entries,ended,winner_ids FROM \"SC_giveaways\" WHERE ended=TRUE AND result_publication_pending=TRUE AND result_published_at IS NULL AND COALESCE(result_publish_after,ended_at,NOW())<=NOW() ORDER BY ended_at ASC LIMIT 20"
    );
    for (const giveaway of pending.rows) {
      try {
        await publishGiveawayResult(client, database, giveaway);
      } catch (error) {
        await retryGiveawayPublication(database, giveaway, error).catch((retryError) =>
          console.error("[giveaways] Could not persist publication retry:", giveaway.giveaway_id, retryError)
        );
      }
    }
  };
  const timer = setInterval(() => void finishDue().catch((error) => console.error("[giveaways] Scheduler failed:", error)), 10_000);
  timer.unref();
  void finishDue().catch((error) => console.error("[giveaways] Initial scheduler failed:", error));
}
