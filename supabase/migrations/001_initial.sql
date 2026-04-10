-- Enable UUID extension
create extension if not exists "pgcrypto";

-- Invite codes (created before users, so no FK yet)
create table invite_codes (
  code        text primary key,
  created_by  uuid,  -- FK added after users table
  max_uses    int not null default 1,
  use_count   int not null default 0,
  created_at  timestamptz not null default now()
);

-- Users
create table users (
  id          uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  username    text,
  is_admin    boolean not null default false,
  invite_code text references invite_codes(code),
  created_at  timestamptz not null default now()
);

-- Add FK from invite_codes to users
alter table invite_codes
  add constraint fk_created_by foreign key (created_by) references users(id);

-- Matches
create table matches (
  id          uuid primary key default gen_random_uuid(),
  home_team   text not null,
  away_team   text not null,
  kickoff_at  timestamptz not null,
  phase       text not null, -- 'grupos', 'octavos', 'cuartos', 'semis', 'final'
  group_name  text,          -- 'A'..'L', null for knockout
  home_score  int,
  away_score  int,
  status      text not null default 'scheduled' check (status in ('scheduled', 'finished')),
  created_at  timestamptz not null default now()
);

-- Predictions
create table predictions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  match_id    uuid not null references matches(id),
  home_score  int not null,
  away_score  int not null,
  points      int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, match_id)
);

-- Conversation state (ephemeral, one row per telegram user)
create table conversation_state (
  telegram_id bigint primary key,
  step        text not null,
  context     jsonb not null default '{}',
  updated_at  timestamptz not null default now()
);

-- RLS: enabled on all tables (service role key used in worker bypasses RLS automatically)
alter table users              enable row level security;
alter table invite_codes       enable row level security;
alter table matches            enable row level security;
alter table predictions        enable row level security;
alter table conversation_state enable row level security;
