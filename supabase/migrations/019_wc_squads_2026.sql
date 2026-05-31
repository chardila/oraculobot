create table wc_squads_2026 (
  id                serial  primary key,
  team              text    not null,
  jersey_number     integer,
  player_name       text    not null,
  position          text,
  born              date,
  age_at_tournament integer,
  club_name         text,
  club_country      text,
  goals             integer default 0,
  captain           boolean default false,
  preliminary       boolean default false
);

alter table wc_squads_2026 enable row level security;

create index on wc_squads_2026 (team);
create index on wc_squads_2026 (player_name);
