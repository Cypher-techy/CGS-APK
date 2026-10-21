-- CGS Project Portal: Row Level Security, grants and private file storage.
-- Principle of least privilege: anonymous visitors can only send a contact message;
-- signed-in users see only their own records and the projects they take part in.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant insert on public.contact_messages to anon;

alter table public.profiles enable row level security;
alter table public.system_settings enable row level security;
alter table public.project_categories enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.milestones enable row level security;
alter table public.tasks enable row level security;
alter table public.monitoring_records enable row level security;
alter table public.documents enable row level security;
alter table public.notifications enable row level security;
alter table public.project_comments enable row level security;
alter table public.approvals enable row level security;
alter table public.activity_logs enable row level security;
alter table public.contact_messages enable row level security;

-- profiles ------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or private.is_admin()
  or private.user_role() = 'project_manager'
  or private.shares_project_with(id)
);
-- Role / status changes are additionally restricted to administrators by trigger.
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or private.is_admin())
  with check (id = (select auth.uid()) or private.is_admin());

-- configuration -------------------------------------------------------------
create policy settings_select on public.system_settings for select to authenticated using (true);
create policy settings_update on public.system_settings for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy categories_select on public.project_categories for select to authenticated using (true);
create policy categories_insert on public.project_categories for insert to authenticated with check (private.is_admin());
create policy categories_update on public.project_categories for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- projects ------------------------------------------------------------------
-- Written against the row's own columns (not can_view_project) so that INSERT ... RETURNING works.
create policy projects_select on public.projects for select to authenticated using (
  private.is_admin() or (
    private.user_role() is not null
    and (owner_id = (select auth.uid()) or manager_id = (select auth.uid()) or private.is_project_member(id))
  )
);
create policy projects_insert on public.projects for insert to authenticated with check (
  private.is_admin() or (private.user_role() = 'project_owner' and owner_id = (select auth.uid()))
);
-- Which columns and status transitions each party may change is enforced by trigger.
create policy projects_update on public.projects for update to authenticated
  using (
    private.is_admin()
    or (private.user_role() = 'project_manager' and manager_id = (select auth.uid()))
    or (private.user_role() = 'project_owner' and owner_id = (select auth.uid()) and status in ('draft', 'revision_required'))
  )
  with check (
    private.is_admin() or manager_id = (select auth.uid()) or owner_id = (select auth.uid())
  );
create policy projects_delete on public.projects for delete to authenticated using (
  private.is_admin() or (private.user_role() = 'project_owner' and owner_id = (select auth.uid()) and status = 'draft')
);

-- project members -----------------------------------------------------------
create policy members_select on public.project_members for select to authenticated
  using (private.can_view_project(project_id));
create policy members_insert on public.project_members for insert to authenticated
  with check (private.can_manage_project(project_id));
create policy members_delete on public.project_members for delete to authenticated
  using (private.can_manage_project(project_id));

-- milestones ----------------------------------------------------------------
create policy milestones_select on public.milestones for select to authenticated
  using (private.can_view_project(project_id));
create policy milestones_insert on public.milestones for insert to authenticated
  with check (private.can_manage_project(project_id));
create policy milestones_update on public.milestones for update to authenticated
  using (private.can_manage_project(project_id)) with check (private.can_manage_project(project_id));
create policy milestones_delete on public.milestones for delete to authenticated
  using (private.can_manage_project(project_id));

