import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

const req = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "http://mendwell.test"), { headers: cookie ? { cookie } : {} });

describe("middleware", () => {
  it("sets CSP and security headers on every response", () => {
    const res = middleware(req("/sign-in"));
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("uses a different nonce for every request", () => {
    const a = middleware(req("/sign-in")).headers.get("content-security-policy");
    const b = middleware(req("/sign-in")).headers.get("content-security-policy");
    expect(a).not.toBe(b);
  });

  it("redirects signed-out visitors from app pages to sign-in, keeping where they were going", () => {
    const res = middleware(req("/settings?tab=team"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/settings?tab=team");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  it("lets requests with a session cookie through to the server-side check", () => {
    const res = middleware(req("/dashboard", "mendwell.session_token=abc.def"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("doesn't redirect public pages or the API", () => {
    for (const path of ["/sign-in", "/invite/tok", "/api/me"]) expect(middleware(req(path)).status, path).toBe(200);
  });
});
