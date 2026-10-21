-- CGS Project Portal: core MVP schema.
-- Tables, enums, constraints and indexes. Functions/triggers and RLS follow in later migrations.

create schema if not exists private;

create type public.user_role as enum (
  'super_admin', 'project_manager', 'project_owner', 'field_officer',
  'gis_analyst', 'mrv_specialist', 'investor', 'community_member'
);
create type public.account_status as enum ('pending', 'active', 'suspended', 'terminated');
create type public.project_status as enum (
  'draft', 'pending_approval', 'approved', 'revision_required', 'active', 'on_hold', 'completed', 'rejected'
);
create type public.task_status as enum ('todo', 'in_progress', 'under_review', 'completed');
create type public.task_priority as enum ('low', 'medium', 'high');
create type public.milestone_status as enum ('pending', 'completed');
create type public.document_review_status as enum ('pending', 'approved', 'rejected');
create type public.monitoring_status as enum ('submitted', 'approved', 'revision_required');
create type public.approval_decision as enum ('approved', 'rejected', 'revision_required');

-- profiles: one row per auth user, created by trigger on sign-up.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null,
  phone text check (phone is null or char_length(phone) <= 30),
  organization text check (organization is null or char_length(organization) <= 160),
  location text check (location is null or char_length(location) <= 160),
  role public.user_role not null default 'project_owner',
  status public.account_status not null default 'pending',
  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role_status_idx on public.profiles (role, status);

-- Single-row platform settings.
create table public.system_settings (
  id boolean primary key default true check (id),
  platform_name text not null default 'CGS Project Portal' check (char_length(platform_name) between 2 and 80),
  support_email text not null default 'info@cyphergreen.com' check (char_length(support_email) <= 160),
  support_phone text not null default '0110966455' check (char_length(support_phone) <= 30),
  require_account_approval boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.system_settings (id) values (true);

create table public.project_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 80),
  description text check (description is null or char_length(description) <= 400),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.project_categories (name, description) values
  ('Reforestation', 'Tree planting on previously forested land.'),
  ('Agroforestry', 'Integration of trees with crops or livestock.'),
  ('Forest Conservation', 'Protection of existing forest cover.'),
  ('Wetland Restoration', 'Rehabilitation of wetlands and riparian areas.'),
  ('Sustainable Agriculture', 'Soil and land management practices.'),
  ('Renewable Energy', 'Clean energy generation and access.');

create sequence public.project_code_seq;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null check (char_length(name) between 3 and 160),
  category_id uuid references public.project_categories (id) on delete restrict,
  description text not null check (char_length(description) between 20 and 5000),
  objectives text check (objectives is null or char_length(objectives) <= 5000),
  county text not null check (char_length(county) between 2 and 80),
  location_description text check (location_description is null or char_length(location_description) <= 500),
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  area_ha numeric(12, 2) check (area_ha is null or area_ha >= 0),
  start_date date,
  expected_end_date date,
  status public.project_status not null default 'draft',
  -- Derived: share of the project's tasks that are completed (maintained by trigger).
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  owner_id uuid not null references public.profiles (id) on delete restrict,
  manager_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_dates_check check (expected_end_date is null or start_date is null or expected_end_date >= start_date)
);
create index projects_owner_idx on public.projects (owner_id);
create index projects_manager_idx on public.projects (manager_id);
create index projects_status_idx on public.projects (status);
create index projects_category_idx on public.projects (category_id);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  member_role text not null default 'field_officer'
    check (member_role in ('field_officer', 'team_member', 'observer')),
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 160),
  description text check (description is null or char_length(description) <= 2000),
  due_date date,
  status public.milestone_status not null default 'pending',
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index milestones_project_idx on public.milestones (project_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  milestone_id uuid references public.milestones (id) on delete set null,
  title text not null check (char_length(title) between 3 and 160),
  description text check (description is null or char_length(description) <= 4000),
  assigned_to uuid references public.profiles (id) on delete set null,
  priority public.task_priority not null default 'medium',
  status public.task_status not null default 'todo',
  due_date date,
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_project_idx on public.tasks (project_id);
create index tasks_assignee_idx on public.tasks (assigned_to);
create index tasks_status_due_idx on public.tasks (status, due_date);
create index tasks_milestone_idx on public.tasks (milestone_id);

create table public.monitoring_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  observation_type text not null check (observation_type in (
    'tree_planting', 'tree_survival', 'vegetation', 'biodiversity', 'soil', 'water_quality', 'land_use', 'general'
  )),
  observation_date date not null check (observation_date <= current_date + 1),
  recorded_by uuid references public.profiles (id) on delete set null,
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  description text not null check (char_length(description) between 10 and 5000),
  measurements jsonb not null default '{}'::jsonb,
  -- Whether the figures were measured in the field or estimated. Never "verified": the portal does not certify.
  value_basis text not null default 'measured' check (value_basis in ('measured', 'estimated')),
  methodology text check (methodology is null or char_length(methodology) <= 1000),
  review_status public.monitoring_status not null default 'submitted',
  review_notes text check (review_notes is null or char_length(review_notes) <= 2000),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index monitoring_project_idx on public.monitoring_records (project_id, observation_date desc);
create index monitoring_recorder_idx on public.monitoring_records (recorded_by);
create index monitoring_status_idx on public.monitoring_records (review_status);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  monitoring_record_id uuid references public.monitoring_records (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 160),
  description text check (description is null or char_length(description) <= 1000),
  category text not null default 'other' check (category in (
    'land_ownership', 'agreement', 'environmental_assessment', 'monitoring_evidence', 'map_dataset', 'report', 'other'
  )),
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  review_status public.document_review_status not null default 'pending',
  review_notes text check (review_notes is null or char_length(review_notes) <= 1000),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index documents_project_idx on public.documents (project_id, created_at desc);
create index documents_monitoring_idx on public.documents (monitoring_record_id);
create index documents_uploader_idx on public.documents (uploaded_by);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  project_id uuid references public.projects (id) on delete cascade,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_entity_idx on public.notifications (entity_id, type);
create index notifications_project_idx on public.notifications (project_id);

create table public.project_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index project_comments_project_idx on public.project_comments (project_id, created_at);
create index project_comments_task_idx on public.project_comments (task_id);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  decision public.approval_decision not null,
  comments text check (comments is null or char_length(comments) <= 2000),
  reviewer_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index approvals_project_idx on public.approvals (project_id, created_at desc);

-- Append-only audit trail. Rows are written only by database triggers.
create table public.activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  project_id uuid references public.projects (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_logs_created_idx on public.activity_logs (created_at desc);
create index activity_logs_project_idx on public.activity_logs (project_id, created_at desc);
create index activity_logs_entity_idx on public.activity_logs (entity_type, entity_id);
create index activity_logs_actor_idx on public.activity_logs (actor_id);

-- Public contact form submissions.
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null check (char_length(email) between 5 and 160),
  subject text not null check (char_length(subject) between 3 and 160),
  message text not null check (char_length(message) between 10 and 4000),
  created_at timestamptz not null default now()
);
