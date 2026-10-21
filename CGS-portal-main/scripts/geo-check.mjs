// End-to-end check of the geographic layer and its access rules against a real Supabase project:
// organizations, project geography, boundary and sites at registration, publishing to the public
// Explore map, the lifecycle stage guard, site-linked field records and the map feeds.
//
//   node --env-file=.env.local --env-file=.env.test.local scripts/geo-check.mjs
//
// Uses the test accounts described in the README, creates "[TEST]" records and deletes them again.
// Never run this against production data.

import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PASSWORD = process.env.TEST_PASSWORD;
if (!URL_ || !KEY || !PASSWORD) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and TEST_PASSWORD");

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${!condition && detail ? ` — ${detail}` : ""}`);
}
const denied = (res) => !!res.error || (Array.isArray(res.data) && res.data.length === 0);

async function signIn(name) {
  const client = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: `test.${name}@cgs-portal.test`, password: PASSWORD });
  if (error) throw new Error(`Sign-in failed for ${name}: ${error.message}`);
  return { client, id: data.user.id };
}

const [admin, manager, owner, officer, investor] = await Promise.all(["admin", "manager", "owner", "officer", "investor"].map(signIn));
const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
const kinds = (collection, kind, projectId) =>
  (collection?.features ?? []).filter((f) => f.properties.kind === kind && (!projectId || f.properties.project_id === projectId));

// A parcel of roughly 100 ha near Nakuru.
const parcel = { type: "Polygon", coordinates: [[[36.06, -0.31], [36.07, -0.31], [36.07, -0.3], [36.06, -0.3], [36.06, -0.31]]] };
const { data: category } = await owner.client.from("project_categories").select("id").eq("name", "Reforestation").single();
let projectId;
const orgIds = [];

try {
  // ---- Visitors ----------------------------------------------------------------------------
  const emptyFeed = await anon.rpc("explore_public");
  check("Visitors can read the public Explore feed", !emptyFeed.error && emptyFeed.data?.type === "FeatureCollection", emptyFeed.error?.message);
  check("Visitors cannot call the workspace map feed", !!(await anon.rpc("gis_features", { p_project: null })).error);
  check("Visitors cannot read organizations, sites or project insights",
    denied(await anon.from("organizations").select("id")) && denied(await anon.from("project_sites").select("id")) && !!(await anon.rpc("geo_project_insights")).error);

  // ---- Organizations -----------------------------------------------------------------------
  const org = await owner.client.from("organizations").insert({ name: `[TEST] Rift Restoration ${Date.now()}`, kind: "ngo", country: "Kenya", is_verified: true }).select().single();
  check("An active user can register an organization", !org.error, org.error?.message);
  orgIds.push(org.data.id);
  check("A new organization is never verified by its creator", org.data.is_verified === false);
  const membership = await owner.client.from("organization_members").select("member_role").eq("organization_id", org.data.id).eq("user_id", owner.id).maybeSingle();
  check("The creator becomes the organization's administrator", membership.data?.member_role === "admin");
  check("The creator cannot verify their own organization",
    !!(await owner.client.from("organizations").update({ is_verified: true }).eq("id", org.data.id).select()).error);
  check("An outsider cannot edit the organization", denied(await investor.client.from("organizations").update({ description: "hijacked" }).eq("id", org.data.id).select()));
  check("An outsider cannot see the organization's members", (await investor.client.from("organization_members").select("user_id").eq("organization_id", org.data.id)).data.length === 0);
  check("An outsider cannot add members", !!(await investor.client.rpc("add_organization_member", { p_org: org.data.id, p_email: "test.investor@cgs-portal.test", p_role: "admin" })).error);
  const added = await owner.client.rpc("add_organization_member", { p_org: org.data.id, p_email: "test.officer@cgs-portal.test", p_role: "member" });
  check("The organization administrator can add a member by e-mail", !added.error, added.error?.message);
  check("Adding an unknown e-mail address is refused", !!(await owner.client.rpc("add_organization_member", { p_org: org.data.id, p_email: "nobody@cgs-portal.test", p_role: "member" })).error);

  const foreign = await admin.client.from("organizations").insert({ name: `[TEST] Other Org ${Date.now()}`, kind: "company", country: "Kenya" }).select().single();
  orgIds.push(foreign.data.id);

  // ---- Project registration with geography ---------------------------------------------------
  const base = { name: "[TEST] Menengai slope restoration", category_id: category.id, description: "Automated geographic test project. Safe to delete.", country: "Kenya", county: "Nakuru", sub_county: "Bahati", latitude: -0.305, longitude: 36.065, area_ha: 95, owner_id: owner.id };
  check("An owner cannot declare a stage from validation onwards", !!(await owner.client.from("projects").insert({ ...base, lifecycle_stage: "verification" }).select()).error);
  check("An owner cannot attach an organization they do not belong to", !!(await owner.client.from("projects").insert({ ...base, organization_id: foreign.data.id }).select()).error);
  const created = await owner.client.from("projects").insert({ ...base, organization_id: org.data.id, lifecycle_stage: "feasibility", is_public: true }).select().single();
  check("An owner can register a project with country, county, coordinates, organization and stage", !created.error, created.error?.message);
  projectId = created.data.id;
  check("A new project is never public, whatever the owner sends", created.data.is_public === false);
  check("The declared coordinates are stored as a PostGIS point", created.data.location !== null);

  const boundary = await owner.client.rpc("save_project_boundary", { p_project: projectId, p_geojson: parcel, p_source: "[TEST] drawn at registration" });
  check("The owner can map the boundary while the project is a draft", !boundary.error && Number(boundary.data) > 50, boundary.error?.message ?? `area ${boundary.data}`);
  const site = await owner.client.from("project_sites").insert({ project_id: projectId, name: "[TEST] Block A", kind: "site", latitude: -0.306, longitude: 36.064, area_ha: 12 }).select().single();
  check("The owner can add a site while the project is a draft", !site.error, site.error?.message);
  check("An outsider cannot add a site", !!(await investor.client.from("project_sites").insert({ project_id: projectId, name: "[TEST] Intruder", latitude: 0, longitude: 0 })).error);

  const ownerMap = await owner.client.rpc("gis_features", { p_project: projectId });
  check("The owner's map shows the project, its boundary and its site",
    kinds(ownerMap.data, "project").length === 1 && kinds(ownerMap.data, "boundary").length === 1 && kinds(ownerMap.data, "site").length === 1, ownerMap.error?.message);
  const point = kinds(ownerMap.data, "project")[0]?.properties ?? {};
  check("The project feature carries its geographic hierarchy", point.country === "Kenya" && point.county === "Nakuru" && point.category === "Reforestation" && point.lifecycle_stage === "feasibility");

  // ---- Approval, then the owner loses map editing ---------------------------------------------
  await owner.client.from("projects").update({ status: "pending_approval" }).eq("id", projectId);
  await admin.client.from("projects").update({ manager_id: manager.id }).eq("id", projectId);
  const approval = await admin.client.from("approvals").insert({ project_id: projectId, decision: "approved", comments: "[TEST]" });
  check("The administrator can approve the project", !approval.error, approval.error?.message);
  check("After approval the owner can no longer add sites", !!(await owner.client.from("project_sites").insert({ project_id: projectId, name: "[TEST] Late site", latitude: -0.3, longitude: 36.06 })).error);
  check("After approval the owner can no longer replace the boundary", !!(await owner.client.rpc("save_project_boundary", { p_project: projectId, p_geojson: parcel, p_source: "x" })).error);

  // ---- Publishing to the public Explore map ---------------------------------------------------
  const inFeed = async () => kinds((await anon.rpc("explore_public")).data, "project", projectId);
  check("An approved but unpublished project is not in the public feed", (await inFeed()).length === 0);
  check("The owner cannot publish the project", denied(await owner.client.from("projects").update({ is_public: true }).eq("id", projectId).select()));
  check("A field officer cannot publish the project", denied(await officer.client.from("projects").update({ is_public: true }).eq("id", projectId).select()));
  const published = await manager.client.from("projects").update({ is_public: true }).eq("id", projectId).select("is_public").single();
  check("The project manager can publish the project", published.data?.is_public === true, published.error?.message);

  let feed = (await anon.rpc("explore_public")).data;
  const pub = kinds(feed, "project", projectId)[0]?.properties;
  check("The published project appears in the public feed with its boundary and site",
    !!pub && kinds(feed, "boundary", projectId).length === 1 && kinds(feed, "site", projectId).length === 1);
  check("The public feed exposes no owner, manager or coordinates beyond the map point",
    !!pub && !("owner_id" in pub) && !("manager_id" in pub) && !JSON.stringify(pub).includes(owner.id));
  check("An unverified organization's name is not shown publicly", !!pub && pub.organization === null);
  await admin.client.from("organizations").update({ is_verified: true }).eq("id", org.data.id);
  check("Once CGS verifies the organization its name is shown publicly",
    kinds((await anon.rpc("explore_public")).data, "project", projectId)[0]?.properties.organization === org.data.name);
  check("The public feed contains no individual field observations", kinds(feed, "observation").length === 0);

  // ---- Lifecycle stage -------------------------------------------------------------------------
  check("The owner cannot move the project to a late stage", denied(await owner.client.from("projects").update({ lifecycle_stage: "credit_issuance" }).eq("id", projectId).select()));
  const staged = await manager.client.from("projects").update({ lifecycle_stage: "validation" }).eq("id", projectId).select("lifecycle_stage").single();
  check("The project manager can set the validation stage", staged.data?.lifecycle_stage === "validation", staged.error?.message);

  // ---- Field monitoring tied to a site ------------------------------------------------------------
  await manager.client.from("projects").update({ status: "active" }).eq("id", projectId);
  await manager.client.from("project_members").insert({ project_id: projectId, user_id: officer.id, member_role: "field_officer" });
  const record = await officer.client
    .from("monitoring_records")
    .insert({ project_id: projectId, site_id: site.data.id, observation_type: "tree_planting", observation_date: "2026-10-01", latitude: -0.3061, longitude: 36.0641, description: "Planting on block A for the geographic test.", measurements: { trees_planted: 400 }, value_basis: "measured", recorded_by: officer.id })
    .select()
    .single();
  check("A field officer can record an observation at a project site", !record.error && record.data.site_id === site.data.id, record.error?.message);
  check("An observation cannot be tied to a site that does not exist in the project",
    !!(await officer.client.from("monitoring_records").insert({ project_id: projectId, site_id: crypto.randomUUID(), observation_type: "general", observation_date: "2026-10-01", description: "Wrong site reference.", recorded_by: officer.id })).error);
  const managerMap = (await manager.client.rpc("gis_features", { p_project: projectId })).data;
  check("The manager's map shows the observation with its site", kinds(managerMap, "observation")[0]?.properties.site_id === site.data.id);
  check("The owner does not see the observation before it is reviewed", kinds((await owner.client.rpc("gis_features", { p_project: projectId })).data, "observation").length === 0);
  check("The public feed counts no field record before review", (await inFeed())[0]?.properties.reviewed_observations === 0);
  await manager.client.from("monitoring_records").update({ review_status: "approved" }).eq("id", record.data.id);
  check("After review the public feed counts the record without exposing it",
    (await inFeed())[0]?.properties.reviewed_observations === 1 && kinds((await anon.rpc("explore_public")).data, "observation").length === 0);

  // ---- Insights and outsiders ------------------------------------------------------------------
  const insights = await manager.client.rpc("geo_project_insights");
  const row = (insights.data ?? []).find((r) => r.project_id === projectId);
  check("Project insights report sites, field records and team for the manager", !!row && Number(row.sites) === 1 && Number(row.observations) === 1 && Number(row.team_members) === 1, insights.error?.message);
  check("An investor's map and insights do not include the project",
    kinds((await investor.client.rpc("gis_features", { p_project: null })).data, "project", projectId).length === 0 &&
    !((await investor.client.rpc("geo_project_insights")).data ?? []).some((r) => r.project_id === projectId) &&
    (await investor.client.from("project_sites").select("id").eq("project_id", projectId)).data.length === 0);
  check("The administrator's map includes the project", kinds((await admin.client.rpc("gis_features", { p_project: null })).data, "project", projectId).length === 1);

  // ---- Unpublishing ----------------------------------------------------------------------------
  await manager.client.from("projects").update({ is_public: false }).eq("id", projectId);
  check("An unpublished project leaves the public feed", (await inFeed()).length === 0);
  const audit = await admin.client.from("activity_logs").select("action").eq("project_id", projectId);
  const actions = (audit.data ?? []).map((a) => a.action);
  check("Publishing, stage changes and sites are written to the audit log",
    ["project.published_to_explore", "project.removed_from_explore", "project.stage_changed", "site.added", "boundary.saved"].every((a) => actions.includes(a)), actions.join(", "));
} finally {
  if (projectId) {
    const removed = await admin.client.from("projects").delete().eq("id", projectId).select("id");
    check("Cleanup: test project deleted", removed.data?.length === 1, removed.error?.message);
  }
  for (const id of orgIds) await admin.client.from("organizations").delete().eq("id", id);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
