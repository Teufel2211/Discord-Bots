import {
  Client,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
  type GuildMember
} from "discord.js";
import type { createDatabase } from "../database.js";
import {
  antiRaidConfigSchema,
  type AntiRaidConfig
} from "@servercore/contracts";

type RecentJoin = {
  member: GuildMember;
  joinedAt: number;
};

type StoredModuleSetting = {
  enabled: boolean;
  config: unknown;
};

const recentJoinsByGuild = new Map<string, RecentJoin[]>();
const alertCooldownByGuild = new Map<string, number>();

const DAY_MS = 86_400_000;

function isExempt(member: GuildMember, config: AntiRaidConfig): boolean {
  if (config.whitelistUserIds.includes(member.id)) return true;
  return member.roles.cache.some((role) =>
    config.exemptRoleIds.includes(role.id)
  );
}

async function assignQuarantineRole(
  members: GuildMember[],
  roleId: string
): Promise<string[]> {
  if (members.length === 0) return [];

  const guild = members[0]!.guild;
  const botMember =
    guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  const role = await guild.roles.fetch(roleId).catch(() => null);

  if (!botMember || !role) {
    console.warn(
      "[anti-raid] Quarantäne nicht möglich: Bot-Mitglied oder Rolle nicht gefunden.",
      guild.id
    );
    return [];
  }

  const canManageRole =
    botMember.permissions.has(PermissionFlagsBits.ManageRoles) &&
    role.id !== guild.id &&
    !role.managed &&
    role.position < botMember.roles.highest.position;

  if (!canManageRole) {
    console.warn(
      "[anti-raid] Quarantäne-Rolle ist nicht verwaltbar. Prüfe Manage Roles und die Rollenreihenfolge.",
      guild.id,
      role.id
    );
    return [];
  }

  const quarantined: string[] = [];
  for (const member of members) {
    if (member.roles.cache.has(role.id)) continue;
    try {
      await member.roles.add(
        role,
        "ServerCore Anti-Raid: automatische Schutzmaßnahme"
      );
      quarantined.push(member.id);
    } catch (error) {
      console.error(
        "[anti-raid] Quarantäne-Rolle konnte nicht vergeben werden:",
        guild.id,
        member.id,
        error
      );
    }
  }
  return quarantined;
}

async function sendRaidAlert(
  member: GuildMember,
  config: AntiRaidConfig,
  details: {
    joinCount: number;
    burstTriggered: boolean;
    accountTooNew: boolean;
    accountAgeDays: number;
    quarantinedUserIds: string[];
  }
): Promise<boolean> {
  const configuredChannel = config.alertChannelId
    ? await member.guild.channels
        .fetch(config.alertChannelId)
        .catch(() => null)
    : null;
  const channel = configuredChannel ?? member.guild.systemChannel;

  if (!channel || !("send" in channel) || typeof channel.send !== "function") {
    console.warn(
      "[anti-raid] Kein erreichbarer Alarmkanal konfiguriert:",
      member.guild.id
    );
    return false;
  }

  const reasons: string[] = [];
  if (details.burstTriggered) {
    reasons.push(
      details.joinCount +
        " Beitritte innerhalb von " +
        config.joinWindowSeconds +
        " Sekunden"
    );
  }
  if (details.accountTooNew) {
    reasons.push(
      "Account ist erst " +
        details.accountAgeDays.toFixed(1) +
        " Tage alt"
    );
  }

  const actionText =
    config.action === "quarantine"
      ? details.quarantinedUserIds.length > 0
        ? details.quarantinedUserIds.length + " Mitglied(er) quarantänisiert"
        : "Quarantäne konnte nicht angewendet werden"
      : "Nur Alarmierung";

  const embed = new EmbedBuilder()
    .setColor(0xff6b75)
    .setTitle("Anti-Raid: Auffälliger Beitritt erkannt")
    .setDescription(reasons.map((reason) => "• " + reason).join("\n"))
    .addFields(
      {
        name: "Zuletzt beigetreten",
        value: "<@" + member.id + "> (" + member.user.tag + ")",
        inline: false
      },
      {
        name: "Schutzmaßnahme",
        value: actionText,
        inline: true
      },
      {
        name: "Account-Alter",
        value: details.accountAgeDays.toFixed(1) + " Tage",
        inline: true
      }
    )
    .setFooter({ text: "ServerCore Anti-Raid" })
    .setTimestamp();

  try {
    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] }
    });
    return true;
  } catch (error) {
    console.error(
      "[anti-raid] Alarm konnte nicht gesendet werden:",
      member.guild.id,
      error
    );
    return false;
  }
}

