-- Daily deadline reminders at 04:00 UTC (07:00 East Africa Time).
create extension if not exists pg_cron;

select cron.schedule(
  'cgs-deadline-reminders',
  '0 4 * * *',
  $$select private.send_deadline_reminders()$$
);
