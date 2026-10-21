-- CGS: geographic intelligence layer.
-- Organizations, project geography (country, sub-county, PostGIS points), project sites, the carbon
-- project lifecycle stage, opt-in public discovery for the Explore globe, and the map feeds that
-- drive the Earth -> Africa -> Country -> County -> Project -> Site experience.

-- ---------------------------------------------------------------------------
-- Project categories named in the platform scope (existing rows are kept)
-- ---------------------------------------------------------------------------
insert into public.project_categories (name, description) values
  ('Afforestation', 'Establishing forest on land that was not recently forested.'),
  ('Regenerative Agriculture', 'Farming practices that rebuild soil health and store carbon.'),
  ('Ecosystem Restoration', 'Recovery of degraded ecosystems and their functions.'),
  ('Biodiversity Conservation', 'Protection of species and habitats.'),
  ('Improved Land Management', 'Grazing, soil and land-use practices that reduce degradation.'),
  ('Carbon Project', 'Project developed towards certification under a carbon standard.'),
  ('Community Conservation', 'Conservation led and governed by local communities.')
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  kind text not null default 'other'
    check (kind in ('company', 'ngo', 'community_group', 'cooperative', 'government', 'research', 'other')),
  country text not null default 'Kenya' check (char_length(country) between 2 and 80),
  county text check (county is null or char_length(county) <= 80),
  website text check (website is null or char_length(website) <= 200),
  description text check (description is null or char_length(description) <= 1000),
  -- Set by a CGS administrator after checking the organization. Unverified names are never shown publicly.
  is_verified boolean not null default false,
  verified_at timestamptz,
  verified_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index organizations_name_key on public.organizations (lower(name));
create index organizations_created_by_idx on public.organizations (created_by);
create index organizations_verified_by_idx on public.organizations (verified_by);
alter table public.organizations enable row level security;

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('admin', 'member')),
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_added_by_idx on public.organization_members (added_by);
alter table public.organization_members enable row level security;

create function private.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_role() is not null and exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = (select auth.uid())
  )
$$;

create function private.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_role() is not null and exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.member_role = 'admin'
  )
$$;

create function private.tg_organizations_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean := private.is_admin();
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_uid, new.created_by);
    if v_uid is not null and not v_admin then
      new.is_verified := false;
    end if;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if v_uid is not null and not v_admin and new.is_verified is distinct from old.is_verified then
      raise exception 'Only a CGS administrator can verify an organization';
    end if;
  end if;
  if new.is_verified and (tg_op = 'INSERT' or not old.is_verified) then
    new.verified_at := now();
    new.verified_by := v_uid;
  elsif not new.is_verified then
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end $$;
create trigger organizations_before_write before insert or update on public.organizations
  for each row execute function private.tg_organizations_before_write();

create function private.tg_organizations_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- The person who registers an organization administers it.
    if new.created_by is not null then
      insert into public.organization_members (organization_id, user_id, member_role, added_by)
      values (new.id, new.created_by, 'admin', new.created_by)
      on conflict do nothing;
    end if;
    perform private.log_activity('organization.created', 'organization', new.id, null, jsonb_build_object('name', new.name));
  elsif new.is_verified is distinct from old.is_verified then
    perform private.log_activity(
      case when new.is_verified then 'organization.verified' else 'organization.unverified' end,
      'organization', new.id, null, jsonb_build_object('name', new.name));
  end if;
  return null;
end $$;
create trigger organizations_after_write after insert or update on public.organizations
  for each row execute function private.tg_organizations_after_write();

-- Organization names are a shared directory for active accounts; membership is private to the organization.
create policy organizations_select on public.organizations for select to authenticated
  using (private.user_role() is not null);
create policy organizations_insert on public.organizations for insert to authenticated
  with check (private.user_role() is not null);
create policy organizations_update on public.organizations for update to authenticated
  using (private.is_admin() or private.is_org_admin(id))
  with check (private.is_admin() or private.is_org_admin(id));
create policy organizations_delete on public.organizations for delete to authenticated
  using (private.is_admin());

create policy organization_members_select on public.organization_members for select to authenticated
  using (private.is_admin() or private.is_org_member(organization_id));
create policy organization_members_insert on public.organization_members for insert to authenticated
  with check (private.is_admin() or private.is_org_admin(organization_id));
