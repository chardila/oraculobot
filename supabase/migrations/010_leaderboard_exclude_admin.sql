-- Add telegram_id to leaderboard result so the worker can filter out the admin
drop function if exists leaderboard(uuid);

create function leaderboard(p_league_id uuid)
returns table(user_id uuid, username text, total_points bigint, telegram_id bigint) as $$
  select u.id, u.username, coalesce(sum(p.points), 0) as total_points, u.telegram_id
  from users u
  left join predictions p on p.user_id = u.id
  where u.league_id = p_league_id
  group by u.id, u.username, u.telegram_id
  order by total_points desc;
$$ language sql stable security definer;
