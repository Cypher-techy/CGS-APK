// End-to-end check of the MVP workflow and its access rules against a real Supabase project.
// It signs in as the four TEST accounts, walks a "[TEST]" project through the whole lifecycle,
// asserts what each role may and may not do, and deletes the project again.
//
//   node --env-file=.env.local --env-file=.env.test.local scripts/e2e-check.mjs
//
// With APP_URL set (e.g. http://localhost:3000) it also requests every dashboard page as each role.
// Never run this against production data: it needs the test accounts described in the README.

import { createClient } from "@supabase/supabase-js";
import { landCoverByClass } from "../src/modules/gis/landcover.ts";
import { readBoundaryFile } from "../src/modules/gis/parse.ts";

// ---- Test fixtures: a zipped shapefile built by hand (one polygon, WGS 84) -------------------
function shapefileZip(ring) {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const content = Buffer.alloc(44 + 4 + ring.length * 16);
  content.writeInt32LE(5, 0); // polygon
  box.forEach((v, i) => content.writeDoubleLE(v, 4 + i * 8));
  content.writeInt32LE(1, 36); // parts
  content.writeInt32LE(ring.length, 40);
  content.writeInt32LE(0, 44);
  ring.forEach((p, i) => {
    content.writeDoubleLE(p[0], 48 + i * 16);
    content.writeDoubleLE(p[1], 56 + i * 16);
  });
  const shp = Buffer.alloc(100 + 8 + content.length);
  shp.writeInt32BE(9994, 0);
  shp.writeInt32BE(shp.length / 2, 24);
  shp.writeInt32LE(1000, 28);
  shp.writeInt32LE(5, 32);
  box.forEach((v, i) => shp.writeDoubleLE(v, 36 + i * 8));
  shp.writeInt32BE(1, 100);
  shp.writeInt32BE(content.length / 2, 104);
  content.copy(shp, 108);
  // dBASE table with one character field and one record.
  const dbf = Buffer.alloc(32 + 32 + 1 + 11 + 1);
  dbf.writeUInt8(3, 0);
  dbf.writeUInt32LE(1, 4);
  dbf.writeUInt16LE(65, 8);
  dbf.writeUInt16LE(11, 10);
  dbf.write("NAME", 32, "ascii");
  dbf.write("C", 43, "ascii");
  dbf.writeUInt8(10, 48);
  dbf.writeUInt8(0x0d, 64);
  dbf.write(" TEST      ", 65, "ascii");
  dbf.writeUInt8(0x1a, 76);
  const prj = Buffer.from('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]');
  return zipStored({ "boundary.shp": shp, "boundary.dbf": dbf, "boundary.prj": prj });
}
function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function zipStored(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PASSWORD = process.env.TEST_PASSWORD;
const APP_URL = process.env.APP_URL;
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
  return { client, id: data.user.id, session: data.session };
}
const unread = async (who, type) =>
  (await who.client.from("notifications").select("id", { count: "exact", head: true }).eq("type", type).is("read_at", null)).count ?? 0;

const admin = await signIn("admin");
const manager = await signIn("manager");
const owner = await signIn("owner");
const officer = await signIn("officer");
const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
check("All four MVP roles can authenticate", true);

const { data: category } = await owner.client.from("project_categories").select("id").limit(1).single();
let projectId;
const storagePaths = [];

