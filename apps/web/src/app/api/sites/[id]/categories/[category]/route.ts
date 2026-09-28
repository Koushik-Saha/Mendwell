import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, routeId, routeParam, route, type RouteContext } from "@/lib/server/http";
import { setCategoryState } from "@/lib/server/services/fixes";
import { requireOrgRole } from "@/lib/server/session";

const body = z.strictObject({ state: z.enum(["auto", "approval"]) });

/** Turn auto-fix on (only once eligible) or off for one category on one site. Admin, after the lookup. */
export const PATCH = route(async (req, { params }: RouteContext<{ id: string; category: string }>) => {
  const id = await routeId(params);
  const category = await routeParam(params, "category");
  const ctx = await requireOrgRole(req.headers, "member");
  const input = await parseJson(req, body);
  return NextResponse.json(await setCategoryState(ctx, id, category, input.state));
});
