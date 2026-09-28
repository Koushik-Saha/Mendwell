import type { Db } from "../db";
import { aiUsageRepo, fixRecordsRepo } from "./fixes";
import { approvalLinksRepo, fixViewsRepo } from "./fixViews";
import { reportDataRepo, reportRecordsRepo } from "./reports";
import { subscriptionsRepo } from "./billing";
import { alertsRepo, approvalsRepo, billingRepo, fixesRepo, issuesRepo, reportsRepo, scansRepo } from "./findings";
import { accessRepo, auditRepo, invitationsRepo, membersRepo, organizationsRepo } from "./orgs";
import { alertRecordsRepo, issueRecordsRepo, scanRunsRepo, sitePagesRepo, teamContactsRepo, uptimeRepo } from "./pipeline";
import { clientsRepo, pagesRepo, pairingCodesRepo, siteCategoriesRepo, sitesRepo } from "./sites";

/**
 * Every tenant repository function takes an OrgId first. Deliberate exceptions, each documented at
 * the definition: access.* (establishes membership, which is how an OrgId is obtained),
 * invitations.findPendingByTokenHash (the invitee isn't a member yet), approvalLinks.findById (a signed
 * email link, no session), and systemSitesRepo / systemFixesRepo
 * (worker schedulers only; exported separately and not part of this object).
 */
export function createRepositories(db: Db) {
  return {
    access: accessRepo(db),
    organizations: organizationsRepo(db),
    members: membersRepo(db),
    invitations: invitationsRepo(db),
    audit: auditRepo(db),
    clients: clientsRepo(db),
    sites: sitesRepo(db),
    siteCategories: siteCategoriesRepo(db),
    pages: pagesRepo(db),
    pairingCodes: pairingCodesRepo(db),
    scans: scansRepo(db),
    issues: issuesRepo(db),
    fixes: fixesRepo(db),
    approvals: approvalsRepo(db),
    alerts: alertsRepo(db),
    reports: reportsRepo(db),
    billing: billingRepo(db),
    scanRuns: scanRunsRepo(db),
    sitePages: sitePagesRepo(db),
    issueRecords: issueRecordsRepo(db),
    alertRecords: alertRecordsRepo(db),
    uptime: uptimeRepo(db),
    teamContacts: teamContactsRepo(db),
    fixRecords: fixRecordsRepo(db),
    aiUsage: aiUsageRepo(db),
    fixViews: fixViewsRepo(db),
    approvalLinks: approvalLinksRepo(db),
    reportRecords: reportRecordsRepo(db),
    reportData: reportDataRepo(db),
    subscriptions: subscriptionsRepo(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
export type { Actor, AuditEntry } from "./orgs";
export { systemReportsRepo } from "./reports";
export { systemBillingRepo, type SubscriptionInput } from "./billing";
export { FixStateConflictError, systemFixesRepo, type AiUsageEntry, type FixExtra } from "./fixes";
export { systemSitesRepo, urlHash, type IssueRow, type ScanCounts, type ScanProgress } from "./pipeline";
