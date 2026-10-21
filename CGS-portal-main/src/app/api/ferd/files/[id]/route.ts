import { NextResponse, type NextRequest } from "next/server";
import { adminConfigured, createAdminClient } from "@/lib/supabase/admin";
import { getFerdSession } from "@/modules/ferd/session";

const LINK_SECONDS = 60;
const MAX_DOWNLOADS_PER_MINUTE = 20;

/**
 * Releases one FERD file. The caller must be signed in, the database must confirm access to the file's
 * content item (department, publication window, premium entitlement), and only then is a link created
 * that works for one minute. Files are never reachable through a public or permanent URL.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await getFerdSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ error: "File delivery is not configured" }, { status: 503 });

  const { supabase, user } = session;
  // RLS hides the row unless the caller may see its content item at all.
  const { data: file } = await supabase.from("ferd_files").select("id, content_id, storage_path, file_name").eq("id", id).maybeSingle();
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: allowed } = await supabase.rpc("ferd_can_access_content", { p_content: file.content_id });
  if (allowed !== true) return NextResponse.json({ error: "You do not have access to this file" }, { status: 403 });

  const admin = createAdminClient();
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("ferd_download_logs").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= MAX_DOWNLOADS_PER_MINUTE) return NextResponse.json({ error: "Too many downloads. Please wait a minute." }, { status: 429 });

  const { data: signed, error } = await admin.storage.from("ferd-files").createSignedUrl(file.storage_path, LINK_SECONDS, { download: file.file_name });
  if (error || !signed?.signedUrl) {
    console.error("FERD file link failed:", error?.message);
    return NextResponse.json({ error: "The file is unavailable" }, { status: 502 });
  }
  await admin.from("ferd_download_logs").insert({ user_id: user.id, file_id: file.id, content_id: file.content_id });
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
}
