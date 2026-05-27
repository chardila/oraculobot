-- supabase/migrations/014_wc_history_tables.sql

create table wc_matches (
  id          serial primary key,
  year        int not null,
  tournament  text not null,  -- 'FIFA World Cup' | 'FIFA World Cup qualification'
  phase       text,           -- 'Group A', 'Round of 16', 'Final', 'Qualifying', etc.
  home_team   text not null,
  away_team   text not null,
  home_score  int,            -- null = partido no jugado aún
  away_score  int,
  home_ht     int,            -- marcador al descanso
  away_ht     int,
  match_date  date,
  ground      text
);

create table wc_goals (
  id        serial primary key,
  match_id  int references wc_matches(id) on delete cascade,
  team      text not null,
  scorer    text not null,
  minute    int,
  penalty   boolean default false,
  own_goal  boolean default false
);

create table wc_teams (
  id            serial primary key,
  year          int not null,
  name          text not null,
  fifa_code     text,
  continent     text,
  confederation text,
  group_name    text
);

create table wc_stadiums (
  id        serial primary key,
  year      int not null,
  name      text not null,
  city      text,
  country   text,
  capacity  int
);

alter table wc_matches  enable row level security;
alter table wc_goals    enable row level security;
alter table wc_teams    enable row level security;
alter table wc_stadiums enable row level security;

-- RPC function para ejecutar SQL generado por el modelo
-- Solo puede ser llamada con service role (el worker la llama con SUPABASE_SERVICE_KEY)
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

  -- Solo SELECT permitido
  if not (lower_q like 'select%') then
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
