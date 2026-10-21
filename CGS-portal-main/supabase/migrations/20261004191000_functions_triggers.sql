-- CGS Project Portal: access helpers, workflow guards, notifications and audit logging.
-- Everything lives in the unexposed "private" schema. Workflow rules are enforced here so that
-- they hold no matter which client talks to the database.

-- ---------------------------------------------------------------------------
-- Access helpers used by RLS policies
-- ---------------------------------------------------------------------------

-- Role of the calling user, or null when the account is not active.
create function private.user_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and status = 'active'
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.user_role() = 'super_admin', false)
$$;

create function private.is_project_member(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project and m.user_id = (select auth.uid())
  )
$$;

-- Owner, manager or team member of a project.
create function private.is_participant(p_project uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project and (p.owner_id = p_user or p.manager_id = p_user)
  ) or exists (
    select 1 from public.project_members m
    where m.project_id = p_project and m.user_id = p_user
  )
$$;

create function private.can_view_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_role() is not null
    and (private.is_admin() or private.is_participant(p_project, (select auth.uid())))
$$;

create function private.can_manage_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (
    private.user_role() = 'project_manager'
    and exists (select 1 from public.projects p where p.id = p_project and p.manager_id = (select auth.uid()))
  )
$$;

-- True when the caller and p_user take part in at least one common project.
create function private.shares_project_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_role() is not null and exists (
    select 1 from public.projects p
    where private.is_participant(p.id, (select auth.uid())) and private.is_participant(p.id, p_user)
  )
$$;

-- ---------------------------------------------------------------------------
-- Notification and audit helpers (called only from triggers)
-- ---------------------------------------------------------------------------

