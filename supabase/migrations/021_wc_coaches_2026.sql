create table wc_coaches_2026 (
  id            serial primary key,
  team          text not null unique,
  fifa_code     text,
  confederation text,
  group_name    text,
  coach_name    text,
  coach_country text,
  squad_kind    text
);

alter table wc_coaches_2026 enable row level security;

create index on wc_coaches_2026 (group_name);
create index on wc_coaches_2026 (confederation);
