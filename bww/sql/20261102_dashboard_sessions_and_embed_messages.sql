create table if not exists public.bww_dashboard_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  guild_id text not null,
  user_id text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists bww_dashboard_sessions_active_idx on public.bww_dashboard_sessions(token_hash, expires_at) where revoked_at is null;
alter table public.bww_dashboard_sessions enable row level security;
revoke all on public.bww_dashboard_sessions from anon, authenticated;
grant all on public.bww_dashboard_sessions to service_role;
drop policy if exists bww_dashboard_sessions_service_role_all on public.bww_dashboard_sessions;
create policy bww_dashboard_sessions_service_role_all on public.bww_dashboard_sessions for all to service_role using (true) with check (true);

create table if not exists public.bww_embed_messages (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  channel_id text not null,
  message_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guild_id, message_id)
);
create index if not exists bww_embed_messages_guild_idx on public.bww_embed_messages(guild_id, updated_at desc);
alter table public.bww_embed_messages enable row level security;
revoke all on public.bww_embed_messages from anon, authenticated;
grant all on public.bww_embed_messages to service_role;
drop policy if exists bww_embed_messages_service_role_all on public.bww_embed_messages;
create policy bww_embed_messages_service_role_all on public.bww_embed_messages for all to service_role using (true) with check (true);

create index if not exists bww_dashboard_actions_queue_idx on public.bww_dashboard_actions(status, created_at) where status in ('pending','processing');
