import { NextResponse, type NextRequest } from "next/server";
import { getFerdSession, PREVIEW_COOKIE } from "@/modules/ferd/session";

/** Staff only: choose which department's student portal to preview, then open its dashboard. */
export async function GET(request: NextRequest) {
  const session = await getFerdSession();
  const slug = request.nextUrl.searchParams.get("dept") ?? "";
  const response = NextResponse.redirect(new URL(session?.role ? "/ferd/dashboard" : "/ferd/login", request.nextUrl.origin));
  if (session?.role && session.departments.some((d) => d.slug === slug)) {
    response.cookies.set(PREVIEW_COOKIE, slug, { httpOnly: true, sameSite: "lax", path: "/ferd", maxAge: 60 * 60 * 8 });
  }
  return response;
}
