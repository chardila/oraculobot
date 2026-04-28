-- 1. Nueva tabla leagues
create table leagues (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- 2. Insertar polla por defecto antes de agregar FKs
insert into leagues (name) values ('Polla Principal');

-- 3. Agregar league_id a invite_codes (nullable primero para filas existentes)
alter table invite_codes
  add column league_id uuid references leagues(id);

-- 4. Asignar códigos existentes a la polla por defecto
update invite_codes
  set league_id = (select id from leagues where name = 'Polla Principal');

-- 5. Hacer league_id NOT NULL en invite_codes
alter table invite_codes
  alter column league_id set not null;

-- 6. Agregar league_id a users (nullable primero para filas existentes)
alter table users
  add column league_id uuid references leagues(id);

-- 7. Asignar usuarios existentes a la polla por defecto
update users
  set league_id = (select id from leagues where name = 'Polla Principal');

-- 8. Hacer league_id NOT NULL en users
alter table users
  alter column league_id set not null;

-- 9. Índices
create index idx_users_league_id on users(league_id);
create index idx_invite_codes_league_id on invite_codes(league_id);

-- 10. Actualizar RPC leaderboard para filtrar por polla
create or replace function leaderboard(p_league_id uuid)
returns table(user_id uuid, username text, total_points bigint) as $$
  select u.id, u.username, coalesce(sum(p.points), 0) as total_points
  from users u
  left join predictions p on p.user_id = u.id
  where u.league_id = p_league_id
  group by u.id, u.username
  order by total_points desc;
$$ language sql stable security definer;
