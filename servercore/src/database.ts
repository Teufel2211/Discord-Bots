import { Pool } from "pg";

export function createDatabase(connectionString: string): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000
  });
}

export async function checkDatabase(pool: Pool): Promise<void> {
  await pool.query("SELECT 1");
}

export async function enqueueJob(
  pool: Pool,
  jobName: string,
  payload: Record<string, unknown> = {},
  runAt: Date = new Date(),
  maxAttempts = 5
): Promise<string> {
  const result = await pool.query<{ job_id: string }>(
    'INSERT INTO "SC_jobs" (job_name,payload,run_at,max_attempts) VALUES ($1,$2::jsonb,$3,$4) RETURNING job_id',
    [jobName, JSON.stringify(payload), runAt, maxAttempts]
  );
  const jobId = result.rows[0]?.job_id;
  if (!jobId) throw new Error("Could not enqueue job.");
  return jobId;
}

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "SC_sessions" (
      session_id TEXT PRIMARY KEY, session_data JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sc_sessions_expires_idx ON "SC_sessions" (expires_at);
    CREATE TABLE IF NOT EXISTS "SC_jobs" (
      job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_name TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 5,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), locked_at TIMESTAMPTZ, locked_by TEXT,
      last_error TEXT, result JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS sc_jobs_due_idx ON "SC_jobs" (run_at,created_at) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS sc_jobs_stale_idx ON "SC_jobs" (locked_at) WHERE status='running';

    CREATE TABLE IF NOT EXISTS "SC_guilds" (
      guild_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT,
      installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS "SC_guild_settings" (
      guild_id TEXT PRIMARY KEY REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      locale TEXT NOT NULL DEFAULT 'de',
      timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "SC_module_settings" (
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      module_key TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, module_key)
    );

    CREATE TABLE IF NOT EXISTS "SC_command_permission_rules" (
      rule_id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      command_name TEXT NOT NULL CHECK (length(command_name) BETWEEN 1 AND 32),
      subcommand TEXT,
      effect TEXT NOT NULL CHECK (effect IN ('allow','deny')),
      subject_type TEXT NOT NULL CHECK (subject_type IN ('role','user')),
      subject_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS command_permission_rules_unique_idx
      ON "SC_command_permission_rules" (guild_id,command_name,COALESCE(subcommand,''),effect,subject_type,subject_id);
    CREATE INDEX IF NOT EXISTS command_permission_rules_lookup_idx
      ON "SC_command_permission_rules" (guild_id,command_name,subcommand);

    CREATE TABLE IF NOT EXISTS "SC_audit_logs" (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      actor_id TEXT,
      action TEXT NOT NULL,
      target_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "SC_ticket_panels" (
      panel_id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      panel_channel_id TEXT NOT NULL,
      panel_message_id TEXT,
      category_id TEXT NOT NULL,
      support_role_id TEXT NOT NULL,
      log_channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE "SC_ticket_panels" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
    ALTER TABLE "SC_ticket_panels" ADD COLUMN IF NOT EXISTS questions JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE "SC_ticket_panels" ADD COLUMN IF NOT EXISTS categories JSONB NOT NULL DEFAULT '[]'::jsonb;

    CREATE TABLE IF NOT EXISTS "SC_tickets" (
      ticket_id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      panel_id UUID NOT NULL REFERENCES "SC_ticket_panels"(panel_id),
      channel_id TEXT NOT NULL UNIQUE,
      opener_id TEXT NOT NULL,
      support_role_id TEXT NOT NULL,
      log_channel_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'closing', 'closed')),
      claimed_by TEXT,
      closed_by TEXT,
      transcript_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    );

    ALTER TABLE "SC_tickets" ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE "SC_tickets" ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';
    ALTER TABLE "SC_tickets" DROP CONSTRAINT IF EXISTS tickets_priority_check;
    ALTER TABLE "SC_tickets" ADD CONSTRAINT tickets_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

    CREATE TABLE IF NOT EXISTS "SC_application_forms" (
      form_id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      panel_channel_id TEXT NOT NULL,
      panel_message_id TEXT,
      review_channel_id TEXT NOT NULL,
      review_role_id TEXT NOT NULL,
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "SC_applications" (
      application_id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      form_id UUID NOT NULL REFERENCES "SC_application_forms"(form_id) ON DELETE CASCADE,
      applicant_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'reviewing', 'accepted', 'rejected')),
      answers JSONB NOT NULL DEFAULT '[]'::jsonb,
      review_channel_id TEXT,
      review_message_id TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE "SC_applications" ADD COLUMN IF NOT EXISTS review_channel_id TEXT;
    ALTER TABLE "SC_applications" ADD COLUMN IF NOT EXISTS review_message_id TEXT;

    CREATE INDEX IF NOT EXISTS application_forms_guild_created_idx
      ON "SC_application_forms" (guild_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS applications_one_active_per_applicant_idx
      ON "SC_applications" (guild_id, form_id, applicant_id)
      WHERE status IN ('pending', 'reviewing');
    CREATE INDEX IF NOT EXISTS applications_guild_status_created_idx
      ON "SC_applications" (guild_id, status, created_at DESC);

    ALTER TABLE "SC_tickets" DROP CONSTRAINT IF EXISTS tickets_status_check;
    ALTER TABLE "SC_tickets" ADD CONSTRAINT tickets_status_check
      CHECK (status IN ('open', 'closing', 'closed'));
    DROP INDEX IF EXISTS tickets_one_open_per_user_idx;
    CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_open_per_user_idx
      ON "SC_tickets" (guild_id, opener_id) WHERE status IN ('open', 'closing');
    CREATE INDEX IF NOT EXISTS tickets_guild_status_created_idx
      ON "SC_tickets" (guild_id, status, created_at DESC);
    CREATE TABLE IF NOT EXISTS "SC_staff_records" (
      record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      record_type TEXT NOT NULL CHECK (record_type IN ('warning', 'note', 'promotion')),
      details TEXT NOT NULL CHECK (length(details) BETWEEN 1 AND 1000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS staff_records_guild_target_created_idx
      ON "SC_staff_records" (guild_id, target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS staff_records_guild_created_idx
      ON "SC_staff_records" (guild_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS "SC_moderation_cases" (
      case_id UUID PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      target_id TEXT NOT NULL, moderator_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('warn','timeout','kick','ban')),
      reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
      duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 40320),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS moderation_cases_guild_created_idx ON "SC_moderation_cases"(guild_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS moderation_cases_target_created_idx ON "SC_moderation_cases"(guild_id,target_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS "SC_suggestions" (
      suggestion_id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      author_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      content TEXT NOT NULL CHECK (length(content) BETWEEN 10 AND 3000),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'implemented')),
      reviewed_by TEXT,
      review_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "SC_suggestion_votes" (
      suggestion_id UUID NOT NULL REFERENCES "SC_suggestions"(suggestion_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      vote SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (suggestion_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS suggestions_guild_status_created_idx
      ON "SC_suggestions" (guild_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS suggestions_author_created_idx
      ON "SC_suggestions" (guild_id, author_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS "SC_recurring_messages" (
      message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
      interval_minutes INTEGER NOT NULL CHECK (interval_minutes BETWEEN 15 AND 43200),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      next_run_at TIMESTAMPTZ NOT NULL,
      last_attempt_at TIMESTAMPTZ,
      last_sent_at TIMESTAMPTZ,
      last_error TEXT,
      delivery_pending BOOLEAN NOT NULL DEFAULT FALSE,
      pending_run_at TIMESTAMPTZ,
      delivery_attempts INTEGER NOT NULL DEFAULT 0,
      delivery_retry_after TIMESTAMPTZ,
      delivery_lease_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE "SC_recurring_messages" ADD COLUMN IF NOT EXISTS delivery_pending BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE "SC_recurring_messages" ADD COLUMN IF NOT EXISTS pending_run_at TIMESTAMPTZ;
    ALTER TABLE "SC_recurring_messages" ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE "SC_recurring_messages" ADD COLUMN IF NOT EXISTS delivery_retry_after TIMESTAMPTZ;
    ALTER TABLE "SC_recurring_messages" ADD COLUMN IF NOT EXISTS delivery_lease_until TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS recurring_messages_due_idx ON "SC_recurring_messages" (next_run_at) WHERE active = TRUE;
    CREATE INDEX IF NOT EXISTS recurring_messages_pending_due_idx ON "SC_recurring_messages" (delivery_retry_after,delivery_lease_until) WHERE active=TRUE AND delivery_pending=TRUE;
    CREATE INDEX IF NOT EXISTS recurring_messages_guild_created_idx ON "SC_recurring_messages" (guild_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS "SC_embed_templates" (
      template_id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
      embed JSONB NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS embed_templates_guild_updated_idx ON "SC_embed_templates" (guild_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS "SC_giveaways" (
      giveaway_id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      prize TEXT NOT NULL CHECK (length(prize) BETWEEN 1 AND 200),
      winner_count INTEGER NOT NULL CHECK (winner_count BETWEEN 1 AND 20),
      ends_at TIMESTAMPTZ NOT NULL,
      bonus_role_id TEXT,
      bonus_entries INTEGER NOT NULL DEFAULT 0 CHECK (bonus_entries BETWEEN 0 AND 100),
      created_by TEXT NOT NULL,
      ended BOOLEAN NOT NULL DEFAULT FALSE,
      ended_at TIMESTAMPTZ,
      winner_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE "SC_giveaways" ADD COLUMN IF NOT EXISTS result_published_at TIMESTAMPTZ;
    ALTER TABLE "SC_giveaways" ADD COLUMN IF NOT EXISTS result_publication_pending BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE "SC_giveaways" ADD COLUMN IF NOT EXISTS result_publish_attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE "SC_giveaways" ADD COLUMN IF NOT EXISTS result_publish_after TIMESTAMPTZ;
    ALTER TABLE "SC_giveaways" ADD COLUMN IF NOT EXISTS result_publish_error TEXT;
    CREATE INDEX IF NOT EXISTS giveaways_result_publish_due_idx
      ON "SC_giveaways" (result_publish_after) WHERE ended=TRUE AND result_publication_pending=TRUE AND result_published_at IS NULL;
    CREATE INDEX IF NOT EXISTS giveaways_due_idx ON "SC_giveaways" (ends_at) WHERE ended=FALSE;
    CREATE INDEX IF NOT EXISTS giveaways_guild_created_idx ON "SC_giveaways" (guild_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS "SC_giveaway_entries" (
      giveaway_id UUID NOT NULL REFERENCES "SC_giveaways"(giveaway_id) ON DELETE CASCADE,
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      bonus_entries INTEGER NOT NULL DEFAULT 0 CHECK (bonus_entries BETWEEN 0 AND 100),
      entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (giveaway_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS giveaway_entries_guild_idx ON "SC_giveaway_entries" (guild_id, giveaway_id);

    CREATE TABLE IF NOT EXISTS "SC_custom_panels" (
      panel_id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
      description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),
      buttons JSONB NOT NULL DEFAULT '[]'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS custom_panels_guild_created_idx ON "SC_custom_panels" (guild_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS "SC_role_panels" (
      panel_id UUID PRIMARY KEY,
      guild_id TEXT NOT NULL REFERENCES "SC_guilds"(guild_id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
      description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 1000),
      roles JSONB NOT NULL DEFAULT '[]'::jsonb,
      selection_mode TEXT NOT NULL CHECK (selection_mode IN ('single', 'multiple')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS role_panels_guild_created_idx
      ON "SC_role_panels" (guild_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS audit_logs_guild_created_idx
      ON "SC_audit_logs" (guild_id, created_at DESC);
  `);
}

export async function closeDatabase(pool: Pool): Promise<void> {
  await pool.end();
}
