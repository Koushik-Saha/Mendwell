import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  type PgColumn,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { id, timestamps, timestamptz } from "./columns";
import {
  alertSeverityEnum,
  approvalDecisionEnum,
  approvalViaEnum,
  bucketEnum,
  categoryStateEnum,
  fixCategoryEnum,
  fixStatusEnum,
  issueCategoryEnum,
  issueStatusEnum,
  scanKindEnum,
  scanStatusEnum,
  severityEnum,
  siteConnectionEnum,
  sitePlatformEnum,
  siteStatusEnum,
  subscriptionStatusEnum,
} from "./enums";
import { organizations, orgIdColumn } from "./orgs";

/*
 * Tenant tables (PROJECT_SPEC §9).
 *
 * Every tenant table carries org_id, including child tables the spec lists with only site_id.
 * Child rows reference parents through composite foreign keys such as
 * (site_id, org_id) -> sites(id, org_id), so Postgres itself rejects a row whose org
 * doesn't match its parent's. Org scoping doesn't depend only on application code.
 */

const money = (name: string) => numeric(name, { precision: 12, scale: 6, mode: "number" });
const textArray = (name: string) => text(name).array().notNull().default(sql`'{}'::text[]`);

export const clients = pgTable(
  "clients",
  {
    id: id(),
    orgId: orgIdColumn(),
    name: text("name").notNull(),
    reportRecipients: textArray("report_recipients"),
    ...timestamps,
  },
  (t) => [unique("clients_id_org_unique").on(t.id, t.orgId), index("clients_org_id_idx").on(t.orgId)],
);

