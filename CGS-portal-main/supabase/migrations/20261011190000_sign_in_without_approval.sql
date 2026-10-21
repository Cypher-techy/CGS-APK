-- Accounts can be used as soon as they are created, without waiting for an administrator.
--
-- FERD: a new student whose registration number matches a department prefix rule is verified at once.
--   The Super Admin can switch this off again in /ferd/admin/settings (ferd_settings.auto_verify_students).
-- CGS: the existing switch "require account approval" is turned off and now also covers investors and
--   community members, not only project owners.
--
-- What still waits for an administrator, on purpose:
--   * a student whose prefix matches no rule (there is no department to send them to);
--   * people who register as Project Manager or Field Officer on CGS, because those roles can read other
--     users' details and field data, so a self-declared one is confirmed first;
--   * GIS Analyst, MRV Specialist and administrator roles, which are never self-registered.

create table public.ferd_settings (
  id boolean primary key default true check (id),
  -- When true, registration alone gives access; identity is not checked by a person first.
  auto_verify_students boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.ferd_settings (id) values (true);
create index ferd_settings_updated_by_idx on public.ferd_settings (updated_by);
alter table public.ferd_settings enable row level security;
create policy ferd_settings_select on public.ferd_settings for select to authenticated using (private.ferd_role() is not null);
create policy ferd_settings_update on public.ferd_settings for update to authenticated
  using (private.ferd_is_super()) with check (private.ferd_is_super());
revoke all on public.ferd_settings from anon, authenticated;
grant select, update on public.ferd_settings to authenticated;
create trigger ferd_settings_audit after update on public.ferd_settings for each row execute function private.tg_ferd_audit_row();

-- CGS: approval is no longer required by default.
update public.system_settings set require_account_approval = false;
alter table public.system_settings alter column require_account_approval set default false;

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_oauth boolean := coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email';
  -- coalesce: a sign-up that names no portal must give false here, not null, or the tests below it never pass.
  v_ferd boolean := not v_oauth and coalesce(v_meta ->> 'portal' = 'ferd', false);
  v_role public.user_role := 'project_owner';
  v_status public.account_status := 'pending';
  v_name text := left(trim(coalesce(v_meta ->> 'full_name', v_meta ->> 'name', '')), 120);
  v_require boolean;
  v_key text;
  v_department uuid;
  v_auto boolean;
begin
  if v_oauth or v_ferd then
    v_role := 'community_member';
  elsif v_meta ->> 'requested_role' in ('project_owner', 'project_manager', 'field_officer', 'investor', 'community_member') then
    v_role := (v_meta ->> 'requested_role')::public.user_role;
  end if;
  select require_account_approval into v_require from public.system_settings limit 1;
  -- Without required approval, the roles that only see their own records are active at once. A FERD student's
  -- CGS profile stays pending: students use the FERD portal, not the CGS workspace.
  if not v_ferd and coalesce(v_require, true) = false and v_role in ('project_owner', 'investor', 'community_member') then
    v_status := 'active';
  end if;
  if char_length(v_name) < 2 then
    v_name := left(split_part(new.email, '@', 1) || '  ', 120);
  end if;
  insert into public.profiles (id, full_name, email, phone, organization, location, role, status,
                               terms_accepted_at, privacy_accepted_at)
  values (
    new.id, v_name, new.email,
    case when v_oauth then null else nullif(left(trim(coalesce(v_meta ->> 'phone', '')), 30), '') end,
    case when v_oauth then null else nullif(left(trim(coalesce(v_meta ->> 'organization', '')), 160), '') end,
    case when v_oauth then null else nullif(left(trim(coalesce(v_meta ->> 'location', '')), 160), '') end,
    v_role, v_status,
    -- OAuth accounts accept the terms on their first visit to the dashboard.
    case when not v_oauth and v_meta ->> 'accepted_terms' = 'true' then now() end,
    case when not v_oauth and v_meta ->> 'accepted_terms' = 'true' then now() end
  );
  if v_ferd then
    -- Only the registration number, name and contact details come from the form. The department is derived
    -- from the prefix rules, and the status is decided here, never by what the client sent.
    v_key := private.ferd_regno_key(v_meta ->> 'reg_no');
    v_department := private.ferd_department_for(v_key);
    select auto_verify_students into v_auto from public.ferd_settings limit 1;
    v_auto := coalesce(v_auto, false) and v_department is not null;
    insert into public.ferd_students (user_id, reg_no, reg_no_key, full_name, phone, year_of_study, department_id, status, verified_at)
    values (new.id, left(upper(trim(v_meta ->> 'reg_no')), 30), v_key, v_name,
            nullif(left(trim(coalesce(v_meta ->> 'phone', '')), 20), ''),
            case when (v_meta ->> 'year_of_study') ~ '^[1-8]$' then (v_meta ->> 'year_of_study')::smallint end,
            v_department,
            case when v_auto then 'verified' else 'pending' end,
            case when v_auto then now() end);
    perform private.ferd_audit(case when v_auto then 'student.auto_verified' else 'student.registered' end, 'ferd_students', new.id::text,
      jsonb_build_object('reg_no', left(upper(trim(v_meta ->> 'reg_no')), 30), 'department', v_department));
    return new;
  end if;
  perform private.notify_admins('account', 'New account registration',
    format('%s registered as %s%s%s.', v_name, replace(v_role::text, '_', ' '),
           case when v_oauth then ' (Google sign-in)' else '' end,
           case when v_status = 'active' then ' and is active' else ' and is awaiting approval' end),
    '/dashboard/admin/users', null, new.id);
  return new;
end $$;

-- People who already have an account and were waiting.
update public.ferd_students
set status = 'verified', verified_at = now(), status_note = null
where status = 'pending' and department_id is not null
  and phone is not null and phone ~ '^254[17][0-9]{8}$'
  and reg_no_key ~ '^[A-Z][0-9]{2}/[0-9]{3,6}/[0-9]{2}$';

update public.profiles p
set status = 'active'
where p.status = 'pending' and p.role in ('project_owner', 'investor', 'community_member')
  and not exists (select 1 from public.ferd_students s where s.user_id = p.id);
