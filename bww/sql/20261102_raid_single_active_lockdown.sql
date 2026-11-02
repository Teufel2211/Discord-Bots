create unique index if not exists bww_raid_one_active_lockdown_per_guild
on public.bww_raid_lockdowns (guild_id)
where restored_at is null;
