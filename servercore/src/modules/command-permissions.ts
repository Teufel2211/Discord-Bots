import {
  PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type Client
} from "discord.js";
import type { createDatabase } from "../database.js";
type Database = ReturnType<typeof createDatabase>;

export const commandPermissionsCommand = new SlashCommandBuilder()
  .setName("commandrechte")
  .setDescription("Verwaltet rollen- und benutzerbasierte Command-Rechte.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) => sub.setName("setzen").setDescription("Legt eine Zugriffsregel an.")
    .addStringOption((o) => o.setName("befehl").setDescription("Slash-Command ohne Schrägstrich, z. B. mod").setMaxLength(32).setRequired(true))
    .addStringOption((o) => o.setName("modus").setDescription("Zugriff erlauben oder verweigern").addChoices({name:"Erlauben",value:"allow"},{name:"Verweigern",value:"deny"}).setRequired(true))
    .addStringOption((o) => o.setName("typ").setDescription("Regel gilt für Rolle oder Benutzer").addChoices({name:"Rolle",value:"role"},{name:"Benutzer",value:"user"}).setRequired(true))
    .addStringOption((o) => o.setName("ziel").setDescription("Rollen- oder Benutzer-ID").setMaxLength(25).setRequired(true))
    .addStringOption((o) => o.setName("unterbefehl").setDescription("Optional: nur für einen Unterbefehl").setMaxLength(32)))
  .addSubcommand((sub) => sub.setName("liste").setDescription("Zeigt alle individuellen Command-Regeln."))
  .addSubcommand((sub) => sub.setName("entfernen").setDescription("Entfernt eine Regel anhand ihrer ID.")
    .addIntegerOption((o) => o.setName("regel-id").setDescription("ID aus /commandrechte liste").setMinValue(1).setRequired(true)));

export async function canExecuteCommand(
  interaction: ChatInputCommandInteraction,
  database: Database
): Promise<boolean> {
  if (!interaction.guild) return true;
  const subcommand = interaction.options.getSubcommand(false);
  const result = await database.query<{
    rule_id: number; effect: "allow" | "deny"; subject_type: "role" | "user"; subject_id: string;
  }>(
    "SELECT rule_id,effect,subject_type,subject_id FROM \"SC_command_permission_rules\" WHERE guild_id=$1 AND command_name=$2 AND (subcommand IS NULL OR subcommand=$3) ORDER BY CASE WHEN subcommand IS NULL THEN 0 ELSE 1 END",
    [interaction.guild.id, interaction.commandName, subcommand]
  );
  if (!result.rows.length) return true;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const roleIds = member?.roles.cache ?? null;
  const matches = (rule: typeof result.rows[number]) =>
    rule.subject_type === "user"
      ? rule.subject_id === interaction.user.id
      : Boolean(roleIds?.has(rule.subject_id));
  const deny = result.rows.some((rule) => rule.effect === "deny" && matches(rule));
  if (deny) {
    await interaction.reply({ content: "Du hast für diesen Command keine Berechtigung. (Individuelle Command-Regel)", ephemeral: true });
    return false;
  }
  const allowRules = result.rows.filter((rule) => rule.effect === "allow");
  if (allowRules.length && !allowRules.some(matches)) {
    await interaction.reply({ content: "Dieser Command ist auf bestimmte Rollen oder Benutzer beschränkt.", ephemeral: true });
    return false;
  }
  return true;
}

export async function hasExplicitCommandAllow(
  interaction: ChatInputCommandInteraction,
  database: Database
): Promise<boolean> {
  if (!interaction.guild) return false;
  const subcommand = interaction.options.getSubcommand(false);
  const result = await database.query<{ subject_type: "role" | "user"; subject_id: string }>(
    "SELECT subject_type,subject_id FROM \"SC_command_permission_rules\" WHERE guild_id=$1 AND command_name=$2 AND effect='allow' AND (subcommand IS NULL OR subcommand=$3)",
    [interaction.guild.id, interaction.commandName, subcommand]
  );
  if (!result.rows.length) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  return result.rows.some((rule) => rule.subject_type === "user"
    ? rule.subject_id === interaction.user.id
    : Boolean(member?.roles.cache.has(rule.subject_id)));
}