type DatabasePool = ReturnType<typeof createDatabase>;

async function handleMemberJoin(
  member: GuildMember,
  database: DatabasePool
): Promise<void> {
  const settingsResult = await database.query<StoredModuleSetting>(
    "SELECT enabled, config FROM \"SC_module_settings\" " +
      "WHERE guild_id = $1 AND module_key = 'anti-raid'",
    [member.guild.id]
  );
  const settings = settingsResult.rows[0];
  if (!settings?.enabled) return;

  const parsedConfig = antiRaidConfigSchema.safeParse(settings.config ?? {});
  if (!parsedConfig.success) {
    console.error(
      "[anti-raid] Ungültige Datenbankkonfiguration:",
      member.guild.id,
      parsedConfig.error.flatten()
    );
    return;
  }
  const config = parsedConfig.data;

  if (isExempt(member, config)) return;

  const now = Date.now();
  const cutoff = now - config.joinWindowSeconds * 1000;
  const recent = (recentJoinsByGuild.get(member.guild.id) ?? [])
    .filter((entry) => entry.joinedAt >= cutoff);

  recent.push({ member, joinedAt: now });
  recentJoinsByGuild.set(member.guild.id, recent.slice(-100));

  const accountAgeMs = Math.max(0, now - member.user.createdTimestamp);
  const accountAgeDays = accountAgeMs / DAY_MS;
  const accountTooNew =
    config.minAccountAgeDays > 0 &&
    accountAgeDays < config.minAccountAgeDays;
  const burstTriggered = recent.length >= config.joinThreshold;

  if (!accountTooNew && !burstTriggered) return;

  let quarantinedUserIds: string[] = [];
  if (config.action === "quarantine" && config.quarantineRoleId) {
    const targets = burstTriggered
      ? recent.map((entry) => entry.member)
      : [member];
    quarantinedUserIds = await assignQuarantineRole(
      targets,
      config.quarantineRoleId
    );
  }

  const lastAlert = alertCooldownByGuild.get(member.guild.id) ?? 0;
  const shouldSendAlert =
    now - lastAlert >= config.alertCooldownSeconds * 1000;
  let alertSent = false;

  if (shouldSendAlert) {
    alertCooldownByGuild.set(member.guild.id, now);
    alertSent = await sendRaidAlert(member, config, {
      joinCount: recent.length,
      burstTriggered,
      accountTooNew,
      accountAgeDays,
      quarantinedUserIds
    });
  }

  if (shouldSendAlert || quarantinedUserIds.length > 0) {
    await database.query(
      "INSERT INTO \"SC_audit_logs\" " +
        "(guild_id, actor_id, action, target_id, metadata) " +
        "VALUES ($1, NULL, $2, $3, $4::jsonb)",
      [
        member.guild.id,
        quarantinedUserIds.length > 0
          ? "anti_raid.quarantined"
          : "anti_raid.detected",
        member.id,
        JSON.stringify({
          joinCount: recent.length,
          joinThreshold: config.joinThreshold,
          joinWindowSeconds: config.joinWindowSeconds,
          minAccountAgeDays: config.minAccountAgeDays,
          accountAgeDays: Number(accountAgeDays.toFixed(2)),
          burstTriggered,
          accountTooNew,
          configuredAction: config.action,
          quarantinedUserIds,
          alertSent
        })
      ]
    );
  }
}

export function attachAntiRaid(client: Client, database: DatabasePool): void {
  client.on(Events.GuildMemberAdd, (member) => {
    void handleMemberJoin(member, database).catch((error) => {
      console.error(
        "[anti-raid] Join-Verarbeitung fehlgeschlagen:",
        member.guild.id,
        member.id,
        error
      );
    });
  });
}