create policy organization_members_delete on public.organization_members for delete to authenticated
  using (private.is_admin() or private.is_org_admin(organization_id) or user_id = (select auth.uid()));

-- Adds an active account to an organization by e-mail address. Profiles of strangers are not readable
-- by ordinary users, so the lookup happens here after the caller's right to add members is checked.
create function public.add_organization_member(p_org uuid, p_email text, p_role text default 'member') returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if not (private.is_admin() or private.is_org_admin(p_org)) then
    raise exception 'Only an administrator of the organization can add members';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Unknown organization role';
  end if;
  select id into v_user from public.profiles
  where lower(email) = lower(trim(p_email)) and status = 'active';
  if v_user is null then
    raise exception 'No active CGS account uses that e-mail address';
  end if;
  insert into public.organization_members (organization_id, user_id, member_role, added_by)
  values (p_org, v_user, p_role, (select auth.uid()))
  on conflict (organization_id, user_id) do update set member_role = excluded.member_role;
end $$;

-- ---------------------------------------------------------------------------
-- Project geography, lifecycle stage and public discovery
-- ---------------------------------------------------------------------------
alter table public.projects
  add column country text not null default 'Kenya' check (char_length(country) between 2 and 80),
  add column sub_county text check (sub_county is null or char_length(sub_county) <= 80),
  add column organization_id uuid references public.organizations (id) on delete set null,
  -- Where the project stands in carbon project development. A stage is a status of work,
  -- never a claim that credits exist: credit figures live in carbon_estimates and are estimates.
  add column lifecycle_stage text not null default 'idea' check (lifecycle_stage in (
    'idea', 'screening', 'feasibility', 'development', 'validation', 'registration',
    'implementation', 'monitoring', 'verification', 'credit_issuance', 'marketplace')),
  -- Opt-in: shows the project's name, category, location, boundary and area on the public Explore map.
  add column is_public boolean not null default false,
  -- Declared location as a PostGIS point (EPSG:4326), derived from latitude / longitude.
  add column location extensions.geometry(Point, 4326) generated always as (
    extensions.st_setsrid(extensions.st_makepoint(longitude::double precision, latitude::double precision), 4326)
  ) stored;
create index projects_location_idx on public.projects using gist (location);
create index projects_organization_idx on public.projects (organization_id);
create index projects_country_county_idx on public.projects (country, county);
create index projects_public_idx on public.projects (is_public) where is_public;

alter table public.monitoring_records
  add column location extensions.geometry(Point, 4326) generated always as (
    extensions.st_setsrid(extensions.st_makepoint(longitude::double precision, latitude::double precision), 4326)
  ) stored;
create index monitoring_location_idx on public.monitoring_records using gist (location);

-- Who may change publication, the lifecycle stage and the organization of a project.
create function private.tg_projects_geo_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean;
  v_lead boolean;
  v_early constant text[] := array['idea', 'screening', 'feasibility', 'development'];
begin
  -- A project that is not (or no longer) approved is never public, whoever changes it.
  if new.status in ('draft', 'pending_approval', 'revision_required', 'rejected') then
    new.is_public := false;
  end if;
  if v_uid is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  v_admin := private.is_admin();
  v_lead := v_admin or coalesce(private.user_role() = 'project_manager' and new.manager_id = v_uid, false);

  if tg_op = 'INSERT' then
    if not v_admin then
      new.is_public := false;
    end if;
    if not v_lead and not (new.lifecycle_stage = any (v_early)) then
      raise exception 'Stages from validation onwards are set by the project manager or CGS';
    end if;
  else
    if new.is_public is distinct from old.is_public then
      if not v_lead then
        raise exception 'Only the project manager or CGS can change public visibility';
      end if;
      if new.is_public and new.status not in ('approved', 'active', 'on_hold', 'completed') then
        raise exception 'Only an approved project can be shown on the public Explore map';
      end if;
    end if;
    if new.lifecycle_stage is distinct from old.lifecycle_stage
       and not v_lead and not (new.lifecycle_stage = any (v_early)) then
      raise exception 'Stages from validation onwards are set by the project manager or CGS';
    end if;
  end if;

  if new.organization_id is not null
     and (tg_op = 'INSERT' or new.organization_id is distinct from old.organization_id)
     and not v_admin and not private.is_org_member(new.organization_id) then
    raise exception 'Choose an organization you are a member of';
  end if;
  return new;
