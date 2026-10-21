-- FERD registration numbers are written N12/12345/25: a letter and two digits (programme prefix), the
-- student's serial number, and the two-digit year of admission. The form checks this; these constraints make
-- the database refuse anything else as well, including sign-ups that do not come through the form.
-- NOT VALID: the rule applies to every new or changed row without re-checking rows stored earlier.

alter table public.ferd_students
  add constraint ferd_students_reg_no_format check (reg_no_key ~ '^[A-Z][0-9]{2}/[0-9]{3,6}/[0-9]{2}$') not valid;

alter table public.ferd_student_records
  add constraint ferd_student_records_reg_no_format check (reg_no_key ~ '^[A-Z][0-9]{2}/[0-9]{3,6}/[0-9]{2}$') not valid;
