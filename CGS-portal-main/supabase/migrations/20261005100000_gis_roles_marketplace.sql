-- CGS Project Portal, phase 7/8: PostGIS boundaries, MRV records, community engagement and the
-- carbon project marketplace (discovery and enquiries only: no trading, pricing or payments).

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Team roles for the additional user categories
-- ---------------------------------------------------------------------------
alter table public.project_members
  drop constraint project_members_member_role_check,
  add constraint project_members_member_role_check check (
    member_role in ('field_officer', 'team_member', 'observer', 'gis_analyst', 'mrv_specialist', 'community_member')
  );

create function private.has_member_role(p_project uuid, p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_role() is not null and exists (
    select 1 from public.project_members m
    where m.project_id = p_project and m.user_id = (select auth.uid()) and m.member_role = p_role
  )
$$;

-- Owner, manager, administrators and working team members. Community members and observers are
-- participants but not staff: they do not see tasks, internal documents or discussion.
create function private.is_project_staff(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_role() is not null and (
    private.is_admin()
    or exists (select 1 from public.projects p where p.id = p_project and (p.owner_id = (select auth.uid()) or p.manager_id = (select auth.uid())))
    or exists (
      select 1 from public.project_members m
      where m.project_id = p_project and m.user_id = (select auth.uid())
        and m.member_role in ('field_officer', 'team_member', 'gis_analyst', 'mrv_specialist')
    )
  )
$$;

create function private.is_project_owner(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_role() is not null
    and exists (select 1 from public.projects p where p.id = p_project and p.owner_id = (select auth.uid()))
$$;

-- Profiles of co-participants: staff see the whole team; community members and observers
-- only see the project owner and manager.
create or replace function private.shares_project_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_role() is not null and exists (
    select 1 from public.projects p
    where private.is_participant(p.id, (select auth.uid()))
      and private.is_participant(p.id, p_user)
      and (private.is_project_staff(p.id) or p.owner_id = p_user or p.manager_id = p_user)
  )
$$;

create function private.notify_participants(
  p_project uuid, p_type text, p_title text, p_body text, p_link text, p_entity uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(u.id, p_type, p_title, p_body, p_link, p_project, p_entity)
  from (
    select owner_id as id from public.projects where id = p_project
    union select manager_id from public.projects where id = p_project
    union select user_id from public.project_members where project_id = p_project
  ) u;
end $$;

-- Registration may now also request the investor and community member roles (still pending approval).
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role public.user_role := 'project_owner';
  v_status public.account_status := 'pending';
  v_name text := left(trim(coalesce(v_meta ->> 'full_name', '')), 120);
  v_require boolean;
begin
  if v_meta ->> 'requested_role' in ('project_owner', 'project_manager', 'field_officer', 'investor', 'community_member') then
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
  perform private.notify_admins('account', 'New account registration',
    format('%s registered as %s.', v_name, replace(v_role::text, '_', ' ')), '/dashboard/admin/users', null, new.id);
  return new;
end $$;

-- Narrow existing policies so that community members and observers only reach what is meant for them.
alter policy tasks_select on public.tasks using (private.is_project_staff(project_id));
alter policy comments_select on public.project_comments using (private.is_project_staff(project_id));
alter policy comments_insert on public.project_comments
  with check (author_id = (select auth.uid()) and private.is_project_staff(project_id));
alter policy documents_insert on public.documents
  with check (uploaded_by = (select auth.uid()) and private.is_project_staff(project_id));
alter policy documents_select on public.documents using (
  private.can_manage_project(project_id)
  or uploaded_by = (select auth.uid())
  or (
    private.is_project_staff(project_id)
    and (monitoring_record_id is null or exists (select 1 from public.monitoring_records r where r.id = monitoring_record_id))
  )
  -- Community members and observers: approved reports only.
  or (category = 'report' and review_status = 'approved' and private.can_view_project(project_id))
);
alter policy activity_select on public.activity_logs using (
  private.is_admin()
  or (project_id is not null and private.can_manage_project(project_id))
  or (project_id is not null and entity_type in ('project', 'milestone', 'task') and private.is_project_staff(project_id))
);
-- MRV specialists see every monitoring record of their projects, including unreviewed ones.
alter policy monitoring_select on public.monitoring_records using (
  private.can_manage_project(project_id)
  or recorded_by = (select auth.uid())
  or private.has_member_role(project_id, 'mrv_specialist')
  or (review_status = 'approved' and private.can_view_project(project_id))
);
alter policy project_files_insert on storage.objects
  with check (bucket_id = 'project-files' and private.is_project_staff(private.path_project(name)));

-- ---------------------------------------------------------------------------
-- GIS: project boundaries (PostGIS)
-- ---------------------------------------------------------------------------
create table public.project_boundaries (
  project_id uuid primary key references public.projects (id) on delete cascade,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  -- Geodesic area of the boundary in hectares, maintained by trigger.
  area_ha numeric(14, 2) not null default 0,
  source text check (source is null or char_length(source) <= 200),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index project_boundaries_geom_idx on public.project_boundaries using gist (geom);
create index project_boundaries_updated_by_idx on public.project_boundaries (updated_by);
alter table public.project_boundaries enable row level security;

create function private.tg_boundaries_before_write() returns trigger
language plpgsql security definer set search_path = extensions as $$
begin
  new.area_ha := round((st_area(new.geom::geography) / 10000.0)::numeric, 2);
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
create trigger boundaries_before_write before insert or update on public.project_boundaries
  for each row execute function private.tg_boundaries_before_write();

create function private.tg_boundaries_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.log_activity('boundary.removed', 'project', old.project_id, old.project_id, '{}'::jsonb);
  else
    perform private.log_activity('boundary.saved', 'project', new.project_id, new.project_id,
      jsonb_build_object('area_ha', new.area_ha, 'source', new.source));
  end if;
  return null;
end $$;
create trigger boundaries_after_write after insert or update or delete on public.project_boundaries
  for each row execute function private.tg_boundaries_after_write();

create policy boundaries_select on public.project_boundaries for select to authenticated
  using (private.can_view_project(project_id));
create policy boundaries_insert on public.project_boundaries for insert to authenticated
  with check (private.can_manage_project(project_id) or private.has_member_role(project_id, 'gis_analyst'));
create policy boundaries_update on public.project_boundaries for update to authenticated
  using (private.can_manage_project(project_id) or private.has_member_role(project_id, 'gis_analyst'))
  with check (private.can_manage_project(project_id) or private.has_member_role(project_id, 'gis_analyst'));
create policy boundaries_delete on public.project_boundaries for delete to authenticated
  using (private.can_manage_project(project_id) or private.has_member_role(project_id, 'gis_analyst'));

-- Stores a boundary from GeoJSON (Geometry, Feature or FeatureCollection). Runs as the caller, so RLS applies.
create function public.save_project_boundary(p_project uuid, p_geojson jsonb, p_source text default null)
returns numeric
language plpgsql security invoker set search_path = extensions as $$
declare
  v_geom geometry;
  v_area numeric;
begin
  if pg_column_size(p_geojson) > 2000000 then
    raise exception 'The GeoJSON is too large (limit 2 MB)';
  end if;
  begin
    if p_geojson ->> 'type' = 'FeatureCollection' then
      select st_collect(st_geomfromgeojson((f -> 'geometry')::text)) into v_geom
      from jsonb_array_elements(p_geojson -> 'features') f
      where jsonb_typeof(f -> 'geometry') = 'object';
    elsif p_geojson ->> 'type' = 'Feature' then
      v_geom := st_geomfromgeojson((p_geojson -> 'geometry')::text);
    else
      v_geom := st_geomfromgeojson(p_geojson::text);
    end if;
  exception when others then
    raise exception 'The file does not contain valid GeoJSON geometry';
  end;
  if v_geom is null then
    raise exception 'No geometry was found in the GeoJSON';
  end if;
  if st_npoints(v_geom) > 20000 then
    raise exception 'The boundary has too many points (limit 20,000). Simplify it and try again';
  end if;
  v_geom := st_multi(st_collectionextract(st_makevalid(st_setsrid(st_force2d(v_geom), 4326)), 3));
  if st_isempty(v_geom) then
    raise exception 'The GeoJSON must contain at least one polygon';
  end if;
  if st_xmin(v_geom) < -180 or st_xmax(v_geom) > 180 or st_ymin(v_geom) < -90 or st_ymax(v_geom) > 90 then
    raise exception 'Coordinates must be longitude and latitude in WGS 84 (EPSG:4326)';
  end if;

  insert into public.project_boundaries (project_id, geom, source)
  values (p_project, v_geom, nullif(left(trim(coalesce(p_source, '')), 200), ''))
  on conflict (project_id) do update set geom = excluded.geom, source = excluded.source
  returning area_ha into v_area;
  return v_area;
end $$;

-- GeoJSON FeatureCollection of everything the caller may see: boundaries, project locations and
-- georeferenced monitoring observations. Runs as the caller, so RLS applies.
create function public.gis_features(p_project uuid default null) returns jsonb
language sql stable security invoker set search_path = extensions as $$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(s.feature), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'type', 'Feature', 'geometry', st_asgeojson(b.geom, 6)::jsonb,
      'properties', jsonb_build_object('kind', 'boundary', 'project_id', p.id, 'code', p.code, 'name', p.name,
                                       'status', p.status, 'area_ha', b.area_ha, 'source', b.source)) as feature
    from public.project_boundaries b join public.projects p on p.id = b.project_id
    where p_project is null or p.id = p_project
    union all
    select jsonb_build_object(
      'type', 'Feature',
      'geometry', jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(p.longitude, p.latitude)),
      'properties', jsonb_build_object('kind', 'project', 'project_id', p.id, 'code', p.code, 'name', p.name,
                                       'status', p.status, 'county', p.county, 'declared_area_ha', p.area_ha))
    from public.projects p
    where p.latitude is not null and p.longitude is not null and (p_project is null or p.id = p_project)
    union all
    select jsonb_build_object(
      'type', 'Feature',
      'geometry', jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(r.longitude, r.latitude)),
      'properties', jsonb_build_object('kind', 'observation', 'record_id', r.id, 'project_id', r.project_id, 'code', p.code,
                                       'observation_type', r.observation_type, 'observation_date', r.observation_date,
                                       'value_basis', r.value_basis, 'review_status', r.review_status))
    from public.monitoring_records r join public.projects p on p.id = r.project_id
    where r.latitude is not null and r.longitude is not null and (p_project is null or r.project_id = p_project)
  ) s
$$;

-- ---------------------------------------------------------------------------
-- MRV: carbon estimates and monitoring schedules
-- ---------------------------------------------------------------------------
-- Every row is an estimate. Nothing in this table is a verified emission reduction or an issued credit.
create table public.carbon_estimates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('baseline', 'potential', 'monitoring_period')),
  period_start date,
  period_end date,
  estimated_tco2e numeric(14, 2) not null check (estimated_tco2e >= 0),
  methodology text not null check (char_length(methodology) between 10 and 2000),
  assumptions text check (assumptions is null or char_length(assumptions) <= 4000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end >= period_start)
);
create index carbon_estimates_project_idx on public.carbon_estimates (project_id, created_at desc);
create index carbon_estimates_creator_idx on public.carbon_estimates (created_by);
alter table public.carbon_estimates enable row level security;

