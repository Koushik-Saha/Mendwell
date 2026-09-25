import { toNextJsHandler } from "better-auth/next-js";
import { server } from "@/lib/server/context";

// Better Auth's own endpoints (sign-in, callbacks, sign-out, session). 2FA management endpoints
// are disabled here and served by /api/two-factor/* instead (see lib/server/two-factor-gate.ts).
export const GET = (req: Request) => toNextJsHandler(server().auth).GET(req);
export const POST = (req: Request) => toNextJsHandler(server().auth).POST(req);
