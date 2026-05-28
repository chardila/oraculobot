-- supabase/migrations/015_jfjelstul_enrichment.sql

-- ── Enriquecer wc_matches ────────────────────────────────────────────────────
alter table wc_matches
  add column if not exists jfjelstul_match_id text,
  add column if not exists extra_time        boolean default false,
  add column if not exists penalty_shootout  boolean default false,
  add column if not exists home_penalties    int,
  add column if not exists away_penalties    int;

create index if not exists wc_matches_jfjelstul_id
  on wc_matches (jfjelstul_match_id);

-- ── Enriquecer wc_goals ──────────────────────────────────────────────────────
alter table wc_goals
  add column if not exists minute_stoppage int,
  add column if not exists match_period    text;

-- ── Árbitros ─────────────────────────────────────────────────────────────────
create table wc_referees (
  id                   serial primary key,
  jfjelstul_referee_id text unique not null,  -- ej: 'R-001'
  family_name          text not null,
  given_name           text,
  country_name         text,
  confederation_code   text
);

create table wc_referee_appearances (
  id          serial primary key,
  match_id    int references wc_matches(id) on delete cascade,
  referee_id  int references wc_referees(id),
  family_name text not null,
  given_name  text,
  country_name text
);

-- ── Tarjetas ─────────────────────────────────────────────────────────────────
create table wc_bookings (
  id                 serial primary key,
  match_id           int references wc_matches(id) on delete cascade,
  team               text not null,
  player_name        text not null,
  shirt_number       int,
  minute_regulation  int,
  minute_stoppage    int,
  match_period       text,
  yellow_card        boolean default false,
  red_card           boolean default false,
  second_yellow_card boolean default false
);

-- ── Sustituciones ────────────────────────────────────────────────────────────
create table wc_substitutions (
  id                serial primary key,
  match_id          int references wc_matches(id) on delete cascade,
  team              text not null,
  player_name       text not null,
  shirt_number      int,
  minute_regulation int,
  minute_stoppage   int,
  match_period      text,
  going_off         boolean default false,
  coming_on         boolean default false
);

-- ── Apariciones de jugadores ─────────────────────────────────────────────────
create table wc_player_appearances (
  id             serial primary key,
  match_id       int references wc_matches(id) on delete cascade,
  team           text not null,
  player_name    text not null,
  shirt_number   int,
  position_name  text,
  position_code  text,
  starter        boolean default true,
  substitute     boolean default false
);

-- ── Penales en shootout ───────────────────────────────────────────────────────
create table wc_penalty_kicks (
  id           serial primary key,
  match_id     int references wc_matches(id) on delete cascade,
  team         text not null,
  player_name  text not null,
  shirt_number int,
  converted    boolean default false
);

-- ── Clasificación de grupos ──────────────────────────────────────────────────
create table wc_group_standings (
  id              serial primary key,
  year            int not null,
  group_name      text not null,
  position        int not null,
  team            text not null,
  played          int,
  wins            int,
  draws           int,
  losses          int,
  goals_for       int,
  goals_against   int,
  goal_difference int,
  points          int,
  advanced        boolean
);

-- ── Premios individuales ─────────────────────────────────────────────────────
create table wc_award_winners (
  id          serial primary key,
  year        int not null,
  award_name  text not null,
  player_name text not null,
  team        text not null,
  shared      boolean default false
);

-- ── RLS (service role only — no policies needed) ─────────────────────────────
alter table wc_referees           enable row level security;
alter table wc_referee_appearances enable row level security;
alter table wc_bookings           enable row level security;
alter table wc_substitutions      enable row level security;
alter table wc_player_appearances  enable row level security;
alter table wc_penalty_kicks      enable row level security;
alter table wc_group_standings    enable row level security;
alter table wc_award_winners      enable row level security;