create table public.monitoring_schedules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  observation_type text not null check (observation_type in (
    'tree_planting', 'tree_survival', 'vegetation', 'biodiversity', 'soil', 'water_quality', 'land_use', 'general'
  )),
  frequency text not null check (frequency in ('once', 'weekly', 'monthly', 'quarterly', 'biannual', 'annual')),
  next_due date not null,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index monitoring_schedules_project_idx on public.monitoring_schedules (project_id, next_due);
create index monitoring_schedules_creator_idx on public.monitoring_schedules (created_by);
alter table public.monitoring_schedules enable row level security;

create function private.tg_mrv_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := now();
  return new;
end $$;
create trigger carbon_estimates_before_insert before insert on public.carbon_estimates
  for each row execute function private.tg_mrv_before_insert();
create trigger monitoring_schedules_before_insert before insert on public.monitoring_schedules
  for each row execute function private.tg_mrv_before_insert();

create function private.tg_carbon_estimates_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.log_activity('carbon_estimate.deleted', 'carbon_estimate', old.id, old.project_id,
      jsonb_build_object('kind', old.kind, 'estimated_tco2e', old.estimated_tco2e));
  else
    perform private.log_activity('carbon_estimate.recorded', 'carbon_estimate', new.id, new.project_id,
      jsonb_build_object('kind', new.kind, 'estimated_tco2e', new.estimated_tco2e));
  end if;
  return null;
