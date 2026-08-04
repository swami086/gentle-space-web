import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  const authServiceUrl = process.env.AUTH_SERVICE_URL;
  if (!authServiceUrl) throw new Error("AUTH_SERVICE_URL is not set");

  const destination = new URL("/api/session/signout", authServiceUrl);
  destination.searchParams.set("return_to", new URL("/login", authServiceUrl).toString());

  const res = NextResponse.redirect(destination);
  // ponytail: host-only clear — correct for local dev, where gs_session has no Domain attribute.
  // See this plan's Global Constraints for the documented prod-only limitation and upgrade path.
  res.cookies.set("gs_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
