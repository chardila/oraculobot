alter table question_logs
  add column outcome text check (outcome in ('answered', 'no_data', 'out_of_scope', 'exception')),
  add column answer text;
