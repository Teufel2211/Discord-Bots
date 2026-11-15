import { canExecuteCommand, hasExplicitCommandAllow } from "./command-permissions.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type Client,
  EmbedBuilder,
  Events,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type Message
} from "discord.js";
import { randomUUID } from "node:crypto";
import type { createDatabase } from "../database.js";

type Database = ReturnType<typeof createDatabase>;
type ApplicationStatus = "pending" | "reviewing" | "accepted" | "rejected";
type ApplicationAnswer = { question: string; answer: string };

type ApplicationForm = {
  form_id: string;
  guild_id: string;
  title: string;
  description: string;
  panel_channel_id: string;
  panel_message_id: string | null;
  review_channel_id: string;
  review_role_id: string;
  questions: string[];
  active: boolean;
};

type Application = {
  application_id: string;
  guild_id: string;
  form_id: string;
  applicant_id: string;
  status: ApplicationStatus;
  answers: ApplicationAnswer[];
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
};

type ApplicationDetails = Application & {
  title: string;
  description: string;
  review_role_id: string;
  questions: string[];
  panel_channel_id: string;
  panel_message_id: string | null;
  review_channel_id: string;
  active: boolean;
};

async function applicationModuleEnabled(database: Database, guildId: string): Promise<boolean> {
  const result = await database.query<{ enabled: boolean }>(
    "SELECT enabled FROM \"SC_module_settings\" WHERE guild_id = $1 AND module_key = 'applications'",
    [guildId]
  );
  return result.rows[0]?.enabled ?? false;
}

export const applicationCommand = new SlashCommandBuilder()
  .setName("bewerbung")
  .setDescription("Richtet das ServerCore-Bewerbungssystem ein.")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("panel")
      .setDescription("Erstellt ein Bewerbungsformular mit bis zu fünf Fragen.")
      .addStringOption((option) =>
        option.setName("title").setDescription("Titel des Formulars.").setMaxLength(100).setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("description").setDescription("Kurze Erklärung für Bewerber.").setMaxLength(1000).setRequired(true)
      )
      .addChannelOption((option) =>
        option.setName("review-channel").setDescription("Privater Team-Kanal für neue Bewerbungen.").addChannelTypes(ChannelType.GuildText).setRequired(true)
      )
      .addRoleOption((option) =>
        option.setName("review-role").setDescription("Rolle, die Bewerbungen prüfen darf.").setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("frage1").setDescription("Erste Frage (Pflicht).").setMaxLength(45).setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("frage2").setDescription("Zweite Frage (optional).").setMaxLength(45)
      )
      .addStringOption((option) =>
        option.setName("frage3").setDescription("Dritte Frage (optional).").setMaxLength(45)
      )
      .addStringOption((option) =>
        option.setName("frage4").setDescription("Vierte Frage (optional).").setMaxLength(45)
      )
      .addStringOption((option) =>
        option.setName("frage5").setDescription("Fünfte Frage (optional).").setMaxLength(45)
      )
  );

function statusLabel(status: ApplicationStatus): string {
  const labels: Record<ApplicationStatus, string> = {
    pending: "Wartet auf Prüfung",
    reviewing: "Wird geprüft",
    accepted: "Angenommen",
    rejected: "Abgelehnt"
  };
  return labels[status];
}

function makeReviewButtons(applicationId: string, status: ApplicationStatus) {
  const isFinal = status === "accepted" || status === "rejected";
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("sc:application:review:" + applicationId)
      .setLabel("Prüfung übernehmen")
      .setEmoji("🔎")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isFinal || status === "reviewing"),
    new ButtonBuilder()
      .setCustomId("sc:application:accept:" + applicationId)
      .setLabel("Annehmen")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(isFinal),
    new ButtonBuilder()
      .setCustomId("sc:application:reject:" + applicationId)
      .setLabel("Ablehnen")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(isFinal)
  );
}

function applicationEmbed(
  form: ApplicationForm,
  application: Application,
  applicantTag: string
): EmbedBuilder {
  const color =
    application.status === "accepted" ? 0x45c58a :
    application.status === "rejected" ? 0xe45d6d :
    application.status === "reviewing" ? 0xe5b45e : 0x7188ff;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle("Bewerbung · " + form.title)
    .setDescription(form.description)
    .setAuthor({ name: applicantTag })
    .addFields(
      { name: "Bewerber", value: "<@" + application.applicant_id + ">", inline: true },
      { name: "Status", value: statusLabel(application.status), inline: true },
      ...application.answers.map((answer) => ({
        name: answer.question.slice(0, 256),
        value: answer.answer.slice(0, 1024) || "—",
        inline: false
      }))
    )
    .setFooter({ text: "ServerCore · Bewerbung " + application.application_id.slice(0, 8) })
    .setTimestamp(application.created_at);
}

