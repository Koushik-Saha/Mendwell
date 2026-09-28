import type { Db } from "../db";
import { aiUsageRepo, fixRecordsRepo } from "./fixes";
import { alertsRepo, approvalsRepo, billingRepo, fixesRepo, issuesRepo, reportsRepo, scansRepo } from "./findings";
import { accessRepo, auditRepo, invitationsRepo, membersRepo, organizationsRepo } from "./orgs";
import { alertRecordsRepo, issueRecordsRepo, scanRunsRepo, sitePagesRepo, teamContactsRepo, uptimeRepo } from "./pipeline";
import { clientsRepo, pagesRepo, pairingCodesRepo, siteCategoriesRepo, sitesRepo } from "./sites";

/**
 * Every tenant repository function takes an OrgId first. Deliberate exceptions, each documented at
 * the definition: access.* (establishes membership, which is how an OrgId is obtained),
 * invitations.findPendingByTokenHash (the invitee isn't a member yet), and systemSitesRepo / systemFixesRepo
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
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
export type { Actor, AuditEntry } from "./orgs";
export { FixStateConflictError, systemFixesRepo, type AiUsageEntry, type FixExtra } from "./fixes";
export { systemSitesRepo, urlHash, type IssueRow, type ScanCounts, type ScanProgress } from "./pipeline";
