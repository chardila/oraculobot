create or replace function exec_wc_query(query text)
returns json
language plpgsql
security invoker
as $$
declare
  result json;
  lower_q text;
begin
  lower_q := trim(lower(query));

  -- Permitir SELECT y CTEs (WITH ... SELECT)
  if not (lower_q like 'select%' or lower_q like 'with%') then
    raise exception 'Only SELECT queries allowed';
  end if;

  -- Bloquear keywords peligrosos
  if lower_q ~ '\y(insert|update|delete|drop|create|alter|truncate|grant|revoke|copy|pg_read|pg_write)\y' then
    raise exception 'Forbidden keyword in query';
  end if;

  execute 'select coalesce(json_agg(row_to_json(q)), ''[]''::json) from (' || query || ') q'
    into result;

  return result;
end;
$$;
