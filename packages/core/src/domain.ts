/**
 * Domain vocabularies shared by the database enums (packages/db) and domain logic.
 * Changing a list here requires a migration (`pnpm db:generate`).
 */

export const sitePlatforms = ["wordpress", "other"] as const;
export const siteConnections = ["none", "connector"] as const;
export const siteStatuses = ["active", "paused", "archived"] as const;

/** Fix types a site can graduate per category (PROJECT_SPEC §5). */
export const fixCategories = ["alt_text", "meta", "internal_link", "external_link"] as const;
export type FixCategory = (typeof fixCategories)[number];

/** Graduation states (PROJECT_SPEC §5.5). */
export const categoryStates = ["approval", "eligible", "auto"] as const;

export const issueCategories = ["accessibility", "seo", "links", "uptime", "ssl", "performance"] as const;
export const severities = ["critical", "serious", "moderate", "minor"] as const;
export const issueStatuses = ["open", "resolved", "ignored"] as const;

/** Policy buckets (PROJECT_SPEC §5.4). */
export const buckets = ["auto", "approval", "alert"] as const;

export const scanKinds = ["daily", "manual", "public"] as const;
export const scanStatuses = ["queued", "running", "succeeded", "failed"] as const;

/** Fix lifecycle states (PROJECT_SPEC §6). Transitions live in lifecycle.ts (not yet built). */
export const fixStatuses = [
  "proposed",
  "pending",
  "approved",
  "edited",
  "rejected",
  "applying",
  "applied",
  "verifying",
  "verified",
  "verify_failed",
  "rolling_back",
  "rolled_back",
  "apply_failed",
  "conflict",
  "undone",
  "superseded",
] as const;
export type FixStatus = (typeof fixStatuses)[number];

export const approvalChannels = ["app", "email_link"] as const;
export const approvalDecisions = ["approved", "edited", "rejected"] as const;

export const alertSeverities = ["info", "warning", "critical"] as const;

export const subscriptionStatuses = ["trialing", "active", "past_due", "canceled", "incomplete", "unpaid"] as const;

export const invitationStatuses = ["pending", "accepted", "revoked"] as const;
