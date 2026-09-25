import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { server } from "./context";
import { AppError, notFound } from "./errors";

export type RouteContext<P extends Record<string, string> = Record<string, never>> = { params: Promise<P> };

export function jsonError(error: AppError) {
  return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF (SECURITY.md §2): state-changing requests must come from our own origin.
 * Browsers always send Origin on cross-site POST/PATCH/DELETE; same-site cookies are the second layer.
 */
function assertSameOrigin(req: Request) {
  if (SAFE_METHODS.has(req.method)) return;
  const expected = new URL(server().env.BETTER_AUTH_URL).origin;
  const origin = req.headers.get("origin");
  if (origin === expected) return;
  if (origin === null && req.headers.get("sec-fetch-site") === "same-origin") return;
  throw new AppError("invalid_origin", "This request didn't come from Mendwell.", 403);
}

/**
 * Resource routes (anything with an [id] or token) follow one order so that another org's
 * resource is a uniform 404 whatever the caller's role:
 *   1. requireOrgRole(headers, "member")   — who you are, which org you're acting in
 *   2. repo.get(ctx.orgId, id) → 404       — does this org have it
 *   3. role check → 403                    — may you do this to it
 * src/test/cross-org.test.ts enforces this for every route.
 *
 * Route handler wrapper: origin check → handler → typed JSON.
 * AppError becomes `{ error: { code, message } }`; anything else is reported to Sentry and becomes a generic 500.
 */
export function route<P extends Record<string, string> = Record<string, never>>(
  handler: (req: NextRequest, ctx: RouteContext<P>) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    try {
      assertSameOrigin(req);
      return await handler(req, ctx);
    } catch (error) {
      if (error instanceof AppError) return jsonError(error);
      Sentry.captureException(error);
      console.error("route.unhandled", { method: req.method, path: new URL(req.url).pathname });
      return jsonError(new AppError("internal_error", "Something went wrong on our side. Try again.", 500));
    }
  };
}

/** Parse and validate a JSON body. Messages name the fields, never echo values. */
export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError("invalid_json", "The request body must be JSON.", 400);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join(".") || "body"))].join(", ");
    throw new AppError("validation_failed", `Check these fields: ${fields}.`, 400);
  }
  return result.data;
}

/** The `[id]` segment. Anything that can't be an id is simply not found. */
export async function routeId(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (id.length === 0 || id.length > 64) throw notFound();
  return id;
}
