import { z } from "zod";

const discordIdSchema = z
  .string()
  .regex(/^\d{17,20}$/, "Invalid Discord ID");

/**
 * Runtime contract for the Anti-Raid module.
 *
 * Kept inside this bot repository so TSX can resolve it without the
 * separate ServerCore pnpm workspace or a runtime package alias.
 */
export const antiRaidConfigSchema = z
  .object({
    joinThreshold: z.number().int().min(3).max(50).default(8),
    joinWindowSeconds: z.number().int().min(5).max(120).default(15),
    minAccountAgeDays: z.number().int().min(0).max(365).default(7),
    action: z.enum(["alert", "quarantine"]).default("alert"),
    alertChannelId: discordIdSchema.nullable().default(null),
    quarantineRoleId: discordIdSchema.nullable().default(null),
    alertCooldownSeconds: z.number().int().min(30).max(3600).default(120),
    exemptRoleIds: z.array(discordIdSchema).max(25).default([]),
    whitelistUserIds: z.array(discordIdSchema).max(100).default([])
  })
  .superRefine((config, context) => {
    if (config.action === "quarantine" && !config.quarantineRoleId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quarantineRoleId"],
        message: "A quarantine role is required when the action is quarantine."
      });
    }
  });

export type AntiRaidConfig = z.infer<typeof antiRaidConfigSchema>;