end $$;
create trigger projects_geo_guard before insert or update on public.projects
  for each row execute function private.tg_projects_geo_guard();

create function private.tg_projects_geo_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_public is distinct from old.is_public then
    perform private.log_activity(
      case when new.is_public then 'project.published_to_explore' else 'project.removed_from_explore' end,
      'project', new.id, new.id, '{}'::jsonb);
  end if;
  if new.lifecycle_stage is distinct from old.lifecycle_stage then
    perform private.log_activity('project.stage_changed', 'project', new.id, new.id,
      jsonb_build_object('from', old.lifecycle_stage, 'to', new.lifecycle_stage));
  end if;
  return null;
end $$;
create trigger projects_geo_log after update on public.projects
  for each row execute function private.tg_projects_geo_log();

-- ---------------------------------------------------------------------------
-- Boundaries: the owner may map the boundary while the project is still a draft
-- ---------------------------------------------------------------------------
create function private.can_edit_geometry(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_manage_project(p_project)
    or private.has_member_role(p_project, 'gis_analyst')
    or (private.user_role() = 'project_owner' and exists (
      select 1 from public.projects p
      where p.id = p_project and p.owner_id = (select auth.uid()) and p.status in ('draft', 'revision_required')
    ))
$$;

drop policy boundaries_insert on public.project_boundaries;
drop policy boundaries_update on public.project_boundaries;
drop policy boundaries_delete on public.project_boundaries;
create policy boundaries_insert on public.project_boundaries for insert to authenticated
  with check (private.can_edit_geometry(project_id));
create policy boundaries_update on public.project_boundaries for update to authenticated
  using (private.can_edit_geometry(project_id)) with check (private.can_edit_geometry(project_id));
create policy boundaries_delete on public.project_boundaries for delete to authenticated
  using (private.can_edit_geometry(project_id));

-- ---------------------------------------------------------------------------
-- Project sites: named locations inside a project (planting blocks, monitoring points, nurseries)
-- ---------------------------------------------------------------------------
create table public.project_sites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  kind text not null default 'site'
    check (kind in ('site', 'monitoring_point', 'nursery', 'water_point', 'office', 'other')),
  description text check (description is null or char_length(description) <= 1000),
  latitude numeric(9, 6) not null check (latitude between -90 and 90),
  longitude numeric(9, 6) not null check (longitude between -180 and 180),
  area_ha numeric(12, 2) check (area_ha is null or area_ha >= 0),
  geom extensions.geometry(Point, 4326) generated always as (
    extensions.st_setsrid(extensions.st_makepoint(longitude::double precision, latitude::double precision), 4326)
  ) stored,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, name)
);
create index project_sites_geom_idx on public.project_sites using gist (geom);
create index project_sites_created_by_idx on public.project_sites (created_by);
alter table public.project_sites enable row level security;

create function private.tg_sites_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
  else
    new.project_id := old.project_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
create trigger sites_before_write before insert or update on public.project_sites
  for each row execute function private.tg_sites_before_write();

create function private.tg_sites_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.log_activity('site.removed', 'project_site', old.id, old.project_id, jsonb_build_object('name', old.name));
  elsif tg_op = 'INSERT' then
    perform private.log_activity('site.added', 'project_site', new.id, new.project_id, jsonb_build_object('name', new.name, 'kind', new.kind));
  else
    perform private.log_activity('site.updated', 'project_site', new.id, new.project_id, jsonb_build_object('name', new.name));
  end if;
  return null;
end $$;
create trigger sites_after_write after insert or update or delete on public.project_sites
  for each row execute function private.tg_sites_after_write();

create policy sites_select on public.project_sites for select to authenticated
  using (private.can_view_project(project_id));
create policy sites_insert on public.project_sites for insert to authenticated
  with check (private.can_edit_geometry(project_id));
create policy sites_update on public.project_sites for update to authenticated
  using (private.can_edit_geometry(project_id)) with check (private.can_edit_geometry(project_id));
create policy sites_delete on public.project_sites for delete to authenticated
  using (private.can_edit_geometry(project_id));