-- tasks ---------------------------------------------------------------------
create policy tasks_select on public.tasks for select to authenticated
  using (private.can_view_project(project_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (private.can_manage_project(project_id));
-- Assignees may update their own task; the trigger limits them to status changes.
create policy tasks_update on public.tasks for update to authenticated
  using (private.can_manage_project(project_id) or (assigned_to = (select auth.uid()) and private.can_view_project(project_id)))
  with check (private.can_manage_project(project_id) or (assigned_to = (select auth.uid()) and private.can_view_project(project_id)));
create policy tasks_delete on public.tasks for delete to authenticated
  using (private.can_manage_project(project_id));

-- monitoring records --------------------------------------------------------
-- Owners and other participants only see records once they have been reviewed and approved.
create policy monitoring_select on public.monitoring_records for select to authenticated using (
  private.can_manage_project(project_id)
  or recorded_by = (select auth.uid())
  or (review_status = 'approved' and private.can_view_project(project_id))
);
create policy monitoring_insert on public.monitoring_records for insert to authenticated with check (
  recorded_by = (select auth.uid())
  and private.user_role() in ('field_officer', 'project_manager', 'super_admin')
  and private.can_view_project(project_id)
);
create policy monitoring_update on public.monitoring_records for update to authenticated
  using (
    private.can_manage_project(project_id)
    or (recorded_by = (select auth.uid()) and review_status <> 'approved' and private.can_view_project(project_id))
  )
  with check (private.can_manage_project(project_id) or recorded_by = (select auth.uid()));
create policy monitoring_delete on public.monitoring_records for delete to authenticated
  using (private.can_manage_project(project_id));

-- documents -----------------------------------------------------------------
-- Evidence attached to a monitoring record follows the visibility of that record.
create policy documents_select on public.documents for select to authenticated using (
  private.can_manage_project(project_id)
  or uploaded_by = (select auth.uid())
  or (
    private.can_view_project(project_id)
    and (
      monitoring_record_id is null
      or exists (select 1 from public.monitoring_records r where r.id = monitoring_record_id)
    )
  )
);
create policy documents_insert on public.documents for insert to authenticated with check (
  uploaded_by = (select auth.uid()) and private.can_view_project(project_id)
);
create policy documents_update on public.documents for update to authenticated
  using (private.can_manage_project(project_id)) with check (private.can_manage_project(project_id));
create policy documents_delete on public.documents for delete to authenticated using (
  private.can_manage_project(project_id)
  or (uploaded_by = (select auth.uid()) and review_status = 'pending')
);

-- notifications (rows are created by triggers only) --------------------------
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- comments ------------------------------------------------------------------
create policy comments_select on public.project_comments for select to authenticated
  using (private.can_view_project(project_id));
create policy comments_insert on public.project_comments for insert to authenticated
  with check (author_id = (select auth.uid()) and private.can_view_project(project_id));
create policy comments_delete on public.project_comments for delete to authenticated
  using (author_id = (select auth.uid()) or private.can_manage_project(project_id));

-- approvals -----------------------------------------------------------------
create policy approvals_select on public.approvals for select to authenticated
  using (private.can_view_project(project_id));
create policy approvals_insert on public.approvals for insert to authenticated
  with check (private.is_admin());

-- activity logs (append-only; written by triggers) ---------------------------
create policy activity_select on public.activity_logs for select to authenticated using (
  private.is_admin()
  or (project_id is not null and private.can_manage_project(project_id))
  or (project_id is not null and entity_type in ('project', 'milestone', 'task') and private.can_view_project(project_id))
);

-- contact form ---------------------------------------------------------------
create policy contact_insert on public.contact_messages for insert to anon, authenticated with check (true);
create policy contact_select on public.contact_messages for select to authenticated using (private.is_admin());

-- ---------------------------------------------------------------------------
-- Storage: one private bucket, objects stored as <project_id>/<random>-<file name>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files', 'project-files', false, 10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg', 'image/png', 'image/webp',
    'application/geo+json', 'application/vnd.google-earth.kml+xml', 'application/zip', 'text/csv'
  ]
);

-- Project id encoded in the first folder of an object path (null when malformed).
create function private.path_project(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case
    when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;
revoke execute on function private.path_project(text) from public, anon;
grant execute on function private.path_project(text) to authenticated;

-- A file can be read only through a documents row the user is allowed to see.
create policy project_files_select on storage.objects for select to authenticated using (
  bucket_id = 'project-files'
  and exists (select 1 from public.documents d where d.storage_path = objects.name)
);
create policy project_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'project-files' and private.can_view_project(private.path_project(name))
);
create policy project_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'project-files'
  and (owner_id = (select auth.uid())::text or private.can_manage_project(private.path_project(name)))
);
