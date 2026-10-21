-- FERD Student Portal: departments, verified students, staff roles, a dynamic content library,
-- premium products with M-Pesa payments and entitlements, and audit logging.
-- Everything is additive and prefixed "ferd_"; no existing CGS table is altered except the
-- sign-up trigger function, which gains a branch for FERD registrations.

-- ---------------------------------------------------------------------------
-- Departments and registration-number prefix rules (both editable by the Super Admin)
-- ---------------------------------------------------------------------------
create table public.ferd_departments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  code text not null unique check (char_length(code) between 2 and 10),
  name text not null check (char_length(name) between 3 and 80),
  tagline text check (tagline is null or char_length(tagline) <= 200),
  description text check (description is null or char_length(description) <= 2000),
  focus_areas text[] not null default '{}',
  accent text not null default '#4cc38a' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ferd_departments (slug, code, name, tagline, description, focus_areas, accent, sort_order) values
  ('environmental-science', 'ES', 'Environmental Science',
   'Understanding and protecting environmental systems.',
   'Pollution, environmental assessment, climate, laboratory and field practice.',
   array['Environmental assessment', 'Pollution and waste', 'Climate', 'Field and laboratory practice', 'Introductory GIS'], '#4cc38a', 1),
  ('natural-resources', 'NR', 'Natural Resources',
   'Managing forests, wildlife, water and land for the long term.',
   'Forestry, wildlife, ecosystem management, inventory and conservation monitoring.',
   array['Forestry', 'Wildlife', 'Ecosystem management', 'Inventory and survey', 'Conservation monitoring'], '#d9a441', 2),
  ('geography', 'GEO', 'Geography',
   'Reading the Earth through maps, space and place.',
   'Cartography, GIS, remote sensing, physical and human geography.',
   array['Cartography', 'GIS', 'Remote sensing', 'Spatial analysis', 'Physical and human geography'], '#5aa9e6', 3);

