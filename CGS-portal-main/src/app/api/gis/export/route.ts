import { NextResponse, type NextRequest } from "next/server";
import { activeSession } from "@/lib/auth";
import { today } from "@/lib/format";

/** GeoJSON export of the boundaries, project locations and observations the signed-in user may see. */
export async function GET(request: NextRequest) {
  const session = await activeSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const project = request.nextUrl.searchParams.get("project");
  if (project && !/^[0-9a-f-]{36}$/i.test(project)) return NextResponse.json({ error: "Invalid project" }, { status: 400 });

  const { data, error } = await session.supabase.rpc("gis_features", { p_project: project });
  if (error) return NextResponse.json({ error: "The export could not be generated" }, { status: 500 });
  return new NextResponse(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/geo+json",
      "Content-Disposition": `attachment; filename="cgs-gis-export-${today()}.geojson"`,
      "Cache-Control": "private, no-store",
    },
  });
}
