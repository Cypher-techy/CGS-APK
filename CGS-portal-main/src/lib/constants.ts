import type { Role } from "@/lib/types";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
type Labelled = Record<string, { label: string; tone: Tone }>;

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  project_manager: "Project Manager",
  project_owner: "Project Owner / Landowner",
  field_officer: "Field Officer",
  gis_analyst: "GIS Analyst",
  mrv_specialist: "MRV Specialist",
  investor: "Investor / Project Developer",
  community_member: "Community Member",
};

/** Roles with a working dashboard in this release. */
export const MVP_ROLES: Role[] = ["super_admin", "project_manager", "project_owner", "field_officer"];
/** Roles that work on CGS projects and are appointed by an administrator. */
export const STAFF_ROLES: Role[] = ["project_manager", "field_officer", "gis_analyst", "mrv_specialist"];
/** Roles a visitor may request when registering. Administrators are appointed, never self-registered. */
export const SELF_REGISTER_ROLES: Role[] = ["project_owner", "field_officer", "project_manager", "investor", "community_member"];

export const ACCOUNT_STATUS: Labelled = {
  pending: { label: "Pending approval", tone: "warning" },
  active: { label: "Active", tone: "success" },
  suspended: { label: "Suspended", tone: "danger" },
  terminated: { label: "Terminated", tone: "neutral" },
};