-- A field observation may be tied to one of its project's sites.
alter table public.monitoring_records
  add column site_id uuid,
  add constraint monitoring_records_site_fkey foreign key (site_id, project_id)
    references public.project_sites (id, project_id) on delete set null (site_id);
create index monitoring_site_idx on public.monitoring_records (site_id);

-- ---------------------------------------------------------------------------
-- Map feed for signed-in users (runs as the caller, so RLS applies)
-- ---------------------------------------------------------------------------
create or replace function public.gis_features(p_project uuid default null) returns jsonb
language sql stable security invoker set search_path = extensions as $$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(s.feature), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'type', 'Feature', 'geometry', st_asgeojson(b.geom, 6)::jsonb,
      'properties', jsonb_build_object('kind', 'boundary', 'project_id', p.id, 'code', p.code, 'name', p.name,
                                       'status', p.status, 'area_ha', b.area_ha, 'source', b.source,
                                       'country', p.country, 'county', p.county)) as feature
    from public.project_boundaries b join public.projects p on p.id = b.project_id
    where p_project is null or p.id = p_project
    union all
    -- One point per project: the declared coordinates, or a point inside the mapped boundary when none were declared.
    select jsonb_build_object(
      'type', 'Feature',
      'geometry', st_asgeojson(coalesce(p.location, st_pointonsurface(b.geom)), 6)::jsonb,
      'properties', jsonb_build_object(
        'kind', 'project', 'project_id', p.id, 'code', p.code, 'name', p.name, 'status', p.status,
        'country', p.country, 'county', p.county, 'sub_county', p.sub_county,
        'category', c.name, 'organization', o.name, 'organization_verified', coalesce(o.is_verified, false),
        'lifecycle_stage', p.lifecycle_stage, 'progress_percent', p.progress_percent,
        'declared_area_ha', p.area_ha, 'mapped_area_ha', b.area_ha, 'start_date', p.start_date,
        'is_public', p.is_public,
        'position_source', case when p.location is not null then 'declared' else 'boundary' end))
    from public.projects p
    left join public.project_boundaries b on b.project_id = p.id
    left join public.project_categories c on c.id = p.category_id
    left join public.organizations o on o.id = p.organization_id
    where (p.location is not null or b.geom is not null) and (p_project is null or p.id = p_project)
    union all
    select jsonb_build_object(
      'type', 'Feature', 'geometry', st_asgeojson(s.geom, 6)::jsonb,
      'properties', jsonb_build_object('kind', 'site', 'site_id', s.id, 'project_id', s.project_id, 'code', p.code,
                                       'name', s.name, 'site_kind', s.kind, 'area_ha', s.area_ha, 'description', s.description))
    from public.project_sites s join public.projects p on p.id = s.project_id
    where p_project is null or s.project_id = p_project
    union all
    select jsonb_build_object(
      'type', 'Feature', 'geometry', st_asgeojson(r.location, 6)::jsonb,
      'properties', jsonb_build_object('kind', 'observation', 'record_id', r.id, 'project_id', r.project_id, 'code', p.code,
                                       'site_id', r.site_id,
                                       'observation_type', r.observation_type, 'observation_date', r.observation_date,
                                       'value_basis', r.value_basis, 'review_status', r.review_status))
    from public.monitoring_records r join public.projects p on p.id = r.project_id
    where r.location is not null and (p_project is null or r.project_id = p_project)
  ) s
$$;