create function private.notify(
  p_user uuid, p_type text, p_title text, p_body text, p_link text,
  p_project uuid default null, p_entity uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Nobody is notified about their own action.
  if p_user is null or p_user = (select auth.uid()) then
    return;
  end if;
  insert into public.notifications (user_id, type, title, body, link, project_id, entity_id)
  values (p_user, p_type, p_title, p_body, p_link, p_project, p_entity);
end $$;

create function private.notify_admins(
  p_type text, p_title text, p_body text, p_link text,
  p_project uuid default null, p_entity uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(a.id, p_type, p_title, p_body, p_link, p_project, p_entity)
  from public.profiles a
  where a.role = 'super_admin' and a.status = 'active';
end $$;

-- The project manager, or the administrators when no manager is assigned yet.
create function private.notify_project_lead(
  p_project uuid, p_type text, p_title text, p_body text, p_link text, p_entity uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_manager uuid;
begin
  select manager_id into v_manager from public.projects where id = p_project;
  if v_manager is not null then
    perform private.notify(v_manager, p_type, p_title, p_body, p_link, p_project, p_entity);
  else
    perform private.notify_admins(p_type, p_title, p_body, p_link, p_project, p_entity);
  end if;
end $$;

create function private.log_activity(
  p_action text, p_entity_type text, p_entity uuid, p_project uuid, p_details jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_logs (actor_id, action, entity_type, entity_id, project_id, details)
  values (
    (select auth.uid()), p_action, p_entity_type, p_entity,
    -- Null when the project is being deleted in the same transaction.
    (select p.id from public.projects p where p.id = p_project),
    coalesce(p_details, '{}'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role public.user_role := 'project_owner';
  v_status public.account_status := 'pending';
  v_name text := left(trim(coalesce(v_meta ->> 'full_name', '')), 120);
  v_require boolean;
begin
  -- Self-registration may only request non-administrative roles.
  if v_meta ->> 'requested_role' in ('project_owner', 'project_manager', 'field_officer') then
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
    nullif(left(trim(coalesce(v_meta ->> 'phone', '')), 30), ''),
    nullif(left(trim(coalesce(v_meta ->> 'organization', '')), 160), ''),
    nullif(left(trim(coalesce(v_meta ->> 'location', '')), 160), ''),
    v_role, v_status,
    case when v_meta ->> 'accepted_terms' = 'true' then now() end,
    case when v_meta ->> 'accepted_terms' = 'true' then now() end
  );

  perform private.notify_admins(
    'account', 'New account registration',
    format('%s registered as %s.', v_name, replace(v_role::text, '_', ' ')),
    '/dashboard/admin/users', null, new.id
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.tg_profiles_before_update() returns trigger
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
  if private.is_admin() then
    if old.id = v_uid and (new.role <> old.role or new.status <> old.status) then
      raise exception 'Administrators cannot change their own role or status';
    end if;
  elsif new.role <> old.role or new.status <> old.status or new.email <> old.email then
    raise exception 'Only an administrator can change role, status or email';
  end if;
  return new;
end $$;

create trigger profiles_before_update before update on public.profiles
  for each row execute function private.tg_profiles_before_update();

create function private.tg_profiles_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role <> old.role then
    perform private.log_activity('user.role_changed', 'user', new.id, null,
      jsonb_build_object('from', old.role, 'to', new.role, 'user', new.full_name));
    perform private.notify(new.id, 'account', 'Your role was updated',
      format('Your role is now %s.', replace(new.role::text, '_', ' ')), '/dashboard', null, new.id);
  end if;
  if new.status <> old.status then
    perform private.log_activity('user.status_changed', 'user', new.id, null,
      jsonb_build_object('from', old.status, 'to', new.status, 'user', new.full_name));
    perform private.notify(new.id, 'account', 'Account status updated',
      format('Your account is now %s.', new.status), '/dashboard', null, new.id);
  end if;
  return null;
end $$;

create trigger profiles_after_update after update on public.profiles
  for each row execute function private.tg_profiles_after_update();

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------

create function private.tg_projects_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  new.code := 'CGS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.project_code_seq')::text, 4, '0');
  new.created_by := coalesce(v_uid, new.created_by);
  new.progress_percent := 0;
  if v_uid is not null and not private.is_admin() then
    new.owner_id := v_uid;
    new.manager_id := null;
  end if;
  if new.status not in ('draft', 'pending_approval') then
    new.status := 'draft';
  end if;
  new.submitted_at := case when new.status = 'pending_approval' then now() end;
  return new;
end $$;

create trigger projects_before_insert before insert on public.projects
  for each row execute function private.tg_projects_before_insert();

create function private.tg_projects_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean;
  v_manager boolean;
begin
  new.updated_at := now();
  new.code := old.code;
  new.created_at := old.created_at;
  -- Updates made by other triggers (approvals, task progress) and by the SQL console are trusted.
  if v_uid is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  v_admin := private.is_admin();
  v_manager := coalesce(private.user_role() = 'project_manager' and old.manager_id = v_uid, false);

  if new.progress_percent <> old.progress_percent then
    raise exception 'Progress is calculated from completed tasks and cannot be edited directly';
  end if;

  if new.status <> old.status then
    if new.status in ('approved', 'rejected', 'revision_required') then
      raise exception 'Approval decisions must be recorded through the approvals workflow';
    end if;
    if new.status = 'pending_approval' then
      if not (old.status in ('draft', 'revision_required') and (old.owner_id = v_uid or v_admin)) then
        raise exception 'Only a draft or a project needing revision can be submitted for approval';
      end if;
      new.submitted_at := now();
    elsif not ((v_admin or v_manager) and (
         (old.status = 'approved' and new.status = 'active')
      or (old.status = 'active' and new.status in ('on_hold', 'completed'))
      or (old.status in ('on_hold', 'completed') and new.status = 'active')
    )) then
      raise exception 'Status change from % to % is not permitted', old.status, new.status;
    end if;
  end if;

  if v_admin then
    return new;
  end if;

  if new.owner_id <> old.owner_id or new.manager_id is distinct from old.manager_id then
    raise exception 'Only an administrator can change the project owner or manager';
  end if;
  if v_manager then
    return new;
  end if;
  if old.owner_id = v_uid and old.status in ('draft', 'revision_required') then
    return new;
  end if;
  raise exception 'You are not permitted to modify this project in its current status';
end $$;

create trigger projects_before_update before update on public.projects
  for each row execute function private.tg_projects_before_update();

create function private.tg_projects_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_link text := '/dashboard/projects/' || new.id;
begin
  if tg_op = 'INSERT' then
    perform private.log_activity('project.created', 'project', new.id, new.id,
      jsonb_build_object('code', new.code, 'name', new.name, 'status', new.status));
    if new.status = 'pending_approval' then
      perform private.notify_admins('project_submitted', 'Project submitted for approval',
        format('%s (%s) is awaiting review.', new.name, new.code), '/dashboard/admin/approvals', new.id, new.id);
    end if;
    return null;
  end if;

  if new.status <> old.status then
    perform private.log_activity('project.status_changed', 'project', new.id, new.id,
      jsonb_build_object('from', old.status, 'to', new.status));
    if new.status = 'pending_approval' then
      perform private.notify_admins('project_submitted', 'Project submitted for approval',
        format('%s (%s) is awaiting review.', new.name, new.code), '/dashboard/admin/approvals', new.id, new.id);
    else
      perform private.notify(new.owner_id, 'project_status', 'Project status updated',
        format('%s (%s) is now: %s.', new.name, new.code, replace(new.status::text, '_', ' ')), v_link, new.id, new.id);
      perform private.notify(new.manager_id, 'project_status', 'Project status updated',
        format('%s (%s) is now: %s.', new.name, new.code, replace(new.status::text, '_', ' ')), v_link, new.id, new.id);
    end if;
  end if;

  if new.manager_id is distinct from old.manager_id then
    perform private.log_activity('project.manager_assigned', 'project', new.id, new.id,
      jsonb_build_object('manager_id', new.manager_id));
    perform private.notify(new.manager_id, 'project_assigned', 'Project assigned to you',
      format('You are now the project manager of %s (%s).', new.name, new.code), v_link, new.id, new.id);
  end if;

  if (new.name, new.description, new.objectives, new.county, new.location_description, new.latitude,
      new.longitude, new.area_ha, new.start_date, new.expected_end_date, new.category_id)
     is distinct from
     (old.name, old.description, old.objectives, old.county, old.location_description, old.latitude,
      old.longitude, old.area_ha, old.start_date, old.expected_end_date, old.category_id) then
    perform private.log_activity('project.updated', 'project', new.id, new.id, '{}'::jsonb);
  end if;
  return null;
end $$;

create trigger projects_after_write after insert or update on public.projects
  for each row execute function private.tg_projects_after_write();

-- ---------------------------------------------------------------------------
-- Approvals: inserting a decision is the only way to approve / reject / request revision.
-- ---------------------------------------------------------------------------

create function private.tg_approvals_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.reviewer_id := coalesce((select auth.uid()), new.reviewer_id);
  new.created_at := now();
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.status = 'pending_approval') then
    raise exception 'Only projects pending approval can be reviewed';
  end if;
  if new.decision in ('rejected', 'revision_required') and coalesce(trim(new.comments), '') = '' then
    raise exception 'Comments are required when rejecting a project or requesting revision';
  end if;
  return new;
end $$;

create trigger approvals_before_insert before insert on public.approvals
  for each row execute function private.tg_approvals_before_insert();

create function private.tg_approvals_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.log_activity('project.reviewed', 'project', new.project_id, new.project_id,
    jsonb_build_object('decision', new.decision, 'comments', new.comments));
  update public.projects set status = new.decision::text::public.project_status where id = new.project_id;
  return null;
end $$;

create trigger approvals_after_insert after insert on public.approvals
  for each row execute function private.tg_approvals_after_insert();

-- ---------------------------------------------------------------------------
-- Project members
-- ---------------------------------------------------------------------------

create function private.tg_members_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.added_by := coalesce((select auth.uid()), new.added_by);
  if not exists (select 1 from public.profiles u where u.id = new.user_id and u.status = 'active') then
    raise exception 'Only active accounts can be added to a project';
  end if;
  return new;
end $$;

create trigger members_before_insert before insert on public.project_members
  for each row execute function private.tg_members_before_insert();

create function private.tg_members_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects;
begin
  if tg_op = 'DELETE' then
    perform private.log_activity('member.removed', 'project', old.project_id, old.project_id,
      jsonb_build_object('user_id', old.user_id));
    return null;
  end if;
  select * into v_project from public.projects where id = new.project_id;
  perform private.log_activity('member.added', 'project', new.project_id, new.project_id,
    jsonb_build_object('user_id', new.user_id, 'member_role', new.member_role));
  perform private.notify(new.user_id, 'project_assigned', 'You were added to a project',
    format('You have been added to %s (%s).', v_project.name, v_project.code),
    '/dashboard/projects/' || new.project_id, new.project_id, new.project_id);
  return null;
end $$;

create trigger members_after_write after insert or delete on public.project_members
  for each row execute function private.tg_members_after_write();

-- ---------------------------------------------------------------------------
-- Milestones
-- ---------------------------------------------------------------------------

create function private.tg_milestones_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
  else
    new.updated_at := now();
    new.project_id := old.project_id;
  end if;
  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end $$;

create trigger milestones_before_write before insert or update on public.milestones
  for each row execute function private.tg_milestones_before_write();

create function private.tg_milestones_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  if tg_op = 'DELETE' then
    perform private.log_activity('milestone.deleted', 'milestone', old.id, old.project_id,
      jsonb_build_object('title', old.title));
  elsif tg_op = 'INSERT' then
    perform private.log_activity('milestone.created', 'milestone', new.id, new.project_id,
      jsonb_build_object('title', new.title, 'due_date', new.due_date));
  elsif new.status <> old.status then
    perform private.log_activity('milestone.' || new.status::text, 'milestone', new.id, new.project_id,
      jsonb_build_object('title', new.title));
    if new.status = 'completed' then
      select owner_id into v_owner from public.projects where id = new.project_id;
      perform private.notify(v_owner, 'milestone', 'Milestone completed',
        format('Milestone "%s" has been completed.', new.title),
        '/dashboard/projects/' || new.project_id || '?tab=milestones', new.project_id, new.id);
    end if;
  elsif (new.title, new.description, new.due_date) is distinct from (old.title, old.description, old.due_date) then
    perform private.log_activity('milestone.updated', 'milestone', new.id, new.project_id,
      jsonb_build_object('title', new.title));
  end if;
  return null;
end $$;

create trigger milestones_after_write after insert or update or delete on public.milestones
  for each row execute function private.tg_milestones_after_write();

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

create function private.tg_tasks_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_uid, new.created_by);
  else
    new.updated_at := now();
    if new.project_id <> old.project_id then
      raise exception 'A task cannot be moved to another project';
    end if;
    -- Assignees (who are not managing the project) may only move their task through the workflow.
    if v_uid is not null and pg_trigger_depth() = 1 and not private.can_manage_project(old.project_id) then
      if old.assigned_to is distinct from v_uid then
        raise exception 'You are not permitted to update this task';
      end if;
      if (new.title, new.description, new.assigned_to, new.priority, new.due_date, new.milestone_id)
         is distinct from
         (old.title, old.description, old.assigned_to, old.priority, old.due_date, old.milestone_id) then
        raise exception 'Assignees may only update the task status';
      end if;
      if old.status = 'completed' then
        raise exception 'Completed tasks can only be reopened by the project manager';
      end if;
      if new.status = 'completed' then
        raise exception 'Submit the task for review; the project manager marks it completed';
      end if;
    end if;
  end if;

  if new.assigned_to is not null and not private.is_participant(new.project_id, new.assigned_to) then
    raise exception 'The assignee must be the owner, manager or a team member of the project';
  end if;
  if new.milestone_id is not null and not exists (
    select 1 from public.milestones m where m.id = new.milestone_id and m.project_id = new.project_id
  ) then
    raise exception 'The milestone does not belong to this project';
  end if;

  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end $$;

create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function private.tg_tasks_before_write();

create function private.tg_tasks_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
begin
  if tg_op = 'DELETE' then
    v_project := old.project_id;
    perform private.log_activity('task.deleted', 'task', old.id, old.project_id, jsonb_build_object('title', old.title));
  elsif tg_op = 'INSERT' then
    v_project := new.project_id;
    perform private.log_activity('task.created', 'task', new.id, new.project_id,
      jsonb_build_object('title', new.title, 'assigned_to', new.assigned_to));
    perform private.notify(new.assigned_to, 'task_assigned', 'New task assigned',
      format('"%s" has been assigned to you.', new.title), '/dashboard/tasks/' || new.id, new.project_id, new.id);
  else
    v_project := new.project_id;
    if new.assigned_to is distinct from old.assigned_to then
      perform private.log_activity('task.reassigned', 'task', new.id, new.project_id,
        jsonb_build_object('title', new.title, 'assigned_to', new.assigned_to));
      perform private.notify(new.assigned_to, 'task_assigned', 'New task assigned',
        format('"%s" has been assigned to you.', new.title), '/dashboard/tasks/' || new.id, new.project_id, new.id);
    end if;
    if new.status <> old.status then
      perform private.log_activity('task.status_changed', 'task', new.id, new.project_id,
        jsonb_build_object('title', new.title, 'from', old.status, 'to', new.status));
      if new.status = 'under_review' then
        perform private.notify_project_lead(new.project_id, 'task_review', 'Task submitted for review',
          format('"%s" is ready for your review.', new.title), '/dashboard/tasks/' || new.id, new.id);
      elsif new.status = 'completed' then
        perform private.notify(new.assigned_to, 'task_completed', 'Task marked completed',
          format('"%s" was reviewed and marked completed.', new.title), '/dashboard/tasks/' || new.id, new.project_id, new.id);
      elsif old.status in ('under_review', 'completed') then
        perform private.notify(new.assigned_to, 'task_returned', 'Task returned for further work',
          format('"%s" was returned to you.', new.title), '/dashboard/tasks/' || new.id, new.project_id, new.id);
      end if;
    end if;
    if (new.title, new.description, new.priority, new.due_date, new.milestone_id)
       is distinct from (old.title, old.description, old.priority, old.due_date, old.milestone_id) then
      perform private.log_activity('task.updated', 'task', new.id, new.project_id, jsonb_build_object('title', new.title));
    end if;
  end if;

  -- Project progress = completed tasks / all tasks.
  update public.projects p
  set progress_percent = coalesce((
    select round(100.0 * count(*) filter (where t.status = 'completed') / nullif(count(*), 0))
    from public.tasks t where t.project_id = v_project
  ), 0)
  where p.id = v_project;
  return null;
end $$;

create trigger tasks_after_write after insert or update or delete on public.tasks
  for each row execute function private.tg_tasks_after_write();

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create function private.tg_documents_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce((select auth.uid()), new.uploaded_by);
    new.review_status := 'pending';
    new.review_notes := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    if new.monitoring_record_id is not null then
      new.category := 'monitoring_evidence';
      if not exists (
        select 1 from public.monitoring_records r
        where r.id = new.monitoring_record_id and r.project_id = new.project_id
      ) then
        raise exception 'The monitoring record does not belong to this project';
      end if;
    end if;
  else
    if (new.project_id, new.storage_path, new.uploaded_by, new.monitoring_record_id)
       is distinct from (old.project_id, old.storage_path, old.uploaded_by, old.monitoring_record_id) then
      raise exception 'File location and ownership of a document cannot be changed';
    end if;
    if new.review_status <> old.review_status then
      new.reviewed_by := (select auth.uid());
      new.reviewed_at := now();
    end if;
  end if;
  return new;
end $$;

create trigger documents_before_write before insert or update on public.documents
  for each row execute function private.tg_documents_before_write();

create function private.tg_documents_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_link text;
begin
  if tg_op = 'DELETE' then
    perform private.log_activity('document.deleted', 'document', old.id, old.project_id, jsonb_build_object('title', old.title));
    return null;
  end if;
  v_link := '/dashboard/projects/' || new.project_id || '?tab=documents';
  if tg_op = 'INSERT' then
    perform private.log_activity('document.uploaded', 'document', new.id, new.project_id,
      jsonb_build_object('title', new.title, 'category', new.category));
    if new.monitoring_record_id is null then
      perform private.notify_project_lead(new.project_id, 'document_uploaded', 'Document awaiting review',
        format('"%s" was uploaded and needs review.', new.title), v_link, new.id);
    end if;
  elsif new.review_status <> old.review_status and new.monitoring_record_id is null then
    perform private.log_activity('document.reviewed', 'document', new.id, new.project_id,
      jsonb_build_object('title', new.title, 'status', new.review_status));
    perform private.notify(new.uploaded_by, 'document_review', 'Document ' || new.review_status::text,
      format('"%s" was %s.', new.title, new.review_status), v_link, new.project_id, new.id);
  end if;
  return null;
end $$;

create trigger documents_after_write after insert or update or delete on public.documents
  for each row execute function private.tg_documents_after_write();

-- ---------------------------------------------------------------------------
-- Monitoring records
-- ---------------------------------------------------------------------------

create function private.tg_monitoring_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(v_uid, new.recorded_by);
    new.review_status := 'submitted';
    new.review_notes := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;

  new.updated_at := now();
  if (new.project_id, new.recorded_by) is distinct from (old.project_id, old.recorded_by) then
    raise exception 'Project and author of a monitoring record cannot be changed';
  end if;
  if v_uid is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if private.can_manage_project(old.project_id) then
    if new.review_status <> old.review_status then
      if new.review_status = 'revision_required' and coalesce(trim(new.review_notes), '') = '' then
        raise exception 'Review notes are required when requesting a correction';
      end if;
      new.reviewed_by := v_uid;
      new.reviewed_at := now();
    end if;
  elsif old.recorded_by = v_uid and old.review_status <> 'approved' then
    -- The author corrects the record; it goes back into the review queue.
    new.review_status := 'submitted';
    new.review_notes := old.review_notes;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  else
    raise exception 'You are not permitted to modify this monitoring record';
  end if;
  return new;
end $$;

create trigger monitoring_before_write before insert or update on public.monitoring_records
  for each row execute function private.tg_monitoring_before_write();

create function private.tg_monitoring_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_link text := '/dashboard/monitoring/' || new.id;
  v_label text := replace(new.observation_type, '_', ' ');
  v_owner uuid;
begin
  if tg_op = 'INSERT' then
    perform private.log_activity('monitoring.submitted', 'monitoring_record', new.id, new.project_id,
      jsonb_build_object('observation_type', new.observation_type, 'observation_date', new.observation_date));
    perform private.notify_project_lead(new.project_id, 'monitoring_submitted', 'Field report submitted',
      format('A %s report dated %s is awaiting review.', v_label, to_char(new.observation_date, 'DD Mon YYYY')), v_link, new.id);
    return null;
  end if;

  if new.review_status <> old.review_status then
    perform private.log_activity('monitoring.' || new.review_status::text, 'monitoring_record', new.id, new.project_id,
      jsonb_build_object('observation_type', new.observation_type));
    if new.review_status = 'submitted' then
      perform private.notify_project_lead(new.project_id, 'monitoring_submitted', 'Field report resubmitted',
        format('A corrected %s report is awaiting review.', v_label), v_link, new.id);
    else
      perform private.notify(new.recorded_by, 'monitoring_review',
        case when new.review_status = 'approved' then 'Field report approved' else 'Field report needs correction' end,
        format('Your %s report dated %s was reviewed.', v_label, to_char(new.observation_date, 'DD Mon YYYY')),
        v_link, new.project_id, new.id);
    end if;
    if new.review_status = 'approved' then
      update public.documents set review_status = 'approved' where monitoring_record_id = new.id;
      select owner_id into v_owner from public.projects where id = new.project_id;
      perform private.notify(v_owner, 'monitoring_update', 'New monitoring update',
        format('A reviewed %s report is available for your project.', v_label), v_link, new.project_id, new.id);
    end if;
  end if;
  return null;
end $$;

create trigger monitoring_after_write after insert or update on public.monitoring_records
  for each row execute function private.tg_monitoring_after_write();

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

create function private.tg_comments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.author_id := coalesce((select auth.uid()), new.author_id);
  new.created_at := now();
  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.project_id = new.project_id
  ) then
    raise exception 'The task does not belong to this project';
  end if;
  return new;
end $$;

create trigger comments_before_insert before insert on public.project_comments
  for each row execute function private.tg_comments_before_insert();

create function private.tg_comments_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects;
  v_task public.tasks;
begin
  select * into v_project from public.projects where id = new.project_id;
  if new.task_id is not null then
    select * into v_task from public.tasks where id = new.task_id;
    perform private.log_activity('task.commented', 'task', new.task_id, new.project_id, jsonb_build_object('title', v_task.title));
    perform private.notify(v_task.assigned_to, 'comment', 'New comment on your task',
      format('A comment was added to "%s".', v_task.title), '/dashboard/tasks/' || new.task_id, new.project_id, new.task_id);
    perform private.notify(v_project.manager_id, 'comment', 'New task comment',
      format('A comment was added to "%s".', v_task.title), '/dashboard/tasks/' || new.task_id, new.project_id, new.task_id);
  else
    perform private.log_activity('project.commented', 'project', new.project_id, new.project_id, '{}'::jsonb);
    perform private.notify(v_project.owner_id, 'comment', 'New project comment',
      format('A comment was posted on %s.', v_project.name), '/dashboard/projects/' || new.project_id, new.project_id, new.project_id);
    perform private.notify(v_project.manager_id, 'comment', 'New project comment',
      format('A comment was posted on %s.', v_project.name), '/dashboard/projects/' || new.project_id, new.project_id, new.project_id);
  end if;
  return null;
end $$;

create trigger comments_after_insert after insert on public.project_comments
  for each row execute function private.tg_comments_after_insert();

-- ---------------------------------------------------------------------------
-- Configuration audit
-- ---------------------------------------------------------------------------

create function private.tg_settings_before_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  perform private.log_activity('settings.updated', 'settings', null, null, '{}'::jsonb);
  return new;
end $$;

create trigger settings_before_update before update on public.system_settings
  for each row execute function private.tg_settings_before_update();

create function private.tg_categories_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.log_activity(case tg_op when 'INSERT' then 'category.created' else 'category.updated' end, 'category', new.id, null,
    jsonb_build_object('name', new.name, 'is_active', new.is_active));
  return null;
end $$;

create trigger categories_after_write after insert or update on public.project_categories
  for each row execute function private.tg_categories_after_write();

-- ---------------------------------------------------------------------------
-- Deadline reminders (scheduled daily by pg_cron in a later migration)
-- ---------------------------------------------------------------------------

create function private.send_deadline_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  insert into public.notifications (user_id, type, title, body, link, project_id, entity_id)
  select t.assigned_to, 'deadline',
         case when t.due_date < current_date then 'Task overdue' else 'Task due soon' end,
         format('"%s" is due on %s.', t.title, to_char(t.due_date, 'DD Mon YYYY')),
         '/dashboard/tasks/' || t.id, t.project_id, t.id
  from public.tasks t
  where t.assigned_to is not null
    and t.status <> 'completed'
    and t.due_date between current_date - 7 and current_date + 2
    and not exists (
      select 1 from public.notifications n
      where n.entity_id = t.id and n.type = 'deadline' and n.created_at >= current_date
    );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Only the RLS helpers are callable by signed-in users; everything else runs from triggers.
revoke execute on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function
  private.user_role(), private.is_admin(), private.is_project_member(uuid), private.is_participant(uuid, uuid),
  private.can_view_project(uuid), private.can_manage_project(uuid), private.shares_project_with(uuid)
to authenticated;
