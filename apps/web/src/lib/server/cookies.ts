import type { NextResponse } from "next/server";
import { ACTIVE_ORG_COOKIE } from "./session";

export function setActiveOrgCookie(res: NextResponse, orgId: string) {
  res.cookies.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export function appendSetCookies(res: NextResponse, cookies: string[]) {
  for (const cookie of cookies) res.headers.append("set-cookie", cookie);
  return res;
}
