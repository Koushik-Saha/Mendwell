const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * IDs arrive from URLs. A malformed one can't match any row, so treat it as "not found"
 * instead of letting Postgres throw (which would surface as a 500, not a 404).
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function first<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

/** Columns callers may never set: identity, tenant and bookkeeping. */
export type Managed = "id" | "orgId" | "createdAt" | "updatedAt";