async function createPanel(interaction: ChatInputCommandInteraction, database: Database): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Dieser Befehl funktioniert nur auf einem Server.", ephemeral: true });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !(await hasExplicitCommandAllow(interaction, database))) {
    await interaction.reply({ content: "Du benötigst die Berechtigung „Server verwalten“.", ephemeral: true });
    return;
  }
  if (!(await applicationModuleEnabled(database, interaction.guild.id))) {
    await interaction.reply({ content: "Das Bewerbungsmodul ist im Dashboard für diesen Server deaktiviert.", ephemeral: true });
    return;
  }

  const title = interaction.options.getString("title", true);
  const description = interaction.options.getString("description", true);
  const reviewChannel = interaction.options.getChannel("review-channel", true);
  const reviewRole = interaction.options.getRole("review-role", true);
  if (reviewChannel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: "Der Prüfkanal muss ein normaler Textkanal sein.", ephemeral: true });
    return;
  }

  const questions = ["frage1", "frage2", "frage3", "frage4", "frage5"]
    .map((key) => interaction.options.getString(key))
    .filter((value): value is string => Boolean(value?.trim()));

  const panelChannel = await interaction.guild.channels.fetch(interaction.channelId);
  if (panelChannel?.type !== ChannelType.GuildText) {
    await interaction.reply({ content: "Das Panel kann nur in einem normalen Textkanal erstellt werden.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const formId = randomUUID();
  await database.query(
    "INSERT INTO \"SC_application_forms\" (form_id, guild_id, title, description, panel_channel_id, review_channel_id, review_role_id, questions, created_by) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)",
    [formId, interaction.guild.id, title, description, panelChannel.id, reviewChannel.id, reviewRole.id, JSON.stringify(questions), interaction.user.id]
  );

  const embed = new EmbedBuilder()
    .setColor(0x7188ff)
    .setTitle(title)
    .setDescription(description + "\n\n**Fragen:**\n" + questions.map((question, index) => (index + 1) + ". " + question).join("\n"))
    .setFooter({ text: "ServerCore Bewerbungssystem" });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("sc:application:start:" + formId)
      .setLabel("Jetzt bewerben")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Primary)
  );

  try {
    const message = await panelChannel.send({ embeds: [embed], components: [row] });
    await database.query("UPDATE \"SC_application_forms\" SET panel_message_id = $1 WHERE form_id = $2", [message.id, formId]);
    await interaction.editReply("Bewerbungsformular wurde in diesem Kanal veröffentlicht.");
  } catch (error) {
    await database.query("DELETE FROM \"SC_application_forms\" WHERE form_id = $1", [formId]);
    console.error("[applications] Panel konnte nicht gesendet werden:", error);
    await interaction.editReply("Das Panel konnte nicht veröffentlicht werden. Prüfe meine Kanalrechte.");
  }
}

async function startApplication(interaction: ButtonInteraction, formId: string, database: Database): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Der Server konnte nicht erkannt werden.", ephemeral: true });
    return;
  }
  if (!(await applicationModuleEnabled(database, interaction.guild.id))) {
    await interaction.reply({ content: "Bewerbungen sind auf diesem Server momentan deaktiviert.", ephemeral: true });
    return;
  }
  const result = await database.query<ApplicationForm>(
    "SELECT form_id, guild_id, title, description, panel_channel_id, panel_message_id, review_channel_id, review_role_id, questions, active " +
      "FROM \"SC_application_forms\" WHERE form_id = $1 AND guild_id = $2 AND active = TRUE",
    [formId, interaction.guild.id]
  );
  const form = result.rows[0];
  if (!form) {
    await interaction.reply({ content: "Dieses Bewerbungsformular ist nicht mehr aktiv.", ephemeral: true });
    return;
  }

  const modal = new ModalBuilder().setCustomId("sc:application:submit:" + formId).setTitle(form.title.slice(0, 45));
  modal.addComponents(
    ...form.questions.slice(0, 5).map((question, index) =>
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("answer_" + index)
          .setLabel(question.slice(0, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(1)
          .setMaxLength(800)
          .setRequired(true)
      )
    )
  );
  await interaction.showModal(modal);
}