try {
  // ---- Project owner registers a project -------------------------------------------------
  const created = await owner.client
    .from("projects")
    .insert({
      name: "[TEST] Riparian tree planting",
      category_id: category.id,
      description: "Automated end-to-end test project. Safe to delete.",
      county: "Kiambu",
      area_ha: 12.5,
      owner_id: owner.id,
      status: "approved", // must be forced back to draft by the database
      manager_id: manager.id, // must be discarded
      progress_percent: 80, // must be reset
    })
    .select()
    .single();
  check("Owner can create a project", !created.error, created.error?.message);
  const project = created.data;
  projectId = project.id;
  check("Project gets a unique CGS code", /^CGS-\d{4}-\d{4}$/.test(project.code), project.code);
  check("Owner cannot self-approve, self-assign a manager or set progress on insert",
    project.status === "draft" && project.manager_id === null && project.progress_percent === 0);

  const selfApprove = await owner.client.from("projects").update({ status: "approved" }).eq("id", projectId).select();
  check("Owner cannot approve own project by update", !!selfApprove.error, "update unexpectedly succeeded");
  check("Field officer cannot see a project they are not assigned to",
    (await officer.client.from("projects").select("id").eq("id", projectId)).data.length === 0);
  check("Manager cannot see an unassigned project",
    (await manager.client.from("projects").select("id").eq("id", projectId)).data.length === 0);
  check("Anonymous visitors cannot read projects", denied(await anon.from("projects").select("id")));

  // ---- Supporting document ---------------------------------------------------------------
  const docPath = `${projectId}/${crypto.randomUUID()}-title-deed.pdf`;
  const upload = await owner.client.storage.from("project-files").upload(docPath, new TextEncoder().encode("%PDF-1.4 test"), { contentType: "application/pdf" });
  check("Owner can upload a file into the project folder", !upload.error, upload.error?.message);
  storagePaths.push(docPath);
  const doc = await owner.client
    .from("documents")
    .insert({ project_id: projectId, title: "[TEST] Title deed", category: "land_ownership", storage_path: docPath, file_name: "title-deed.pdf", mime_type: "application/pdf", size_bytes: 13, uploaded_by: owner.id, review_status: "approved" })
    .select()
    .single();
  check("Document record is created as pending review", doc.data?.review_status === "pending", doc.error?.message);
  const foreignUpload = await officer.client.storage.from("project-files").upload(`${projectId}/${crypto.randomUUID()}-x.pdf`, new TextEncoder().encode("x"), { contentType: "application/pdf" });
  check("Non-member cannot upload into the project folder", !!foreignUpload.error);
  const badType = await owner.client.storage.from("project-files").upload(`${projectId}/${crypto.randomUUID()}-x.exe`, new TextEncoder().encode("x"), { contentType: "application/x-msdownload" });
  check("Storage rejects disallowed file types", !!badType.error);
  check("Non-member cannot get a download link", !!(await officer.client.storage.from("project-files").createSignedUrl(docPath, 60)).error);

  // ---- Submission and review -------------------------------------------------------------
  const before = await unread(admin, "project_submitted");
  const submit = await owner.client.from("projects").update({ status: "pending_approval" }).eq("id", projectId).select();
  check("Owner can submit the project for approval", submit.data?.[0]?.status === "pending_approval", submit.error?.message);
  check("Administrators are notified of the submission", (await unread(admin, "project_submitted")) === before + 1);
  check("Owner cannot edit a project while it is pending approval",
    denied(await owner.client.from("projects").update({ name: "[TEST] changed" }).eq("id", projectId).select()));
  check("Only administrators can record approval decisions",
    !!(await manager.client.from("approvals").insert({ project_id: projectId, decision: "approved" })).error &&
    !!(await owner.client.from("approvals").insert({ project_id: projectId, decision: "approved" })).error);
  check("A revision request requires comments",
    !!(await admin.client.from("approvals").insert({ project_id: projectId, decision: "revision_required" })).error);
  const revision = await admin.client.from("approvals").insert({ project_id: projectId, decision: "revision_required", comments: "Please add objectives." });
  check("Admin can request a revision", !revision.error, revision.error?.message);
  check("Owner is notified of the decision", (await unread(owner, "project_status")) >= 1);
  const resubmit = await owner.client.from("projects").update({ objectives: "Restore 12.5 ha of riparian land.", status: "pending_approval" }).eq("id", projectId).select();
  check("Owner can revise and resubmit", resubmit.data?.[0]?.status === "pending_approval", resubmit.error?.message);

  await admin.client.from("projects").update({ manager_id: manager.id }).eq("id", projectId);
  const approve = await admin.client.from("approvals").insert({ project_id: projectId, decision: "approved", comments: "Approved for implementation." });
  const approved = (await admin.client.from("projects").select("status, manager_id").eq("id", projectId).single()).data;
  check("Admin can approve and assign a manager", !approve.error && approved.status === "approved" && approved.manager_id === manager.id, approve.error?.message);
  check("Manager is notified of the assignment", (await unread(manager, "project_assigned")) >= 1);
  check("Owner sees the approval history", (await owner.client.from("approvals").select("id").eq("project_id", projectId)).data.length === 2);

  // ---- Project manager runs the project --------------------------------------------------
  const start = await manager.client.from("projects").update({ status: "active" }).eq("id", projectId).select();
  check("Manager can start the approved project", start.data?.[0]?.status === "active", start.error?.message);
  check("Manager cannot reassign ownership", !!(await manager.client.from("projects").update({ owner_id: manager.id }).eq("id", projectId).select()).error);
  check("Manager can review the owner's document",
    (await manager.client.from("documents").update({ review_status: "approved" }).eq("id", doc.data.id).select()).data?.[0]?.review_status === "approved");
  check("Owner cannot review documents", denied(await owner.client.from("documents").update({ review_status: "rejected" }).eq("id", doc.data.id).select()));

  check("A task cannot be assigned to someone outside the team",
    !!(await manager.client.from("tasks").insert({ project_id: projectId, title: "[TEST] invalid", assigned_to: officer.id })).error);
  const member = await manager.client.from("project_members").insert({ project_id: projectId, user_id: officer.id, member_role: "field_officer" });
  check("Manager can add a field officer to the team", !member.error, member.error?.message);
  check("Field officer now sees the assigned project", (await officer.client.from("projects").select("id").eq("id", projectId)).data.length === 1);
  const milestone = await manager.client.from("milestones").insert({ project_id: projectId, title: "[TEST] Planting completed", due_date: "2026-12-31" }).select().single();
  check("Manager can create a milestone", !milestone.error, milestone.error?.message);
  const task = await manager.client
    .from("tasks")
    .insert({ project_id: projectId, milestone_id: milestone.data.id, title: "[TEST] Plant seedlings", assigned_to: officer.id, priority: "high", due_date: "2026-10-05" })
    .select()
    .single();
  check("Manager can create and assign a task", !task.error, task.error?.message);
  check("Assignee is notified of the task", (await unread(officer, "task_assigned")) >= 1);
  check("Field officer cannot create tasks", !!(await officer.client.from("tasks").insert({ project_id: projectId, title: "[TEST] not allowed" })).error);
  check("Owner cannot create tasks", !!(await owner.client.from("tasks").insert({ project_id: projectId, title: "[TEST] not allowed" })).error);

  const taskId = task.data.id;
  check("Assignee can start the task", (await officer.client.from("tasks").update({ status: "in_progress" }).eq("id", taskId).select()).data?.[0]?.status === "in_progress");
  check("Assignee cannot edit task details", !!(await officer.client.from("tasks").update({ title: "[TEST] renamed" }).eq("id", taskId).select()).error);
  check("Assignee cannot mark the task completed", !!(await officer.client.from("tasks").update({ status: "completed" }).eq("id", taskId).select()).error);
  check("Assignee can submit the task for review", (await officer.client.from("tasks").update({ status: "under_review" }).eq("id", taskId).select()).data?.[0]?.status === "under_review");
  check("Assignee can comment on the task", !(await officer.client.from("project_comments").insert({ project_id: projectId, task_id: taskId, author_id: officer.id, body: "Seedlings planted along the river." })).error);
  check("Manager can complete the task", (await manager.client.from("tasks").update({ status: "completed" }).eq("id", taskId).select()).data?.[0]?.status === "completed");
  check("Project progress is derived from completed tasks", (await owner.client.from("projects").select("progress_percent").eq("id", projectId).single()).data.progress_percent === 100);
  check("Manager can complete the milestone", (await manager.client.from("milestones").update({ status: "completed" }).eq("id", milestone.data.id).select()).data?.[0]?.completed_at != null);
  check("Task history is recorded", (await officer.client.from("activity_logs").select("id").eq("entity_type", "task").eq("entity_id", taskId)).data.length >= 5);

  // ---- Field monitoring ------------------------------------------------------------------
  check("Owner cannot submit monitoring records",
    !!(await owner.client.from("monitoring_records").insert({ project_id: projectId, observation_type: "general", observation_date: "2026-10-01", description: "Owner should not be able to do this.", recorded_by: owner.id })).error);
  const record = await officer.client
    .from("monitoring_records")
    .insert({
      project_id: projectId, observation_type: "tree_survival", observation_date: "2026-10-01", latitude: -1.1714, longitude: 36.8356,
      description: "Survival count on the northern plot.", measurements: { trees_assessed: 200, trees_surviving: 174 },
      value_basis: "measured", recorded_by: officer.id, review_status: "approved",
    })
    .select()
    .single();
  check("Field officer can submit a monitoring record (always enters as submitted)", record.data?.review_status === "submitted", record.error?.message);
  const recordId = record.data.id;
  const photoPath = `${projectId}/${crypto.randomUUID()}-plot.jpg`;
  await officer.client.storage.from("project-files").upload(photoPath, new TextEncoder().encode("jpegdata"), { contentType: "image/jpeg" });
  storagePaths.push(photoPath);
  const photo = await officer.client
    .from("documents")
    .insert({ project_id: projectId, monitoring_record_id: recordId, title: "[TEST] Plot photograph", storage_path: photoPath, file_name: "plot.jpg", mime_type: "image/jpeg", size_bytes: 8, uploaded_by: officer.id })
    .select()
    .single();
  check("Field officer can attach photographic evidence", photo.data?.category === "monitoring_evidence", photo.error?.message);
  check("Manager is notified of the field report", (await unread(manager, "monitoring_submitted")) >= 1);
  check("Owner cannot see an unreviewed record or its evidence",
    (await owner.client.from("monitoring_records").select("id").eq("id", recordId)).data.length === 0 &&
    (await owner.client.from("documents").select("id").eq("id", photo.data.id)).data.length === 0 &&
    !!(await owner.client.storage.from("project-files").createSignedUrl(photoPath, 60)).error);
  check("Field officer cannot approve own record",
    (await officer.client.from("monitoring_records").update({ review_status: "approved" }).eq("id", recordId).select()).data?.[0]?.review_status === "submitted");
  check("A correction request requires notes", !!(await manager.client.from("monitoring_records").update({ review_status: "revision_required" }).eq("id", recordId).select()).error);
  check("Manager can request a correction",
    (await manager.client.from("monitoring_records").update({ review_status: "revision_required", review_notes: "Confirm the count." }).eq("id", recordId).select()).data?.[0]?.review_status === "revision_required");
  check("Field officer can correct and resubmit",
    (await officer.client.from("monitoring_records").update({ measurements: { trees_assessed: 200, trees_surviving: 176 } }).eq("id", recordId).select()).data?.[0]?.review_status === "submitted");
  check("Manager can approve the record", (await manager.client.from("monitoring_records").update({ review_status: "approved", review_notes: null }).eq("id", recordId).select()).data?.[0]?.review_status === "approved");
  check("Field officer cannot change an approved record", denied(await officer.client.from("monitoring_records").update({ description: "Changed after approval." }).eq("id", recordId).select()));
  const ownerView = await owner.client.from("monitoring_records").select("measurements").eq("id", recordId);
  check("Owner can view the approved record", ownerView.data.length === 1 && ownerView.data[0].measurements.trees_surviving === 176);
  const link = await owner.client.storage.from("project-files").createSignedUrl(photoPath, 60);
  check("Owner can download the approved evidence", !link.error && (await fetch(link.data.signedUrl)).ok, link.error?.message);
  check("Owner is notified of the monitoring update", (await unread(owner, "monitoring_update")) >= 1);

  // ---- Accounts, audit trail, public form ------------------------------------------------
  check("A user cannot change their own role", !!(await owner.client.from("profiles").update({ role: "super_admin" }).eq("id", owner.id).select()).error);
  const acceptedAt = (await owner.client.from("profiles").select("terms_accepted_at").eq("id", owner.id).single()).data.terms_accepted_at;
  await owner.client.from("profiles").update({ terms_accepted_at: null }).eq("id", owner.id);
  check("Acceptance of the terms cannot be cleared or backdated",
    acceptedAt !== null && (await owner.client.from("profiles").select("terms_accepted_at").eq("id", owner.id).single()).data.terms_accepted_at === acceptedAt);
  check("A user cannot change another user's profile", denied(await owner.client.from("profiles").update({ full_name: "Hacked" }).eq("id", officer.id).select()));
  check("Admin cannot remove their own admin role", !!(await admin.client.from("profiles").update({ role: "project_owner" }).eq("id", admin.id).select()).error);
  check("Users only read their own notifications", (await owner.client.from("notifications").select("user_id")).data.every((n) => n.user_id === owner.id));
  check("Audit log entries cannot be forged", !!(await owner.client.from("activity_logs").insert({ action: "fake", entity_type: "project" })).error);
  const logs = (await admin.client.from("activity_logs").select("action").eq("project_id", projectId)).data.map((l) => l.action);
  check("Important operations are recorded in the audit log",
    ["project.created", "project.reviewed", "project.status_changed", "project.manager_assigned", "member.added", "task.created", "task.status_changed", "milestone.completed", "document.uploaded", "document.reviewed", "monitoring.submitted", "monitoring.approved"].every((a) => logs.includes(a)),
    `recorded: ${[...new Set(logs)].join(", ")}`);
  check("Field officer cannot read document and monitoring audit entries",
    (await officer.client.from("activity_logs").select("entity_type").eq("project_id", projectId)).data.every((l) => ["project", "milestone", "task"].includes(l.entity_type)));
  check("Only administrators can change settings", denied(await manager.client.from("system_settings").update({ platform_name: "x" }).eq("id", true).select()));
  check("Public contact form accepts a message",
    !(await anon.from("contact_messages").insert({ full_name: "E2E Test", email: "e2e@cgs-portal.test", subject: "[TEST] contact form", message: "Automated test message." })).error);
  check("Anonymous visitors cannot read contact messages", denied(await anon.from("contact_messages").select("id")));

  // ---- GIS: boundaries -------------------------------------------------------------------
  const gis = await signIn("gis");
  const mrv = await signIn("mrv");
  const investor = await signIn("investor");
  const community = await signIn("community");
  // Roughly 1.11 km x 1.11 km near the equator: about 123 ha.
  const square = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[36.83, -1.17], [36.84, -1.17], [36.84, -1.18], [36.83, -1.18], [36.83, -1.17]]] } };
  check("GIS analyst cannot map a project they are not assigned to",
    !!(await gis.client.rpc("save_project_boundary", { p_project: projectId, p_geojson: square })).error);
  check("A community account cannot be given a staff role on a project",
    !!(await manager.client.from("project_members").insert({ project_id: projectId, user_id: community.id, member_role: "field_officer" })).error);
  check("An investor account cannot be added to a project team",
    !!(await manager.client.from("project_members").insert({ project_id: projectId, user_id: investor.id, member_role: "observer" })).error);
  const teamAdds = await manager.client.from("project_members").insert([
    { project_id: projectId, user_id: gis.id, member_role: "gis_analyst" },
    { project_id: projectId, user_id: mrv.id, member_role: "mrv_specialist" },
    { project_id: projectId, user_id: community.id, member_role: "community_member" },
  ]);
  check("Manager can add GIS, MRV and community members", !teamAdds.error, teamAdds.error?.message);
  const boundary = await gis.client.rpc("save_project_boundary", { p_project: projectId, p_geojson: square, p_source: "[TEST] square" });
  check("GIS analyst can import a GeoJSON boundary; PostGIS calculates the area", !boundary.error && boundary.data > 115 && boundary.data < 130, boundary.error?.message ?? `area=${boundary.data}`);
  check("Invalid GeoJSON is rejected", !!(await gis.client.rpc("save_project_boundary", { p_project: projectId, p_geojson: { type: "Point", coordinates: [36.8, -1.2] } })).error);
  check("Field officer cannot change the boundary", !!(await officer.client.rpc("save_project_boundary", { p_project: projectId, p_geojson: square })).error);
  const features = (await owner.client.rpc("gis_features", { p_project: projectId })).data.features;
  check("Map data contains the boundary and the georeferenced observation",
    features.some((f) => f.properties.kind === "boundary" && f.geometry.type === "MultiPolygon") && features.some((f) => f.properties.kind === "observation"));
  check("Map data is limited to the caller's projects", (await investor.client.rpc("gis_features", { p_project: null })).data.features.length === 0);

  // ---- Boundary file formats and land cover ----------------------------------------------
  const ring = [[36.83, -1.17], [36.83, -1.18], [36.84, -1.18], [36.84, -1.17], [36.83, -1.17]];
  const kmlText = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>[TEST]</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring.map((p) => `${p[0]},${p[1]},0`).join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
  const fromKml = await readBoundaryFile(new File([kmlText], "boundary.kml"));
  const kmlSaved = fromKml.error ? { error: { message: fromKml.error } } : await gis.client.rpc("save_project_boundary", { p_project: projectId, p_geojson: fromKml.geojson, p_source: "[TEST] kml" });
  check("A KML boundary is imported", !kmlSaved.error && kmlSaved.data > 115 && kmlSaved.data < 130, kmlSaved.error?.message ?? `area=${kmlSaved.data}`);
  const fromShp = await readBoundaryFile(new File([shapefileZip(ring)], "boundary.zip"));
  const shpSaved = fromShp.error ? { error: { message: fromShp.error } } : await gis.client.rpc("save_project_boundary", { p_project: projectId, p_geojson: fromShp.geojson, p_source: "[TEST] shapefile" });
  check("A zipped shapefile boundary is imported", !shpSaved.error && shpSaved.data > 115 && shpSaved.data < 130, shpSaved.error?.message ?? `area=${shpSaved.data}`);
  check("Unsupported boundary files are refused", (await readBoundaryFile(new File(["x"], "boundary.kmz"))).error !== null);

  const stored = (await gis.client.rpc("gis_features", { p_project: projectId })).data.features.find((f) => f.properties.kind === "boundary");
  let landCover = null;
  let landCoverError = "";
  try {
    landCover = await landCoverByClass(stored.geometry.coordinates, 2022, Number(stored.properties.area_ha));
  } catch (cause) {
    landCoverError = String(cause);
  }
  const classTotal = Object.values(landCover ?? {}).reduce((a, b) => a + b, 0);
  check("Land cover is calculated from the satellite classification and adds up to the boundary area",
    landCover !== null && Math.abs(classTotal - Number(stored.properties.area_ha)) < 0.5, landCoverError || `classes=${JSON.stringify(landCover)}`);
  const lcRow = { project_id: projectId, year: 2022, classes: landCover ?? { trees: 1 }, boundary_area_ha: stored.properties.area_ha, source: "[TEST]" };
  check("Field officer cannot store land-cover results", !!(await officer.client.from("land_cover_analyses").insert(lcRow)).error);
  check("GIS analyst can store land-cover results; participants can read them",
    !(await gis.client.from("land_cover_analyses").upsert(lcRow, { onConflict: "project_id,year" })).error &&
    (await owner.client.from("land_cover_analyses").select("year").eq("project_id", projectId)).data.length === 1);

  // ---- MRV: estimates, schedules ---------------------------------------------------------
  check("Carbon estimates require a methodology",
    !!(await mrv.client.from("carbon_estimates").insert({ project_id: projectId, kind: "potential", estimated_tco2e: 1200 })).error);
  const estimate = await mrv.client.from("carbon_estimates").insert({ project_id: projectId, kind: "potential", estimated_tco2e: 1200, methodology: "[TEST] Default factors, 20 year horizon.", assumptions: "80% survival." }).select().single();
  check("MRV specialist can record a carbon estimate", !estimate.error, estimate.error?.message);
  check("Field officer cannot record carbon estimates", !!(await officer.client.from("carbon_estimates").insert({ project_id: projectId, kind: "baseline", estimated_tco2e: 1, methodology: "Should not be allowed." })).error);
  check("MRV specialist can schedule monitoring", !(await mrv.client.from("monitoring_schedules").insert({ project_id: projectId, observation_type: "tree_survival", frequency: "quarterly", next_due: "2027-01-15" })).error);
  check("MRV specialist reads monitoring records and their audit trail",
    (await mrv.client.from("monitoring_records").select("id").eq("project_id", projectId)).data.length >= 1 &&
    (await mrv.client.from("activity_logs").select("id").eq("entity_type", "monitoring_record").eq("project_id", projectId)).data.length >= 1);

  // ---- Community -------------------------------------------------------------------------
  check("Community member sees the project but not tasks, discussion or internal documents",
    (await community.client.from("projects").select("id").eq("id", projectId)).data.length === 1 &&
    (await community.client.from("tasks").select("id").eq("project_id", projectId)).data.length === 0 &&
    (await community.client.from("project_comments").select("id").eq("project_id", projectId)).data.length === 0 &&
    (await community.client.from("documents").select("id").eq("project_id", projectId)).data.length === 0);
  check("Community member cannot upload files or post comments",
    !!(await community.client.storage.from("project-files").upload(`${projectId}/${crypto.randomUUID()}-c.pdf`, new TextEncoder().encode("x"), { contentType: "application/pdf" })).error &&
    !!(await community.client.from("project_comments").insert({ project_id: projectId, author_id: community.id, body: "not allowed" })).error);
  check("Community member only sees profiles of the owner and manager",
    (await community.client.from("profiles").select("id").in("id", [owner.id, manager.id, officer.id, gis.id])).data.length === 2);
  check("Manager can post an announcement and schedule a meeting",
    !(await manager.client.from("project_announcements").insert({ project_id: projectId, title: "[TEST] Planting day", body: "Community planting day on Saturday." })).error &&
    !(await manager.client.from("project_meetings").insert({ project_id: projectId, title: "[TEST] Baraza", scheduled_at: "2027-01-10T10:00:00+03:00", location: "Chief's camp" })).error);
  check("Community member is notified and can read announcements and meetings",
    (await unread(community, "announcement")) >= 1 && (await unread(community, "meeting")) >= 1 &&
    (await community.client.from("project_announcements").select("id").eq("project_id", projectId)).data.length === 1);
  check("Community member cannot post announcements", !!(await community.client.from("project_announcements").insert({ project_id: projectId, title: "[TEST] no", body: "not allowed" })).error);
  const grievance = await community.client.from("grievances").insert({ project_id: projectId, submitted_by: community.id, kind: "grievance", subject: "[TEST] Access path blocked", description: "The footpath to the river is blocked by seedlings.", status: "resolved" }).select().single();
  check("Community member can raise a grievance (always enters as open)", grievance.data?.status === "open", grievance.error?.message);
  check("A grievance is private to its sender and its handlers",
    (await officer.client.from("grievances").select("id").eq("id", grievance.data.id)).data.length === 0 &&
    (await owner.client.from("grievances").select("id").eq("id", grievance.data.id)).data.length === 0 &&
    (await manager.client.from("grievances").select("id").eq("id", grievance.data.id)).data.length === 1);
  check("The sender cannot alter or resolve a grievance", denied(await community.client.from("grievances").update({ status: "resolved" }).eq("id", grievance.data.id).select()));
  check("Manager can respond; the sender is notified",
    (await manager.client.from("grievances").update({ status: "resolved", response: "Path reopened." }).eq("id", grievance.data.id).select()).data?.[0]?.status === "resolved" &&
    (await unread(community, "grievance")) >= 1);

  // ---- Benefit sharing and financial records ---------------------------------------------
  check("Owner cannot write financial records",
    !!(await owner.client.from("financial_records").insert({ project_id: projectId, kind: "income", description: "[TEST] not allowed", amount: 10, record_date: "2026-10-01" })).error);
  const finance = await manager.client.from("financial_records").insert([
    { project_id: projectId, kind: "budget", description: "[TEST] Seedling budget", amount: 500000, currency: "KES", record_date: "2026-09-01", payment_status: "paid", beneficiary: null },
    { project_id: projectId, kind: "expense", description: "[TEST] Seedlings", amount: 120000, currency: "KES", record_date: "2026-09-15", payment_status: "paid", beneficiary: null },
    { project_id: projectId, kind: "benefit_payment", description: "[TEST] First community share", amount: 30000, currency: "KES", record_date: "2026-10-01", payment_status: "pending", beneficiary: "[TEST] Community group" },
  ]);
  check("Manager can record budget, expenses and benefit-sharing payments", !finance.error, finance.error?.message);
  check("Manager can record benefit-sharing terms",
    !(await manager.client.from("benefit_sharing_terms").insert({ project_id: projectId, beneficiary: "[TEST] Community group", share_percent: 30, description: "30% of net proceeds, paid annually." })).error);
  check("Owner sees all financial records and is notified of the benefit payment",
    (await owner.client.from("financial_records").select("id").eq("project_id", projectId)).data.length === 3 && (await unread(owner, "finance")) >= 1);
  check("Community member sees the terms and benefit payments only",
    (await community.client.from("benefit_sharing_terms").select("id").eq("project_id", projectId)).data.length === 1 &&
    (await community.client.from("financial_records").select("kind").eq("project_id", projectId)).data.every((r) => r.kind === "benefit_payment") &&
    (await community.client.from("financial_records").select("kind").eq("project_id", projectId)).data.length === 1);
  check("Field officer sees no financial records", (await officer.client.from("financial_records").select("id").eq("project_id", projectId)).data.length === 0);
  check("Financial amounts must be positive", !!(await manager.client.from("financial_records").insert({ project_id: projectId, kind: "expense", description: "[TEST] bad", amount: -5, record_date: "2026-10-01" })).error);

  // ---- E-mail delivery and offline capture ------------------------------------------------
  check("A user can switch notification e-mails off and on",
    (await owner.client.from("profiles").update({ email_notifications: false }).eq("id", owner.id).select("email_notifications")).data?.[0]?.email_notifications === false &&
    (await owner.client.from("profiles").update({ email_notifications: true }).eq("id", owner.id).select("email_notifications")).data?.[0]?.email_notifications === true);
  check("A user cannot mark their notifications as e-mailed for someone else",
    denied(await owner.client.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("user_id", manager.id).select()));
  const mailer = await fetch(`${URL_}/functions/v1/send-notification-emails`, { method: "POST" });
  check("The e-mail function refuses unauthenticated calls", mailer.status === 401, String(mailer.status));
  const clientId = crypto.randomUUID();
  const offline = { project_id: projectId, observation_type: "general", observation_date: "2026-10-02", description: "[TEST] Recorded offline in the field.", recorded_by: officer.id, client_id: clientId };
  const firstSync = await officer.client.from("monitoring_records").insert(offline);
  const secondSync = await officer.client.from("monitoring_records").insert(offline);
  check("An offline report sent twice is stored once", !firstSync.error && secondSync.error?.code === "23505" &&
    (await officer.client.from("monitoring_records").select("id").eq("client_id", clientId)).data.length === 1, firstSync.error?.message);

  // ---- Marketplace -----------------------------------------------------------------------
  check("Investor cannot read projects, estimates or documents directly",
    (await investor.client.from("projects").select("id")).data.length === 0 &&
    (await investor.client.from("carbon_estimates").select("id")).data.length === 0 &&
    (await investor.client.from("documents").select("id")).data.length === 0);
  const listing = await owner.client.from("marketplace_listings").insert({ project_id: projectId, summary: "[TEST] Riparian restoration seeking a development partner.", status: "published", development_stage: "verified", standard: "Fake" }).select().single();
  check("Owner can create a listing, but not publish it or claim a stage", listing.data?.status === "draft" && listing.data?.development_stage === "proposed" && listing.data?.standard === null, listing.error?.message);
  check("Unpublished listings are invisible to investors", (await investor.client.rpc("marketplace_browse")).data.length === 0);
  check("Owner cannot publish a listing", !!(await owner.client.from("marketplace_listings").update({ status: "published" }).eq("project_id", projectId).select()).error);
  check("Owner can submit the listing for review; administrators are notified",
    (await owner.client.from("marketplace_listings").update({ status: "pending_review" }).eq("project_id", projectId).select()).data?.[0]?.status === "pending_review" &&
    (await unread(admin, "listing")) >= 1);
  check("An enquiry cannot be sent for an unpublished listing",
    !!(await investor.client.from("marketplace_interests").insert({ project_id: projectId, investor_id: investor.id, kind: "expression_of_interest", message: "We would like to learn more about this project." })).error);
  check("Admin can publish the listing", (await admin.client.from("marketplace_listings").update({ status: "published" }).eq("project_id", projectId).select()).data?.[0]?.published_at != null);
  check("A verified stage cannot be recorded without a standard and evidence",
    !!(await admin.client.from("marketplace_listings").update({ development_stage: "verified" }).eq("project_id", projectId).select()).error);
  check("Owner cannot change the development stage",
    !!(await owner.client.from("marketplace_listings").update({ development_stage: "under_assessment" }).eq("project_id", projectId).select()).error);
  check("MRV specialist can set a stage that needs no evidence",
    (await mrv.client.from("marketplace_listings").update({ development_stage: "under_assessment" }).eq("project_id", projectId).select()).data?.[0]?.development_stage === "under_assessment");
  check("A stage can be recorded as validated with a standard and an approved document",
    (await admin.client.from("marketplace_listings").update({ development_stage: "validated", standard: "[TEST] Standard", stage_evidence_document_id: doc.data.id }).eq("project_id", projectId).select()).data?.[0]?.development_stage === "validated");
  const browse = (await investor.client.rpc("marketplace_browse")).data;
  check("Investor sees the published listing with estimate, method and stage",
    browse.length === 1 && Number(browse[0].estimated_tco2e) === 1200 && browse[0].estimate_methodology.includes("[TEST]") && browse[0].development_stage === "validated" && browse[0].has_stage_evidence === true && Number(browse[0].mapped_area_ha) > 115);
  check("The listing does not expose owner identity or coordinates", !("owner_id" in browse[0]) && !("latitude" in browse[0]));
  check("Other roles cannot browse the marketplace", (await officer.client.rpc("marketplace_browse")).data.length === 0);
  check("Investor can save a listed project", !(await investor.client.from("marketplace_saved").insert({ investor_id: investor.id, project_id: projectId })).error);
  const interest = await investor.client.from("marketplace_interests").insert({ project_id: projectId, investor_id: investor.id, kind: "partnership_enquiry", message: "[TEST] We would like to discuss a development partnership.", status: "agreement" }).select().single();
  check("Investor can send an enquiry (always enters as submitted)", interest.data?.status === "submitted", interest.error?.message);
  check("Owner and manager are notified of the enquiry and can read it",
    (await unread(owner, "enquiry")) >= 1 && (await owner.client.from("marketplace_interests").select("id").eq("id", interest.data.id)).data.length === 1);
  check("Investor cannot advance their own enquiry", !!(await investor.client.from("marketplace_interests").update({ status: "agreement" }).eq("id", interest.data.id).select()).error);
  check("Owner cannot change an enquiry", denied(await owner.client.from("marketplace_interests").update({ status: "declined" }).eq("id", interest.data.id).select()));
  check("Manager can move the enquiry to due diligence; the investor is notified",
    (await manager.client.from("marketplace_interests").update({ status: "due_diligence", response_notes: "Documents will be shared under NDA." }).eq("id", interest.data.id).select()).data?.[0]?.status === "due_diligence" &&
    (await unread(investor, "enquiry")) >= 1);
  check("Investor can withdraw the enquiry", (await investor.client.from("marketplace_interests").update({ status: "withdrawn" }).eq("id", interest.data.id).select()).data?.[0]?.status === "withdrawn");

  // ---- Rendered pages (optional) ---------------------------------------------------------
  if (APP_URL) {
    const ref = new URL(URL_).hostname.split(".")[0];
    const cookieFor = (session) => {
      const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
      const chunks = value.match(/.{1,3180}/g);
      return chunks.length === 1 ? `sb-${ref}-auth-token=${value}` : chunks.map((c, i) => `sb-${ref}-auth-token.${i}=${c}`).join("; ");
    };
    // Visible text only: script payloads always carry the error / not-found boundaries.
    const visible = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
    const get = (path, who) => fetch(`${APP_URL}${path}`, { headers: who ? { cookie: cookieFor(who.session) } : {}, redirect: "manual" });
    const common = ["/dashboard", "/dashboard/projects", `/dashboard/projects/${projectId}`, "/dashboard/reports", "/dashboard/notifications", "/dashboard/profile", "/dashboard/monitoring", `/dashboard/monitoring/${recordId}`, `/dashboard/tasks/${taskId}`, "/dashboard/documents"];
    const tab = (t) => `/dashboard/projects/${projectId}?tab=${t}`;
    const tabs = ["tasks", "milestones", "documents", "monitoring", "team", "activity", "map", "mrv", "community", "marketplace", "finance"].map(tab);
    const base = ["/dashboard", "/dashboard/projects", `/dashboard/projects/${projectId}`, "/dashboard/notifications", "/dashboard/profile", "/dashboard/gis"];
    const pages = {
      admin: [...common, ...tabs, "/dashboard/gis", "/dashboard/mrv", "/dashboard/marketplace", `/dashboard/marketplace/${projectId}`, "/dashboard/marketplace/enquiries", "/dashboard/admin/users", "/dashboard/admin/approvals", "/dashboard/admin/activity", "/dashboard/admin/settings", "/dashboard/reports?type=gis", "/dashboard/reports?type=carbon", "/dashboard/reports?type=finance", "/dashboard/monitoring/offline", "/dashboard/command", "/dashboard/organizations", "/explore"],
      manager: [...common, ...tabs, "/dashboard/gis", "/dashboard/mrv", "/dashboard/marketplace/enquiries", "/dashboard/tasks", "/dashboard/milestones", "/dashboard/monitoring/new", `/dashboard/projects/${projectId}/edit`],
      owner: [...common, ...tabs, "/dashboard/gis", "/dashboard/marketplace/enquiries", "/dashboard/projects/new", "/dashboard/organizations", "/explore"],
      officer: [...common, ...tabs, "/dashboard/gis", "/dashboard/tasks", "/dashboard/monitoring/new", "/dashboard/monitoring/offline"],
      gis: [...base, tab("map"), tab("documents"), "/dashboard/documents", "/dashboard/reports?type=gis"],
      mrv: [...base, tab("mrv"), tab("monitoring"), tab("marketplace"), "/dashboard/mrv", "/dashboard/monitoring", `/dashboard/monitoring/${recordId}`, "/dashboard/reports?type=carbon"],
      investor: ["/dashboard", "/dashboard/marketplace", "/dashboard/marketplace?saved=1", `/dashboard/marketplace/${projectId}`, "/dashboard/marketplace/enquiries", "/dashboard/notifications", "/dashboard/profile"],
      community: [...base, tab("community"), tab("map"), tab("milestones"), tab("finance"), "/dashboard/community", "/dashboard/monitoring"],
    };
    const who = { admin, manager, owner, officer, gis, mrv, investor, community };
    const worker = await get("/sw.js");
    check("The offline service worker is served", worker.status === 200 && (await worker.text()).includes("cgs-offline"), String(worker.status));
    const financeCsv = await (await get(`/api/reports?type=finance&format=csv&project=${projectId}`, owner)).text();
    check("Financial report contains the recorded amounts", financeCsv.includes("120000") && financeCsv.includes("Benefit-sharing payment"), financeCsv.slice(0, 120));
    const mapPage = await (await get(tab("map"), gis)).text();
    check("The project map page shows the stored land-cover result", mapPage.includes("Land use and land cover") && mapPage.includes("2022"));
    const geo = await get(`/api/gis/export?project=${projectId}`, gis);
    check("GeoJSON export returns the project boundary", geo.status === 200 && (await geo.json()).features.some((f) => f.properties.kind === "boundary"), String(geo.status));
    for (const [path, user, label] of [[`/dashboard/projects/${projectId}`, investor, "an investor"], ["/dashboard/marketplace", community, "a community member"], [tab("tasks"), community, "a community member (tasks tab falls back to overview)"]]) {
      const res = await get(path, user);
      const html = await res.text();
      const text = visible(html);
      // Pages stream, so a refusal arrives as a redirect or not-found inside a 200 response: check that no protected content is present.
      const leaked = path.includes("tab=tasks") ? html.includes("Create a task") || html.includes("Plant seedlings") : html.includes("Riparian tree planting") || html.includes("Minimum area");
      const closed = [302, 303, 307, 404].includes(res.status) || !leaked;
      check(`${path.replace(projectId, ":id")} is closed to ${label}`, closed, String(res.status));
    }
    for (const [role, paths] of Object.entries(pages)) {
      const bad = [];
      for (const path of paths) {
        const res = await get(path, who[role]);
        const html = res.status === 200 ? await res.text() : "";
        const text = visible(html);
        if (res.status !== 200 || html.includes("NEXT_REDIRECT") || text.includes("could not be loaded") || text.includes("Record not found")) bad.push(`${path} -> ${res.status}`);
      }
      check(`All ${paths.length} pages render for ${role}`, bad.length === 0, bad.join("; "));
    }
    for (const path of ["/", "/explore", "/projects", "/marketplace", "/how-it-works", "/features", "/faq", "/about", "/contact", "/terms", "/privacy", "/login", "/register", "/forgot-password"]) {
      const res = await get(path);
      check(`Public page ${path} renders`, res.status === 200, String(res.status));
    }
    check("Signed-out visitors are redirected from the dashboard", [302, 307].includes((await get("/dashboard")).status));
    check("Signed-out visitors cannot export reports", (await get("/api/reports?type=projects&format=csv")).status === 401);
    for (const path of ["/dashboard/admin/users", "/dashboard/admin/activity", "/dashboard/admin/settings", "/dashboard/admin/approvals"]) {
      const res = await get(path, owner);
      const html = await res.text();
      // The role check runs while the page streams, so the redirect arrives inside the response.
      const closed = [302, 303, 307].includes(res.status) || (html.includes("NEXT_REDIRECT") && !/Approve registrations|Audit trail|Platform configuration|Review submitted projects/.test(html));
      check(`Admin page ${path} is closed to a project owner`, closed, String(res.status));
    }
    const csv = await get(`/api/reports?type=monitoring&format=csv&project=${projectId}`, owner);
    const csvText = await csv.text();
    check("CSV report contains real database rows", csv.status === 200 && csvText.includes("Tree survival") && csvText.includes("176"), csvText.slice(0, 200));
    const pdf = await get(`/api/reports?type=tasks&format=pdf&project=${projectId}`, manager);
    check("PDF report is generated", pdf.status === 200 && Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString() === "%PDF-", String(pdf.status));
    const officerCsv = await (await get("/api/reports?type=approvals&format=csv", officer)).text();
    const download = await get(`/api/documents/${doc.data.id}`, owner);
    check("Document download redirects to a signed URL", [302, 307].includes(download.status) && (download.headers.get("location") ?? "").includes("/object/sign/"), String(download.status));
    check("Report exports stay within the caller's projects", officerCsv.includes("Decision") , officerCsv.slice(0, 80));
  }
} finally {
  // ---- Clean up the test project ---------------------------------------------------------
  if (projectId) {
    if (storagePaths.length) await admin.client.storage.from("project-files").remove(storagePaths);
    const removed = await admin.client.from("projects").delete().eq("id", projectId).select("id");
    check("Test project removed", removed.data?.length === 1, removed.error?.message);
    for (const name of ["admin", "manager", "owner", "officer", "gis", "mrv", "investor", "community"]) {
      const user = await signIn(name);
      await user.client.from("notifications").delete().eq("user_id", user.id);
    }
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
