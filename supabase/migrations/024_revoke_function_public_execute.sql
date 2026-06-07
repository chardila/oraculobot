-- PostgreSQL grants EXECUTE to PUBLIC by default on function creation.
-- Revoke from PUBLIC to prevent anon/authenticated clients from calling these
-- security definer functions directly. The worker uses the service role.
revoke execute on function leaderboard() from public;
revoke execute on function leaderboard(uuid) from public;
revoke execute on function try_consume_invite_code(text) from public;
