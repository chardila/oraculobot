-- Atomic increment of invite code use_count (avoids race conditions on concurrent registrations)
create or replace function increment_invite_use(p_code text)
returns void
language sql
security definer
as $$
  update invite_codes
  set use_count = use_count + 1
  where code = p_code;
$$;
