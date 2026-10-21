-- Every FERD student must have a mobile number on file, stored as 2547XXXXXXXX or 2541XXXXXXXX, because
-- it is the number the M-Pesa payment prompt is sent to. The registration form normalises what the student
-- types; this constraint makes the database refuse a registration without a valid number as well.
-- NOT VALID: applies to every new or changed row without re-checking rows stored earlier.

alter table public.ferd_students
  add constraint ferd_students_phone_required check (phone is not null and phone ~ '^254[17][0-9]{8}$') not valid;
