-- Run this once in the Supabase dashboard (SQL Editor -> New query -> paste -> Run).
-- It powers the public demo's daily usage limits.

-- One row per (counter key, day). Keys are hashed visitor IDs, plus one shared "global" key.
create table if not exists usage_counters (
  key text not null,
  day date not null default current_date,
  count int not null default 0,
  primary key (key, day)
);

-- Locked down: only the server (secret key) can touch it.
alter table usage_counters enable row level security;

-- Atomically add 1 to today's counter and say whether the caller is still within the limit.
-- (Doing it in one SQL statement avoids two simultaneous requests both slipping under the cap.)
create or replace function increment_usage(p_key text, p_limit int)
returns boolean
language plpgsql
as $$
declare
  new_count int;
begin
  insert into usage_counters (key, day, count)
  values (p_key, current_date, 1)
  on conflict (key, day) do update set count = usage_counters.count + 1
  returning count into new_count;

  return new_count <= p_limit;
end;
$$;

-- Browsers (anon/authenticated roles) must never call this; only the server does.
revoke execute on function increment_usage(text, int) from public, anon, authenticated;
grant execute on function increment_usage(text, int) to service_role;