export const sites = pgTable(
  "sites",
  {
    id: id(),
    orgId: orgIdColumn(),
    clientId: uuid("client_id"),
    url: text("url").notNull(),
    name: text("name").notNull(),
    platform: sitePlatformEnum("platform").notNull().default("wordpress"),
    connection: siteConnectionEnum("connection").notNull().default("none"),
    connectorVersion: text("connector_version"),
    /** AES-256-GCM payload from @mendwell/core encrypt(), context `site:<id>:connector_secret`. */
    secretEnc: text("secret_enc"),
    ownershipVerifiedAt: timestamptz("ownership_verified_at"),
    writesPaused: boolean("writes_paused").notNull().default(false),
    timezone: text("timezone").notNull().default("UTC"),
    protectedPaths: textArray("protected_paths"),
    dailyWriteCap: integer("daily_write_cap").notNull().default(25),
    reportRecipients: textArray("report_recipients"),
    status: siteStatusEnum("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    unique("sites_id_org_unique").on(t.id, t.orgId),
    unique("sites_org_url_unique").on(t.orgId, t.url),
    index("sites_org_id_idx").on(t.orgId),
    index("sites_client_id_idx").on(t.clientId),
    index("sites_status_idx").on(t.status),
    foreignKey({ name: "sites_client_fk", columns: [t.clientId, t.orgId], foreignColumns: [clients.id, clients.orgId] }),
    check("sites_daily_write_cap_nonnegative", sql`${t.dailyWriteCap} >= 0`),
  ],
);

/** (site_id, org_id) -> sites(id, org_id), cascading. */
const siteFk = (name: string, siteId: PgColumn, orgId: PgColumn) =>
  foreignKey({ name, columns: [siteId, orgId], foreignColumns: [sites.id, sites.orgId] }).onDelete("cascade");

export const siteCategories = pgTable(
  "site_categories",
  {
    orgId: orgIdColumn(),
    siteId: uuid("site_id").notNull(),
    category: fixCategoryEnum("category").notNull(),
    state: categoryStateEnum("state").notNull().default("approval"),
    ...timestamps,
  },
  (t) => [
    primaryKey({ name: "site_categories_pk", columns: [t.siteId, t.category] }),
    index("site_categories_org_id_idx").on(t.orgId),
    siteFk("site_categories_site_fk", t.siteId, t.orgId),
  ],
);

export const publicScans = pgTable(
  "public_scans",
  {
    id: id(),
    url: text("url").notNull(),
    host: text("host").notNull(),
    /** Salted hash of the requester's IP, for per-IP rate limits. Never the raw IP. */
    ipHash: text("ip_hash").notNull(),
    status: scanStatusEnum("status").notNull().default("queued"),
    shareSlug: text("share_slug").notNull().unique(),
    result: jsonb("result"),
    expiresAt: timestamptz("expires_at").notNull(),
    ...timestamps,
  },
  (t) => [
    index("public_scans_host_idx").on(t.host),
    index("public_scans_ip_hash_idx").on(t.ipHash),
    index("public_scans_status_idx").on(t.status),
    index("public_scans_expires_at_idx").on(t.expiresAt),
  ],
);

export const scans = pgTable(
  "scans",
  {
    id: id(),
    /** Null only for public scans, which belong to no org. */
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id"),
    publicScanId: uuid("public_scan_id").references(() => publicScans.id, { onDelete: "cascade" }),
    kind: scanKindEnum("kind").notNull(),
    status: scanStatusEnum("status").notNull().default("queued"),
    startedAt: timestamptz("started_at"),
    finishedAt: timestamptz("finished_at"),
    pagesCrawled: integer("pages_crawled").notNull().default(0),
    counts: jsonb("counts").notNull().default({}),
    lighthouse: jsonb("lighthouse"),
    error: text("error"),
    workerSeconds: integer("worker_seconds").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("scans_id_org_unique").on(t.id, t.orgId),
    index("scans_org_id_idx").on(t.orgId),
    index("scans_site_id_idx").on(t.siteId),
    index("scans_status_idx").on(t.status),
    siteFk("scans_site_fk", t.siteId, t.orgId),
    check(
      "scans_owner",
      sql`(${t.kind} = 'public' AND ${t.publicScanId} IS NOT NULL AND ${t.siteId} IS NULL AND ${t.orgId} IS NULL)
       OR (${t.kind} <> 'public' AND ${t.siteId} IS NOT NULL AND ${t.orgId} IS NOT NULL AND ${t.publicScanId} IS NULL)`,
    ),
  ],
);

export const pages = pgTable(
  "pages",
  {
    id: id(),
    orgId: orgIdColumn(),
    siteId: uuid("site_id").notNull(),
    url: text("url").notNull(),
    urlHash: text("url_hash").notNull(),
    lastStatus: integer("last_status"),
    isProtected: boolean("is_protected").notNull().default(false),
    wpObject: jsonb("wp_object"),
    ...timestamps,
  },
  (t) => [
    unique("pages_site_url_hash_unique").on(t.siteId, t.urlHash),
    index("pages_org_id_idx").on(t.orgId),
    index("pages_site_id_idx").on(t.siteId),
    siteFk("pages_site_fk", t.siteId, t.orgId),
  ],
);

export const issues = pgTable(
  "issues",
  {
    id: id(),
    orgId: orgIdColumn(),
    siteId: uuid("site_id").notNull(),
    /** sha256(siteId + rule + normalizedUrl + target) — PROJECT_SPEC §4. */
    fingerprint: text("fingerprint").notNull(),
    rule: text("rule").notNull(),
    category: issueCategoryEnum("category").notNull(),
    severity: severityEnum("severity").notNull(),
    pageUrl: text("page_url").notNull(),
    target: jsonb("target").notNull(),
    evidence: jsonb("evidence").notNull(),
    evidenceKey: text("evidence_key"),
    bucket: bucketEnum("bucket").notNull(),
    status: issueStatusEnum("status").notNull().default("open"),
    firstScanId: uuid("first_scan_id").notNull(),
    lastScanId: uuid("last_scan_id").notNull(),
    resolvedAt: timestamptz("resolved_at"),
    ...timestamps,
  },
  (t) => [
    unique("issues_site_fingerprint_unique").on(t.siteId, t.fingerprint),
    unique("issues_id_org_unique").on(t.id, t.orgId),
    index("issues_org_id_idx").on(t.orgId),
    index("issues_site_id_idx").on(t.siteId),
    index("issues_status_idx").on(t.status),
    index("issues_fingerprint_idx").on(t.fingerprint),
    siteFk("issues_site_fk", t.siteId, t.orgId),
    foreignKey({ name: "issues_first_scan_fk", columns: [t.firstScanId, t.orgId], foreignColumns: [scans.id, scans.orgId] }),
    foreignKey({ name: "issues_last_scan_fk", columns: [t.lastScanId, t.orgId], foreignColumns: [scans.id, scans.orgId] }),
  ],
);

export const fixes = pgTable(
  "fixes",
  {
    id: id(),
    orgId: orgIdColumn(),
    siteId: uuid("site_id").notNull(),
    issueId: uuid("issue_id").notNull(),
    category: fixCategoryEnum("category").notNull(),
    status: fixStatusEnum("status").notNull().default("proposed"),
    bucketAtCreation: bucketEnum("bucket_at_creation").notNull(),
    proposedValue: jsonb("proposed_value").notNull(),
    finalValue: jsonb("final_value"),
    beforeValue: jsonb("before_value"),
    generatorModel: text("generator_model"),
    promptVersion: text("prompt_version"),
    validation: jsonb("validation").notNull().default({}),
    connectorLogId: text("connector_log_id"),
    appliedAt: timestamptz("applied_at"),
    verifyAttempts: integer("verify_attempts").notNull().default(0),
    verifiedAt: timestamptz("verified_at"),
    verification: jsonb("verification"),
    rolledBackAt: timestamptz("rolled_back_at"),
    rollbackReason: text("rollback_reason"),
    undoneAt: timestamptz("undone_at"),
    costUsd: money("cost_usd").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("fixes_id_org_unique").on(t.id, t.orgId),
    index("fixes_org_id_idx").on(t.orgId),
    index("fixes_site_id_idx").on(t.siteId),
    index("fixes_issue_id_idx").on(t.issueId),
    index("fixes_status_idx").on(t.status),
    siteFk("fixes_site_fk", t.siteId, t.orgId),
    foreignKey({ name: "fixes_issue_fk", columns: [t.issueId, t.orgId], foreignColumns: [issues.id, issues.orgId] }).onDelete(
      "cascade",
    ),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    orgId: orgIdColumn(),
    fixId: uuid("fix_id").notNull(),
    /** Null when decided through a signed email link (no login). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    via: approvalViaEnum("via").notNull(),
    decision: approvalDecisionEnum("decision").notNull(),
    editedValue: jsonb("edited_value"),
    reason: text("reason"),
    decidedAt: timestamptz("decided_at").notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index("approvals_org_id_idx").on(t.orgId),
    index("approvals_fix_id_idx").on(t.fixId),
    foreignKey({ name: "approvals_fix_fk", columns: [t.fixId, t.orgId], foreignColumns: [fixes.id, fixes.orgId] }).onDelete(
      "cascade",
    ),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: id(),
    orgId: orgIdColumn(),
    siteId: uuid("site_id"),
    clientId: uuid("client_id"),
    periodStart: timestamptz("period_start").notNull(),
    periodEnd: timestamptz("period_end").notNull(),
    content: jsonb("content").notNull(),
    sentAt: timestamptz("sent_at"),
    openedAt: timestamptz("opened_at"),
    providerId: text("provider_id"),
    ...timestamps,
  },
  (t) => [
    index("reports_org_id_idx").on(t.orgId),
    index("reports_site_id_idx").on(t.siteId),
    siteFk("reports_site_fk", t.siteId, t.orgId),
    foreignKey({ name: "reports_client_fk", columns: [t.clientId, t.orgId], foreignColumns: [clients.id, clients.orgId] }).onDelete(
      "cascade",
    ),
  ],
);

export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    orgId: orgIdColumn(),
    siteId: uuid("site_id").notNull(),
    type: text("type").notNull(),
    severity: alertSeverityEnum("severity").notNull(),
    message: text("message").notNull(),
    acknowledgedAt: timestamptz("acknowledged_at"),
    ...timestamps,
  },
  (t) => [
    index("alerts_org_id_idx").on(t.orgId),
    index("alerts_site_id_idx").on(t.siteId),
    siteFk("alerts_site_fk", t.siteId, t.orgId),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    orgId: orgIdColumn().unique(),
    stripeCustomerId: text("stripe_customer_id").notNull().unique(),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    plan: text("plan").notNull(),
    siteQuantity: integer("site_quantity").notNull().default(0),
    status: subscriptionStatusEnum("status").notNull(),
    trialEndsAt: timestamptz("trial_ends_at"),
    coupon: text("coupon"),
    ...timestamps,
  },
  (t) => [index("subscriptions_status_idx").on(t.status)],
);

export const pairingCodes = pgTable(
  "pairing_codes",
  {
    id: id(),
    /** sha256 of the one-time code. The code itself is shown once and never stored. */
    codeHash: text("code_hash").notNull().unique(),
    orgId: orgIdColumn(),
    siteId: uuid("site_id").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    usedAt: timestamptz("used_at"),
    ...timestamps,
  },
  (t) => [
    index("pairing_codes_org_id_idx").on(t.orgId),
    index("pairing_codes_site_id_idx").on(t.siteId),
    siteFk("pairing_codes_site_fk", t.siteId, t.orgId),
  ],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    orgId: orgIdColumn(),
    siteId: uuid("site_id"),
    fixId: uuid("fix_id"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsd: money("cost_usd").notNull(),
    at: timestamptz("at").notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index("ai_usage_org_id_idx").on(t.orgId),
    index("ai_usage_site_id_idx").on(t.siteId),
    index("ai_usage_at_idx").on(t.at),
    foreignKey({ name: "ai_usage_site_fk", columns: [t.siteId, t.orgId], foreignColumns: [sites.id, sites.orgId] }).onDelete(
      "cascade",
    ),
    foreignKey({ name: "ai_usage_fix_fk", columns: [t.fixId, t.orgId], foreignColumns: [fixes.id, fixes.orgId] }).onDelete(
      "cascade",
    ),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    orgId: orgIdColumn(),
    /** 'user:<uuid>' | 'system' | 'worker' */
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    /** IDs and step names only. Never page content, secrets or personal data (hard rule 8). */
    meta: jsonb("meta").notNull().default({}),
    at: timestamptz("at").notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index("audit_log_org_id_idx").on(t.orgId),
    index("audit_log_entity_idx").on(t.entity, t.entityId),
    index("audit_log_at_idx").on(t.at),
    check("audit_log_actor_format", sql`${t.actor} IN ('system', 'worker') OR ${t.actor} ~ '^user:[0-9a-f-]{36}$'`),
  ],
);
