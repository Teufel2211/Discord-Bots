-- Im Supabase SQL Editor ausführen.
create table if not exists public.tw_giveaway_state (
  id integer primary key check (id = 1),
  status text not null check (status in ('idle', 'active', 'ended')),
  prize text,
  ends_at timestamptz,
  participants integer not null default 0,
  participants_data jsonb not null default '[]'::jsonb,
  winner text,
  join_word text not null default 'giveaway',
  role_settings jsonb not null default '{}'::jsonb,
  persistent_mode boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.tw_giveaway_commands (
  id text primary key,
  command_type text not null check (command_type in ('start', 'end', 'reroll', 'keyword')),
  minutes integer,
  prize text,
  winner text,
  join_word text,
  role_settings jsonb,
  participants_data jsonb,
  persistent_mode boolean,
  created_at timestamptz not null default now()
);

-- Migration für bestehende Installationen (idempotent).
alter table public.tw_giveaway_state add column if not exists join_word text not null default 'giveaway';
alter table public.tw_giveaway_state add column if not exists role_settings jsonb not null default '{}'::jsonb;
alter table public.tw_giveaway_state add column if not exists persistent_mode boolean not null default false;
alter table public.tw_giveaway_commands add column if not exists join_word text;
alter table public.tw_giveaway_commands add column if not exists role_settings jsonb;
alter table public.tw_giveaway_commands add column if not exists participants_data jsonb;
alter table public.tw_giveaway_commands add column if not exists persistent_mode boolean;
alter table public.tw_giveaway_commands drop constraint if exists tw_giveaway_commands_command_type_check;
alter table public.tw_giveaway_commands add constraint tw_giveaway_commands_command_type_check check (command_type in ('start', 'end', 'reroll', 'keyword'));

create index if not exists giveaway_commands_created_at_idx
  on public.tw_giveaway_commands (created_at);

insert into public.tw_giveaway_state (id, status, participants)
values (1, 'idle', 0)
on conflict (id) do nothing;

alter table public.tw_giveaway_state enable row level security;
alter table public.tw_giveaway_commands enable row level security;

-- Es gibt absichtlich keine anon/authenticated-Policies.
-- Der Zugriff erfolgt ausschließlich serverseitig mit dem Supabase-Secret-Key.
revoke all on public.tw_giveaway_state from anon, authenticated;
revoke all on public.tw_giveaway_commands from anon, authenticated;

create table if not exists public.tw_watchtime (
  user_id text primary key,
  username text not null,
  watch_seconds bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.tw_watchtime enable row level security;
revoke all on public.tw_watchtime from anon, authenticated;
