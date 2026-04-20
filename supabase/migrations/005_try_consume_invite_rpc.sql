-- Atomic check-and-consume for invite codes.
-- Returns true if the code was valid and successfully consumed, false otherwise.
create or replace function try_consume_invite_code(p_code text)
returns boolean
language plpgsql
security definer
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
