-- Accounts created through Google sign-in: always a pending Community Member.
-- A role can never be requested or raised through OAuth; an administrator assigns it afterwards.
-- (Google sign-ins whose verified e-mail matches an existing account are linked to that account by
-- Supabase Auth and never reach this trigger, so the existing role and status are kept.)
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_oauth boolean := coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email';
  v_role public.user_role := 'project_owner';
  v_status public.account_status := 'pending';
  v_name text := left(trim(coalesce(v_meta ->> 'full_name', v_meta ->> 'name', '')), 120);
  v_require boolean;
begin
  if v_oauth then
    v_role := 'community_member';
  elsif v_meta ->> 'requested_role' in ('project_owner', 'project_manager', 'field_officer', 'investor', 'community_member') then
    v_role := (v_meta ->> 'requested_role')::public.user_role;
  end if;
  select require_account_approval into v_require from public.system_settings limit 1;
  if v_role = 'project_owner' and coalesce(v_require, true) = false then
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
  perform private.notify_admins('account', 'New account registration',
    format('%s registered as %s%s.', v_name, replace(v_role::text, '_', ' '), case when v_oauth then ' (Google sign-in)' else '' end),
    '/dashboard/admin/users', null, new.id);
  return new;
end $$;

-- Users record their own acceptance of the terms, but can never clear or backdate it.
create or replace function private.tg_profiles_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  new.updated_at := now();
  new.id := old.id;
  new.created_at := old.created_at;
  if v_uid is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  if old.terms_accepted_at is not null then
    new.terms_accepted_at := old.terms_accepted_at;
    new.privacy_accepted_at := old.privacy_accepted_at;
  elsif new.terms_accepted_at is not null then
    new.terms_accepted_at := now();
    new.privacy_accepted_at := now();
  end if;
  if private.is_admin() then
    if old.id = v_uid and (new.role <> old.role or new.status <> old.status) then
      raise exception 'Administrators cannot change their own role or status';
    end if;
  elsif new.role <> old.role or new.status <> old.status or new.email <> old.email then
    raise exception 'Only an administrator can change role, status or email';
  end if;
  return new;
end $$;
