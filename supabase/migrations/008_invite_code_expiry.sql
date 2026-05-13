-- Migration 008: Add expiration to invite codes

-- 1. Add expires_at column (default: 7 days from creation)
alter table invite_codes
  add column expires_at timestamptz not null default now() + interval '7 days';

-- 2. Set expiration for existing codes (30 days from creation)
update invite_codes
  set expires_at = created_at + interval '30 days';

-- 3. Update try_consume_invite_code to check expiration
create or replace function try_consume_invite_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_use_count int;
  v_max_uses  int;
  v_expires_at timestamptz;
begin
  select use_count, max_uses, expires_at
    into v_use_count, v_max_uses, v_expires_at
    from invite_codes
   where code = p_code
     for update;

  if not found or v_use_count >= v_max_uses or v_expires_at <= now() then
    return false;
  end if;

  update invite_codes
     set use_count = use_count + 1
   where code = p_code;

  return true;
end;
$$;
