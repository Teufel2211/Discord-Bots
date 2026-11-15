-- Bot-Realtime: Das Dashboard benachrichtigt BWW nur bei neuen Aktionen.
-- Idempotent; die bestehende RLS-Konfiguration der Tabelle wird nicht verändert.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'bww_dashboard_actions'
     ) then
    execute 'alter publication supabase_realtime add table public.bww_dashboard_actions';
  end if;
end
$$;
