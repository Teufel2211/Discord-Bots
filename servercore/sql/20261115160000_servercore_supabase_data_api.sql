-- ServerCore schema. Safe to re-run on an existing installation.
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

-- Execute one parameterized ServerCore SQL statement through the Supabase
-- Data API. This function is SECURITY INVOKER and is callable only by the
-- server-side service_role used by SUPABASE_SECRET_KEY.
CREATE OR REPLACE FUNCTION public.sc_exec_sql(
  p_sql text,
  p_params jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_sql text := p_sql;
  v_parameter record;
  v_replacement text;
  v_row record;
  v_rows jsonb := '[]'::jsonb;
  v_row_count bigint := 0;
  v_nonce text := replace(gen_random_uuid()::text, '-', '');
  v_token text;
BEGIN
  IF p_sql IS NULL OR length(p_sql) > 30000 THEN
    RAISE EXCEPTION 'Invalid or oversized SQL statement.';
  END IF;
  IF jsonb_typeof(COALESCE(p_params, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'SQL parameters must be a JSON array.';
  END IF;
  IF upper(ltrim(p_sql)) !~ '^(SELECT|INSERT|UPDATE|DELETE|WITH)([[:space:]]|$)' THEN
    RAISE EXCEPTION 'Only SELECT/INSERT/UPDATE/DELETE statements are allowed.';
  END IF;
  IF p_sql !~ '"SC_[A-Za-z0-9_]+"' THEN
    RAISE EXCEPTION 'SQL may only target ServerCore tables.';
  END IF;
  IF position(';' in p_sql) > 0 OR position('--' in p_sql) > 0
     OR position('/*' in p_sql) > 0 OR position('*/' in p_sql) > 0
     OR position('pg_catalog.' in lower(p_sql)) > 0
     OR position('information_schema.' in lower(p_sql)) > 0
     OR position('auth.' in lower(p_sql)) > 0
     OR position('storage.' in lower(p_sql)) > 0
     OR position('vault.' in lower(p_sql)) > 0 THEN
    RAISE EXCEPTION 'The SQL statement contains a forbidden construct.';
  END IF;
  IF upper(p_sql) ~ '(^|[[:space:]])(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|RESET|VACUUM|ANALYZE|EXPLAIN)([[:space:]]|$)' THEN
    RAISE EXCEPTION 'DDL and administrative SQL are not allowed through this endpoint.';
  END IF;

  -- Replace placeholders with random sentinels first, so a parameter value
  -- containing text such as $2 cannot be mistaken for another placeholder.
  FOR v_parameter IN
    SELECT ordinality
    FROM jsonb_array_elements(COALESCE(p_params, '[]'::jsonb)) WITH ORDINALITY
    ORDER BY ordinality DESC
  LOOP
    v_token := '__SC_SQL_PARAM_' || v_nonce || '_' || v_parameter.ordinality::text || '__';
    v_sql := replace(v_sql, '$' || v_parameter.ordinality::text, v_token);
  END LOOP;

  FOR v_parameter IN
    SELECT value, ordinality
    FROM jsonb_array_elements(COALESCE(p_params, '[]'::jsonb)) WITH ORDINALITY
    ORDER BY ordinality DESC
  LOOP
    CASE jsonb_typeof(v_parameter.value)
      WHEN 'null' THEN
        v_replacement := 'NULL';
      WHEN 'string' THEN
        v_replacement := quote_nullable(v_parameter.value #>> '{}');
      WHEN 'number' THEN
        v_replacement := v_parameter.value::text;
      WHEN 'boolean' THEN
        v_replacement := v_parameter.value::text;
      WHEN 'array' THEN
        SELECT CASE
          WHEN count(*) = 0 THEN 'ARRAY[]::text[]'
          ELSE 'ARRAY[' || string_agg(quote_nullable(item #>> '{}'), ',' ORDER BY ordinality) || ']'
        END
          INTO v_replacement
        FROM jsonb_array_elements(v_parameter.value) WITH ORDINALITY AS element(item, ordinality);
      WHEN 'object' THEN
        v_replacement := quote_nullable(v_parameter.value::text);
      ELSE
        RAISE EXCEPTION 'Unsupported SQL parameter type.';
    END CASE;

    v_token := '__SC_SQL_PARAM_' || v_nonce || '_' || v_parameter.ordinality::text || '__';
    v_sql := replace(v_sql, v_token, v_replacement);
  END LOOP;

  IF upper(ltrim(v_sql)) ~ '^SELECT([[:space:]]|$)' OR position('RETURNING' in upper(v_sql)) > 0 THEN
    FOR v_row IN EXECUTE v_sql LOOP
      v_rows := v_rows || jsonb_build_array(to_jsonb(v_row));
      IF jsonb_array_length(v_rows) > 5000 THEN
        RAISE EXCEPTION 'Query returned too many rows; add a LIMIT clause.';
      END IF;
    END LOOP;
    v_row_count := jsonb_array_length(v_rows);
  ELSE
    EXECUTE v_sql;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('rows', v_rows, 'rowCount', v_row_count);
END;
$function$;
CREATE OR REPLACE FUNCTION public.sc_exec_batch(p_statements jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_statement jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_statements) <> 'array' OR jsonb_array_length(p_statements) > 25 THEN
    RAISE EXCEPTION 'A transaction must contain between 0 and 25 SQL statements.';
  END IF;

  FOR v_statement IN SELECT value FROM jsonb_array_elements(p_statements)
  LOOP
    v_result := public.sc_exec_sql(
      v_statement ->> 'sql',
      COALESCE(v_statement -> 'params', '[]'::jsonb)
    );
    v_results := v_results || jsonb_build_array(v_result);
  END LOOP;

  RETURN v_results;
END;
$function$;

-- Giveaway operations that require row locks remain atomic inside one RPC.
CREATE OR REPLACE FUNCTION public.sc_join_giveaway(
  p_giveaway_id uuid,
  p_guild_id text,
  p_user_id text,
  p_bonus_entries integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_giveaway record;
  v_rows integer;
BEGIN
  SELECT ended, ends_at
    INTO v_giveaway
    FROM public."SC_giveaways"
   WHERE giveaway_id = p_giveaway_id AND guild_id = p_guild_id
   FOR UPDATE;

  IF NOT FOUND OR v_giveaway.ended OR v_giveaway.ends_at <= now() THEN
    RETURN jsonb_build_object('status', 'ended');
  END IF;

  INSERT INTO public."SC_giveaway_entries"
    (giveaway_id, guild_id, user_id, bonus_entries)
  VALUES (p_giveaway_id, p_guild_id, p_user_id, GREATEST(0, LEAST(100, p_bonus_entries)))
  ON CONFLICT (giveaway_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('status', 'existing');
  END IF;

  INSERT INTO public."SC_audit_logs" (guild_id, actor_id, action, target_id, metadata)
  VALUES (p_guild_id, p_user_id, 'giveaway.entry_created', p_giveaway_id::text,
          jsonb_build_object('bonusEntries', GREATEST(0, LEAST(100, p_bonus_entries))));

  RETURN jsonb_build_object('status', 'inserted');
END;
$function$;

CREATE OR REPLACE FUNCTION public.sc_draw_giveaway(
  p_giveaway_id uuid,
  p_guild_id text,
  p_actor_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_winner_count integer;
  v_participant_count integer := 0;
  v_total_weight numeric;
  v_ticket numeric;
  v_winner_id text;
  v_winners text[] := ARRAY[]::text[];
  v_index integer;
BEGIN
  UPDATE public."SC_giveaways"
     SET ended = TRUE,
         ended_at = now(),
         result_publication_pending = TRUE,
         updated_at = now()
   WHERE giveaway_id = p_giveaway_id
     AND guild_id = p_guild_id
     AND ended = FALSE
  RETURNING winner_count INTO v_winner_count;

  IF NOT FOUND THEN
    SELECT winner_ids INTO v_winners
      FROM public."SC_giveaways"
     WHERE giveaway_id = p_giveaway_id AND guild_id = p_guild_id;
    RETURN jsonb_build_object('claimed', FALSE, 'winner_ids', COALESCE(to_jsonb(v_winners), '[]'::jsonb), 'participant_count', 0);
  END IF;

  SELECT count(*) INTO v_participant_count
    FROM public."SC_giveaway_entries"
   WHERE giveaway_id = p_giveaway_id;

  FOR v_index IN 1..v_winner_count LOOP
    SELECT COALESCE(sum(1 + bonus_entries), 0) INTO v_total_weight
      FROM public."SC_giveaway_entries"
     WHERE giveaway_id = p_giveaway_id
       AND NOT (user_id = ANY(v_winners));

    EXIT WHEN v_total_weight <= 0;
    v_ticket := random() * v_total_weight;

    SELECT user_id INTO v_winner_id
      FROM (
        SELECT user_id,
               sum(1 + bonus_entries) OVER (ORDER BY entered_at, user_id) AS cumulative_weight
          FROM public."SC_giveaway_entries"
         WHERE giveaway_id = p_giveaway_id
           AND NOT (user_id = ANY(v_winners))
      ) weighted
     WHERE cumulative_weight > v_ticket
     ORDER BY cumulative_weight
     LIMIT 1;

    EXIT WHEN v_winner_id IS NULL;
    v_winners := array_append(v_winners, v_winner_id);
    v_winner_id := NULL;
  END LOOP;

  UPDATE public."SC_giveaways"
     SET winner_ids = v_winners,
         updated_at = now()
   WHERE giveaway_id = p_giveaway_id
     AND guild_id = p_guild_id;

  INSERT INTO public."SC_audit_logs" (guild_id, actor_id, action, target_id, metadata)
  VALUES (p_guild_id, p_actor_id, 'giveaway.drawn', p_giveaway_id::text,
          jsonb_build_object('winnerIds', to_jsonb(v_winners), 'participantCount', v_participant_count));

  RETURN jsonb_build_object('claimed', TRUE, 'winner_ids', to_jsonb(v_winners), 'participant_count', v_participant_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sc_redraw_giveaway(
  p_giveaway_id uuid,
  p_guild_id text,
  p_actor_id text,
  p_requested_winner_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_current record;
  v_previous text[];
  v_old_winner text;
  v_new_winner text;
  v_total_weight numeric;
  v_ticket numeric;
  v_updated text[];
BEGIN
  SELECT winner_ids, ended INTO v_current
    FROM public."SC_giveaways"
   WHERE giveaway_id = p_giveaway_id AND guild_id = p_guild_id
   FOR UPDATE;

  IF NOT FOUND OR NOT v_current.ended THEN
    RETURN jsonb_build_object('status', 'not_ended');
  END IF;

  v_previous := COALESCE(v_current.winner_ids, ARRAY[]::text[]);
  v_old_winner := COALESCE(p_requested_winner_id, v_previous[array_length(v_previous, 1)]);

  IF v_old_winner IS NULL OR NOT (v_old_winner = ANY(v_previous)) THEN
    RETURN jsonb_build_object('status', 'invalid_winner', 'has_previous', cardinality(v_previous) > 0);
  END IF;

  SELECT COALESCE(sum(1 + bonus_entries), 0) INTO v_total_weight
    FROM public."SC_giveaway_entries"
   WHERE giveaway_id = p_giveaway_id
     AND NOT (user_id = ANY(v_previous));

  IF v_total_weight <= 0 THEN
    RETURN jsonb_build_object('status', 'no_alternative', 'old_winner_id', v_old_winner);
  END IF;

  v_ticket := random() * v_total_weight;
  SELECT user_id INTO v_new_winner
    FROM (
      SELECT user_id,
             sum(1 + bonus_entries) OVER (ORDER BY entered_at, user_id) AS cumulative_weight
        FROM public."SC_giveaway_entries"
       WHERE giveaway_id = p_giveaway_id
         AND NOT (user_id = ANY(v_previous))
    ) weighted
   WHERE cumulative_weight > v_ticket
   ORDER BY cumulative_weight
   LIMIT 1;

  IF v_new_winner IS NULL THEN
    RETURN jsonb_build_object('status', 'no_alternative', 'old_winner_id', v_old_winner);
  END IF;

  SELECT array_agg(CASE WHEN winner_id = v_old_winner THEN v_new_winner ELSE winner_id END ORDER BY position)
    INTO v_updated
    FROM unnest(v_previous) WITH ORDINALITY AS current_winners(winner_id, position);

  UPDATE public."SC_giveaways"
     SET winner_ids = v_updated,
         result_published_at = NULL,
         result_publication_pending = TRUE,
         result_publish_after = now(),
         result_publish_error = NULL,
         updated_at = now()
   WHERE giveaway_id = p_giveaway_id AND guild_id = p_guild_id;

  INSERT INTO public."SC_audit_logs" (guild_id, actor_id, action, target_id, metadata)
  VALUES (p_guild_id, p_actor_id, 'giveaway.redrawn', p_giveaway_id::text,
          jsonb_build_object('previousWinners', to_jsonb(v_previous), 'replacedWinner', v_old_winner, 'newWinner', v_new_winner));

  RETURN jsonb_build_object('status', 'success', 'old_winner_id', v_old_winner, 'new_winner_id', v_new_winner, 'winner_ids', to_jsonb(v_updated));
END;
$function$;

REVOKE ALL ON FUNCTION public.sc_exec_sql(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sc_exec_batch(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sc_join_giveaway(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sc_draw_giveaway(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sc_redraw_giveaway(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sc_exec_sql(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sc_exec_batch(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.sc_join_giveaway(uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sc_draw_giveaway(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sc_redraw_giveaway(uuid, text, text, text) TO service_role;
