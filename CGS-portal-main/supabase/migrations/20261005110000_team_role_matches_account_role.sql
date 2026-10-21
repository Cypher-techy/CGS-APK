-- A person's working role on a project must match their account role, so that a community
-- member or investor account can never be given staff access to a project by mistake.
create or replace function private.tg_members_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_role;
  v_expected text;
begin
  new.added_by := coalesce((select auth.uid()), new.added_by);
  select u.role into v_role from public.profiles u where u.id = new.user_id and u.status = 'active';
  if v_role is null then
    raise exception 'Only active accounts can be added to a project';
  end if;
  v_expected := case v_role
    when 'field_officer' then 'field_officer'
    when 'project_manager' then 'team_member'
    when 'gis_analyst' then 'gis_analyst'
    when 'mrv_specialist' then 'mrv_specialist'
    when 'community_member' then 'community_member'
  end;
  if v_expected is null then
    raise exception 'This account type cannot be added to a project team';
  end if;
  if new.member_role not in (v_expected, 'observer') then
    raise exception 'The team role must match the account role of the person (%)', replace(v_role::text, '_', ' ');
  end if;
  return new;
end $$;
