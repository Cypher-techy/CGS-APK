-- FERD AI study assistant: a dashboard module that can be switched on or off like the others, and a
-- usage log that the server uses for rate limits. No model output or question text is stored.

insert into public.ferd_modules (key, label, description, href, icon, sort_order)
values ('assistant', 'Study assistant', 'Ask questions about your department''s published materials.', '/ferd/assistant', 'sparkles', 8)
on conflict (key) do nothing;
update public.ferd_modules set sort_order = 9 where key = 'notifications' and sort_order = 8;
update public.ferd_modules set sort_order = 10 where key = 'help' and sort_order = 9;

create table public.ferd_assistant_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- How many published items were given to the model as sources for this answer.
  source_count smallint not null default 0,
  created_at timestamptz not null default now()
);
create index ferd_assistant_usage_user_idx on public.ferd_assistant_usage (user_id, created_at desc);
alter table public.ferd_assistant_usage enable row level security;

-- A user sees their own usage; the Super Admin sees totals. Rows are written by the server only.
create policy ferd_assistant_usage_select on public.ferd_assistant_usage for select to authenticated
  using (user_id = (select auth.uid()) or private.ferd_is_super());

revoke all on public.ferd_assistant_usage from anon, authenticated;
grant select on public.ferd_assistant_usage to authenticated;
