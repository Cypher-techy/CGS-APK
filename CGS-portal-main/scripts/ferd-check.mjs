// End-to-end check of the FERD Student Portal rules against a Supabase project:
// registration and verification, department isolation, staff roles, the content library,
// premium access, payment finalisation and private files.
//
//   node --env-file=<env file> scripts/ferd-check.mjs
//
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and TEST_PASSWORD,
// and the test accounts described in the README. With APP_URL set it also requests the FERD pages.
// It creates "[TEST]" students and content and deletes them again. It refuses to run against a database
// that is not local unless FERD_CHECK_REMOTE=yes is set: never run it against production data.
// No real M-Pesa request is made: payment outcomes are simulated by calling the database function directly.

import { createClient } from "@supabase/supabase-js";
import { normalizePhone, phoneProblem } from "../src/modules/ferd/constants.ts";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const PASSWORD = process.env.TEST_PASSWORD;
const APP_URL = process.env.APP_URL;
if (!URL_ || !KEY || !SECRET || !PASSWORD) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and TEST_PASSWORD");
if (!/127\.0\.0\.1|localhost/.test(URL_) && process.env.FERD_CHECK_REMOTE !== "yes") throw new Error("Refusing to run against a non-local database (set FERD_CHECK_REMOTE=yes to override)");

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${!condition && detail ? ` — ${detail}` : ""}`);
}
const denied = (res) => !!res.error || (Array.isArray(res.data) && res.data.length === 0);
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(URL_, SECRET, options);
const anon = createClient(URL_, KEY, options);

async function signIn(email, password = PASSWORD) {
  const client = createClient(URL_, KEY, options);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { client, id: data.user.id, session: data.session };
}
const staff = (name) => signIn(`test.${name}@cgs-portal.test`);

const run = Date.now().toString().slice(-6);
// Registration numbers follow N12/12345/25. Extra test numbers append a digit to the serial (six digits),
// so they can never equal one of the five-digit ones.
const serial = run.slice(-5);
const STUDENT_PASSWORD = `Ferd-test-${run}-pw1`;
/** Registers through the normal sign-up path, exactly as the registration form does. */
async function register(regNo, name, extra = {}) {
  const email = `ferd.${regNo.replace(/[^a-z0-9]/gi, "").toLowerCase()}@cgs-portal.test`;
  const client = createClient(URL_, KEY, options);
  const { data, error } = await client.auth.signUp({ email, password: STUDENT_PASSWORD, options: { data: { portal: "ferd", full_name: name, reg_no: regNo, phone: "254712345678", accepted_terms: "true", ...extra } } });
  if (error) throw new Error(`Registration failed for ${regNo}: ${error.message}`);
  return { email, id: data.user.id };
}

const [admin, deptAdmin, contentManager, finance] = await Promise.all(["admin", "manager", "officer", "investor"].map(staff));
const created = { users: [], content: [], staff: [], products: [] };

try {
  // Most checks below exercise manual review, so automatic verification is switched off first and its
  // original setting is put back at the end.
  const { data: original } = await service.from("ferd_settings").select("auto_verify_students").single();
  created.autoVerify = original.auto_verify_students;
  await service.from("ferd_settings").update({ auto_verify_students: false }).eq("id", true);
  // A run that was interrupted may have left its test prefix rule behind.
  await service.from("ferd_prefix_rules").delete().eq("note", "[TEST]");
  // Departments are found by their fixed slug; the displayed abbreviation (ENSC, NARE, GEOG) can be edited.
  const { data: departments } = await admin.client.from("ferd_departments").select("id, code, slug");
  const KEYS = { "environmental-science": "ES", "natural-resources": "NR", geography: "GEO" };
  const dept = Object.fromEntries(departments.map((d) => [KEYS[d.slug], d.id]));
  check("Departments carry the abbreviations ENSC, NARE and GEOG", ["ENSC", "NARE", "GEOG"].every((code) => departments.some((d) => d.code === code)), departments.map((d) => d.code).join(", "));

  // ---- Phone numbers ---------------------------------------------------------------------
  check("Phone numbers are accepted as 07…, 01… and +254…, with or without spaces",
    ["0712345678", "0712 345 678", "0712-345-678", "+254712345678", "+254 712 345 678", "254712345678", "712345678", "+254 0712 345 678", "2540712345678", "00254712345678", "(+254) 712 345678"].every((n) => normalizePhone(n) === "254712345678") &&
    ["0110966455", "0110 966 455", "+254110966455", "+254 110 966 455"].every((n) => normalizePhone(n) === "254110966455"));
  check("Numbers that are not Kenyan mobile numbers are rejected", ["0812345678", "+255712345678", "12345", "07123456789", "071234567", "0212345678", "+1 712 345 678", ""].every((n) => normalizePhone(n) === null));

  check("A rejected phone number is explained: too many digits, too few, or not a mobile number",
    /11 digits.*should have 10.*extra/.test(phoneProblem("01110966455")) && /9 digits.*should have 10.*missing/.test(phoneProblem("071234567")) &&
    /13 digits.*should have 12.*extra/.test(phoneProblem("+254 7123 456 789")) && /does not look like a Kenyan mobile/.test(phoneProblem("0212345678")));

  // ---- Visitors ---------------------------------------------------------------------------
  check("Visitors can read the list of departments", (await anon.from("ferd_departments").select("code")).data?.length === 3);
  check("Visitors cannot read students, content, payments or prefix rules",
    denied(await anon.from("ferd_students").select("user_id")) && denied(await anon.from("ferd_content").select("id")) &&
    denied(await anon.from("ferd_payments").select("id")) && denied(await anon.from("ferd_prefix_rules").select("id")));

  // ---- Registration -----------------------------------------------------------------------
  const es = await register(`n12/${serial}/26`, "[TEST] Env Science Student", { status: "verified", department_id: dept.GEO, role: "super_admin" });
  const geo = await register(`N14/${serial}/26`, "[TEST] Geography Student");
  const odd = await register(`Z99/${serial}/26`, "[TEST] Unknown Prefix Student");
  created.users.push(es.id, geo.id, odd.id);
  const row = async (id) => (await service.from("ferd_students").select("*").eq("user_id", id).single()).data;
  const esRow = await row(es.id);
  check("A registration is stored with a normalised registration number", esRow?.reg_no_key === `N12/${serial}/26`, esRow?.reg_no_key);
  check("With manual review on, a new student is pending, whatever the form sent", esRow?.status === "pending");
  check("The department comes from the prefix rule, not from the form (N12/ → Environmental Science)", esRow?.department_id === dept.ES);
  check("N14/ is placed in Geography", (await row(geo.id))?.department_id === dept.GEO);
  check("An unknown prefix gets no department", (await row(odd.id))?.department_id === null);
  check("A FERD registration does not become CGS or FERD staff",
    (await service.from("profiles").select("role, status").eq("id", es.id).single()).data?.role === "community_member" &&
    (await service.from("ferd_staff").select("user_id").eq("user_id", es.id)).data.length === 0);
  const duplicate = await createClient(URL_, KEY, options).auth.signUp({ email: `ferd.dup${run}@cgs-portal.test`, password: STUDENT_PASSWORD, options: { data: { portal: "ferd", full_name: "[TEST] Duplicate", reg_no: `N12/${serial}/26`, phone: "254712345678" } } });
  if (duplicate.data?.user) created.users.push(duplicate.data.user.id);
  check("The same registration number cannot be registered twice", !!duplicate.error || (await service.from("ferd_students").select("user_id").eq("reg_no_key", `N12/${serial}/26`)).data.length === 1);

  const badFormat = await createClient(URL_, KEY, options).auth.signUp({ email: `ferd.bad${run}@cgs-portal.test`, password: STUDENT_PASSWORD, options: { data: { portal: "ferd", full_name: "[TEST] Bad Format", reg_no: `N12/${serial}/2026`, phone: "254712345678" } } });
  if (badFormat.data?.user) created.users.push(badFormat.data.user.id);
  check("A registration number that is not in the N12/12345/25 format is refused by the database",
    !!badFormat.error && (await service.from("ferd_students").select("user_id").eq("reg_no_key", `N12/${serial}/2026`)).data.length === 0, badFormat.error?.message ?? "sign-up succeeded");

  for (const [label, phone] of [["without a phone number", undefined], ["with an invalid phone number", "12345"]]) {
    const attempt = await createClient(URL_, KEY, options).auth.signUp({ email: `ferd.nophone${run}${phone ? "b" : "a"}@cgs-portal.test`, password: STUDENT_PASSWORD, options: { data: { portal: "ferd", full_name: "[TEST] No Phone", reg_no: `N12/${serial}7/26`, phone } } });
    if (attempt.data?.user) created.users.push(attempt.data.user.id);
    check(`A registration ${label} is refused by the database`, !!attempt.error, "sign-up succeeded");
  }
  check("The student's phone number is stored in the form M-Pesa expects", esRow?.phone === "254712345678", esRow?.phone);

  // ---- Pending students have no access ------------------------------------------------------
  await service.from("ferd_staff").upsert([
    { user_id: deptAdmin.id, role: "department_admin", department_id: dept.ES },
    { user_id: contentManager.id, role: "content_manager", department_id: null },
    { user_id: finance.id, role: "finance_admin", department_id: null },
  ]);
  created.staff.push(deptAdmin.id, contentManager.id, finance.id);

  const item = async (client, fields) => client.from("ferd_content").insert({ type: "note", title: "[TEST] item", status: "published", publish_at: new Date(Date.now() - 60_000).toISOString(), ...fields }).select("id").single();
  const { data: product } = await admin.client.from("ferd_products").select("id, price_kes").eq("slug", "es-all-units-manuals").single();
  const freeEs = await item(admin.client, { title: "[TEST] ES free note", departments: [dept.ES] });
  const premiumEs = await item(admin.client, { title: "[TEST] ES premium manual", type: "manual", departments: [dept.ES], tier: "premium", product_id: product.id });
  const geoOnly = await item(admin.client, { title: "[TEST] GEO note", departments: [dept.GEO] });
  const everyone = await item(admin.client, { title: "[TEST] All departments announcement", type: "announcement", departments: [] });
  const draft = await item(admin.client, { title: "[TEST] ES draft", departments: [dept.ES], status: "draft" });
  const scheduled = await item(admin.client, { title: "[TEST] ES scheduled", departments: [dept.ES], publish_at: new Date(Date.now() + 86_400_000).toISOString() });
  const expired = await item(admin.client, { title: "[TEST] ES expired internship", type: "internship", departments: [dept.ES], expires_at: new Date(Date.now() - 3_600_000).toISOString() });
  for (const c of [freeEs, premiumEs, geoOnly, everyone, draft, scheduled, expired]) if (c.data) created.content.push(c.data.id);
  check("The Super Admin can create content of every kind", [freeEs, premiumEs, geoOnly, everyone, draft, scheduled, expired].every((c) => !c.error), [freeEs, premiumEs, geoOnly].map((c) => c.error?.message).filter(Boolean).join("; "));

  const student = await signIn(es.email, STUDENT_PASSWORD);
  check("A pending student sees no content", (await student.client.from("ferd_content").select("id")).data.length === 0);
  check("A pending student cannot verify themselves", !!(await student.client.from("ferd_students").update({ status: "verified" }).eq("user_id", es.id).select()).error);
  check("A student cannot change their own department or registration number",
    !!(await student.client.from("ferd_students").update({ department_id: dept.GEO }).eq("user_id", es.id).select()).error &&
    !!(await student.client.from("ferd_students").update({ reg_no_key: `N14/${serial}9/26` }).eq("user_id", es.id).select()).error);
  check("A student can change their own phone number but cannot remove it",
    !(await student.client.from("ferd_students").update({ phone: "254799000111" }).eq("user_id", es.id).select()).error &&
    !!(await student.client.from("ferd_students").update({ phone: null }).eq("user_id", es.id).select()).error);

  // ---- Verification by staff ---------------------------------------------------------------
  check("A department admin cannot verify a student of another department", denied(await deptAdmin.client.from("ferd_students").update({ status: "verified" }).eq("user_id", geo.id).select()));
  check("A department admin cannot move a student into another department",
    !!(await deptAdmin.client.from("ferd_students").update({ department_id: dept.GEO }).eq("user_id", es.id).select()).error);
  const verified = await deptAdmin.client.from("ferd_students").update({ status: "verified", status_note: "[TEST] ID checked" }).eq("user_id", es.id).select("status, verified_by");
  check("A department admin can verify a student of their own department", verified.data?.[0]?.status === "verified" && verified.data[0].verified_by === deptAdmin.id, verified.error?.message);
  await admin.client.from("ferd_students").update({ status: "verified" }).eq("user_id", geo.id);
  check("The student is notified of the verification", (await student.client.from("ferd_notifications").select("title")).data.some((n) => n.title.includes("verified")));
  check("A student cannot rewrite a notification", !!(await student.client.from("ferd_notifications").update({ title: "hacked" }).eq("user_id", es.id).select()).error);

  // ---- Department isolation and publication window ------------------------------------------
  const visible = new Set((await student.client.from("ferd_content").select("id")).data.map((c) => c.id));
  check("A verified student sees live content of their department and of all departments", visible.has(freeEs.data.id) && visible.has(everyone.data.id) && visible.has(premiumEs.data.id));
  check("A student does not see another department's content", !visible.has(geoOnly.data.id));
  check("Drafts, scheduled and expired items are hidden from students", !visible.has(draft.data.id) && !visible.has(scheduled.data.id) && !visible.has(expired.data.id));
  const geoStudent = await signIn(geo.email, STUDENT_PASSWORD);
  check("A Geography student sees Geography content but not Environmental Science content",
    (await geoStudent.client.from("ferd_content").select("id").eq("id", geoOnly.data.id)).data.length === 1 &&
    (await geoStudent.client.from("ferd_content").select("id").eq("id", freeEs.data.id)).data.length === 0);
  check("A student cannot read another student's record", (await student.client.from("ferd_students").select("user_id").eq("user_id", geo.id)).data.length === 0);

  // ---- Students cannot write ---------------------------------------------------------------
  check("A student cannot create, edit or delete content",
    !!(await item(student.client, { departments: [dept.ES] })).error &&
    denied(await student.client.from("ferd_content").update({ title: "hacked" }).eq("id", freeEs.data.id).select()) &&
    denied(await student.client.from("ferd_content").delete().eq("id", freeEs.data.id).select()));
  check("A student cannot make themselves staff", !!(await student.client.from("ferd_staff").insert({ user_id: es.id, role: "super_admin" })).error);
  check("A student cannot grant themselves a library",
    !!(await student.client.from("ferd_entitlements").insert({ user_id: es.id, product_id: product.id, source: "grant", granted_by: es.id })).error);
  check("A student cannot create a payment record or change prices or feature settings",
    !!(await student.client.from("ferd_payments").insert({ user_id: es.id, product_id: product.id, amount_kes: 1, phone: "254712345678", reference: `X${run}`, status: "success" })).error &&
    denied(await student.client.from("ferd_products").update({ price_kes: 1 }).eq("id", product.id).select()) &&
    denied(await student.client.from("ferd_modules").update({ is_enabled: false }).eq("key", "manuals").select()));

  // ---- Staff roles -------------------------------------------------------------------------
  const ownDept = await item(deptAdmin.client, { title: "[TEST] ES note by department admin", departments: [dept.ES] });
  if (ownDept.data) created.content.push(ownDept.data.id);
  check("A department admin can publish content for their own department", !ownDept.error, ownDept.error?.message);
  check("A department admin cannot publish for another department or for all departments",
    !!(await item(deptAdmin.client, { departments: [dept.GEO] })).error && !!(await item(deptAdmin.client, { departments: [] })).error);
  const managed = await item(contentManager.client, { title: "[TEST] note by content manager", departments: [dept.GEO] });
  if (managed.data) created.content.push(managed.data.id);
  check("A content manager can publish free content", !managed.error, managed.error?.message);
  check("A content manager cannot make content premium", !!(await item(contentManager.client, { tier: "premium", product_id: product.id })).error &&
    !!(await contentManager.client.from("ferd_content").update({ tier: "premium", product_id: product.id }).eq("id", managed.data.id).select()).error);
  check("Only the Super Admin can change prices, prefix rules, modules and staff roles",
    denied(await deptAdmin.client.from("ferd_products").update({ price_kes: 5 }).eq("id", product.id).select()) &&
    !!(await deptAdmin.client.from("ferd_prefix_rules").insert({ prefix: `T${run.slice(-3)}/`, department_id: dept.ES })).error &&
    denied(await deptAdmin.client.from("ferd_modules").update({ is_enabled: false }).eq("key", "events").select()) &&
    !!(await deptAdmin.client.from("ferd_staff").upsert({ user_id: deptAdmin.id, role: "super_admin" })).error);
  check("A finance admin can read payments but cannot write content", !(await finance.client.from("ferd_payments").select("id").limit(1)).error && !!(await item(finance.client, { departments: [dept.ES] })).error);
  check("Staff other than the Super Admin cannot read the audit log", (await deptAdmin.client.from("ferd_audit_logs").select("id").limit(1)).data.length === 0);

  // ---- Feature configuration ---------------------------------------------------------------
  const off = await admin.client.from("ferd_department_modules").upsert({ department_id: dept.GEO, module_key: "events", is_enabled: false, label: "[TEST] hidden" }, { onConflict: "department_id,module_key" });
  check("The Super Admin can switch a module off for one department", !off.error, off.error?.message);
  await admin.client.from("ferd_department_modules").delete().eq("department_id", dept.GEO).eq("module_key", "events");
  const rule = await admin.client.from("ferd_prefix_rules").insert({ prefix: `Z99/`, department_id: dept.NR, note: "[TEST]" }).select("id").single();
  const late = await register(`Z99/${serial}8/26`, "[TEST] New Prefix Student");
  created.users.push(late.id);
  check("A prefix rule added by the Super Admin applies to the next registration", (await row(late.id))?.department_id === dept.NR, rule.error?.message);
  if (rule.data) await admin.client.from("ferd_prefix_rules").delete().eq("id", rule.data.id);

  // ---- Sign-in without approval ---------------------------------------------------------------
  check("Only the Super Admin can change the verification setting",
    denied(await deptAdmin.client.from("ferd_settings").update({ auto_verify_students: true }).eq("id", true).select()) &&
    denied(await student.client.from("ferd_settings").update({ auto_verify_students: true }).eq("id", true).select()));
  const switched = await admin.client.from("ferd_settings").update({ auto_verify_students: true }).eq("id", true).select("auto_verify_students");
  check("The Super Admin can switch automatic verification on", switched.data?.[0]?.auto_verify_students === true, switched.error?.message);
  const instant = await register(`N12/${serial}6/26`, "[TEST] Instant Student", { status: "suspended", department_id: dept.GEO });
  const noDept = await register(`Y88/${serial}6/26`, "[TEST] Instant Unknown Prefix");
  created.users.push(instant.id, noDept.id);
  const instantRow = await row(instant.id);
  check("With automatic verification, a new student is verified at once in the department of their prefix",
    instantRow?.status === "verified" && instantRow.department_id === dept.ES && instantRow.verified_at !== null, JSON.stringify(instantRow?.status));
  const instantClient = await signIn(instant.email, STUDENT_PASSWORD);
  check("That student can sign in and read their department's content straight away",
    (await instantClient.client.from("ferd_content").select("id").eq("id", freeEs.data.id)).data.length === 1 &&
    (await instantClient.client.from("ferd_content").select("id").eq("id", geoOnly.data.id)).data.length === 0);
  check("Automatic verification gives no staff role and no premium access",
    (await service.from("ferd_staff").select("user_id").eq("user_id", instant.id)).data.length === 0 &&
    (await instantClient.client.rpc("ferd_can_access_content", { p_content: premiumEs.data.id })).data === false);
  check("A number that matches no department still waits for an administrator", (await row(noDept.id))?.status === "pending");
  check("A FERD registration never activates a CGS workspace account", (await service.from("profiles").select("status").eq("id", instant.id).single()).data.status === "pending");
  await service.from("ferd_settings").update({ auto_verify_students: false }).eq("id", true);

  // The same rule on the CGS side: self-service roles are active at once, staff roles still wait.
  const { data: cgs } = await service.from("system_settings").select("require_account_approval").single();
  await service.from("system_settings").update({ require_account_approval: false }).eq("id", true);
  const cgsStatus = async (role) => {
    const { data, error } = await createClient(URL_, KEY, options).auth.signUp({ email: `cgs.${role}.${run}@cgs-portal.test`, password: STUDENT_PASSWORD, options: { data: { full_name: `[TEST] ${role}`, requested_role: role, accepted_terms: "true" } } });
    if (error) throw new Error(`CGS registration failed for ${role}: ${error.message}`);
    created.users.push(data.user.id);
    return (await service.from("profiles").select("role, status").eq("id", data.user.id).single()).data;
  };
  const [ownerAccount, investorAccount, communityAccount, managerAccount, officerAccount] = [await cgsStatus("project_owner"), await cgsStatus("investor"), await cgsStatus("community_member"), await cgsStatus("project_manager"), await cgsStatus("field_officer")];
  check("New CGS project owners, investors and community members are active without approval",
    [ownerAccount, investorAccount, communityAccount].every((a) => a.status === "active"), JSON.stringify([ownerAccount, investorAccount, communityAccount]));
  check("People who register as Project Manager or Field Officer still wait for an administrator",
    managerAccount.status === "pending" && officerAccount.status === "pending", JSON.stringify([managerAccount, officerAccount]));
  check("Nobody can register themselves as an administrator", (await cgsStatus("super_admin")).role !== "super_admin");
  await service.from("system_settings").update({ require_account_approval: cgs.require_account_approval }).eq("id", true);

  // ---- Adding a student record to an existing account ------------------------------------------
  const holder = async (label) => {
    const email = `cgs.holder${label}.${run}@cgs-portal.test`;
    const { data, error } = await createClient(URL_, KEY, options).auth.signUp({ email, password: STUDENT_PASSWORD, options: { data: { full_name: "[TEST] Existing Account", requested_role: "community_member", accepted_terms: "true" } } });
    if (error) throw new Error(`CGS registration failed: ${error.message}`);
    created.users.push(data.user.id);
    return signIn(email, STUDENT_PASSWORD);
  };
  const enrol = (client, regNo, phone = "254712345678", name = "[TEST] Existing Account") => client.rpc("ferd_enroll_self", { p_full_name: name, p_reg_no: regNo, p_phone: phone, p_year_of_study: 2 });
  const first = await holder("a");
  check("An account without a student record has none to begin with", (await service.from("ferd_students").select("user_id").eq("user_id", first.id)).data.length === 0);
  check("A visitor cannot add a student record", !!(await enrol(anon, `N14/${serial}5/26`)).error);
  check("A badly written registration number, an invalid phone number and a number that is already taken are refused",
    !!(await enrol(first.client, `N14/${serial}5/2026`)).error && !!(await enrol(first.client, `N14/${serial}5/26`, "0712345678")).error &&
    !!(await enrol(first.client, `N12/${serial}/26`)).error && !!(await enrol(first.client, `N14/${serial}5/26`, "254712345678", " ")).error);
  const enrolled = await enrol(first.client, `n14/${serial}5/26`);
  const enrolledRow = await row(first.id);
  check("A signed-in account holder can add their student record; with manual review it is pending",
    enrolled.data === "pending" && enrolledRow?.reg_no_key === `N14/${serial}5/26` && enrolledRow.department_id === dept.GEO && enrolledRow.status === "pending", enrolled.error?.message ?? JSON.stringify(enrolled.data));
  check("An account cannot hold two student records", !!(await enrol(first.client, `N14/${serial}4/26`)).error);
  check("Adding a student record gives no staff role", (await service.from("ferd_staff").select("user_id").eq("user_id", first.id)).data.length === 0);
  await service.from("ferd_settings").update({ auto_verify_students: true }).eq("id", true);
  const second = await holder("b");
  const direct = await enrol(second.client, `N12/${serial}5/26`);
  await service.from("ferd_settings").update({ auto_verify_students: false }).eq("id", true);
  check("With automatic verification the added record is verified at once and the portal opens",
    direct.data === "verified" && (await second.client.from("ferd_content").select("id").eq("id", freeEs.data.id)).data.length === 1, direct.error?.message ?? JSON.stringify(direct.data));
  const announced = async (id) => (await admin.client.from("notifications").select("title, body, link").eq("type", "ferd_registration").eq("entity_id", id)).data ?? [];
  const [viaForm, viaAccount, viaAuto] = [await announced(es.id), await announced(first.id), await announced(second.id)];
  check("Administrators are notified of every new student, with a link to the Students page",
    viaForm.length === 1 && viaAccount.length === 1 && viaAuto.length === 1 && viaAccount[0].link === "/ferd/admin/students?status=pending" &&
    viaAuto[0].link === "/ferd/admin/students?status=verified" && viaForm[0].body.includes(`N12/${serial}/26`), JSON.stringify([viaForm, viaAccount, viaAuto]));
  check("A student does not receive the administrators' notification", ((await student.client.from("notifications").select("id").eq("type", "ferd_registration")).data ?? []).length === 0);

  // ---- Premium access and payments ----------------------------------------------------------
  const access = async (who, id) => (await who.client.rpc("ferd_can_access_content", { p_content: id })).data;
  check("A free item is accessible; a premium item is locked before payment", (await access(student, freeEs.data.id)) === true && (await access(student, premiumEs.data.id)) === false);
  check("Another department's item is not accessible", (await access(student, geoOnly.data.id)) === false);
  check("A student cannot call the payment finalisation function", !!(await student.client.rpc("ferd_finalize_payment", { p_checkout_request_id: "x", p_result_code: "0", p_result_desc: "x" })).error);

  const pay = async (suffix) => {
    const checkout = `ws_CO_TEST_${run}_${suffix}`;
    const { data, error } = await service.from("ferd_payments").insert({ user_id: es.id, product_id: product.id, amount_kes: product.price_kes, phone: "254712345678", reference: `T${run}${suffix}`, checkout_request_id: checkout }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: data.id, checkout };
  };
  const finalize = async (checkout, code, receipt = null, amount = null) =>
    (await service.rpc("ferd_finalize_payment", { p_checkout_request_id: checkout, p_result_code: code, p_result_desc: "[TEST]", p_receipt: receipt, p_paid_amount: amount })).data;

  const cancelled = await pay("A");
  check("A cancelled payment is recorded as cancelled", (await finalize(cancelled.checkout, "1032")) === "cancelled");
  const failed = await pay("B");
  check("A failed payment is recorded as failed", (await finalize(failed.checkout, "1")) === "failed");
  const short = await pay("C");
  check("A payment for less than the price is not accepted", (await finalize(short.checkout, "0", `TST${run}C`, product.price_kes - 1)) === "failed");
  const pending = await pay("D");
  check("Cancelled, failed, underpaid and pending payments unlock nothing", (await access(student, premiumEs.data.id)) === false &&
    (await service.from("ferd_entitlements").select("id").eq("user_id", es.id)).data.length === 0);

  const good = await pay("E");
  check("A confirmed payment is recorded as successful", (await finalize(good.checkout, "0", `TST${run}E`, product.price_kes)) === "success");
  check("The confirmed payment unlocks the library for that student", (await access(student, premiumEs.data.id)) === true);
  check("It does not unlock anything for another student", (await access(geoStudent, premiumEs.data.id)) === false);
  check("A repeated callback changes nothing and grants nothing twice",
    (await finalize(good.checkout, "0", `TST${run}E2`, product.price_kes)) === "success" && (await finalize(good.checkout, "1032")) === "success" &&
    (await service.from("ferd_entitlements").select("id").eq("user_id", es.id)).data.length === 1 &&
    (await service.from("ferd_payments").select("mpesa_receipt").eq("id", good.id).single()).data.mpesa_receipt === `TST${run}E`);
  check("An unknown checkout id is ignored", (await finalize(`ws_CO_UNKNOWN_${run}`, "0")) === "unknown");
  check("A finished payment record cannot be edited or deleted, even by the server key",
    !!(await service.from("ferd_payments").update({ amount_kes: 1 }).eq("id", good.id).select()).error &&
    !!(await service.from("ferd_payments").update({ status: "pending" }).eq("id", cancelled.id).select()).error &&
    !!(await service.from("ferd_payments").delete().eq("id", good.id).select()).error);
  check("A student sees only their own payments", (await student.client.from("ferd_payments").select("id")).data.length === 5 && (await geoStudent.client.from("ferd_payments").select("id")).data.length === 0);

  await admin.client.from("ferd_products").update({ price_kes: product.price_kes + 50 }).eq("id", product.id);
  check("Changing the price does not alter a finished payment or the entitlement",
    (await service.from("ferd_payments").select("amount_kes").eq("id", good.id).single()).data.amount_kes === product.price_kes && (await access(student, premiumEs.data.id)) === true);
  await admin.client.from("ferd_products").update({ price_kes: product.price_kes }).eq("id", product.id);

  const grant = await admin.client.from("ferd_entitlements").insert({ user_id: geo.id, product_id: product.id, source: "grant", granted_by: admin.id, note: "[TEST] bursary" }).select("id").single();
  check("The Super Admin can grant a library manually; a department admin cannot",
    !grant.error && !!(await deptAdmin.client.from("ferd_entitlements").insert({ user_id: late.id, product_id: product.id, source: "grant", granted_by: deptAdmin.id })).error, grant.error?.message);
  await admin.client.from("ferd_entitlements").update({ revoked_at: new Date().toISOString() }).eq("user_id", es.id).eq("product_id", product.id);
  check("Withdrawing access locks the library again", (await access(student, premiumEs.data.id)) === false);
  await admin.client.from("ferd_entitlements").update({ revoked_at: null }).eq("user_id", es.id).eq("product_id", product.id);

  // ---- Private files -----------------------------------------------------------------------
  const path = `${premiumEs.data.id}/test-${run}.pdf`;
  const upload = await admin.client.storage.from("ferd-files").upload(path, new TextEncoder().encode("%PDF-1.4 ferd test"), { contentType: "application/pdf" });
  const fileRow = await admin.client.from("ferd_files").insert({ content_id: premiumEs.data.id, storage_path: path, file_name: "manual.pdf", mime_type: "application/pdf", size_bytes: 18, uploaded_by: admin.id }).select("id").single();
  check("Staff can upload a file to the private bucket", !upload.error && !fileRow.error, upload.error?.message ?? fileRow.error?.message);
  check("A student cannot upload to the bucket", !!(await student.client.storage.from("ferd-files").upload(`${premiumEs.data.id}/x-${run}.pdf`, new TextEncoder().encode("x"), { contentType: "application/pdf" })).error);
  check("A student cannot download or sign a file from the bucket directly, even one they paid for",
    !!(await student.client.storage.from("ferd-files").download(path)).error && !!(await student.client.storage.from("ferd-files").createSignedUrl(path, 60)).error);
  check("A visitor cannot download the file", !!(await anon.storage.from("ferd-files").download(path)).error);
  const publicUrl = await fetch(`${URL_}/storage/v1/object/public/ferd-files/${path}`);
  check("The file has no public URL", publicUrl.status !== 200, String(publicUrl.status));

  // ---- Audit -------------------------------------------------------------------------------
  const actions = new Set((await admin.client.from("ferd_audit_logs").select("action").order("created_at", { ascending: false }).limit(200)).data.map((l) => l.action));
  check("Verification, content, payments, access grants, prices and settings are in the audit log",
    ["student.verified", "content.created", "payment.success", "payment.cancelled", "ferd_entitlements.insert", "ferd_products.update", "ferd_prefix_rules.insert", "ferd_department_modules.insert"].every((a) => actions.has(a)),
    [...actions].join(", "));
  check("The audit log cannot be written or edited through the API",
    !!(await admin.client.from("ferd_audit_logs").insert({ action: "x", entity: "x" })).error && denied(await admin.client.from("ferd_audit_logs").delete().gt("id", 0).select()));

  // ---- Pages and endpoints (optional) --------------------------------------------------------
  if (APP_URL) {
    const ref = new URL(URL_).hostname.split(".")[0];
    const cookieFor = (session) => {
      const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
      const chunks = value.match(/.{1,3180}/g);
      return chunks.length === 1 ? `sb-${ref}-auth-token=${value}` : chunks.map((c, i) => `sb-${ref}-auth-token.${i}=${c}`).join("; ");
    };
    const get = (path, who, init = {}) => fetch(`${APP_URL}${path}`, { ...init, headers: { ...(who ? { cookie: cookieFor(who.session) } : {}), ...(init.headers ?? {}) }, redirect: "manual" });
    const text = async (res) => (await res.text()).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");

    for (const path of ["/ferd", "/ferd/login", "/ferd/register", "/ferd/forgot-password", "/ferd/help"]) {
      check(`Public page ${path} renders`, (await get(path)).status === 200);
    }
    check("The CGS home page still renders and carries the FERD Student Portal link", await (async () => {
      const res = await get("/");
      const html = await res.text();
      return res.status === 200 && html.includes("FERD Student Portal") && html.includes("Explore the Earth");
    })());
    const backLink = /<a[^>]*title="Back to the Cypher Green Systems home page"[^>]*href="[/]"|<a[^>]*href="[/]"[^>]*title="Back to the Cypher Green Systems home page"/;
    const withBack = [];
    for (const [path, who] of [["/ferd", null], ["/ferd/login", null], ["/ferd/register", null], ["/ferd/forgot-password", null], ["/ferd/dashboard", student], ["/ferd/admin", admin]]) {
      if (!backLink.test(await (await get(path, who)).text())) withBack.push(path);
    }
    check("Every FERD screen carries a link back to the Cypher Green Systems home page", withBack.length === 0, withBack.join(", "));
    const cgsDashboard = await get("/dashboard", admin);
    const cgsHtml = await cgsDashboard.text();
    check("The CGS super administrator's dashboard shows the FERD figures and links to the FERD administration",
      cgsDashboard.status === 200 && cgsHtml.includes("Registered students") && cgsHtml.includes("Students awaiting review") && cgsHtml.includes('href="/ferd/admin"') && !cgsHtml.includes("Unavailable"));
    check("Other CGS roles do not get the FERD figures", !(await (await get("/dashboard", contentManager)).text()).includes("Registered students"));
    // Search from the student dashboard.
    const searchText = async (who, q) => text(await get(`/ferd/search?q=${encodeURIComponent(q)}`, who));
    const byTitle = await searchText(student, "free note");
    const byFile = await searchText(student, "manual.pdf");
    check("The dashboard has a search box and the search finds an item by its title",
      (await (await get("/ferd/dashboard", student)).text()).includes('action="/ferd/search"') && byTitle.includes("[TEST] ES free note") && !byTitle.includes("[TEST] GEO note"));
    check("The search finds an item by the name of an uploaded file", byFile.includes("manual.pdf") && byFile.includes("[TEST] ES premium manual"));
    check("The search never returns another department's material", !(await searchText(student, "GEO note")).includes("[TEST] GEO note") && (await searchText(geoStudent, "GEO note")).includes("[TEST] GEO note") && !(await searchText(geoStudent, "manual.pdf")).includes("[TEST] ES premium manual"));
    check("Visitors cannot search", await (async () => { const res = await get("/ferd/search?q=note"); return [302, 303, 307].includes(res.status) || /NEXT_REDIRECT/.test(await res.text()); })());
    const closed = async (path, who) => {
      const res = await get(path, who);
      return [302, 303, 307, 401, 403, 404].includes(res.status) || /NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK;404/.test(await res.text());
    };
    check("Visitors are sent away from the student portal and the administration", (await closed("/ferd/dashboard")) && (await closed("/ferd/admin")) && (await closed("/ferd/manuals")));
    const noRecord = await holder("c");
    const addPage = await get("/ferd/register", noRecord);
    check("A signed-in account without a student record is offered the form to add one",
      addPage.status === 200 && (await text(addPage)).includes("Add your student record") && (await closed("/ferd/dashboard", noRecord)));
    check("An account that already has a student record is sent on from the registration page", await closed("/ferd/register", student));
    check("A student is sent away from the administration", (await closed("/ferd/admin", student)) && (await closed("/ferd/admin/students", student)) && (await closed("/ferd/admin/settings", student)));
    check("A department admin is sent away from Super Admin pages", (await closed("/ferd/admin/settings", deptAdmin)) && (await closed("/ferd/admin/staff", deptAdmin)) && (await closed("/ferd/admin/audit", deptAdmin)));

    const studentPages = ["/ferd/dashboard", "/ferd/courses", "/ferd/resources", "/ferd/manuals", "/ferd/opportunities", "/ferd/events", "/ferd/community", "/ferd/notifications", "/ferd/profile", `/ferd/content/${freeEs.data.id}`, `/ferd/content/${premiumEs.data.id}`, "/ferd/checkout/es-all-units-manuals"];
    const bad = [];
    for (const path of studentPages) {
      const res = await get(path, student);
      if (res.status !== 200 || (await res.text()).includes("NEXT_REDIRECT")) bad.push(`${path} -> ${res.status}`);
    }
    check(`All ${studentPages.length} student pages render for a verified student`, bad.length === 0, bad.join("; "));
    const esDash = await text(await get("/ferd/dashboard", student));
    const geoDash = await text(await get("/ferd/dashboard", geoStudent));
    check("Each department gets its own dashboard and content",
      esDash.includes("Environmental Science") && esDash.includes("[TEST] ES free note") && !esDash.includes("[TEST] GEO note") &&
      geoDash.includes("Geography") && geoDash.includes("[TEST] GEO note") && !geoDash.includes("[TEST] ES free note"));
    check("Another department's item is not found by its address", await closed(`/ferd/content/${geoOnly.data.id}`, student));

    const adminPages = ["/ferd/admin", "/ferd/admin/students", "/ferd/admin/content", "/ferd/admin/content/new", `/ferd/admin/content/${premiumEs.data.id}`, "/ferd/admin/courses", "/ferd/admin/products", "/ferd/admin/payments", "/ferd/admin/settings", "/ferd/admin/staff", "/ferd/admin/audit", "/ferd/dashboard"];
    const badAdmin = [];
    for (const path of adminPages) {
      const res = await get(path, admin);
      if (res.status !== 200 || (await res.text()).includes("NEXT_REDIRECT")) badAdmin.push(`${path} -> ${res.status}`);
    }
    check(`All ${adminPages.length} administration pages render for the Super Admin`, badAdmin.length === 0, badAdmin.join("; "));

    // File delivery through the server.
    const fileUrl = `/api/ferd/files/${fileRow.data.id}`;
    check("A visitor cannot fetch a file", (await get(fileUrl)).status === 401);
    const mine = await get(fileUrl, student);
    check("A student who owns the library is redirected to a short-lived signed link", mine.status === 302 && /token=/.test(mine.headers.get("location") ?? ""), String(mine.status));
    if (mine.status === 302) check("The signed link delivers the file", (await fetch(mine.headers.get("location"))).status === 200);
    check("A student of another department is refused the file", [403, 404].includes((await get(fileUrl, geoStudent)).status));
    await admin.client.from("ferd_entitlements").update({ revoked_at: new Date().toISOString() }).eq("user_id", es.id).eq("product_id", product.id);
    check("After access is withdrawn the same student is refused", (await get(fileUrl, student)).status === 403);
    await admin.client.from("ferd_entitlements").update({ revoked_at: null }).eq("user_id", es.id).eq("product_id", product.id);

    // Payment endpoints.
    const post = (who, body) => get("/api/payments/stk-push", who, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    check("The payment endpoint refuses visitors", (await post(null, { product: "es-all-units-manuals", phone: "0712345678" })).status === 401);
    check("The payment endpoint refuses staff and unverified accounts", (await post(admin, { product: "es-all-units-manuals", phone: "0712345678" })).status === 403);
    check("The payment endpoint rejects an invalid phone number", (await post(geoStudent, { product: "es-all-units-manuals", phone: "12345" })).status === 400);
    const onRecord = await post(geoStudent, { product: "es-all-units-manuals" });
    check("Without a number in the request, the payment endpoint uses the phone on the student's record", onRecord.status !== 400, String(onRecord.status));
    const disabled = await post(geoStudent, { product: "es-all-units-manuals", phone: "0712345678" });
    check("With M-Pesa switched off, no payment can be started", disabled.status === 503, String(disabled.status));
    check("The status endpoint shows a student their own payment and hides others'",
      (await (await get(`/api/payments/status?id=${good.id}`, student)).json()).status === "success" && (await get(`/api/payments/status?id=${good.id}`, geoStudent)).status === 404);
    const before = (await service.from("ferd_payments").select("status").eq("id", pending.id).single()).data.status;
    const forged = await fetch(`${APP_URL}/api/payments/callback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Body: { stkCallback: { MerchantRequestID: "x", CheckoutRequestID: pending.checkout, ResultCode: 0, ResultDesc: "ok", CallbackMetadata: { Item: [{ Name: "Amount", Value: product.price_kes }, { Name: "MpesaReceiptNumber", Value: "FORGED123" }] } } } }) });
    check("A forged success callback is acknowledged but changes nothing",
      forged.status === 200 && before === "pending" && (await service.from("ferd_payments").select("status").eq("id", pending.id).single()).data.status === "pending");

    // Study assistant. No real model call is needed for these: with no API key the endpoint answers 503,
    // and with a deliberately invalid key (ANTHROPIC_API_KEY=sk-ant-invalid-for-tests on the server) it
    // still performs the access checks and source retrieval, then reports that the model is unavailable.
    const ask = (who, question) => get("/api/ferd/assistant", who, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: question }] }) });
    const sourcesOf = (res) => JSON.parse(Buffer.from(res.headers.get("x-ferd-sources") ?? "", "base64").toString() || "[]");
    check("The study assistant page renders for a verified student", (await get("/ferd/assistant", student)).status === 200);
    check("The assistant refuses visitors", (await ask(null, "Explain the free note")).status === 401);
    check("The assistant rejects an empty or oversized conversation",
      (await get("/api/ferd/assistant", student, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [] }) })).status !== 200);
    const first = await ask(student, "Explain the premium manual and the free note");
    if (first.status === 503) {
      check("Without an API key the assistant reports that it is not set up", true);
    } else {
      const mine = sourcesOf(first);
      await first.text();
      check("The assistant is given only the student's own department material",
        first.status === 200 && mine.some((s) => s.title === "[TEST] ES free note") && !mine.some((s) => s.title.includes("GEO")), JSON.stringify(mine));
      check("A premium item the student owns is readable by the assistant", mine.find((s) => s.title === "[TEST] ES premium manual")?.readable === true);
      await admin.client.from("ferd_entitlements").update({ revoked_at: new Date().toISOString() }).eq("user_id", es.id).eq("product_id", product.id);
      const locked = await ask(student, "Explain the premium manual and the free note");
      check("A premium item the student has not unlocked is named but not readable", sourcesOf(locked).find((s) => s.title === "[TEST] ES premium manual")?.readable === false);
      await locked.text();
      await admin.client.from("ferd_entitlements").update({ revoked_at: null }).eq("user_id", es.id).eq("product_id", product.id);
      const other = await ask(geoStudent, "Explain the premium manual and the free note");
      check("Another department's student gets none of that material", !sourcesOf(other).some((s) => s.title.includes("ES ")), JSON.stringify(sourcesOf(other)));
      await other.text();
      check("Each question is counted in the usage log", (await service.from("ferd_assistant_usage").select("id", { count: "exact", head: true }).eq("user_id", es.id)).count === 2);
      await service.from("ferd_assistant_usage").insert(Array.from({ length: 6 }, () => ({ user_id: es.id })));
      check("The assistant rate limit stops rapid questions", (await ask(student, "Explain the free note again")).status === 429);
    }
    await admin.client.from("ferd_department_modules").upsert({ department_id: dept.GEO, module_key: "assistant", is_enabled: false }, { onConflict: "department_id,module_key" });
    check("Switching the assistant off for a department closes its page and endpoint", (await closed("/ferd/assistant", geoStudent)) && (await ask(geoStudent, "Explain the free note")).status === 404);
    await admin.client.from("ferd_department_modules").delete().eq("department_id", dept.GEO).eq("module_key", "assistant");
  }
} finally {
  // Payments are financial records and cannot be deleted through the API; local test rows are removed
  // with the account by the cleanup SQL in the README. Everything else is removed here.
  await service.from("ferd_prefix_rules").delete().eq("note", "[TEST]");
  if (created.autoVerify !== undefined) await service.from("ferd_settings").update({ auto_verify_students: created.autoVerify }).eq("id", true);
  for (const id of created.content) await service.from("ferd_content").delete().eq("id", id);
  if (created.staff.length) await service.from("ferd_staff").delete().in("user_id", created.staff);
  let removed = 0;
  for (const id of created.users) {
    const { data: paid } = await service.from("ferd_payments").select("id").eq("user_id", id).limit(1);
    if (paid?.length) {
      await service.from("ferd_students").update({ status: "suspended", status_note: "[TEST] finished" }).eq("user_id", id);
      continue; // an account with payment records is kept (suspended) because those records are permanent
    }
    if (!(await service.auth.admin.deleteUser(id)).error) removed++;
  }
  console.log(`Cleanup: ${created.content.length} content items and ${removed} of ${created.users.length} test accounts removed.`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
