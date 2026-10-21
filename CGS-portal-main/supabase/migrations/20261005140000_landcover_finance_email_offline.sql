-- CGS Project Portal: land-cover analysis results, benefit-sharing and financial records,
-- e-mail delivery of notifications and support for offline field capture.

-- ---------------------------------------------------------------------------
-- Land cover: per-year class areas inside a project boundary
-- ---------------------------------------------------------------------------
create table public.land_cover_analyses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  year smallint not null check (year between 2017 and 2100),
  -- Hectares per land-cover class, e.g. {"trees": 12.4, "crops": 3.1}
  classes jsonb not null,
  boundary_area_ha numeric(14, 2) not null,
  source text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, year)
);
create index land_cover_analyses_creator_idx on public.land_cover_analyses (created_by);
alter table public.land_cover_analyses enable row level security;

create policy land_cover_select on public.land_cover_analyses for select to authenticated
  using (private.can_view_project(project_id));
create policy land_cover_insert on public.land_cover_analyses for insert to authenticated
  with check (private.can_manage_project(project_id) or private.has_member_role(project_id, 'gis_analyst') or private.has_member_role(project_id, 'mrv_specialist'));
create policy land_cover_update on public.land_cover_analyses for update to authenticated
  using (private.can_manage_project(project_id) or private.has_member_role(project_id, 'gis_analyst') or private.has_member_role(project_id, 'mrv_specialist'))
  with check (private.can_manage_project(project_id) or private.has_member_role(project_id, 'gis_analyst') or private.has_member_role(project_id, 'mrv_specialist'));
create policy land_cover_delete on public.land_cover_analyses for delete to authenticated
  using (private.can_manage_project(project_id) or private.has_member_role(project_id, 'gis_analyst'));

create function private.tg_land_cover_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_when = 'BEFORE' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
    return new;
  end if;
  perform private.log_activity('land_cover.analysed', 'project', new.project_id, new.project_id, jsonb_build_object('year', new.year));
  return null;
end $$;
create trigger land_cover_before_write before insert or update on public.land_cover_analyses
  for each row execute function private.tg_land_cover_write();
create trigger land_cover_after_write after insert or update on public.land_cover_analyses
  for each row execute function private.tg_land_cover_write();

-- ---------------------------------------------------------------------------
-- Benefit sharing and financial records (records only: the portal makes no payments)
-- ---------------------------------------------------------------------------
create table public.benefit_sharing_terms (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  beneficiary text not null check (char_length(beneficiary) between 2 and 160),
  share_percent numeric(5, 2) check (share_percent is null or share_percent between 0 and 100),
  description text not null check (char_length(description) between 5 and 2000),
  agreed_on date,
  document_id uuid references public.documents (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index benefit_sharing_terms_project_idx on public.benefit_sharing_terms (project_id);
create index benefit_sharing_terms_document_idx on public.benefit_sharing_terms (document_id);
create index benefit_sharing_terms_creator_idx on public.benefit_sharing_terms (created_by);
alter table public.benefit_sharing_terms enable row level security;

create table public.financial_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('budget', 'expense', 'income', 'benefit_payment')),
  category text check (category is null or char_length(category) <= 80),
  description text not null check (char_length(description) between 3 and 500),
  amount numeric(16, 2) not null check (amount > 0),
  currency text not null default 'KES' check (currency in ('KES', 'USD', 'EUR')),
  record_date date not null,
  payment_status text not null default 'paid' check (payment_status in ('planned', 'pending', 'paid')),
  beneficiary text check (beneficiary is null or char_length(beneficiary) <= 160),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_records_project_idx on public.financial_records (project_id, record_date desc);
create index financial_records_creator_idx on public.financial_records (created_by);
alter table public.financial_records enable row level security;

create function private.tg_finance_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  if tg_when = 'BEFORE' then
    if tg_op = 'INSERT' then
      new.created_by := coalesce((select auth.uid()), new.created_by);
      new.created_at := now();
    elsif tg_table_name = 'financial_records' then
      new.updated_at := now();
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform private.log_activity(tg_table_name || '.deleted', 'finance', old.id, old.project_id, '{}'::jsonb);
    return null;
  end if;
  if tg_table_name = 'financial_records' then
    perform private.log_activity('financial_record.' || lower(tg_op), 'finance', new.id, new.project_id,
      jsonb_build_object('kind', new.kind, 'amount', new.amount, 'currency', new.currency, 'payment_status', new.payment_status));
    if new.kind = 'benefit_payment' and (tg_op = 'INSERT' or new.payment_status <> old.payment_status) then
      select owner_id into v_owner from public.projects where id = new.project_id;
      perform private.notify(v_owner, 'finance', 'Benefit-sharing payment record ' || new.payment_status,
        format('%s %s to %s (%s).', new.currency, to_char(new.amount, 'FM999G999G999G990D00'), coalesce(new.beneficiary, 'beneficiary'), new.payment_status),
        '/dashboard/projects/' || new.project_id || '?tab=finance', new.project_id, new.id);
    end if;
  else
    perform private.log_activity('benefit_sharing.recorded', 'finance', new.id, new.project_id, jsonb_build_object('name', new.beneficiary));
  end if;
  return null;
end $$;
create trigger financial_records_before_write before insert or update on public.financial_records
  for each row execute function private.tg_finance_write();
create trigger financial_records_after_write after insert or update or delete on public.financial_records
  for each row execute function private.tg_finance_write();
create trigger benefit_terms_before_write before insert on public.benefit_sharing_terms
  for each row execute function private.tg_finance_write();
create trigger benefit_terms_after_write after insert or delete on public.benefit_sharing_terms
  for each row execute function private.tg_finance_write();

-- Benefit-sharing terms are open to every project participant.
create policy benefit_terms_select on public.benefit_sharing_terms for select to authenticated
  using (private.can_view_project(project_id));
create policy benefit_terms_insert on public.benefit_sharing_terms for insert to authenticated
  with check (private.can_manage_project(project_id));
create policy benefit_terms_delete on public.benefit_sharing_terms for delete to authenticated
  using (private.can_manage_project(project_id));

-- Financial records: the owner and the managers see everything; community members only see
-- benefit-sharing payments.
create policy financial_records_select on public.financial_records for select to authenticated using (
  private.can_manage_project(project_id)
  or private.is_project_owner(project_id)
  or (kind = 'benefit_payment' and private.has_member_role(project_id, 'community_member'))
);
create policy financial_records_insert on public.financial_records for insert to authenticated
  with check (private.can_manage_project(project_id));
create policy financial_records_update on public.financial_records for update to authenticated
  using (private.can_manage_project(project_id)) with check (private.can_manage_project(project_id));
create policy financial_records_delete on public.financial_records for delete to authenticated
  using (private.can_manage_project(project_id));

grant select, insert, update, delete on public.land_cover_analyses, public.benefit_sharing_terms, public.financial_records to authenticated;

-- ---------------------------------------------------------------------------
-- E-mail delivery of notifications
-- ---------------------------------------------------------------------------
-- Each user can switch notification e-mails off in their profile.
alter table public.profiles add column email_notifications boolean not null default true;
-- Set by the send-notification-emails Edge Function. email_error also marks rows that are being sent or were skipped.
alter table public.notifications add column emailed_at timestamptz, add column email_error text;
create index notifications_email_queue_idx on public.notifications (created_at) where emailed_at is null and email_error is null;

-- Used by pg_cron to call the Edge Function.
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Offline field capture: a client-generated id makes re-sent reports idempotent
-- ---------------------------------------------------------------------------
alter table public.monitoring_records add column client_id uuid unique;

revoke execute on all functions in schema private from public, anon;
