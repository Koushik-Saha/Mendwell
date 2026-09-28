import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, routeId, route, type RouteContext } from "@/lib/server/http";
import { archiveSite, getSite, latestScan, updateSiteSettings } from "@/lib/server/services/sites";
import { requireOrgRole } from "@/lib/server/session";

export const GET = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  const site = await getSite(ctx, id);
  return NextResponse.json({
    site: {
      id: site.id,
      name: site.name,
      url: site.url,
      status: site.status,
      verified: Boolean(site.ownershipVerifiedAt),
      connection: site.connection,
      writesPaused: site.writesPaused,
      timezone: site.timezone,
      protectedPaths: site.protectedPaths,
      dailyWriteCap: site.dailyWriteCap,
      reportRecipients: site.reportRecipients,
    },
    latestScan: await latestScan(ctx, id),
  });
});

const settingsSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    timezone: z.string().max(64).refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }),
    protectedPaths: z.array(z.string().trim().min(1).max(200).regex(/^[^\s<>"'`]+$/)).max(100),
    dailyWriteCap: z.number().int().min(0).max(200),
    reportRecipients: z.array(z.email().max(254)).max(20),
  })
  .partial()
  .strict();

export const PATCH = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const input = await parseJson(req, settingsSchema);
  const ctx = await requireOrgRole(req.headers, "member");
  const site = await updateSiteSettings(ctx, id, input);
  return NextResponse.json({ site: { id: site?.id, protectedPaths: site?.protectedPaths, dailyWriteCap: site?.dailyWriteCap, reportRecipients: site?.reportRecipients } });
});

/** Archive the site (admin, checked after the lookup so another org's site is a 404). */
export const DELETE = route(async (req, { params }: RouteContext<{ id: string }>) => {
  const id = await routeId(params);
  const ctx = await requireOrgRole(req.headers, "member");
  await archiveSite(ctx, id);
  return new NextResponse(null, { status: 204 });
});
