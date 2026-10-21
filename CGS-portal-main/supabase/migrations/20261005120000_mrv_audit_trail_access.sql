-- MRV specialists can read the audit trail of monitoring records, carbon estimates and listing stages
-- for the projects they are assigned to.
alter policy activity_select on public.activity_logs using (
  private.is_admin()
  or (project_id is not null and private.can_manage_project(project_id))
  or (project_id is not null and entity_type in ('project', 'milestone', 'task') and private.is_project_staff(project_id))
  or (project_id is not null and entity_type in ('monitoring_record', 'carbon_estimate', 'listing')
      and private.has_member_role(project_id, 'mrv_specialist'))
);
