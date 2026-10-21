import { NextResponse, type NextRequest } from "next/server";
import { activeSession } from "@/lib/auth";
import { BUCKET } from "@/modules/documents/storage";

/**
 * Access-controlled download. The document row is read under the user's RLS scope;
 * only then is a short-lived signed URL for the private file issued.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await activeSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: doc } = await session.supabase.from("documents").select("storage_path, file_name").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found or not authorised" }, { status: 404 });

  const { data, error } = await session.supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
  if (error || !data) return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
