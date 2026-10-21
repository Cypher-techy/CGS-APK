-- FERD: a person who already has a Cypher Green Systems account (for example one created with Google sign-in)
-- can add their student record to that account, and administrators are told about every new student.

-- Adds a student record to the caller's own account. The department comes from the prefix rules and the status
-- from the verification setting, exactly as for a new registration; nothing about them is taken from the caller.
create function public.ferd_enroll_self(p_full_name text, p_reg_no text, p_phone text, p_year_of_study smallint default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text := private.ferd_regno_key(p_reg_no);
  v_name text := left(trim(coalesce(p_full_name, '')), 120);
  v_department uuid;
  v_auto boolean;
  v_status text;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.status not in ('suspended', 'terminated')) then
    raise exception 'Sign in to your account first';
  end if;
  if exists (select 1 from public.ferd_students s where s.user_id = v_uid) then
    raise exception 'Your account already has a student record';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'Enter your full name as it appears on your student ID';
  end if;
  if v_key !~ '^[A-Z][0-9]{2}/[0-9]{3,6}/[0-9]{2}$' then
    raise exception 'Write your registration number in the format N12/12345/25';
  end if;
  if p_phone is null or p_phone !~ '^254[17][0-9]{8}$' then
    raise exception 'A valid mobile number is required';
  end if;
  if exists (select 1 from public.ferd_students s where s.reg_no_key = v_key) then
    raise exception 'This registration number already has an account. If it is yours, sign in to that account; if not, contact FERD support';
  end if;

  v_department := private.ferd_department_for(v_key);
  select auto_verify_students into v_auto from public.ferd_settings limit 1;
  v_status := case when coalesce(v_auto, false) and v_department is not null then 'verified' else 'pending' end;

  insert into public.ferd_students (user_id, reg_no, reg_no_key, full_name, phone, year_of_study, department_id, status, verified_at)
  values (v_uid, left(upper(trim(p_reg_no)), 30), v_key, v_name, p_phone,
          case when p_year_of_study between 1 and 8 then p_year_of_study end,
          v_department, v_status, case when v_status = 'verified' then now() end);
  perform private.ferd_audit(case when v_status = 'verified' then 'student.auto_verified' else 'student.registered' end,
    'ferd_students', v_uid::text, jsonb_build_object('reg_no', left(upper(trim(p_reg_no)), 30), 'department', v_department, 'existing_account', true));
  return v_status;
end $$;

revoke execute on function public.ferd_enroll_self(text, text, text, smallint) from public, anon;
grant execute on function public.ferd_enroll_self(text, text, text, smallint) to authenticated;

-- Every new student, however the record was created, is announced to the administrators in their
-- notifications, with a link to the Students page.
create function private.tg_ferd_students_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify_admins('ferd_registration', 'New FERD student',
    format('%s (%s) registered%s.', new.full_name, new.reg_no,
      case when new.status = 'verified' then ' and was verified automatically'
           when new.department_id is null then '. The registration number matches no department: assign one'
           else ' and is waiting for review' end),
    '/ferd/admin/students?status=' || new.status, null, new.user_id);
  return null;
end $$;
create trigger ferd_students_after_insert after insert on public.ferd_students
  for each row execute function private.tg_ferd_students_after_insert();

-- Only the new function is closed here: a schema-wide revoke would also withdraw the two helpers that
-- visitors need for the public department list.
revoke execute on function private.tg_ferd_students_after_insert() from public, anon, authenticated;
