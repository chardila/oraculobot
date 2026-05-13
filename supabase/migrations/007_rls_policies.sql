-- Migration 007: RLS policies and security hardening
-- Addresses: RLS disabled on leagues, search_path on security definer functions,
--             unused increment_invite_use function exposure

-- 1. Enable RLS on leagues (was missing from migration 006)
alter table leagues enable row level security;

-- 2. RLS policies for public/anonymous read access
create policy "matches_public_select"
  on matches for select
  to anon, authenticated
  using (true);

create policy "leagues_public_select"
  on leagues for select
  to anon, authenticated
  using (true);

-- 3. RLS policies for authenticated web users (self-service)
create policy "users_self_select"
  on users for select
  using (auth.uid() = auth_user_id);

create policy "predictions_self_select"
  on predictions for select
  using (user_id in (select id from users where auth_user_id = auth.uid()));

create policy "predictions_self_insert"
  on predictions for insert
  with check (user_id in (select id from users where auth_user_id = auth.uid()));

create policy "predictions_self_update"
  on predictions for update
  using (user_id in (select id from users where auth_user_id = auth.uid()));

-- 4. Fix search_path on security definer functions (defense against search path hijacking)

create or replace function leaderboard(p_league_id uuid)
returns table(user_id uuid, username text, total_points bigint)
language sql
security definer
set search_path = 'public'
as $$
  select u.id, u.username, coalesce(sum(p.points), 0) as total_points
  from users u
  left join predictions p on p.user_id = u.id
  where u.league_id = p_league_id
  group by u.id, u.username
  order by total_points desc;
$$;

create or replace function try_consume_invite_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_use_count int;
  v_max_uses  int;
begin
  select use_count, max_uses
    into v_use_count, v_max_uses
    from invite_codes
   where code = p_code
     for update;

  if not found or v_use_count >= v_max_uses then
    return false;
  end if;

  update invite_codes
     set use_count = use_count + 1
   where code = p_code;

  return true;
end;
$$;

create or replace function increment_invite_use(p_code text)
returns void
language sql
security definer
set search_path = 'public'
as $$
  update invite_codes
  set use_count = use_count + 1
  where code = p_code;
$$;

create or replace function leaderboard()
returns table (user_id uuid, username text, total_points bigint)
language sql
security definer
set search_path = 'public'
as $$
  select u.id as user_id, u.username, coalesce(sum(p.points), 0) as total_points
  from users u
  left join predictions p on p.user_id = u.id
  group by u.id, u.username
  order by total_points desc;
$$;

-- 5. Revoke public execute on increment_invite_use (no safety check, replaced by try_consume_invite_code)
revoke execute on function increment_invite_use(text) from public, anon, authenticated;

-- 6. Grant execute on safe functions to anon/authenticated for web access
grant execute on function leaderboard() to anon, authenticated;
grant execute on function leaderboard(uuid) to anon, authenticated;
grant execute on function try_consume_invite_code(text) to anon, authenticated;
