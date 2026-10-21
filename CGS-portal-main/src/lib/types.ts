export type Role =
  | "super_admin"
  | "project_manager"
  | "project_owner"
  | "field_officer"
  | "gis_analyst"
  | "mrv_specialist"
  | "investor"
  | "community_member";

export type AccountStatus = "pending" | "active" | "suspended" | "terminated";

export type ProjectStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "revision_required"
  | "active"
  | "on_hold"
  | "completed"
  | "rejected";

export type TaskStatus = "todo" | "in_progress" | "under_review" | "completed";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  organization: string | null;
  location: string | null;
  role: Role;
  status: AccountStatus;
  email_notifications: boolean;
  terms_accepted_at: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  category_id: string | null;
  description: string;
  objectives: string | null;
  country: string;
  county: string;
  sub_county: string | null;
  organization_id: string | null;
  lifecycle_stage: string;
  is_public: boolean;
  location_description: string | null;
  latitude: number | null;
  longitude: number | null;
  area_ha: number | null;
  start_date: string | null;
  expected_end_date: string | null;
  status: ProjectStatus;
  progress_percent: number;
  owner_id: string;
  manager_id: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Result of a server action, shown by <ActionForm>. */
export type ActionState = { ok: boolean; message: string } | null;