-- ---------------------------------------------------------------------------
-- Public Explore feed (visitors who are not signed in)
-- ---------------------------------------------------------------------------
-- Deliberately limited to projects whose manager or CGS opted in: no owner identity, no documents,
-- no individual field observations (only counts of reviewed records), and an organization name
-- only when CGS has verified the organization.
create function public.explore_public() returns jsonb
language sql stable security definer set search_path = '' as $$
  with visible as (
    select p.*, b.geom as boundary_geom, b.area_ha as mapped_area_ha, c.name as category_name,
           case when o.is_verified then o.name end as organization_name
    from public.projects p
    left join public.project_boundaries b on b.project_id = p.id
    left join public.project_categories c on c.id = p.category_id
    left join public.organizations o on o.id = p.organization_id
    where p.is_public and p.status in ('approved', 'active', 'on_hold', 'completed')
      and (p.location is not null or b.geom is not null)
    order by p.created_at desc
    limit 1000
  )
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(s.feature), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'type', 'Feature',
      'geometry', extensions.st_asgeojson(coalesce(v.location, extensions.st_pointonsurface(v.boundary_geom)), 5)::jsonb,
      'properties', jsonb_build_object(
        'kind', 'project', 'project_id', v.id, 'code', v.code, 'name', v.name, 'status', v.status,
        'country', v.country, 'county', v.county, 'sub_county', v.sub_county,
        'category', v.category_name, 'organization', v.organization_name,
        'organization_verified', v.organization_name is not null,
        'lifecycle_stage', v.lifecycle_stage, 'declared_area_ha', v.area_ha, 'mapped_area_ha', v.mapped_area_ha,
        'start_date', v.start_date, 'summary', left(v.description, 600), 'is_public', true,
        'position_source', case when v.location is not null then 'declared' else 'boundary' end,
        'site_count', (select count(*) from public.project_sites s where s.project_id = v.id),
        'reviewed_observations', (select count(*) from public.monitoring_records r
                                  where r.project_id = v.id and r.review_status = 'approved'),
        'last_observation', (select max(r.observation_date) from public.monitoring_records r
                             where r.project_id = v.id and r.review_status = 'approved'))) as feature
    from visible v
    union all
    select jsonb_build_object(
      'type', 'Feature', 'geometry', extensions.st_asgeojson(v.boundary_geom, 5)::jsonb,
      'properties', jsonb_build_object('kind', 'boundary', 'project_id', v.id, 'code', v.code, 'name', v.name,
                                       'status', v.status, 'area_ha', v.mapped_area_ha,
                                       'country', v.country, 'county', v.county))
    from visible v where v.boundary_geom is not null
    union all
    select jsonb_build_object(
      'type', 'Feature', 'geometry', extensions.st_asgeojson(s.geom, 5)::jsonb,
      'properties', jsonb_build_object('kind', 'site', 'site_id', s.id, 'project_id', s.project_id, 'code', v.code,
                                       'name', s.name, 'site_kind', s.kind, 'area_ha', s.area_ha))
    from public.project_sites s join visible v on v.id = s.project_id
  ) s
$$;

-- ---------------------------------------------------------------------------
-- Per-project operational figures for the workspace map and the admin command centre
-- (runs as the caller, so every count respects RLS)
-- ---------------------------------------------------------------------------
create function public.geo_project_insights()
returns table (
  project_id uuid, open_tasks bigint, overdue_tasks bigint, reports_awaiting_review bigint,
  observations bigint, last_observation date, documents_awaiting_review bigint,
  open_grievances bigint, sites bigint, team_members bigint
)
language sql stable security invoker set search_path = '' as $$
  select p.id,
    (select count(*) from public.tasks t where t.project_id = p.id and t.status <> 'completed'),
    (select count(*) from public.tasks t where t.project_id = p.id and t.status <> 'completed' and t.due_date < current_date),
    (select count(*) from public.monitoring_records r where r.project_id = p.id and r.review_status = 'submitted'),
    (select count(*) from public.monitoring_records r where r.project_id = p.id),
    (select max(r.observation_date) from public.monitoring_records r where r.project_id = p.id),
    (select count(*) from public.documents d where d.project_id = p.id and d.review_status = 'pending' and d.monitoring_record_id is null),
    (select count(*) from public.grievances g where g.project_id = p.id and g.status in ('open', 'in_review')),
    (select count(*) from public.project_sites s where s.project_id = p.id),
    (select count(*) from public.project_members m where m.project_id = p.id)
  from public.projects p
$$;

-- Grants -----------------------------------------------------------------------------------
revoke all on public.organizations, public.organization_members, public.project_sites from anon;
grant select, insert, update, delete on public.organizations, public.organization_members, public.project_sites to authenticated;

revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_org_member(uuid), private.is_org_admin(uuid), private.can_edit_geometry(uuid) to authenticated;

revoke execute on function public.add_organization_member(uuid, text, text), public.geo_project_insights() from public, anon;
grant execute on function public.add_organization_member(uuid, text, text), public.geo_project_insights() to authenticated;
revoke execute on function public.explore_public() from public;
grant execute on function public.explore_public() to anon, authenticated;
