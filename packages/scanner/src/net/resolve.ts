import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { blockedReason, unbracket } from "./ip";

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** TESTS ONLY: extra addresses/ports to allow (the fixture server). Refused in production. */
export type TestAllow = { addresses: string[]; ports: number[] };

export class AddressError extends Error {
  constructor(
    readonly code: "blocked_address" | "dns_failure",
    message: string,
  ) {
    super(message);
    this.name = "AddressError";
  }
}

export const systemResolver: Resolver = async (hostname) =>
  (await dns.lookup(hostname, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

export function assertTestAllowOutsideProduction(testAllow: TestAllow | undefined) {
  if (testAllow && process.env.NODE_ENV === "production") {
    throw new Error("testAllow is for tests only and is refused in production");
  }
}

/**
 * Resolve a hostname once and check every answer. Returns the address to pin the connection to.
 * A mixed public/private answer is refused outright (it's an attack, not a fallback).
 */
export async function resolvePinned(hostname: string, options: { resolver?: Resolver; testAllow?: TestAllow } = {}): Promise<ResolvedAddress> {
  const host = unbracket(hostname);
  const allowed = new Set(options.testAllow?.addresses ?? []);
  let addresses: ResolvedAddress[];
  if (isIP(host)) {
    addresses = [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await (options.resolver ?? systemResolver)(host);
    } catch {
      throw new AddressError("dns_failure", "The host name could not be resolved");
    }
  }
  if (addresses.length === 0) throw new AddressError("dns_failure", "The host name has no addresses");
  for (const { address } of addresses) {
    if (allowed.has(address)) continue;
    const reason = blockedReason(address);
    if (reason) throw new AddressError("blocked_address", `Refusing to connect to a ${reason} address`);
  }
  return addresses[0] as ResolvedAddress;
}