async function submitApplication(
  interaction: ModalSubmitInteraction,
  formId: string,
  client: Client,
  database: Database
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Der Server konnte nicht erkannt werden.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  if (!(await applicationModuleEnabled(database, interaction.guild.id))) {
    await interaction.editReply("Bewerbungen sind auf diesem Server momentan deaktiviert.");
    return;
  }

  const formResult = await database.query<ApplicationForm>(
    "SELECT form_id, guild_id, title, description, panel_channel_id, panel_message_id, review_channel_id, review_role_id, questions, active " +
      "FROM \"SC_application_forms\" WHERE form_id = $1 AND guild_id = $2 AND active = TRUE",
    [formId, interaction.guild.id]
  );
  const form = formResult.rows[0];
  if (!form) {
    await interaction.editReply("Dieses Bewerbungsformular ist nicht mehr aktiv.");
    return;
  }

  const answers: ApplicationAnswer[] = form.questions.slice(0, 5).map((question, index) => ({
    question,
    answer: interaction.fields.getTextInputValue("answer_" + index).trim()
  }));
  const applicationId = randomUUID();
  let inserted: Application;
  try {
    const result = await database.query<Application>(
      "INSERT INTO \"SC_applications\" (application_id, guild_id, form_id, applicant_id, status, answers) " +
        "VALUES ($1, $2, $3, $4, 'pending', $5::jsonb) RETURNING application_id, guild_id, form_id, applicant_id, status, answers, reviewed_by, reviewed_at, created_at",
      [applicationId, interaction.guild.id, formId, interaction.user.id, JSON.stringify(answers)]
    );
    inserted = result.rows[0]!;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      await interaction.editReply("Du hast für dieses Formular bereits eine offene Bewerbung. Warte bitte auf die Entscheidung des Teams.");
      return;
    }
    throw error;
  }

  let reviewMessage: Message;
  try {
    const reviewChannel = await client.channels.fetch(form.review_channel_id);
    if (!reviewChannel || reviewChannel.type !== ChannelType.GuildText) {
      throw new Error("Der konfigurierte Prüfkanal ist nicht verfügbar.");
    }
    reviewMessage = await reviewChannel.send({
      content: "<@&" + form.review_role_id + "> Neue Bewerbung eingegangen.",
      embeds: [applicationEmbed(form, inserted, interaction.user.tag)],
      components: [makeReviewButtons(applicationId, "pending")],
      allowedMentions: { roles: [form.review_role_id] }
    });
  } catch (error) {
    await database.query("DELETE FROM \"SC_applications\" WHERE application_id = $1", [applicationId]).catch(() => undefined);
    console.error("[applications] Bewerbung konnte nicht übermittelt werden:", error);
    await interaction.editReply("Die Bewerbung konnte nicht an das Team übermittelt werden. Bitte versuche es später erneut.");
    return;
  }

  await database.query(
    "UPDATE \"SC_applications\" SET review_channel_id = $1, review_message_id = $2 WHERE application_id = $3",
    [form.review_channel_id, reviewMessage.id, applicationId]
  ).catch((error) => console.error("[applications] Review-Nachricht konnte nicht gespeichert werden:", error));
  await database.query(
    "INSERT INTO \"SC_audit_logs\" (guild_id, actor_id, action, target_id, metadata) VALUES ($1, $2, 'application.submitted', $3, $4::jsonb)",
    [interaction.guild.id, interaction.user.id, applicationId, JSON.stringify({ formId, reviewChannelId: form.review_channel_id, reviewMessageId: reviewMessage.id })]
  ).catch((error) => console.error("[applications] Audit-Eintrag fehlgeschlagen:", error));
  await interaction.editReply("Deine Bewerbung wurde erfolgreich an das Team übermittelt.");
}

