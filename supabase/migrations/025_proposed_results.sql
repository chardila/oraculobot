create table proposed_results (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references matches(id),
  home_score_90   int not null,
  away_score_90   int not null,
  home_score_et   int,
  away_score_et   int,
  home_penalties  int,
  away_penalties  int,
  penalty_winner  text check (penalty_winner in ('home', 'away')),
  status          text not null default 'pending'
                  check (status in ('pending', 'confirmed', 'rejected')),
  telegram_message_id bigint,
  proposed_at     timestamptz not null default now(),
  decided_at      timestamptz
);

alter table proposed_results enable row level security;
-- Accessed only by the worker with service role; no policies needed.

create index on proposed_results (match_id, status);
