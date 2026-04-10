-- Leaderboard function used by worker and site generator
create or replace function leaderboard()
returns table (user_id uuid, username text, total_points bigint)
language sql
as $$
  select u.id as user_id, u.username, coalesce(sum(p.points), 0) as total_points
  from users u
  left join predictions p on p.user_id = u.id
  group by u.id, u.username
  order by total_points desc;
$$;
