import type { OrgId } from "@mendwell/core";
import { createRepositories, type Db } from "@mendwell/db";
import { alertEmail, type Mailer } from "@mendwell/email";
import { logger } from "@trigger.dev/sdk";

export type NotifyDeps = { db: Db; mailer: Mailer; appUrl: string };

/** Email the org's owners and admins about a site. Best effort: a failed send is logged, not thrown. */
export async function notifyTeam(
  deps: NotifyDeps,
  site: { orgId: OrgId; siteId: string; name: string; url: string },
  content: { headline: string; body: string; action?: string },
) {
  const recipients = await createRepositories(deps.db).teamContacts.emails(site.orgId, ["owner", "admin"]);
  const message = await alertEmail({ siteName: site.name, siteUrl: site.url, dashboardUrl: new URL(`/sites/${site.siteId}`, deps.appUrl).toString(), ...content });
  for (const to of recipients) {
    try {
      await deps.mailer.send({ to, ...message });
    } catch {
      logger.warn("alert.email.failed", { siteId: site.siteId });
    }
  }
}
