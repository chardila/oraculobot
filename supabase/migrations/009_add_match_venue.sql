-- Migration 009: Add venue/ground to matches

alter table matches
  add column ground text;

-- Add index for venue lookups
create index idx_matches_ground on matches(ground);
