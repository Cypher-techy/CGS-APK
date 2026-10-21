// Authorization checks for the two community chats (CGS and FERD), run against the database through the
// same API the browser uses. Local database only, unless COMMUNITY_CHECK_REMOTE=yes.
//
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, TEST_PASSWORD
//   node scripts/community-check.mjs
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY;
const PASSWORD = process.env.TEST_PASSWORD;
if (!URL_ || !KEY || !SECRET || !PASSWORD) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and TEST_PASSWORD");
if (!/127\.0\.0\.1|localhost/.test(URL_) && process.env.COMMUNITY_CHECK_REMOTE !== "yes") throw new Error("Refusing to run against a non-local database (set COMMUNITY_CHECK_REMOTE=yes to override)");

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${!condition && detail ? ` — ${detail}` : ""}`);
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(URL_, SECRET, options);
const anon = createClient(URL_, KEY, options);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = Date.now().toString().slice(-5);
const SECRET_WORD = `Chat-test-${run}-pw1`;
const users = [];

async function signIn(email, password) {
  const client = createClient(URL_, KEY, options);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return { client, id: data.user.id, sends: [] };
}
/** An active CGS community member. */
async function cgsMember(label) {
  const email = `chat.cgs${label}.${run}@cgs-portal.test`;
  const { data, error } = await service.auth.admin.createUser({ email, password: SECRET_WORD, email_confirm: true, user_metadata: { full_name: `[TEST] CGS ${label}`, requested_role: "community_member", accepted_terms: "true" } });
  if (error) throw error;
  users.push(data.user.id);
  await service.from("profiles").update({ status: "active" }).eq("id", data.user.id);
  return signIn(email, SECRET_WORD);
}
/** A FERD student registered through the normal path, then given a status by an administrator. */
async function student(label, regNo, status) {
  const email = `chat.ferd${label}.${run}@cgs-portal.test`;
  const { data, error } = await service.auth.admin.createUser({ email, password: SECRET_WORD, email_confirm: true, user_metadata: { portal: "ferd", full_name: `[TEST] Student ${label}`, reg_no: regNo, phone: "254712345678", accepted_terms: "true" } });
  if (error) throw error;
  users.push(data.user.id);
  await service.from("ferd_students").update({ status }).eq("user_id", data.user.id);
  return signIn(email, SECRET_WORD);
}
/** Sends a message, pausing when the sender nears the rate limit (5 messages in 10 seconds). */
async function send(who, channel, body, extra = {}) {
  const now = Date.now();
  who.sends = who.sends.filter((t) => now - t < 10_500);
  if (who.sends.length >= 4) await sleep(10_500 - (now - who.sends[0]));
  who.sends.push(Date.now());
  return who.client.rpc("community_send", { p_channel: channel, p_body: body, ...extra });
}
const visible = async (who, id) => ((await who.client.from("community_messages").select("id").eq("id", id)).data ?? []).length === 1;
const channels = async (who, community) => (await who.client.rpc("community_channel_list", { p_community: community })).data ?? [];
const PDF = new Blob([new Uint8Array(2048)], { type: "application/pdf" });

const admin = await signIn("test.admin@cgs-portal.test", PASSWORD);
const { data: settings } = await service.from("community_settings").select("community, require_approval");

try {
  const [a, b, late] = [await cgsMember("a"), await cgsMember("b"), await cgsMember("late")];
  const es = await student("es", `N12/${run}/27`, "verified");
  const geo = await student("geo", `N14/${run}/27`, "verified");
  const waiting = await student("wait", `N12/${run}9/27`, "pending");
  const all = (await service.from("community_channels").select("id, community, slug, kind, department_id")).data;
  const ch = (community, slug) => all.find((c) => c.community === community && c.slug === slug).id;
  const { data: departments } = await service.from("ferd_departments").select("id, slug");
  const esRoom = all.find((c) => c.department_id === departments.find((d) => d.slug === "environmental-science").id).id;

  // ---- Visitors and joining -------------------------------------------------------------------
  check("Visitors cannot read channels, messages or members",
    ((await anon.from("community_channels").select("id")).data ?? []).length === 0 && ((await anon.from("community_messages").select("id")).data ?? []).length === 0 &&
    ((await anon.from("community_members").select("user_id")).data ?? []).length === 0);
  check("Visitors cannot join or send", !!(await anon.rpc("community_join", { p_community: "cgs" })).error && !!(await anon.rpc("community_send", { p_channel: ch("cgs", "general"), p_body: "hello" })).error);
  check("Before joining, an eligible account sees no channels", (await channels(a, "cgs")).length === 0);
  check("An active CGS member joins the CGS community", (await a.client.rpc("community_join", { p_community: "cgs" })).data === "active" && (await b.client.rpc("community_join", { p_community: "cgs" })).data === "active");
  check("A verified student joins the FERD community", (await es.client.rpc("community_join", { p_community: "ferd" })).data === "active" && (await geo.client.rpc("community_join", { p_community: "ferd" })).data === "active");
  check("A CGS member cannot join the FERD community", !!(await a.client.rpc("community_join", { p_community: "ferd" })).error);
  check("A FERD student cannot join the CGS community", !!(await es.client.rpc("community_join", { p_community: "cgs" })).error);
  check("A student who is not verified cannot join, whatever their registration number", !!(await waiting.client.rpc("community_join", { p_community: "ferd" })).error);
  check("Nobody can write a membership for themselves directly",
    !!(await waiting.client.from("community_members").insert({ community: "ferd", user_id: waiting.id })).error && !!(await a.client.from("community_members").insert({ community: "ferd", user_id: a.id })).error &&
    ((await a.client.from("community_members").update({ role: "moderator" }).eq("user_id", a.id).select()).data ?? []).length === 0);

  // ---- Channels are per community ---------------------------------------------------------------
  const [aCgs, aFerd, esFerd, esCgs, geoFerd] = [await channels(a, "cgs"), await channels(a, "ferd"), await channels(es, "ferd"), await channels(es, "cgs"), await channels(geo, "ferd")];
  check("A CGS member sees the CGS channels and none of FERD's", aCgs.length === 10 && aFerd.length === 0, `${aCgs.length} / ${aFerd.length}`);
  check("A student sees the FERD channels and none of CGS's", esFerd.length === 9 && esCgs.length === 0, `${esFerd.length} / ${esCgs.length}`);
  check("A student sees only their own department's room", esFerd.some((c) => c.id === esRoom) && !geoFerd.some((c) => c.id === esRoom) && geoFerd.filter((c) => c.kind === "department").length === 1);
  check("Reading the tables directly gives the same answer", ((await a.client.from("community_channels").select("id").eq("community", "ferd")).data ?? []).length === 0 && ((await es.client.from("community_channels").select("id").eq("community", "cgs")).data ?? []).length === 0);

  // ---- Messages -----------------------------------------------------------------------------
  const first = await send(a, ch("cgs", "general"), "  [TEST] Hello from A\u0007  ");
  const stored = (await service.from("community_messages").select("body, author_name, community").eq("id", first.data).single()).data;
  check("A member posts in a CGS channel; the text is trimmed and cleaned", !first.error && stored?.body === "[TEST] Hello from A" && stored.community === "cgs" && stored.author_name === "[TEST] CGS a", first.error?.message ?? JSON.stringify(stored));
  const ferdFirst = await send(es, ch("ferd", "general"), "[TEST] Hello from a student");
  check("A student posts in a FERD channel", !ferdFirst.error, ferdFirst.error?.message);
  check("Another member of the same community reads it", (await visible(b, first.data)) && (await visible(geo, ferdFirst.data)));
  check("Cross-community reading is denied in the database", !(await visible(es, first.data)) && !(await visible(a, ferdFirst.data)) && !(await visible(waiting, ferdFirst.data)));
  check("Cross-community posting is denied", !!(await send(es, ch("cgs", "general"), "[TEST] intruder")).error && !!(await send(a, ch("ferd", "general"), "[TEST] intruder")).error);
  check("An empty or oversized message is refused", !!(await send(a, ch("cgs", "general"), "   ")).error && !!(await send(a, ch("cgs", "general"), "x".repeat(4001))).error);
  check("Messages cannot be inserted, changed or deleted around the functions",
    !!(await a.client.from("community_messages").insert({ community: "cgs", channel_id: ch("cgs", "general"), author_id: a.id, author_name: "Someone else", body: "forged" })).error &&
    ((await a.client.from("community_messages").update({ body: "changed" }).eq("id", first.data).select()).data ?? []).length === 0 &&
    ((await b.client.from("community_messages").delete().eq("id", first.data).select()).data ?? []).length === 0 && (await visible(b, first.data)));
  const mismatch = await service.from("community_messages").insert({ community: "ferd", channel_id: ch("cgs", "general"), author_name: "x", body: "[TEST] wrong community" });
  check("A message cannot be stored under a community other than its channel's", !!mismatch.error);

  check("Only the author can edit a message", !!(await b.client.rpc("community_edit", { p_message: first.data, p_body: "hijacked" })).error &&
    !(await a.client.rpc("community_edit", { p_message: first.data, p_body: "[TEST] Hello from A (edited)" })).error &&
    (await service.from("community_messages").select("body, edited_at").eq("id", first.data).single()).data.edited_at !== null);
  const reply = await send(b, ch("cgs", "general"), "[TEST] Reply from B", { p_reply_to: first.data });
  check("A reply is stored against its parent", !reply.error && (await service.from("community_messages").select("reply_to").eq("id", reply.data).single()).data.reply_to === first.data);
  check("A reply cannot point into another channel", !!(await send(b, ch("cgs", "gis"), "[TEST] stray reply", { p_reply_to: first.data })).error);
  await a.client.rpc("community_react", { p_message: reply.data, p_emoji: "👍" });
  await b.client.rpc("community_react", { p_message: reply.data, p_emoji: "👍" });
  const reacted = (await service.from("community_messages").select("reactions").eq("id", reply.data).single()).data.reactions;
  await a.client.rpc("community_react", { p_message: reply.data, p_emoji: "👍" });
  const toggled = (await service.from("community_messages").select("reactions").eq("id", reply.data).single()).data.reactions;
  check("Reactions are counted per person and can be taken back", reacted["👍"]?.length === 2 && toggled["👍"]?.length === 1 && toggled["👍"][0] === b.id, JSON.stringify([reacted, toggled]));
  check("An unknown reaction and a reaction from outside the community are refused", !!(await a.client.rpc("community_react", { p_message: reply.data, p_emoji: "💣" })).error && !!(await es.client.rpc("community_react", { p_message: reply.data, p_emoji: "👍" })).error);

  // ---- Unread and search ----------------------------------------------------------------------
  const unreadBefore = (await channels(a, "cgs")).find((c) => c.slug === "general").unread;
  await a.client.rpc("community_mark_read", { p_channel: ch("cgs", "general") });
  check("Unread messages are counted until the channel is read", unreadBefore === 1 && (await channels(a, "cgs")).find((c) => c.slug === "general").unread === 0, String(unreadBefore));
  const found = (await b.client.rpc("community_search", { p_community: "cgs", p_query: "hello from a" })).data ?? [];
  check("Search finds a member's readable messages and nothing from the other community",
    found.some((m) => m.id === first.data) && ((await es.client.rpc("community_search", { p_community: "cgs", p_query: "hello" })).data ?? []).length === 0 &&
    ((await a.client.rpc("community_search", { p_community: "ferd", p_query: "student" })).data ?? []).length === 0);

  // ---- Announcements, pins, moderation --------------------------------------------------------------
  check("An ordinary member cannot post an announcement", !!(await send(a, ch("cgs", "announcements"), "[TEST] not allowed")).error && !!(await send(es, ch("ferd", "announcements"), "[TEST] not allowed")).error);
  const announced = await send(admin, ch("cgs", "announcements"), "[TEST] Official notice");
  check("An administrator posts an announcement and members are notified", !announced.error && ((await a.client.from("notifications").select("id").eq("entity_id", announced.data)).data ?? []).length === 1, announced.error?.message);
  check("Only moderators pin messages", !!(await a.client.rpc("community_pin", { p_message: first.data, p_pinned: true })).error && !(await admin.client.rpc("community_pin", { p_message: first.data, p_pinned: true })).error);
  check("A member cannot delete someone else's message", !!(await a.client.rpc("community_delete", { p_message: reply.data })).error);
  check("A member cannot appoint moderators, mute or remove people",
    !!(await a.client.rpc("community_moderate_member", { p_community: "cgs", p_user: b.id, p_action: "make_moderator" })).error &&
    !!(await a.client.rpc("community_moderate_member", { p_community: "cgs", p_user: b.id, p_action: "mute" })).error &&
    !!(await a.client.rpc("community_moderate_member", { p_community: "cgs", p_user: b.id, p_action: "remove" })).error);
  check("A FERD administrator's authority does not come from CGS membership: a student cannot moderate the CGS community",
    !!(await es.client.rpc("community_moderate_member", { p_community: "cgs", p_user: a.id, p_action: "mute" })).error);

  const report = await b.client.rpc("community_report", { p_message: first.data, p_reason: "[TEST] this looks like spam" });
  const seenByAdmin = (await admin.client.from("community_reports").select("id, status").eq("message_id", first.data)).data ?? [];
  check("A member reports a message; moderators see the report and other members do not",
    !report.error && seenByAdmin.length === 1 && ((await a.client.from("community_reports").select("id")).data ?? []).length === 0, report.error?.message);
  check("Only moderators decide a report", !!(await a.client.rpc("community_resolve_report", { p_report: seenByAdmin[0].id, p_status: "dismissed" })).error &&
    !(await admin.client.rpc("community_resolve_report", { p_report: seenByAdmin[0].id, p_status: "resolved", p_note: "[TEST] handled" })).error);

  check("An administrator appoints a moderator", !(await admin.client.rpc("community_moderate_member", { p_community: "cgs", p_user: b.id, p_action: "make_moderator" })).error);
  check("A moderator posts announcements and removes a message, and cannot act on an administrator",
    !(await send(b, ch("cgs", "announcements"), "[TEST] From a moderator")).error && !(await b.client.rpc("community_delete", { p_message: first.data })).error &&
    !!(await b.client.rpc("community_moderate_member", { p_community: "cgs", p_user: admin.id, p_action: "mute" })).error &&
    !!(await b.client.rpc("community_moderate_member", { p_community: "cgs", p_user: a.id, p_action: "make_moderator" })).error);
  const removed = (await service.from("community_messages").select("body, deleted_at, deleted_by").eq("id", first.data).single()).data;
  const trail = (await admin.client.from("community_audit").select("action, details, actor_id").eq("message_id", first.data)).data ?? [];
  check("The removed message is emptied and the removal is in the audit log with its text",
    removed.body === null && removed.deleted_by === b.id && trail.some((t) => t.action === "message.removed" && t.actor_id === b.id && String(t.details.text).includes("Hello from A")), JSON.stringify(trail));
  check("Members cannot read the audit log", ((await a.client.from("community_audit").select("id")).data ?? []).length === 0);
  check("A moderator of one community has no authority in the other", !!(await b.client.rpc("community_moderate_member", { p_community: "ferd", p_user: es.id, p_action: "mute" })).error && !!(await send(b, ch("ferd", "announcements"), "[TEST] no")).error);

  await b.client.rpc("community_moderate_member", { p_community: "cgs", p_user: a.id, p_action: "mute", p_minutes: 30 });
  const whileMuted = await send(a, ch("cgs", "general"), "[TEST] muted?");
  await b.client.rpc("community_moderate_member", { p_community: "cgs", p_user: a.id, p_action: "unmute" });
  check("A muted member can read and cannot post until unmuted", !!whileMuted.error && (await visible(a, reply.data)) && !(await send(a, ch("cgs", "general"), "[TEST] back again")).error);

  // ---- Attachments ----------------------------------------------------------------------------
  const path = (community, channel) => `${community}/${channel}/${randomUUID()}.pdf`;
  const mine = path("cgs", ch("cgs", "general"));
  const up = await a.client.storage.from("community-files").upload(mine, PDF, { contentType: "application/pdf" });
  check("A member uploads a file into a channel they can post in", !up.error, up.error?.message);
  check("Uploads into the other community, or under a mismatched community, are refused",
    !!(await es.client.storage.from("community-files").upload(path("cgs", ch("cgs", "general")), PDF, { contentType: "application/pdf" })).error &&
    !!(await a.client.storage.from("community-files").upload(path("ferd", ch("ferd", "general")), PDF, { contentType: "application/pdf" })).error &&
    !!(await a.client.storage.from("community-files").upload(path("ferd", ch("cgs", "general")), PDF, { contentType: "application/pdf" })).error);
  check("A file type that is not allowed is refused", !!(await a.client.storage.from("community-files").upload(path("cgs", ch("cgs", "general")).replace(".pdf", ".exe"), new Blob(["x"], { type: "application/x-msdownload" }), { contentType: "application/x-msdownload" })).error);
  check("Before it is attached, only the uploader can open the file", !!(await b.client.storage.from("community-files").createSignedUrl(mine, 60)).error);
  check("Nobody can attach another person's upload", !!(await send(b, ch("cgs", "general"), "[TEST] stolen file", { p_files: [{ path: mine, name: "notes.pdf" }] })).error);
  const withFile = await send(a, ch("cgs", "general"), "[TEST] With a file", { p_files: [{ path: mine, name: "Field notes.pdf" }] });
  const attachment = (await service.from("community_messages").select("attachments").eq("id", withFile.data).single()).data?.attachments?.[0];
  check("The message records the file with the size and type read from storage", !withFile.error && attachment?.size === 2048 && attachment.mime === "application/pdf" && attachment.name === "Field notes.pdf", withFile.error?.message ?? JSON.stringify(attachment));
  const link = await b.client.storage.from("community-files").createSignedUrl(mine, 60);
  check("A member of the channel opens the file through a short-lived link", !link.error && (await fetch(link.data.signedUrl)).status === 200, link.error?.message);
  check("The file is private: no public address, and a FERD student cannot get a link",
    (await fetch(`${URL_}/storage/v1/object/public/community-files/${mine}`)).status !== 200 && !!(await es.client.storage.from("community-files").createSignedUrl(mine, 60)).error);
  check("The same upload cannot be attached twice", !!(await send(a, ch("cgs", "general"), "[TEST] again", { p_files: [{ path: mine, name: "again.pdf" }] })).error);
  await a.client.rpc("community_delete", { p_message: withFile.data });
  check("After the message is deleted the file can no longer be opened by other members", !!(await b.client.storage.from("community-files").createSignedUrl(mine, 60)).error);
  await a.client.storage.from("community-files").remove([mine]);

  // ---- Department rooms and student standing ------------------------------------------------------
  const inRoom = await send(es, esRoom, "[TEST] Department note");
  check("A department room is closed to students of another department", !inRoom.error && !(await visible(geo, inRoom.data)) && !!(await send(geo, esRoom, "[TEST] wrong room")).error, inRoom.error?.message);
  await service.from("ferd_students").update({ status: "suspended" }).eq("user_id", es.id);
  const suspended = !(await visible(es, ferdFirst.data)) && (await channels(es, "ferd")).length === 0 && !!(await send(es, ch("ferd", "general"), "[TEST] suspended")).error;
  await service.from("ferd_students").update({ status: "verified" }).eq("user_id", es.id);
  check("A suspended student loses the community at once and regains it when verified again", suspended && (await visible(es, ferdFirst.data)));
  await service.from("profiles").update({ status: "suspended" }).eq("id", a.id);
  const blocked = !(await visible(a, reply.data)) && !!(await send(a, ch("cgs", "general"), "[TEST] suspended")).error;
  await service.from("profiles").update({ status: "active" }).eq("id", a.id);
  check("A suspended CGS account loses the community at once", blocked && (await visible(a, reply.data)));

  // ---- Removal and approval ---------------------------------------------------------------------
  await admin.client.rpc("community_moderate_member", { p_community: "cgs", p_user: a.id, p_action: "remove" });
  check("A removed member cannot read, post or rejoin by themselves",
    !(await visible(a, reply.data)) && !!(await send(a, ch("cgs", "general"), "[TEST] removed")).error && (await a.client.rpc("community_join", { p_community: "cgs" })).data === "removed" && (await channels(a, "cgs")).length === 0);
  await admin.client.rpc("community_moderate_member", { p_community: "cgs", p_user: a.id, p_action: "restore" });
  check("Only an administrator switches membership approval on", !!(await b.client.rpc("community_set_approval", { p_community: "cgs", p_required: true })).error && !(await admin.client.rpc("community_set_approval", { p_community: "cgs", p_required: true })).error);
  const pendingJoin = (await late.client.rpc("community_join", { p_community: "cgs" })).data;
  const closed = (await channels(late, "cgs")).length === 0 && !(await visible(late, reply.data));
  await b.client.rpc("community_moderate_member", { p_community: "cgs", p_user: late.id, p_action: "approve" });
  check("With approval on, a new member waits and gets in once a moderator approves", pendingJoin === "pending" && closed && (await visible(late, reply.data)), String(pendingJoin));
  check("Approval in one community is not approval in the other", (await service.from("community_settings").select("require_approval").eq("community", "ferd").single()).data.require_approval === settings.find((s) => s.community === "ferd").require_approval && (await channels(late, "ferd")).length === 0);

  // ---- Channel management and projects --------------------------------------------------------
  check("Only administrators create channels", !!(await b.client.rpc("community_save_channel", { p_community: "cgs", p_id: null, p_name: "[TEST] Mine", p_description: null })).error);
  const room = await admin.client.rpc("community_save_channel", { p_community: "cgs", p_id: null, p_name: `Test room ${run}`, p_description: "[TEST]" });
  await admin.client.rpc("community_save_channel", { p_community: "cgs", p_id: room.data, p_name: `Test room ${run}`, p_description: "[TEST]", p_archived: true });
  check("An administrator creates and archives a channel; an archived channel is closed to members",
    !room.error && !(await channels(a, "cgs")).some((c) => c.id === room.data) && !!(await send(a, room.data, "[TEST] archived")).error, room.error?.message);
  // A project owned by B: B takes part in it, A does not.
  const { data: project, error: projectError } = await service.from("projects")
    .insert({ code: `TEST-CHAT-${run}`, name: `[TEST] Chat project ${run}`, description: "[TEST] A project used only by the community checks.", county: "Nakuru", owner_id: b.id })
    .select("id").single();
  if (project) {
    check("A project participant opens the project's discussion", !(await b.client.rpc("community_open_project", { p_project: project.id })).error &&
      ((await b.client.rpc("community_my_projects")).data ?? []).some((row) => row.id === project.id) && ((await a.client.rpc("community_my_projects")).data ?? []).length === 0);
    const opened = await admin.client.rpc("community_open_project", { p_project: project.id });
    const inside = await send(admin, opened.data, "[TEST] Project talk");
    check("A project discussion is open to the project's people and closed to other members",
      !opened.error && !inside.error && !!(await a.client.rpc("community_open_project", { p_project: project.id })).error && !(await visible(a, inside.data)) &&
      !(await channels(a, "cgs")).some((c) => c.id === opened.data) && !!(await send(a, opened.data, "[TEST] outsider")).error, opened.error?.message ?? inside.error?.message);
    await service.from("projects").delete().eq("id", project.id);
  } else {
    check("A test project could be created for the project-discussion checks", false, projectError?.message);
  }

  // ---- Member list and rate limit ---------------------------------------------------------------
  const list = (await es.client.rpc("community_member_list", { p_community: "ferd" })).data ?? [];
  check("The member list shows names and departments, never e-mail addresses, phone or registration numbers",
    list.some((m) => m.user_id === geo.id && m.department) && list.every((m) => !("email" in m) && !("phone" in m) && !("reg_no" in m)) &&
    ((await a.client.rpc("community_member_list", { p_community: "ferd" })).data ?? []).length === 0);
  const burst = [];
  await sleep(10_500);
  for (let i = 0; i < 7; i++) burst.push(await geo.client.rpc("community_send", { p_channel: ch("ferd", "general"), p_body: `[TEST] burst ${i}` }));
  check("Rapid messages are stopped by the rate limit", burst.filter((r) => !r.error).length === 5 && /too quickly/.test(burst[6].error?.message ?? ""), String(burst.filter((r) => !r.error).length));
} finally {
  for (const s of settings ?? []) await service.from("community_settings").update({ require_approval: s.require_approval }).eq("community", s.community);
  await service.from("community_channels").delete().like("description", "[TEST]%");
  await service.from("community_messages").delete().like("author_name", "[TEST]%");
  await service.from("community_messages").delete().like("body", "[TEST]%");
  await service.from("community_audit").delete().in("actor_id", [...users, admin.id]);
  await service.from("notifications").delete().eq("type", "community_announcement").like("body", "[TEST]%");
  await service.from("community_members").delete().eq("user_id", admin.id);
  for (const id of users) await service.auth.admin.deleteUser(id);
  console.log(`Cleanup: ${users.length} test accounts removed.`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
