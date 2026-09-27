import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson, route } from "@/lib/server/http";
import { createSite, listSites } from "@/lib/server/services/sites";
import { requireOrgRole } from "@/lib/server/session";

export const GET = route(async (req) => {
  const ctx = await requireOrgRole(req.headers, "member");
  return NextResponse.json({ sites: await listSites(ctx) });
});

const createSchema = z.object({
  url: z.string().trim().min(3).max(2048),
  name: z.string().trim().max(120).optional(),
  timezone: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    })
    .optional(),
});

export const POST = route(async (req) => {
  const input = await parseJson(req, createSchema);
  const ctx = await requireOrgRole(req.headers, "member");
  const site = await createSite(ctx, input);
  return NextResponse.json({ site: { id: site.id, url: site.url, name: site.name } }, { status: 201 });
});