export const PROJECT_STATUS: Labelled = {
  draft: { label: "Draft", tone: "neutral" },
  pending_approval: { label: "Pending Approval", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  revision_required: { label: "Revision Required", tone: "warning" },
  active: { label: "Active", tone: "success" },
  on_hold: { label: "On Hold", tone: "neutral" },
  completed: { label: "Completed", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};

export const TASK_STATUS: Labelled = {
  todo: { label: "To Do", tone: "neutral" },
  in_progress: { label: "In Progress", tone: "info" },
  under_review: { label: "Under Review", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
};

export const TASK_PRIORITY: Labelled = {
  low: { label: "Low", tone: "neutral" },
  medium: { label: "Medium", tone: "info" },
  high: { label: "High", tone: "danger" },
};

export const MILESTONE_STATUS: Labelled = {
  pending: { label: "Pending", tone: "neutral" },
  completed: { label: "Completed", tone: "success" },
};

export const DOCUMENT_STATUS: Labelled = {
  pending: { label: "Pending review", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};

export const MONITORING_STATUS: Labelled = {
  submitted: { label: "Awaiting review", tone: "warning" },
  approved: { label: "Reviewed and approved", tone: "success" },
  revision_required: { label: "Correction required", tone: "danger" },
};

export const DOCUMENT_CATEGORIES: Record<string, string> = {
  land_ownership: "Land ownership",
  agreement: "Agreement",
  environmental_assessment: "Environmental assessment",
  monitoring_evidence: "Monitoring evidence",
  map_dataset: "Map / GIS dataset",
  report: "Report",
  other: "Other",
};

export const MEMBER_ROLES: Record<string, string> = {
  field_officer: "Field officer",
  team_member: "Team member",
  gis_analyst: "GIS analyst",
  mrv_specialist: "MRV specialist",
  community_member: "Community member",
  observer: "Observer",
};
/** Team roles that take part in project work. Community members and observers have read-only, limited access. */
export const STAFF_MEMBER_ROLES = ["field_officer", "team_member", "gis_analyst", "mrv_specialist"];

export const LISTING_STATUS: Labelled = {
  draft: { label: "Draft", tone: "neutral" },
  pending_review: { label: "Awaiting CGS review", tone: "warning" },
  published: { label: "Published", tone: "success" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};

/** Development stage of a carbon project. Validated, verified and issued require a named standard and evidence. */
export const DEVELOPMENT_STAGES: Labelled = {
  proposed: { label: "Proposed", tone: "neutral" },
  under_assessment: { label: "Under assessment", tone: "info" },
  validated: { label: "Validated", tone: "success" },
  under_monitoring: { label: "Under monitoring", tone: "info" },
  verified: { label: "Verified", tone: "success" },
  issued: { label: "Credits issued", tone: "success" },
};
export const EVIDENCE_STAGES = ["validated", "verified", "issued"];

/**
 * Carbon project lifecycle. A stage describes the work in progress; it is never a credit claim.
 * `evidence` is the plain label shown next to figures at that stage.
 */
export const LIFECYCLE_STAGES: Record<string, { label: string; tone: Tone; evidence: string }> = {
  idea: { label: "Project idea", tone: "neutral", evidence: "Under development" },
  screening: { label: "Screening", tone: "neutral", evidence: "Under development" },
  feasibility: { label: "Feasibility", tone: "info", evidence: "Under development" },
  development: { label: "Project development", tone: "info", evidence: "Under development" },
  validation: { label: "Validation", tone: "info", evidence: "Under development" },
  registration: { label: "Registration", tone: "info", evidence: "Under development" },
  implementation: { label: "Implementation", tone: "success", evidence: "Projected" },
  monitoring: { label: "Monitoring", tone: "success", evidence: "Monitored" },
  verification: { label: "Verification", tone: "warning", evidence: "Awaiting verification" },
  credit_issuance: { label: "Credit issuance", tone: "warning", evidence: "Awaiting issuance" },
  marketplace: { label: "Marketplace", tone: "success", evidence: "Listed" },
};
/** Stages a project owner may declare. Later stages are set by the project manager or CGS. */
export const EARLY_STAGES = ["idea", "screening", "feasibility", "development"];

export const ORGANIZATION_KINDS: Record<string, string> = {
  company: "Company",
  ngo: "NGO / non-profit",
  community_group: "Community group",
  cooperative: "Cooperative",
  government: "Government body",
  research: "Research institution",
  other: "Other",
};

export const SITE_KINDS: Record<string, string> = {
  site: "Project site",
  monitoring_point: "Monitoring point",
  nursery: "Nursery",
  water_point: "Water point",
  office: "Field office",
  other: "Other",
};

export const INTEREST_STATUS: Labelled = {
  submitted: { label: "Submitted", tone: "warning" },
  under_review: { label: "Under review", tone: "info" },
  due_diligence: { label: "Due diligence", tone: "info" },
  negotiation: { label: "Negotiation", tone: "info" },
  agreement: { label: "Agreement reached", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
};
export const INTEREST_KINDS: Record<string, string> = {
  expression_of_interest: "Expression of interest",
  partnership_enquiry: "Partnership enquiry",
};

export const GRIEVANCE_STATUS: Labelled = {
  open: { label: "Open", tone: "warning" },
  in_review: { label: "In review", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

export const ESTIMATE_KINDS: Record<string, string> = {
  baseline: "Baseline estimate",
  potential: "Estimated carbon potential",
  monitoring_period: "Monitoring period estimate",
};
export const SCHEDULE_FREQUENCIES: Record<string, string> = {
  once: "Once",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  biannual: "Twice a year",
  annual: "Annually",
};

export interface MeasurementField {
  key: string;
  label: string;
  unit?: string;
  type: "number" | "text";
}

/** Observation types and the measurements captured for each (stored in monitoring_records.measurements). */
export const OBSERVATION_TYPES: Record<string, { label: string; fields: MeasurementField[] }> = {
  tree_planting: {
    label: "Tree planting",
    fields: [
      { key: "trees_planted", label: "Trees planted", unit: "trees", type: "number" },
      { key: "species", label: "Species planted", type: "text" },
      { key: "area_planted_ha", label: "Area planted", unit: "ha", type: "number" },
    ],
  },
  tree_survival: {
    label: "Tree survival",
    fields: [
      { key: "trees_assessed", label: "Trees assessed", unit: "trees", type: "number" },
      { key: "trees_surviving", label: "Trees surviving", unit: "trees", type: "number" },
      { key: "average_height_cm", label: "Average height", unit: "cm", type: "number" },
    ],
  },
  vegetation: {
    label: "Forest cover and vegetation",
    fields: [
      { key: "canopy_cover_percent", label: "Canopy cover", unit: "%", type: "number" },
      { key: "plot_size_m2", label: "Sample plot size", unit: "m²", type: "number" },
      { key: "dominant_species", label: "Dominant species", type: "text" },
    ],
  },
  biodiversity: {
    label: "Biodiversity",
    fields: [
      { key: "species_observed", label: "Species observed", type: "text" },
      { key: "individuals_counted", label: "Individuals counted", unit: "count", type: "number" },
    ],
  },
  soil: {
    label: "Soil",
    fields: [
      { key: "soil_ph", label: "Soil pH", unit: "pH", type: "number" },
      { key: "moisture_percent", label: "Soil moisture", unit: "%", type: "number" },
      { key: "sample_depth_cm", label: "Sample depth", unit: "cm", type: "number" },
    ],
  },
  water_quality: {
    label: "Water quality",
    fields: [
      { key: "water_ph", label: "Water pH", unit: "pH", type: "number" },
      { key: "turbidity_ntu", label: "Turbidity", unit: "NTU", type: "number" },
      { key: "temperature_c", label: "Temperature", unit: "°C", type: "number" },
    ],
  },
  land_use: {
    label: "Land-use change",
    fields: [
      { key: "previous_land_use", label: "Previous land use", type: "text" },
      { key: "current_land_use", label: "Current land use", type: "text" },
      { key: "area_affected_ha", label: "Area affected", unit: "ha", type: "number" },
    ],
  },
  general: { label: "General field observation", fields: [] },
};

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** Allowed upload types by file extension. The storage bucket enforces the same list. */
export const UPLOAD_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  geojson: "application/geo+json",
  kml: "application/vnd.google-earth.kml+xml",
  zip: "application/zip",
  csv: "text/csv",
};
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

const NOTIFICATIONS: NavItem = { label: "Notifications", href: "/dashboard/notifications", icon: "bell" };
const PROFILE: NavItem = { label: "Profile", href: "/dashboard/profile", icon: "user" };
const DASHBOARD: NavItem = { label: "Dashboard", href: "/dashboard", icon: "dashboard" };
const MAP: NavItem = { label: "Earth & GIS", href: "/dashboard/gis", icon: "globe" };
const ORGANIZATIONS: NavItem = { label: "Organizations", href: "/dashboard/organizations", icon: "building" };
const ENQUIRIES: NavItem = { label: "Investor Enquiries", href: "/dashboard/marketplace/enquiries", icon: "handshake" };

export function navFor(role: Role): NavItem[] {
  switch (role) {
    case "super_admin":
      return [
        DASHBOARD,
        { label: "Global Command Center", href: "/dashboard/command", icon: "globe" },
        { label: "Users", href: "/dashboard/admin/users", icon: "users" },
        ORGANIZATIONS,
        { label: "Projects", href: "/dashboard/projects", icon: "folder" },
        { label: "Approvals", href: "/dashboard/admin/approvals", icon: "check" },
        { label: "GIS Workspace", href: "/dashboard/gis", icon: "map" },
        { label: "Marketplace", href: "/dashboard/marketplace", icon: "store" },
        ENQUIRIES,
        { label: "FERD Student Portal", href: "/ferd/admin", icon: "graduation" },
        { label: "Activity Logs", href: "/dashboard/admin/activity", icon: "history" },
        { label: "Reports", href: "/dashboard/reports", icon: "chart" },
        { label: "Settings", href: "/dashboard/admin/settings", icon: "settings" },
      ];
    case "project_manager":
      return [
        DASHBOARD,
        { label: "My Projects", href: "/dashboard/projects", icon: "folder" },
        { label: "Tasks", href: "/dashboard/tasks", icon: "tasks" },
        { label: "Milestones", href: "/dashboard/milestones", icon: "flag" },
        { label: "Documents", href: "/dashboard/documents", icon: "file" },
        { label: "Monitoring", href: "/dashboard/monitoring", icon: "leaf" },
        MAP,
        ENQUIRIES,
        ORGANIZATIONS,
        { label: "Reports", href: "/dashboard/reports", icon: "chart" },
        NOTIFICATIONS,
      ];
    case "project_owner":
      return [
        DASHBOARD,
        { label: "My Projects", href: "/dashboard/projects", icon: "folder" },
        { label: "Submit Project", href: "/dashboard/projects/new", icon: "plus" },
        { label: "Documents", href: "/dashboard/documents", icon: "file" },
        { label: "Monitoring Updates", href: "/dashboard/monitoring", icon: "leaf" },
        MAP,
        ENQUIRIES,
        ORGANIZATIONS,
        { label: "Reports", href: "/dashboard/reports", icon: "chart" },
        NOTIFICATIONS,
        PROFILE,
      ];
    case "field_officer":
      return [
        DASHBOARD,
        { label: "Assigned Projects", href: "/dashboard/projects", icon: "folder" },
        { label: "My Tasks", href: "/dashboard/tasks", icon: "tasks" },
        { label: "Field Monitoring", href: "/dashboard/monitoring", icon: "leaf" },
        MAP,
        { label: "Reports", href: "/dashboard/reports", icon: "chart" },
        NOTIFICATIONS,
        PROFILE,
      ];
    case "gis_analyst":
      return [
        DASHBOARD,
        { label: "Assigned Projects", href: "/dashboard/projects", icon: "folder" },
        MAP,
        { label: "Spatial Datasets", href: "/dashboard/documents", icon: "file" },
        { label: "Reports", href: "/dashboard/reports", icon: "chart" },
        NOTIFICATIONS,
        PROFILE,
      ];
    case "mrv_specialist":
      return [
        DASHBOARD,
        { label: "Assigned Projects", href: "/dashboard/projects", icon: "folder" },
        { label: "Field Observations", href: "/dashboard/monitoring", icon: "leaf" },
        { label: "MRV Records", href: "/dashboard/mrv", icon: "check" },
        MAP,
        { label: "Reports", href: "/dashboard/reports", icon: "chart" },
        NOTIFICATIONS,
        PROFILE,
      ];
    case "investor":
      return [
        DASHBOARD,
        { label: "Marketplace", href: "/dashboard/marketplace", icon: "store" },
        { label: "Saved Projects", href: "/dashboard/marketplace?saved=1", icon: "bookmark" },
        { label: "My Enquiries", href: "/dashboard/marketplace/enquiries", icon: "handshake" },
        ORGANIZATIONS,
        NOTIFICATIONS,
        PROFILE,
      ];
    case "community_member":
      return [
        DASHBOARD,
        { label: "Community Projects", href: "/dashboard/projects", icon: "folder" },
        { label: "Announcements and Feedback", href: "/dashboard/community", icon: "megaphone" },
        { label: "Monitoring Updates", href: "/dashboard/monitoring", icon: "leaf" },
        MAP,
        NOTIFICATIONS,
        PROFILE,
      ];
    default:
      return [DASHBOARD, NOTIFICATIONS, PROFILE];
  }
}
