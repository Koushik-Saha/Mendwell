import {
  alertSeverities,
  approvalChannels,
  approvalDecisions,
  buckets,
  categoryStates,
  fixCategories,
  fixStatuses,
  invitationStatuses,
  issueCategories,
  issueStatuses,
  orgTypes,
  roles,
  scanKinds,
  scanStatuses,
  severities,
  siteConnections,
  sitePlatforms,
  siteStatuses,
  subscriptionStatuses,
} from "@mendwell/core";
import { pgEnum } from "drizzle-orm/pg-core";

export const orgTypeEnum = pgEnum("org_type", orgTypes);
export const memberRoleEnum = pgEnum("member_role", roles);
export const invitationStatusEnum = pgEnum("invitation_status", invitationStatuses);
export const sitePlatformEnum = pgEnum("site_platform", sitePlatforms);
export const siteConnectionEnum = pgEnum("site_connection", siteConnections);
export const siteStatusEnum = pgEnum("site_status", siteStatuses);
export const fixCategoryEnum = pgEnum("fix_category", fixCategories);
export const categoryStateEnum = pgEnum("category_state", categoryStates);
export const issueCategoryEnum = pgEnum("issue_category", issueCategories);
export const severityEnum = pgEnum("severity", severities);
export const issueStatusEnum = pgEnum("issue_status", issueStatuses);
export const bucketEnum = pgEnum("bucket", buckets);
export const scanKindEnum = pgEnum("scan_kind", scanKinds);
export const scanStatusEnum = pgEnum("scan_status", scanStatuses);
export const fixStatusEnum = pgEnum("fix_status", fixStatuses);
export const approvalViaEnum = pgEnum("approval_via", approvalChannels);
export const approvalDecisionEnum = pgEnum("approval_decision", approvalDecisions);
export const alertSeverityEnum = pgEnum("alert_severity", alertSeverities);
export const subscriptionStatusEnum = pgEnum("subscription_status", subscriptionStatuses);