async function decideApplication(
  interaction: ButtonInteraction,
  action: "review" | "accept" | "reject",
  applicationId: string,
  database: Database
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Der Server konnte nicht erkannt werden.", ephemeral: true });
    return;
  }

  const result = await database.query<ApplicationDetails>(
    "SELECT a.application_id, a.guild_id, a.form_id, a.applicant_id, a.status, a.answers, a.reviewed_by, a.reviewed_at, a.created_at, " +
      "f.title, f.description, f.review_role_id, f.questions, f.panel_channel_id, f.panel_message_id, f.review_channel_id, f.active " +
      "FROM \"SC_applications\" a JOIN \"SC_application_forms\" f ON f.form_id = a.form_id WHERE a.application_id = $1 AND a.guild_id = $2",
    [applicationId, interaction.guild.id]
  );
  const application = result.rows[0];
  if (!application) {
    await interaction.reply({ content: "Diese Bewerbung wurde nicht gefunden.", ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const isReviewer = member.roles.cache.has(application.review_role_id);
  const canManage = member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (!isReviewer && !canManage) {
    await interaction.reply({ content: "Nur das zuständige Team darf Bewerbungen bearbeiten.", ephemeral: true });
    return;
  }

  const nextStatus: ApplicationStatus =
    action === "review" ? "reviewing" : action === "accept" ? "accepted" : "rejected";
  const allowedStatuses = action === "review" ? ["pending"] : ["pending", "reviewing"];
  const updated = await database.query<Application>(
    "UPDATE \"SC_applications\" SET status = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW() " +
      "WHERE application_id = $3 AND guild_id = $4 AND status = ANY($5::text[]) " +
      "RETURNING application_id, guild_id, form_id, applicant_id, status, answers, reviewed_by, reviewed_at, created_at",
    [nextStatus, interaction.user.id, applicationId, interaction.guild.id, allowedStatuses]
  );
  const changed = updated.rows[0];
  if (!changed) {
    await interaction.reply({ content: "Diese Bewerbung wurde bereits von einem Teammitglied bearbeitet.", ephemeral: true });
    return;
  }

  const form: ApplicationForm = {
    form_id: changed.form_id,
    guild_id: changed.guild_id,
    title: application.title,
    description: application.description,
    panel_channel_id: application.panel_channel_id,
    panel_message_id: application.panel_message_id,
    review_channel_id: application.review_channel_id,
    review_role_id: application.review_role_id,
    questions: application.questions,
    active: application.active
  };

  await database.query(
    "INSERT INTO \"SC_audit_logs\" (guild_id, actor_id, action, target_id, metadata) VALUES ($1, $2, $3, $4, $5::jsonb)",
    [interaction.guild.id, interaction.user.id, "application." + nextStatus, applicationId, JSON.stringify({ applicantId: changed.applicant_id, previousStatus: application.status })]
  ).catch((error) => console.error("[applications] Audit-Eintrag fehlgeschlagen:", error));

  await interaction.update({
    embeds: [applicationEmbed(form, changed, interaction.user.tag)],
    components: [makeReviewButtons(applicationId, nextStatus)]
  });

  if (nextStatus === "accepted" || nextStatus === "rejected") {
    const applicant = await interaction.client.users.fetch(changed.applicant_id).catch(() => null);
    if (applicant) {
      const message = nextStatus === "accepted"
        ? "Deine Bewerbung auf **" + application.title + "** wurde angenommen."
        : "Deine Bewerbung auf **" + application.title + "** wurde leider abgelehnt.";
      await applicant.send(message + "\nEntscheidung durch: " + interaction.user.tag).catch(() => undefined);
    }
  }
}

export function attachApplications(client: Client, database: Database): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    const customId = "customId" in interaction ? String(interaction.customId) : "";
    const isApplicationCommand =
      interaction.isChatInputCommand() && interaction.commandName === "bewerbung";
    if (!isApplicationCommand && !customId.startsWith("sc:application:")) return;

    try {
      if (interaction.isChatInputCommand()) {
        if (!(await canExecuteCommand(interaction, database))) return;
        if (interaction.commandName === "bewerbung" && interaction.options.getSubcommand() === "panel") {
          await createPanel(interaction, database);
        }
        return;
      }

      const [prefix, moduleName, action, id] = customId.split(":");
      if (prefix !== "sc" || moduleName !== "application" || !action || !id) return;
      if (interaction.isButton()) {
        if (action === "start") {
          await startApplication(interaction, id, database);
        } else if (action === "review" || action === "accept" || action === "reject") {
          await decideApplication(interaction, action, id, database);
        }
      } else if (interaction.isModalSubmit() && action === "submit") {
        await submitApplication(interaction, id, client, database);
      }
    } catch (error) {
      console.error("[applications] Interaction fehlgeschlagen:", error);
      if (interaction.isRepliable()) {
        const message = "Die Bewerbungsaktion ist fehlgeschlagen. Prüfe die Bot-Rechte oder versuche es erneut.";
        if (interaction.deferred) {
          await interaction.editReply(message).catch(() => undefined);
        } else if (!interaction.replied) {
          await interaction.reply({ content: message, ephemeral: true }).catch(() => undefined);
        }
      }
    }
  });
}
