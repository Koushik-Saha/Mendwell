import type { Db } from "../db";
import { alertsRepo, approvalsRepo, billingRepo, fixesRepo, issuesRepo, reportsRepo, scansRepo } from "./findings";
import { accessRepo, auditRepo, invitationsRepo, membersRepo, organizationsRepo } from "./orgs";
import { clientsRepo, pagesRepo, pairingCodesRepo, siteCategoriesRepo, sitesRepo } from "./sites";

/**
 * Every tenant repository function takes an OrgId first. Two deliberate exceptions, both
 * documented at the definition: access.* (establishes membership, which is how an OrgId is
 * obtained) and invitations.findPendingByTokenHash (the invitee isn't a member yet).
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
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
export type { Actor, AuditEntry } from "./orgs";
