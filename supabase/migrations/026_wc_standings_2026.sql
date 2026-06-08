create table wc_standings_2026 (
  id              serial primary key,
  group_name      text    not null,
  position        integer not null,
  team            text    not null,
  played          integer not null default 0,
  wins            integer not null default 0,
  draws           integer not null default 0,
  losses          integer not null default 0,
  goals_for       integer not null default 0,
  goals_against   integer not null default 0,
  goal_difference integer not null default 0,
  points          integer not null default 0,
  updated_at      timestamptz not null default now(),
  unique (group_name, team)
);

alter table wc_standings_2026 enable row level security;

create index on wc_standings_2026 (group_name);
create index on wc_standings_2026 (team);