end $$;
create trigger carbon_estimates_after_write after insert or delete on public.carbon_estimates
  for each row execute function private.tg_carbon_estimates_after_write();

create policy carbon_estimates_select on public.carbon_estimates for select to authenticated
  using (private.is_project_staff(project_id));
create policy carbon_estimates_insert on public.carbon_estimates for insert to authenticated
  with check (private.can_manage_project(project_id) or private.has_member_role(project_id, 'mrv_specialist'));
create policy carbon_estimates_delete on public.carbon_estimates for delete to authenticated
  using (private.can_manage_project(project_id) or private.has_member_role(project_id, 'mrv_specialist'));

create policy schedules_select on public.monitoring_schedules for select to authenticated
  using (private.is_project_staff(project_id));
create policy schedules_insert on public.monitoring_schedules for insert to authenticated
  with check (private.can_manage_project(project_id) or private.has_member_role(project_id, 'mrv_specialist'));
create policy schedules_update on public.monitoring_schedules for update to authenticated
  using (private.can_manage_project(project_id) or private.has_member_role(project_id, 'mrv_specialist'))
  with check (private.can_manage_project(project_id) or private.has_member_role(project_id, 'mrv_specialist'));
create policy schedules_delete on public.monitoring_schedules for delete to authenticated
  using (private.can_manage_project(project_id) or private.has_member_role(project_id, 'mrv_specialist'));

