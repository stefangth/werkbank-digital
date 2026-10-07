-- Werkbank Digital runs on its own Supabase project (ADR-0014). The resolver from
-- 20260809140000_functions_base_url_env_resolver.sql defaults to the Showflow production host,
-- so every pg_cron and trigger dispatch of this database would call Showflow's edge functions.
-- Point the default at this project. Local and preview stacks keep their override row
-- (supabase/seed.sql), so only the no-override default changes.
create or replace function private.functions_base_url()
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(value, '') from private.runtime_config where key = 'functions_base_url'),
    'https://wmtbjajmnjxefrhkchts.supabase.co'
  );
$$;