-- A registration number belongs to the department of the longest matching active prefix.
-- A number that matches no rule gets no department until an administrator assigns one.
create table public.ferd_prefix_rules (
  id uuid primary key default gen_random_uuid(),
  prefix text not null unique check (prefix ~ '^[A-Z0-9/]{1,12}$'),
  department_id uuid not null references public.ferd_departments (id) on delete cascade,
  note text check (note is null or char_length(note) <= 300),
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ferd_prefix_rules_department_idx on public.ferd_prefix_rules (department_id);

insert into public.ferd_prefix_rules (prefix, department_id, note)
select v.prefix, d.id, v.note
from (values
  ('N12/', 'ES', 'Environmental Science'),
  ('N14/', 'GEO', 'Geography'),
  ('N11/', 'NR', 'Natural Resources (known example; confirm against official records)'),
  ('N13/', 'NR', 'Natural Resources (known example; confirm against official records)'),
  ('N15/', 'NR', 'Natural Resources (known example; confirm against official records)')
) as v (prefix, code, note)
join public.ferd_departments d on d.code = v.code;

create function private.ferd_regno_key(p_regno text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(upper(trim(coalesce(p_regno, ''))), '[^A-Z0-9/]', '', 'g')
$$;

create function private.ferd_department_for(p_key text) returns uuid
language sql stable security definer set search_path = '' as $$
  select r.department_id from public.ferd_prefix_rules r
  join public.ferd_departments d on d.id = r.department_id and d.is_active
  where r.is_active and p_key like r.prefix || '%'
  order by char_length(r.prefix) desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Staff roles
-- ---------------------------------------------------------------------------
create table public.ferd_staff (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role text not null check (role in ('super_admin', 'department_admin', 'content_manager', 'opportunities_manager', 'finance_admin', 'project_manager')),
  -- Scope: required for a department admin; optional limit for a content manager.
  department_id uuid references public.ferd_departments (id) on delete set null,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ferd_staff_department_admin_scope check (role <> 'department_admin' or department_id is not null)
);
create index ferd_staff_department_idx on public.ferd_staff (department_id);

-- A CGS super administrator is always a FERD super administrator, so the first administrator is
-- provisioned through the existing, non-public CGS process and never through a sign-up form.
create function private.ferd_role() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when private.is_admin() then 'super_admin'
    else (select s.role from public.ferd_staff s
          join public.profiles p on p.id = s.user_id and p.status <> 'suspended' and p.status <> 'terminated'
          where s.user_id = (select auth.uid()))
  end
$$;

create function private.ferd_is_super() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.ferd_role() = 'super_admin', false)
$$;

create function private.ferd_staff_department() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.department_id from public.ferd_staff s where s.user_id = (select auth.uid())
$$;

-- Super admins manage every department; a department admin only their own.
create function private.ferd_manages_department(p_department uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.ferd_is_super()
    or (private.ferd_role() = 'department_admin' and p_department is not null and p_department = private.ferd_staff_department())
$$;

-- ---------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------
-- Official records supplied by the faculty. A match helps the reviewer; it never activates an account by itself.
create table public.ferd_student_records (
  reg_no_key text primary key check (reg_no_key ~ '^[A-Z0-9/]{5,30}$'),
  full_name text not null check (char_length(full_name) between 2 and 120),
  department_id uuid references public.ferd_departments (id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.ferd_students (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  reg_no text not null check (char_length(reg_no) between 5 and 30),
  reg_no_key text not null unique check (reg_no_key ~ '^[A-Z0-9/]{5,30}$'),
  full_name text not null check (char_length(full_name) between 2 and 120),
  phone text check (phone is null or char_length(phone) <= 20),
  year_of_study smallint check (year_of_study is null or year_of_study between 1 and 8),
  department_id uuid references public.ferd_departments (id) on delete set null,
  -- pending: awaiting review. verified: identity confirmed, access granted. rejected / suspended: no access.
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected', 'suspended')),
  status_note text check (status_note is null or char_length(status_note) <= 500),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ferd_students_department_status_idx on public.ferd_students (department_id, status);
create index ferd_students_verified_by_idx on public.ferd_students (verified_by);

create function private.ferd_is_student() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.ferd_students s where s.user_id = (select auth.uid()) and s.status = 'verified')
$$;

create function private.ferd_student_department() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.department_id from public.ferd_students s where s.user_id = (select auth.uid()) and s.status = 'verified'
$$;

-- Failed and successful sign-in attempts, used for rate limiting. Server-only: no client policy exists.
create table public.ferd_login_attempts (
  id bigint generated always as identity primary key,
  reg_no_key text not null,
  client_hash text not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index ferd_login_attempts_key_idx on public.ferd_login_attempts (reg_no_key, created_at desc);
create index ferd_login_attempts_client_idx on public.ferd_login_attempts (client_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- Audit log (written by triggers; nobody can insert or edit it through the API)
-- ---------------------------------------------------------------------------
create table public.ferd_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ferd_audit_logs_created_idx on public.ferd_audit_logs (created_at desc);
create index ferd_audit_logs_actor_idx on public.ferd_audit_logs (actor_id);
create index ferd_audit_logs_entity_idx on public.ferd_audit_logs (entity, entity_id);

create function private.ferd_audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ferd_audit_logs (actor_id, action, entity, entity_id, details)
  values ((select p.id from public.profiles p where p.id = (select auth.uid())), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
end $$;

-- Generic row audit for configuration tables.
create function private.tg_ferd_audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
begin
  perform private.ferd_audit(tg_table_name || '.' || lower(tg_op), tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'key', v_row ->> 'reg_no_key'),
    case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)) else v_row end);
  return null;
end $$;

-- Students may edit only their own contact details; status, department and identity belong to administrators.
create function private.tg_ferd_students_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  new.updated_at := now();
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  if v_uid is null then
    return new; -- service role and SQL console
  end if;
  if private.ferd_manages_department(old.department_id) or (old.department_id is null and private.ferd_role() = 'department_admin') then
    if not private.ferd_is_super() and new.department_id is distinct from old.department_id
       and new.department_id is distinct from private.ferd_staff_department() then
      raise exception 'A department administrator can only assign students to their own department';
    end if;
    if new.status is distinct from old.status then
      new.verified_by := case when new.status = 'verified' then v_uid else old.verified_by end;
      new.verified_at := case when new.status = 'verified' then now() else old.verified_at end;
    end if;
    return new;
  end if;
  if old.user_id = v_uid then
    if (new.reg_no, new.reg_no_key, new.full_name, new.department_id, new.status, new.status_note, new.verified_by, new.verified_at)
       is distinct from
       (old.reg_no, old.reg_no_key, old.full_name, old.department_id, old.status, old.status_note, old.verified_by, old.verified_at) then
      raise exception 'Only an administrator can change a registration number, name, department or account status';
    end if;
    return new;
  end if;
  raise exception 'You are not permitted to change this student record';
end $$;
create trigger ferd_students_guard before update on public.ferd_students
  for each row execute function private.tg_ferd_students_guard();

create function private.tg_ferd_students_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.status, new.department_id, new.reg_no_key, new.full_name)
     is distinct from (old.status, old.department_id, old.reg_no_key, old.full_name) then
    perform private.ferd_audit('student.' || case when new.status is distinct from old.status then new.status else 'corrected' end,
      'ferd_students', new.user_id::text,
      jsonb_build_object('reg_no', new.reg_no, 'from_status', old.status, 'to_status', new.status,
                         'from_department', old.department_id, 'to_department', new.department_id, 'note', new.status_note));
    if new.status is distinct from old.status then
      insert into public.ferd_notifications (user_id, title, body, link)
      values (new.user_id,
        case new.status when 'verified' then 'Your FERD account is verified'
                        when 'rejected' then 'Your FERD registration was not approved'
                        when 'suspended' then 'Your FERD account is suspended'
                        else 'Your FERD account is under review' end,
        coalesce(new.status_note, case new.status when 'verified' then 'You can now open your department dashboard.' else null end),
        '/ferd/dashboard');
    end if;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Dashboard modules (labels, order and visibility are data, not code)
-- ---------------------------------------------------------------------------
create table public.ferd_modules (
  key text primary key check (key ~ '^[a-z_]{2,30}$'),
  label text not null check (char_length(label) between 2 and 40),
  description text check (description is null or char_length(description) <= 200),
  href text not null check (href ~ '^/ferd/[a-z0-9/-]*$'),
  icon text not null default 'folder',
  sort_order int not null default 0,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.ferd_modules (key, label, description, href, icon, sort_order) values
  ('dashboard', 'Dashboard', 'Your department at a glance.', '/ferd/dashboard', 'dashboard', 1),
  ('courses', 'Courses', 'Units and their materials.', '/ferd/courses', 'book', 2),
  ('resources', 'Resources', 'Notes, guides, datasets and links.', '/ferd/resources', 'file', 3),
  ('manuals', 'Manuals', 'Premium manuals and study packs.', '/ferd/manuals', 'library', 4),
  ('opportunities', 'Opportunities', 'Internships, scholarships, jobs and more.', '/ferd/opportunities', 'briefcase', 5),
  ('events', 'Events', 'Field trips, workshops and meetings.', '/ferd/events', 'calendar', 6),
  ('community', 'Community', 'Announcements, galleries and projects.', '/ferd/community', 'megaphone', 7),
  ('notifications', 'Notifications', 'Updates about your account.', '/ferd/notifications', 'bell', 8),
  ('help', 'Help', 'Support and frequently asked questions.', '/ferd/help', 'help', 9);

-- Per-department override of a module: hide it, rename it or move it.
create table public.ferd_department_modules (
  department_id uuid not null references public.ferd_departments (id) on delete cascade,
  module_key text not null references public.ferd_modules (key) on delete cascade,
  is_enabled boolean not null default true,
  label text check (label is null or char_length(label) between 2 and 40),
  sort_order int,
  primary key (department_id, module_key)
);
create index ferd_department_modules_module_idx on public.ferd_department_modules (module_key);

-- ---------------------------------------------------------------------------
-- Courses, products and the content library
-- ---------------------------------------------------------------------------
create table public.ferd_courses (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.ferd_departments (id) on delete cascade,
  code text not null check (char_length(code) between 2 and 20),
  title text not null check (char_length(title) between 3 and 160),
  year_of_study smallint check (year_of_study is null or year_of_study between 1 and 8),
  semester smallint check (semester is null or semester between 1 and 3),
  description text check (description is null or char_length(description) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (department_id, code)
);

-- A premium product is a library: one payment unlocks every premium item attached to it.
create table public.ferd_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  name text not null check (char_length(name) between 3 and 120),
  description text not null default '' check (char_length(description) <= 3000),
  terms text not null default '' check (char_length(terms) <= 3000),
  price_kes integer not null check (price_kes between 1 and 150000),
  department_id uuid references public.ferd_departments (id) on delete set null,
  is_active boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ferd_products_department_idx on public.ferd_products (department_id);
create index ferd_products_created_by_idx on public.ferd_products (created_by);

insert into public.ferd_products (slug, name, description, terms, price_kes, department_id, is_active)
select v.slug, v.name, v.description,
  'One-time payment. Access to every item in this library, including items added later, for as long as the library is offered. Personal study use only; do not redistribute.',
  100, d.id, v.active
from (values
  ('es-all-units-manuals', 'Environmental Science All Units Manuals', 'The Environmental Science manuals library. The included manuals are the premium items attached to this library in the content manager.', 'ES', true),
  ('nr-all-units-manuals', 'Natural Resources All Units Manuals', 'The Natural Resources manuals library. Not on sale until the Super Admin activates it.', 'NR', false),
  ('geo-all-units-manuals', 'Geography All Units Manuals', 'The Geography manuals library. Not on sale until the Super Admin activates it.', 'GEO', false)
) as v (slug, name, description, code, active)
join public.ferd_departments d on d.code = v.code;

create table public.ferd_content (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in (
    'note', 'manual', 'document', 'resource', 'video', 'link', 'dataset', 'report', 'project',
    'announcement', 'event', 'gallery',
    'internship', 'attachment', 'scholarship', 'job', 'graduate', 'volunteering', 'competition', 'research', 'fellowship')),
  title text not null check (char_length(title) between 3 and 200),
  summary text check (summary is null or char_length(summary) <= 500),
  body text check (body is null or char_length(body) <= 30000),
  -- Empty array: every department. Otherwise only the listed departments.
  departments uuid[] not null default '{}',
  course_id uuid references public.ferd_courses (id) on delete set null,
  tier text not null default 'free' check (tier in ('free', 'premium')),
  product_id uuid references public.ferd_products (id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished', 'archived')),
  publish_at timestamptz,
  expires_at timestamptz,
  source text check (source is null or char_length(source) <= 200),
  external_url text check (external_url is null or external_url ~ '^https?://'),
  tags text[] not null default '{}',
  -- Type-specific fields: organization, location, mode, deadline, starts_at, ends_at, last_verified.
  meta jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ferd_content_premium_needs_product check (tier = 'free' or product_id is not null)
);
create index ferd_content_type_status_idx on public.ferd_content (type, status, publish_at desc);
create index ferd_content_departments_idx on public.ferd_content using gin (departments);
create index ferd_content_course_idx on public.ferd_content (course_id);
create index ferd_content_product_idx on public.ferd_content (product_id);
create index ferd_content_created_by_idx on public.ferd_content (created_by);
create index ferd_content_updated_by_idx on public.ferd_content (updated_by);

-- Published, inside its publication window.
create function private.ferd_is_live(p_status text, p_publish_at timestamptz, p_expires_at timestamptz) returns boolean
language sql stable set search_path = '' as $$
  select p_status = 'published' and (p_publish_at is null or p_publish_at <= now()) and (p_expires_at is null or p_expires_at > now())
$$;

-- Which staff role may write which content.
create function private.ferd_can_write_content(p_type text, p_departments uuid[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.ferd_role()
    when 'super_admin' then true
    when 'department_admin' then cardinality(p_departments) > 0 and p_departments <@ array[private.ferd_staff_department()]
    when 'content_manager' then private.ferd_staff_department() is null
                                or (cardinality(p_departments) > 0 and p_departments <@ array[private.ferd_staff_department()])
    when 'opportunities_manager' then p_type in ('internship', 'attachment', 'scholarship', 'job', 'graduate', 'volunteering', 'competition', 'research', 'fellowship')
    when 'project_manager' then p_type in ('project', 'dataset', 'report')
    else false
  end
$$;

create function private.tg_ferd_content_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_uid, new.created_by);
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(v_uid, new.updated_by);
  -- Price and premium status are commercial settings: only the Super Admin and department admins set them.
  if v_uid is not null and private.ferd_role() not in ('super_admin', 'department_admin')
     and (tg_op = 'INSERT' and new.tier = 'premium'
          or tg_op = 'UPDATE' and (new.tier, new.product_id) is distinct from (old.tier, old.product_id)) then
    raise exception 'Only a Super Admin or department administrator can make content premium';
  end if;
  return new;
end $$;
create trigger ferd_content_before before insert or update on public.ferd_content
  for each row execute function private.tg_ferd_content_before();

create function private.tg_ferd_content_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.ferd_audit('content.deleted', 'ferd_content', old.id::text, jsonb_build_object('title', old.title, 'type', old.type));
  elsif tg_op = 'INSERT' then
    perform private.ferd_audit('content.created', 'ferd_content', new.id::text, jsonb_build_object('title', new.title, 'type', new.type, 'status', new.status));
  elsif (new.status, new.tier, new.product_id, new.departments) is distinct from (old.status, old.tier, old.product_id, old.departments) then
    perform private.ferd_audit('content.' || case when new.status is distinct from old.status then new.status else 'access_changed' end,
      'ferd_content', new.id::text,
      jsonb_build_object('title', new.title, 'from_status', old.status, 'to_status', new.status, 'from_tier', old.tier, 'to_tier', new.tier));
  else
    perform private.ferd_audit('content.edited', 'ferd_content', new.id::text, jsonb_build_object('title', new.title));
  end if;
  return null;
end $$;
create trigger ferd_content_after after insert or update or delete on public.ferd_content
  for each row execute function private.tg_ferd_content_after();

-- Files and images attached to content. All of them live in a private bucket.
create table public.ferd_files (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.ferd_content (id) on delete cascade,
  kind text not null default 'attachment' check (kind in ('attachment', 'image', 'cover')),
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  caption text check (caption is null or char_length(caption) <= 300),
  sort_order int not null default 0,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ferd_files_content_idx on public.ferd_files (content_id, kind, sort_order);
create index ferd_files_uploaded_by_idx on public.ferd_files (uploaded_by);

-- ---------------------------------------------------------------------------
-- Payments and entitlements
-- ---------------------------------------------------------------------------
create table public.ferd_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  product_id uuid not null references public.ferd_products (id) on delete restrict,
  -- Price at the moment of purchase. Later price changes never touch this row.
  amount_kes integer not null check (amount_kes > 0),
  phone text not null check (phone ~ '^254[17][0-9]{8}$'),
  reference text not null unique,
  merchant_request_id text,
  checkout_request_id text unique,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'cancelled', 'expired')),
  result_code text,
  result_desc text check (result_desc is null or char_length(result_desc) <= 300),
  mpesa_receipt text unique,
  paid_amount_kes integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index ferd_payments_user_idx on public.ferd_payments (user_id, created_at desc);
create index ferd_payments_product_idx on public.ferd_payments (product_id);
create index ferd_payments_status_idx on public.ferd_payments (status, created_at);

create table public.ferd_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.ferd_products (id) on delete restrict,
  payment_id uuid references public.ferd_payments (id) on delete restrict,
  source text not null default 'payment' check (source in ('payment', 'grant')),
  granted_by uuid references public.profiles (id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, product_id),
  -- A manual grant must name who granted it; a paid one must name its payment.
  constraint ferd_entitlements_origin_check check ((source = 'payment' and payment_id is not null) or (source = 'grant' and granted_by is not null))
);
create index ferd_entitlements_product_idx on public.ferd_entitlements (product_id);
create index ferd_entitlements_payment_idx on public.ferd_entitlements (payment_id);
create index ferd_entitlements_granted_by_idx on public.ferd_entitlements (granted_by);

-- A finished payment is a financial record: nobody edits it, whatever their role.
create function private.tg_ferd_payments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payment records cannot be deleted';
  end if;
  if old.status <> 'pending' then
    raise exception 'A completed payment record cannot be changed';
  end if;
  if (new.user_id, new.product_id, new.amount_kes, new.reference) is distinct from (old.user_id, old.product_id, old.amount_kes, old.reference) then
    raise exception 'The purchaser, product, amount and reference of a payment cannot be changed';
  end if;
  return new;
end $$;
create trigger ferd_payments_guard before update or delete on public.ferd_payments
  for each row execute function private.tg_ferd_payments_guard();

-- Records the outcome of a payment exactly once and, on success, grants the entitlement in the same
-- transaction. Safe to call repeatedly (duplicate callbacks, callback plus status query).
-- Returns the resulting status. Callable by the server (service role) only.
create function public.ferd_finalize_payment(
  p_checkout_request_id text, p_result_code text, p_result_desc text,
  p_receipt text default null, p_paid_amount integer default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_payment public.ferd_payments;
  v_status text;
begin
  select * into v_payment from public.ferd_payments where checkout_request_id = p_checkout_request_id for update;
  if not found then
    return 'unknown';
  end if;
  if v_payment.status <> 'pending' then
    return v_payment.status; -- already final: repeated calls change nothing
  end if;

  v_status := case
    when p_result_code = '0' then 'success'
    when p_result_code = '1032' then 'cancelled'
    when p_result_code in ('1037', '1019') then 'expired'
    else 'failed'
  end;
  -- A success must be for at least the expected amount, when the amount is known.
  if v_status = 'success' and p_paid_amount is not null and p_paid_amount < v_payment.amount_kes then
    v_status := 'failed';
    p_result_desc := format('Paid amount %s is less than the price %s', p_paid_amount, v_payment.amount_kes);
  end if;

  update public.ferd_payments
  set status = v_status, result_code = p_result_code, result_desc = left(p_result_desc, 300),
      mpesa_receipt = case when v_status = 'success' then p_receipt end,
      paid_amount_kes = p_paid_amount, completed_at = now()
  where id = v_payment.id;

  if v_status = 'success' then
    insert into public.ferd_entitlements (user_id, product_id, payment_id, source)
    values (v_payment.user_id, v_payment.product_id, v_payment.id, 'payment')
    on conflict (user_id, product_id) do update set revoked_at = null, payment_id = excluded.payment_id, source = 'payment'
      where public.ferd_entitlements.revoked_at is not null;
    insert into public.ferd_notifications (user_id, title, body, link)
    values (v_payment.user_id, 'Payment received',
            format('Your payment of KSh %s was confirmed. Your library is unlocked.', v_payment.amount_kes), '/ferd/manuals');
  end if;
  insert into public.ferd_audit_logs (actor_id, action, entity, entity_id, details)
  values (null, 'payment.' || v_status, 'ferd_payments', v_payment.id::text,
          jsonb_build_object('reference', v_payment.reference, 'result_code', p_result_code, 'amount_kes', v_payment.amount_kes));
  return v_status;
end $$;

-- ---------------------------------------------------------------------------
-- Student activity
-- ---------------------------------------------------------------------------
create table public.ferd_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 160),
  body text check (body is null or char_length(body) <= 1000),
  link text check (link is null or link ~ '^/ferd'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index ferd_notifications_user_idx on public.ferd_notifications (user_id, created_at desc);

create trigger ferd_students_after after update on public.ferd_students
  for each row execute function private.tg_ferd_students_after();

create table public.ferd_bookmarks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  content_id uuid not null references public.ferd_content (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, content_id)
);
create index ferd_bookmarks_content_idx on public.ferd_bookmarks (content_id);

create table public.ferd_download_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  file_id uuid references public.ferd_files (id) on delete set null,
  content_id uuid references public.ferd_content (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ferd_download_logs_user_idx on public.ferd_download_logs (user_id, created_at desc);
create index ferd_download_logs_file_idx on public.ferd_download_logs (file_id);
create index ferd_download_logs_content_idx on public.ferd_download_logs (content_id);

-- The single access decision for a content item's files, used by the server before it signs a URL.
create function public.ferd_can_access_content(p_content uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ferd_content c
    where c.id = p_content and (
      private.ferd_role() is not null
      or (
        private.ferd_is_student()
        and private.ferd_is_live(c.status, c.publish_at, c.expires_at)
        and (cardinality(c.departments) = 0 or private.ferd_student_department() = any (c.departments))
        and (c.tier = 'free' or exists (
          select 1 from public.ferd_entitlements e
          where e.user_id = (select auth.uid()) and e.product_id = c.product_id and e.revoked_at is null))
      )
    )
  )
$$;

-- Audit triggers for configuration and privileged records.
create trigger ferd_staff_audit after insert or update or delete on public.ferd_staff for each row execute function private.tg_ferd_audit_row();
create trigger ferd_prefix_rules_audit after insert or update or delete on public.ferd_prefix_rules for each row execute function private.tg_ferd_audit_row();
create trigger ferd_departments_audit after insert or update or delete on public.ferd_departments for each row execute function private.tg_ferd_audit_row();
create trigger ferd_modules_audit after update on public.ferd_modules for each row execute function private.tg_ferd_audit_row();
create trigger ferd_department_modules_audit after insert or update or delete on public.ferd_department_modules for each row execute function private.tg_ferd_audit_row();
create trigger ferd_products_audit after insert or update or delete on public.ferd_products for each row execute function private.tg_ferd_audit_row();
create trigger ferd_entitlements_audit after insert or update or delete on public.ferd_entitlements for each row execute function private.tg_ferd_audit_row();
create trigger ferd_student_records_audit after insert or update or delete on public.ferd_student_records for each row execute function private.tg_ferd_audit_row();

-- ---------------------------------------------------------------------------
-- Sign-up: a FERD registration creates a pending student, never a privileged account
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_oauth boolean := coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email';
  v_ferd boolean := not v_oauth and v_meta ->> 'portal' = 'ferd';
  v_role public.user_role := 'project_owner';
  v_status public.account_status := 'pending';
  v_name text := left(trim(coalesce(v_meta ->> 'full_name', v_meta ->> 'name', '')), 120);
  v_require boolean;
  v_key text;
begin
  if v_oauth or v_ferd then
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
  if v_ferd then
    -- Only the registration number, name and contact details come from the form. Department is derived
    -- from the prefix rules and the status always starts as pending, whatever the client sent.
    v_key := private.ferd_regno_key(v_meta ->> 'reg_no');
    insert into public.ferd_students (user_id, reg_no, reg_no_key, full_name, phone, year_of_study, department_id)
    values (new.id, left(upper(trim(v_meta ->> 'reg_no')), 30), v_key, v_name,
            nullif(left(trim(coalesce(v_meta ->> 'phone', '')), 20), ''),
            case when (v_meta ->> 'year_of_study') ~ '^[1-8]$' then (v_meta ->> 'year_of_study')::smallint end,
            private.ferd_department_for(v_key));
    return new;
  end if;
  perform private.notify_admins('account', 'New account registration',
    format('%s registered as %s%s.', v_name, replace(v_role::text, '_', ' '), case when v_oauth then ' (Google sign-in)' else '' end),
    '/dashboard/admin/users', null, new.id);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.ferd_departments enable row level security;
alter table public.ferd_prefix_rules enable row level security;
alter table public.ferd_staff enable row level security;
alter table public.ferd_student_records enable row level security;
alter table public.ferd_students enable row level security;
alter table public.ferd_login_attempts enable row level security;
alter table public.ferd_audit_logs enable row level security;
alter table public.ferd_modules enable row level security;
alter table public.ferd_department_modules enable row level security;
alter table public.ferd_courses enable row level security;
alter table public.ferd_products enable row level security;
alter table public.ferd_content enable row level security;
alter table public.ferd_files enable row level security;
alter table public.ferd_payments enable row level security;
alter table public.ferd_entitlements enable row level security;
alter table public.ferd_notifications enable row level security;
alter table public.ferd_bookmarks enable row level security;
alter table public.ferd_download_logs enable row level security;

-- Departments are public information (shown on the FERD landing page).
create policy ferd_departments_select on public.ferd_departments for select to anon, authenticated using (is_active or private.ferd_role() is not null);
create policy ferd_departments_write on public.ferd_departments for all to authenticated using (private.ferd_is_super()) with check (private.ferd_is_super());

create policy ferd_prefix_rules_select on public.ferd_prefix_rules for select to authenticated using (private.ferd_role() is not null);
create policy ferd_prefix_rules_write on public.ferd_prefix_rules for all to authenticated using (private.ferd_is_super()) with check (private.ferd_is_super());

-- Staff: each person sees their own role; only the Super Admin sees and changes the list.
create policy ferd_staff_select on public.ferd_staff for select to authenticated using (user_id = (select auth.uid()) or private.ferd_is_super());
create policy ferd_staff_write on public.ferd_staff for all to authenticated using (private.ferd_is_super()) with check (private.ferd_is_super());

create policy ferd_student_records_select on public.ferd_student_records for select to authenticated
  using (private.ferd_is_super() or private.ferd_manages_department(department_id));
create policy ferd_student_records_write on public.ferd_student_records for all to authenticated
  using (private.ferd_is_super() or private.ferd_manages_department(department_id))
  with check (private.ferd_is_super() or private.ferd_manages_department(department_id));

-- Students: own row, or the administrators of that department. Unassigned students are visible to every
-- department administrator so that one of them can claim them.
create policy ferd_students_select on public.ferd_students for select to authenticated using (
  user_id = (select auth.uid()) or private.ferd_manages_department(department_id)
  or (department_id is null and private.ferd_role() = 'department_admin')
  or private.ferd_role() = 'finance_admin'
);
create policy ferd_students_update on public.ferd_students for update to authenticated
  using (user_id = (select auth.uid()) or private.ferd_manages_department(department_id) or (department_id is null and private.ferd_role() = 'department_admin'))
  with check (user_id = (select auth.uid()) or private.ferd_manages_department(department_id));

create policy ferd_audit_logs_select on public.ferd_audit_logs for select to authenticated using (private.ferd_is_super());

create policy ferd_modules_select on public.ferd_modules for select to authenticated using (true);
create policy ferd_modules_update on public.ferd_modules for update to authenticated using (private.ferd_is_super()) with check (private.ferd_is_super());
create policy ferd_department_modules_select on public.ferd_department_modules for select to authenticated using (true);
create policy ferd_department_modules_write on public.ferd_department_modules for all to authenticated using (private.ferd_is_super()) with check (private.ferd_is_super());

create policy ferd_courses_select on public.ferd_courses for select to authenticated using (
  private.ferd_role() is not null or (private.ferd_is_student() and is_active and department_id = private.ferd_student_department())
);
create policy ferd_courses_write on public.ferd_courses for all to authenticated
  using (private.ferd_manages_department(department_id)) with check (private.ferd_manages_department(department_id));

create policy ferd_products_select on public.ferd_products for select to authenticated using (
  private.ferd_role() is not null or (private.ferd_is_student() and (is_active or exists (
    select 1 from public.ferd_entitlements e where e.product_id = ferd_products.id and e.user_id = (select auth.uid()))))
);
-- Prices and terms are global commercial settings: Super Admin only.
create policy ferd_products_write on public.ferd_products for all to authenticated using (private.ferd_is_super()) with check (private.ferd_is_super());

-- Content: staff see everything; a verified student sees live items of their department.
-- Reading a premium item's description is allowed; its files are released only by ferd_can_access_content.
create policy ferd_content_select on public.ferd_content for select to authenticated using (
  private.ferd_role() is not null
  or (private.ferd_is_student() and private.ferd_is_live(status, publish_at, expires_at)
      and (cardinality(departments) = 0 or private.ferd_student_department() = any (departments)))
);
create policy ferd_content_insert on public.ferd_content for insert to authenticated with check (private.ferd_can_write_content(type, departments));
create policy ferd_content_update on public.ferd_content for update to authenticated
  using (private.ferd_can_write_content(type, departments)) with check (private.ferd_can_write_content(type, departments));
create policy ferd_content_delete on public.ferd_content for delete to authenticated using (private.ferd_can_write_content(type, departments));

create policy ferd_files_select on public.ferd_files for select to authenticated
  using (exists (select 1 from public.ferd_content c where c.id = content_id));
create policy ferd_files_insert on public.ferd_files for insert to authenticated
  with check (exists (select 1 from public.ferd_content c where c.id = content_id and private.ferd_can_write_content(c.type, c.departments)));
create policy ferd_files_update on public.ferd_files for update to authenticated
  using (exists (select 1 from public.ferd_content c where c.id = content_id and private.ferd_can_write_content(c.type, c.departments)))
  with check (exists (select 1 from public.ferd_content c where c.id = content_id and private.ferd_can_write_content(c.type, c.departments)));
create policy ferd_files_delete on public.ferd_files for delete to authenticated
  using (exists (select 1 from public.ferd_content c where c.id = content_id and private.ferd_can_write_content(c.type, c.departments)));

-- Payments: a student sees their own; finance and the Super Admin see all. Nobody writes them through the API.
create policy ferd_payments_select on public.ferd_payments for select to authenticated
  using (user_id = (select auth.uid()) or private.ferd_role() in ('super_admin', 'finance_admin'));

create policy ferd_entitlements_select on public.ferd_entitlements for select to authenticated
  using (user_id = (select auth.uid()) or private.ferd_role() in ('super_admin', 'finance_admin'));
-- Manual grants and revocations: Super Admin only, always attributed to them, always audited.
create policy ferd_entitlements_insert on public.ferd_entitlements for insert to authenticated
  with check (private.ferd_is_super() and source = 'grant' and granted_by = (select auth.uid()));
create policy ferd_entitlements_update on public.ferd_entitlements for update to authenticated
  using (private.ferd_is_super()) with check (private.ferd_is_super());

create policy ferd_notifications_select on public.ferd_notifications for select to authenticated using (user_id = (select auth.uid()));
create policy ferd_notifications_update on public.ferd_notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy ferd_notifications_delete on public.ferd_notifications for delete to authenticated using (user_id = (select auth.uid()));

create policy ferd_bookmarks_all on public.ferd_bookmarks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and private.ferd_is_student());

create policy ferd_download_logs_select on public.ferd_download_logs for select to authenticated
  using (user_id = (select auth.uid()) or private.ferd_is_super());

-- Notifications may only be marked read by their owner; the text is fixed.
create function private.tg_ferd_notifications_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and (new.user_id, new.title, new.body, new.link, new.created_at)
     is distinct from (old.user_id, old.title, old.body, old.link, old.created_at) then
    raise exception 'Only the read status of a notification can be changed';
  end if;
  return new;
end $$;
create trigger ferd_notifications_guard before update on public.ferd_notifications
  for each row execute function private.tg_ferd_notifications_guard();

-- ---------------------------------------------------------------------------
-- Private storage for every FERD file (free or premium). Students never read the bucket directly:
-- the server checks access and hands out a short-lived signed link.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ferd-files', 'ferd-files', false, 52428800,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg', 'image/png', 'image/webp',
    'application/geo+json', 'application/vnd.google-earth.kml+xml', 'application/zip', 'text/csv'
  ]
);

create policy ferd_files_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'ferd-files' and private.ferd_role() is not null);
create policy ferd_files_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ferd-files' and private.ferd_role() in ('super_admin', 'department_admin', 'content_manager', 'opportunities_manager', 'project_manager'));
create policy ferd_files_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ferd-files' and private.ferd_role() in ('super_admin', 'department_admin', 'content_manager', 'opportunities_manager', 'project_manager'));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on
  public.ferd_departments, public.ferd_prefix_rules, public.ferd_staff, public.ferd_student_records, public.ferd_students,
  public.ferd_login_attempts, public.ferd_audit_logs, public.ferd_modules, public.ferd_department_modules, public.ferd_courses,
  public.ferd_products, public.ferd_content, public.ferd_files, public.ferd_payments, public.ferd_entitlements,
  public.ferd_notifications, public.ferd_bookmarks, public.ferd_download_logs
from anon, authenticated;
grant select on public.ferd_departments to anon;
grant select, insert, update, delete on
  public.ferd_departments, public.ferd_prefix_rules, public.ferd_staff, public.ferd_student_records,
  public.ferd_department_modules, public.ferd_courses, public.ferd_products, public.ferd_content, public.ferd_files,
  public.ferd_bookmarks
to authenticated;
grant select, update on public.ferd_students, public.ferd_modules to authenticated;
grant select, insert, update on public.ferd_entitlements to authenticated;
grant select, update, delete on public.ferd_notifications to authenticated;
grant select on public.ferd_payments, public.ferd_audit_logs, public.ferd_download_logs to authenticated;

revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.ferd_role(), private.ferd_is_super(), private.ferd_staff_department(), private.ferd_manages_department(uuid),
  private.ferd_is_student(), private.ferd_student_department(), private.ferd_is_live(text, timestamptz, timestamptz),
  private.ferd_can_write_content(text, uuid[])
to authenticated;
grant execute on function private.ferd_role(), private.ferd_is_live(text, timestamptz, timestamptz) to anon;

revoke execute on function public.ferd_can_access_content(uuid) from public, anon;
grant execute on function public.ferd_can_access_content(uuid) to authenticated;
revoke execute on function public.ferd_finalize_payment(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.ferd_finalize_payment(text, text, text, text, integer) to service_role;