-- ---------------------------------------------------------------------------
-- Community engagement: announcements, meetings, feedback and grievances
-- ---------------------------------------------------------------------------
create table public.project_announcements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 160),
  body text not null check (char_length(body) between 5 and 4000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index project_announcements_project_idx on public.project_announcements (project_id, created_at desc);
create index project_announcements_creator_idx on public.project_announcements (created_by);
alter table public.project_announcements enable row level security;

create table public.project_meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 160),
  scheduled_at timestamptz not null,
  location text check (location is null or char_length(location) <= 300),
  agenda text check (agenda is null or char_length(agenda) <= 4000),
  minutes text check (minutes is null or char_length(minutes) <= 8000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index project_meetings_project_idx on public.project_meetings (project_id, scheduled_at);
create index project_meetings_creator_idx on public.project_meetings (created_by);
alter table public.project_meetings enable row level security;

create table public.grievances (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  submitted_by uuid references public.profiles (id) on delete set null,
  kind text not null default 'feedback' check (kind in ('feedback', 'grievance')),
  subject text not null check (char_length(subject) between 3 and 160),
  description text not null check (char_length(description) between 10 and 4000),
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved', 'closed')),
  response text check (response is null or char_length(response) <= 4000),
  handled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index grievances_project_idx on public.grievances (project_id, created_at desc);
create index grievances_submitter_idx on public.grievances (submitted_by);
create index grievances_handler_idx on public.grievances (handled_by);
alter table public.grievances enable row level security;

create function private.tg_engagement_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_link text := '/dashboard/projects/' || new.project_id || '?tab=community';
begin
  if tg_table_name = 'project_announcements' then
    perform private.log_activity('announcement.posted', 'project', new.project_id, new.project_id, jsonb_build_object('title', new.title));
    perform private.notify_participants(new.project_id, 'announcement', 'Project announcement', new.title, v_link, new.id);
  else
    perform private.log_activity('meeting.scheduled', 'project', new.project_id, new.project_id, jsonb_build_object('title', new.title));
    perform private.notify_participants(new.project_id, 'meeting', 'Meeting scheduled',
      format('%s on %s.', new.title, to_char(new.scheduled_at at time zone 'Africa/Nairobi', 'DD Mon YYYY HH24:MI')), v_link, new.id);
  end if;
  return null;
end $$;
create trigger announcements_after_insert after insert on public.project_announcements
  for each row execute function private.tg_engagement_after_insert();
create trigger meetings_after_insert after insert on public.project_meetings
  for each row execute function private.tg_engagement_after_insert();

create function private.tg_engagement_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := coalesce((select auth.uid()), new.created_by);
  new.created_at := now();
  return new;
end $$;
create trigger announcements_before_insert before insert on public.project_announcements
  for each row execute function private.tg_engagement_before_insert();
create trigger meetings_before_insert before insert on public.project_meetings
  for each row execute function private.tg_engagement_before_insert();

create function private.tg_grievances_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.submitted_by := coalesce((select auth.uid()), new.submitted_by);
    new.status := 'open';
    new.response := null;
    new.handled_by := null;
  else
    if (new.project_id, new.submitted_by, new.kind, new.subject, new.description)
       is distinct from (old.project_id, old.submitted_by, old.kind, old.subject, old.description) then
      raise exception 'The submitted text of a feedback or grievance record cannot be changed';
    end if;
    new.updated_at := now();
    new.handled_by := coalesce((select auth.uid()), new.handled_by);
  end if;
  return new;
end $$;
create trigger grievances_before_write before insert or update on public.grievances
  for each row execute function private.tg_grievances_before_write();

create function private.tg_grievances_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_link text := '/dashboard/projects/' || new.project_id || '?tab=community';
begin
  if tg_op = 'INSERT' then
    perform private.log_activity('grievance.submitted', 'grievance', new.id, new.project_id, jsonb_build_object('title', new.subject, 'kind', new.kind));
    perform private.notify_project_lead(new.project_id, 'grievance', initcap(new.kind) || ' submitted', new.subject, v_link, new.id);
  elsif new.status <> old.status or new.response is distinct from old.response then
    perform private.log_activity('grievance.updated', 'grievance', new.id, new.project_id,
      jsonb_build_object('title', new.subject, 'from', old.status, 'to', new.status));
    perform private.notify(new.submitted_by, 'grievance', 'Your ' || new.kind || ' was updated',
      format('"%s" is now: %s.', new.subject, replace(new.status, '_', ' ')), '/dashboard/community', new.project_id, new.id);
  end if;
  return null;
end $$;
create trigger grievances_after_write after insert or update on public.grievances
  for each row execute function private.tg_grievances_after_write();

create policy announcements_select on public.project_announcements for select to authenticated
  using (private.can_view_project(project_id));
create policy announcements_insert on public.project_announcements for insert to authenticated
  with check (private.can_manage_project(project_id));
create policy announcements_delete on public.project_announcements for delete to authenticated
  using (private.can_manage_project(project_id));

create policy meetings_select on public.project_meetings for select to authenticated
  using (private.can_view_project(project_id));
create policy meetings_insert on public.project_meetings for insert to authenticated
  with check (private.can_manage_project(project_id));
create policy meetings_update on public.project_meetings for update to authenticated
  using (private.can_manage_project(project_id)) with check (private.can_manage_project(project_id));
create policy meetings_delete on public.project_meetings for delete to authenticated
  using (private.can_manage_project(project_id));

-- A grievance is visible to the person who raised it and to those who handle it.
create policy grievances_select on public.grievances for select to authenticated
  using (submitted_by = (select auth.uid()) or private.can_manage_project(project_id));
create policy grievances_insert on public.grievances for insert to authenticated
  with check (submitted_by = (select auth.uid()) and private.can_view_project(project_id));
create policy grievances_update on public.grievances for update to authenticated
  using (private.can_manage_project(project_id)) with check (private.can_manage_project(project_id));

-- ---------------------------------------------------------------------------
-- Marketplace: listings, saved projects, expressions of interest
-- ---------------------------------------------------------------------------
create table public.marketplace_listings (
  project_id uuid primary key references public.projects (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'published', 'withdrawn')),
  summary text not null check (char_length(summary) between 20 and 2000),
  eligibility_notes text check (eligibility_notes is null or char_length(eligibility_notes) <= 2000),
  development_stage text not null default 'proposed'
    check (development_stage in ('proposed', 'under_assessment', 'validated', 'under_monitoring', 'verified', 'issued')),
  standard text check (standard is null or char_length(standard) <= 120),
  stage_evidence_document_id uuid references public.documents (id) on delete restrict,
  published_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- A project may only be shown as validated, verified or issued with a named standard and supporting evidence.
  constraint listing_stage_requires_evidence check (
    development_stage not in ('validated', 'verified', 'issued')
    or (standard is not null and stage_evidence_document_id is not null)
  )
);
create index marketplace_listings_status_idx on public.marketplace_listings (status);
create index marketplace_listings_evidence_idx on public.marketplace_listings (stage_evidence_document_id);
create index marketplace_listings_updated_by_idx on public.marketplace_listings (updated_by);
alter table public.marketplace_listings enable row level security;

create function private.is_listed(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.marketplace_listings l where l.project_id = p_project and l.status = 'published')
$$;

create function private.tg_listings_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean := private.is_admin();
  v_mrv boolean := private.has_member_role(new.project_id, 'mrv_specialist');
begin
  new.updated_by := coalesce(v_uid, new.updated_by);
  new.updated_at := now();
  if not exists (select 1 from public.projects p where p.id = new.project_id and p.status in ('approved', 'active', 'on_hold', 'completed')) then
    raise exception 'Only approved projects can be listed on the marketplace';
  end if;
  if new.stage_evidence_document_id is not null and not exists (
    select 1 from public.documents d where d.id = new.stage_evidence_document_id and d.project_id = new.project_id and d.review_status = 'approved'
  ) then
    raise exception 'Stage evidence must be an approved document of this project';
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    if v_uid is not null and not v_admin then
      new.development_stage := 'proposed';
      new.standard := null;
      new.stage_evidence_document_id := null;
      if new.status not in ('draft', 'pending_review') then new.status := 'draft'; end if;
    end if;
  elsif v_uid is not null then
    if new.project_id <> old.project_id then
      raise exception 'A listing cannot be moved to another project';
    end if;
    if (new.development_stage, new.standard, new.stage_evidence_document_id)
       is distinct from (old.development_stage, old.standard, old.stage_evidence_document_id)
       and not (v_admin or v_mrv) then
      raise exception 'Only an administrator or the project''s MRV specialist can change the development stage';
    end if;
    if new.status <> old.status and not v_admin then
      if new.status = 'published' then
        raise exception 'Listings are published by a CGS administrator after review';
      end if;
      if v_mrv and not private.is_project_owner(new.project_id) and not private.can_manage_project(new.project_id) then
        raise exception 'Only the project owner or manager can submit or withdraw a listing';
      end if;
    end if;
    -- Edits by the owner to a published listing go back through review.
    if not v_admin and not v_mrv and old.status = 'published' and new.status = 'published'
       and (new.summary, new.eligibility_notes) is distinct from (old.summary, old.eligibility_notes) then
      new.status := 'pending_review';
    end if;
  end if;
  new.published_at := case when new.status = 'published' then coalesce(new.published_at, now()) end;
  return new;
end $$;
create trigger listings_before_write before insert or update on public.marketplace_listings
  for each row execute function private.tg_listings_before_write();

create function private.tg_listings_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects;
  v_link text := '/dashboard/projects/' || new.project_id || '?tab=marketplace';
begin
  select * into v_project from public.projects where id = new.project_id;
  if tg_op = 'INSERT' or new.status <> old.status then
    perform private.log_activity('listing.' || new.status, 'listing', new.project_id, new.project_id, jsonb_build_object('name', v_project.name));
    if new.status = 'pending_review' then
      perform private.notify_admins('listing', 'Marketplace listing awaiting review',
        format('%s (%s) was submitted for listing.', v_project.name, v_project.code), v_link, new.project_id, new.project_id);
    elsif tg_op = 'UPDATE' then
      perform private.notify(v_project.owner_id, 'listing', 'Marketplace listing updated',
        format('The listing of %s is now: %s.', v_project.name, replace(new.status, '_', ' ')), v_link, new.project_id, new.project_id);
    end if;
  end if;
  if tg_op = 'UPDATE' and new.development_stage <> old.development_stage then
    perform private.log_activity('listing.stage_changed', 'listing', new.project_id, new.project_id,
      jsonb_build_object('from', old.development_stage, 'to', new.development_stage, 'standard', new.standard));
  end if;
  return null;
end $$;
create trigger listings_after_write after insert or update on public.marketplace_listings
  for each row execute function private.tg_listings_after_write();

create policy listings_select on public.marketplace_listings for select to authenticated
  using (private.is_project_staff(project_id));
create policy listings_insert on public.marketplace_listings for insert to authenticated
  with check (private.is_admin() or private.is_project_owner(project_id));
create policy listings_update on public.marketplace_listings for update to authenticated
  using (private.can_manage_project(project_id) or private.is_project_owner(project_id) or private.has_member_role(project_id, 'mrv_specialist'))
  with check (private.can_manage_project(project_id) or private.is_project_owner(project_id) or private.has_member_role(project_id, 'mrv_specialist'));

create table public.marketplace_saved (
  investor_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.marketplace_listings (project_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (investor_id, project_id)
);
create index marketplace_saved_project_idx on public.marketplace_saved (project_id);
alter table public.marketplace_saved enable row level security;
create policy saved_select on public.marketplace_saved for select to authenticated using (investor_id = (select auth.uid()));
create policy saved_insert on public.marketplace_saved for insert to authenticated
  with check (investor_id = (select auth.uid()) and private.user_role() = 'investor' and private.is_listed(project_id));
create policy saved_delete on public.marketplace_saved for delete to authenticated using (investor_id = (select auth.uid()));

create table public.marketplace_interests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.marketplace_listings (project_id) on delete cascade,
  investor_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('expression_of_interest', 'partnership_enquiry')),
  message text not null check (char_length(message) between 20 and 3000),
  status text not null default 'submitted'
    check (status in ('submitted', 'under_review', 'due_diligence', 'negotiation', 'agreement', 'declined', 'withdrawn')),
  response_notes text check (response_notes is null or char_length(response_notes) <= 3000),
  handled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index marketplace_interests_project_idx on public.marketplace_interests (project_id, created_at desc);
create index marketplace_interests_investor_idx on public.marketplace_interests (investor_id);
create index marketplace_interests_handler_idx on public.marketplace_interests (handled_by);
alter table public.marketplace_interests enable row level security;

create function private.tg_interests_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.investor_id := coalesce(v_uid, new.investor_id);
    new.status := 'submitted';
    new.response_notes := null;
    new.handled_by := null;
    return new;
  end if;
  new.updated_at := now();
  if (new.project_id, new.investor_id, new.kind, new.message) is distinct from (old.project_id, old.investor_id, old.kind, old.message) then
    raise exception 'A submitted enquiry cannot be edited';
  end if;
  if v_uid is not null and not private.can_manage_project(old.project_id) then
    -- The investor may only withdraw.
    if not (old.investor_id = v_uid and new.status = 'withdrawn' and new.response_notes is not distinct from old.response_notes) then
      raise exception 'You can only withdraw your own enquiry';
    end if;
  elsif v_uid is not null then
    new.handled_by := v_uid;
  end if;
  return new;
end $$;
create trigger interests_before_write before insert or update on public.marketplace_interests
  for each row execute function private.tg_interests_before_write();

create function private.tg_interests_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects;
  v_label text := replace(new.kind, '_', ' ');
begin
  select * into v_project from public.projects where id = new.project_id;
  if tg_op = 'INSERT' then
    perform private.log_activity('enquiry.submitted', 'enquiry', new.id, new.project_id, jsonb_build_object('kind', new.kind));
    perform private.notify(v_project.owner_id, 'enquiry', 'New ' || v_label,
      format('An investor submitted an enquiry about %s.', v_project.name), '/dashboard/marketplace/enquiries', new.project_id, new.id);
    perform private.notify(v_project.manager_id, 'enquiry', 'New ' || v_label,
      format('An investor submitted an enquiry about %s.', v_project.name), '/dashboard/marketplace/enquiries', new.project_id, new.id);
    perform private.notify_admins('enquiry', 'New ' || v_label,
      format('An investor submitted an enquiry about %s.', v_project.name), '/dashboard/marketplace/enquiries', new.project_id, new.id);
  elsif new.status <> old.status then
    perform private.log_activity('enquiry.status_changed', 'enquiry', new.id, new.project_id,
      jsonb_build_object('from', old.status, 'to', new.status));
    perform private.notify(new.investor_id, 'enquiry', 'Enquiry status updated',
      format('Your enquiry about %s is now: %s.', v_project.name, replace(new.status, '_', ' ')), '/dashboard/marketplace/enquiries', null, new.id);
    perform private.notify(v_project.owner_id, 'enquiry', 'Enquiry status updated',
      format('An enquiry about %s is now: %s.', v_project.name, replace(new.status, '_', ' ')), '/dashboard/marketplace/enquiries', new.project_id, new.id);
  end if;
  return null;
end $$;
create trigger interests_after_write after insert or update on public.marketplace_interests
  for each row execute function private.tg_interests_after_write();

create policy interests_select on public.marketplace_interests for select to authenticated using (
  investor_id = (select auth.uid()) or private.can_manage_project(project_id) or private.is_project_owner(project_id)
);
create policy interests_insert on public.marketplace_interests for insert to authenticated
  with check (investor_id = (select auth.uid()) and private.user_role() = 'investor' and private.is_listed(project_id));
create policy interests_update on public.marketplace_interests for update to authenticated
  using (investor_id = (select auth.uid()) or private.can_manage_project(project_id))
  with check (investor_id = (select auth.uid()) or private.can_manage_project(project_id));

-- What investors may see of a published listing. Deliberately limited: no owner identity, no exact
-- coordinates, no documents. Further material is shared through the due diligence workflow.
create function private.marketplace_listings()
returns table (
  project_id uuid, code text, name text, category text, county text, declared_area_ha numeric, mapped_area_ha numeric,
  description text, objectives text, start_date date, summary text, eligibility_notes text,
  development_stage text, standard text, has_stage_evidence boolean, published_at timestamptz,
  estimated_tco2e numeric, estimate_kind text, estimate_methodology text, estimate_assumptions text, estimate_date timestamptz,
  approved_monitoring_records bigint
)
language sql stable security definer set search_path = '' as $$
  select p.id, p.code, p.name, c.name, p.county, p.area_ha, b.area_ha,
         p.description, p.objectives, p.start_date, l.summary, l.eligibility_notes,
         l.development_stage, l.standard, l.stage_evidence_document_id is not null, l.published_at,
         e.estimated_tco2e, e.kind, e.methodology, e.assumptions, e.created_at,
         (select count(*) from public.monitoring_records r where r.project_id = p.id and r.review_status = 'approved')
  from public.marketplace_listings l
  join public.projects p on p.id = l.project_id
  left join public.project_categories c on c.id = p.category_id
  left join public.project_boundaries b on b.project_id = p.id
  left join lateral (
    select ce.* from public.carbon_estimates ce
    where ce.project_id = p.id and ce.kind = 'potential'
    order by ce.created_at desc limit 1
  ) e on true
  where l.status = 'published' and private.user_role() in ('investor', 'super_admin')
$$;

create function public.marketplace_browse()
returns table (
  project_id uuid, code text, name text, category text, county text, declared_area_ha numeric, mapped_area_ha numeric,
  description text, objectives text, start_date date, summary text, eligibility_notes text,
  development_stage text, standard text, has_stage_evidence boolean, published_at timestamptz,
  estimated_tco2e numeric, estimate_kind text, estimate_methodology text, estimate_assumptions text, estimate_date timestamptz,
  approved_monitoring_records bigint
)
language sql stable security invoker set search_path = '' as $$
  select * from private.marketplace_listings()
$$;

-- Grants -----------------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant insert on public.contact_messages to anon;
grant select, insert, update, delete on
  public.project_boundaries, public.carbon_estimates, public.monitoring_schedules, public.project_announcements,
  public.project_meetings, public.grievances, public.marketplace_listings, public.marketplace_saved, public.marketplace_interests
to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.user_role(), private.is_admin(), private.is_project_member(uuid), private.is_participant(uuid, uuid),
  private.can_view_project(uuid), private.can_manage_project(uuid), private.shares_project_with(uuid),
  private.path_project(text), private.has_member_role(uuid, text), private.is_project_staff(uuid),
  private.is_project_owner(uuid), private.is_listed(uuid), private.marketplace_listings()
to authenticated;

revoke execute on function public.save_project_boundary(uuid, jsonb, text), public.gis_features(uuid), public.marketplace_browse() from public, anon;
grant execute on function public.save_project_boundary(uuid, jsonb, text), public.gis_features(uuid), public.marketplace_browse() to authenticated;
