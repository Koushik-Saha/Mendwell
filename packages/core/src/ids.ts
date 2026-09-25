declare const orgIdBrand: unique symbol;

/**
 * An organization id that has been checked against the caller's membership.
 * Repositories take `OrgId`, not `string`, so a raw id from a URL or request body
 * can't reach a query without going through authorization first (hard rule 7).
 */
export type OrgId = string & { readonly [orgIdBrand]: true };

/**
 * Brand a string as an OrgId. Only call this after verifying membership
 * (apps/web requireOrgRole), in the worker after loading a site's org, or in tests.
 */
export function unsafeOrgId(id: string): OrgId {
  return id as OrgId;
}