export function attachCommandPermissions(client: Client, database: Database): void {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "commandrechte") return;
    try {
      if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({ content: "Du benötigst „Server verwalten“.", ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === "setzen") {
        const command = interaction.options.getString("befehl", true).trim().toLowerCase().replace(/^\//, "");
        const effect = interaction.options.getString("modus", true) as "allow" | "deny";
        const subjectType = interaction.options.getString("typ", true) as "role" | "user";
        const subjectId = interaction.options.getString("ziel", true).trim();
        const subcommand = interaction.options.getString("unterbefehl")?.trim().toLowerCase() || null;
        if (!/^[a-z0-9_-]{1,32}$/.test(command) || (subcommand && !/^[a-z0-9_-]{1,32}$/.test(subcommand)) || !/^\d{17,20}$/.test(subjectId)) {
          await interaction.reply({ content: "Befehl, Unterbefehl oder Discord-ID ist ungültig.", ephemeral: true });
          return;
        }
        if (subjectType === "role" && !await interaction.guild.roles.fetch(subjectId).catch(() => null)) {
          await interaction.reply({ content: "Diese Rolle wurde auf dem Server nicht gefunden.", ephemeral: true });
          return;
        }
        if (subjectType === "user" && !await interaction.guild.members.fetch(subjectId).catch(() => null)) {
          await interaction.reply({ content: "Dieser Benutzer ist nicht auf dem Server.", ephemeral: true });
          return;
        }
        const saved = await database.query<{ rule_id: number }>(
          "INSERT INTO \"SC_command_permission_rules\" (guild_id,command_name,subcommand,effect,subject_type,subject_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (guild_id,command_name,(COALESCE(subcommand,'')),effect,subject_type,subject_id) DO UPDATE SET created_by=EXCLUDED.created_by RETURNING rule_id",
          [interaction.guild.id, command, subcommand, effect, subjectType, subjectId, interaction.user.id]
        );
        await database.query(
          "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,'command_permission.created',$3,$4::jsonb)",
          [interaction.guild.id, interaction.user.id, String(saved.rows[0]?.rule_id ?? ""), JSON.stringify({ command, subcommand, effect, subjectType, subjectId })]
        );
        await interaction.reply({ content: "Command-Regel gespeichert. Regel-ID: " + saved.rows[0]?.rule_id, ephemeral: true });
        return;
      }
      if (sub === "liste") {
        const result = await database.query<{rule_id:number;command_name:string;subcommand:string|null;effect:string;subject_type:string;subject_id:string}>(
          "SELECT rule_id,command_name,subcommand,effect,subject_type,subject_id FROM \"SC_command_permission_rules\" WHERE guild_id=$1 ORDER BY command_name,rule_id",
          [interaction.guild.id]
        );
        const lines = result.rows.map((rule) => "`" + rule.rule_id + "` · /" + rule.command_name + (rule.subcommand ? " " + rule.subcommand : "") + " · " + (rule.effect === "allow" ? "Erlauben" : "Verweigern") + " · " + (rule.subject_type === "role" ? "Rolle" : "Benutzer") + " `" + rule.subject_id + "`");
        await interaction.reply({ content: lines.length ? lines.join("\n").slice(0, 1900) : "Es sind noch keine individuellen Command-Regeln vorhanden.", ephemeral: true });
        return;
      }
      const id = interaction.options.getInteger("regel-id", true);
      const removed = await database.query(
        "DELETE FROM \"SC_command_permission_rules\" WHERE guild_id=$1 AND rule_id=$2 RETURNING rule_id",
        [interaction.guild.id, id]
      );
      if (!removed.rowCount) {
        await interaction.reply({ content: "Diese Regel-ID wurde nicht gefunden.", ephemeral: true });
        return;
      }
      await database.query(
        "INSERT INTO \"SC_audit_logs\" (guild_id,actor_id,action,target_id,metadata) VALUES ($1,$2,'command_permission.deleted',$3,$4::jsonb)",
        [interaction.guild.id, interaction.user.id, String(id), JSON.stringify({ ruleId: id })]
      );
      await interaction.reply({ content: "Command-Regel #" + id + " wurde entfernt.", ephemeral: true });
    } catch (error) {
      console.error("[command-permissions] Command failed:", error);
      if (!interaction.replied) await interaction.reply({ content: "Die Command-Regel konnte nicht verarbeitet werden.", ephemeral: true }).catch(() => undefined);
    }
  });
}
