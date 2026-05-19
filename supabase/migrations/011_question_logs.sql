create table question_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid references users(id),
  question    text not null,
  asked_at    timestamptz default now()
);
