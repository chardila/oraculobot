-- Fix mutable search_path on leaderboard(p_league_id uuid)
create or replace function leaderboard(p_league_id uuid)
returns table(user_id uuid, username text, total_points bigint, telegram_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.username, coalesce(sum(p.points), 0) as total_points, u.telegram_id
  from public.users u
  left join public.predictions p on p.user_id = u.id
  where u.league_id = p_league_id
  group by u.id, u.username, u.telegram_id
  order by total_points desc;
$$;

-- Fix mutable search_path on exec_wc_query (uses dynamic SQL with unqualified table names,
-- so pinning to 'public' instead of '' to allow unqualified wc_* references inside EXECUTE)
create or replace function exec_wc_query(query text)
returns json
language plpgsql
security invoker
set search_path = public
as $$
declare
  result json;
  lower_q text;
begin
  lower_q := trim(lower(query));

  if not (lower_q like 'select%' or lower_q like 'with%') then
    raise exception 'Only SELECT queries allowed';
  end if;

  if lower_q ~ '\y(insert|update|delete|drop|create|alter|truncate|grant|revoke|copy|pg_read|pg_write)\y' then
    raise exception 'Forbidden keyword in query';
  end if;

  execute 'select coalesce(json_agg(row_to_json(q)), ''[]''::json) from (' || query || ') q'
    into result;

  return result;
end;
$$;

-- Revoke public execute grants on security definer functions.
-- The worker uses the service role which bypasses RLS/grants entirely;
-- these functions should not be callable directly by clients.
revoke execute on function leaderboard() from anon, authenticated;
revoke execute on function leaderboard(uuid) from anon, authenticated;
revoke execute on function try_consume_invite_code(text) from anon, authenticated;
