import { NextResponse } from "next/server";
import { routeId, route, type RouteContext } from "@/lib/server/http";
import { isIssueCategory, listIssues } from "@/lib/server/services/sites";
import { requireOrgRole } from "@/lib/server/session";

const statuses = new Set(["open", "resolved", "ignored"] as const);

export const GET = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  const q = req.nextUrl.searchParams;
  const status = q.get("status");
  const category = q.get("category");
  const issues = await listIssues(ctx, id, {
    status: status && statuses.has(status as "open") ? (status as "open" | "resolved" | "ignored") : "open",
    category: isIssueCategory(category) ? category : undefined,
  });
  return NextResponse.json({ issues });
});
