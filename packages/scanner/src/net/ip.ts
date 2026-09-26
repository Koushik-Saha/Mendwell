import { BlockList, isIP } from "node:net";

/**
 * Address ranges the scanner must never connect to (SECURITY.md T4). Anything not public unicast:
 * private, loopback, link-local (incl. cloud metadata 169.254.169.254), CGNAT, multicast,
 * reserved/documentation/benchmark ranges, and every IPv6 form that embeds or translates an IPv4
 * address (mapped, compatible, NAT64, 6to4, Teredo), which could otherwise smuggle 127.0.0.1 in.
 */
const RANGES: [cidr: string, family: "ipv4" | "ipv6", label: string][] = [
  ["0.0.0.0/8", "ipv4", "this-network"],
  ["10.0.0.0/8", "ipv4", "private"],
  ["100.64.0.0/10", "ipv4", "cgnat"],
  ["127.0.0.0/8", "ipv4", "loopback"],
  ["169.254.0.0/16", "ipv4", "link-local"],
  ["172.16.0.0/12", "ipv4", "private"],
  ["192.0.0.0/24", "ipv4", "reserved"],
  ["192.0.2.0/24", "ipv4", "documentation"],
  ["192.31.196.0/24", "ipv4", "reserved"],
  ["192.52.193.0/24", "ipv4", "reserved"],
  ["192.88.99.0/24", "ipv4", "reserved"],
  ["192.168.0.0/16", "ipv4", "private"],
  ["192.175.48.0/24", "ipv4", "reserved"],
  ["198.18.0.0/15", "ipv4", "benchmark"],
  ["198.51.100.0/24", "ipv4", "documentation"],
  ["203.0.113.0/24", "ipv4", "documentation"],
  ["224.0.0.0/4", "ipv4", "multicast"],
  ["240.0.0.0/4", "ipv4", "reserved"], // includes 255.255.255.255

  ["::/128", "ipv6", "unspecified"],
  ["::1/128", "ipv6", "loopback"],
  ["::/96", "ipv6", "ipv4-compatible"],
  ["::ffff:0:0/96", "ipv6", "ipv4-mapped"],
  ["64:ff9b::/96", "ipv6", "nat64"],
  ["64:ff9b:1::/48", "ipv6", "nat64"],
  ["100::/64", "ipv6", "discard"],
  ["2001::/23", "ipv6", "reserved"], // IETF protocol assignments, incl. Teredo 2001::/32
  ["2001:db8::/32", "ipv6", "documentation"],
  ["2002::/16", "ipv6", "6to4"],
  ["3fff::/20", "ipv6", "documentation"],
  ["5f00::/16", "ipv6", "reserved"],
  ["fc00::/7", "ipv6", "unique-local"],
  ["fe80::/10", "ipv6", "link-local"],
  ["fec0::/10", "ipv6", "site-local"],
  ["ff00::/8", "ipv6", "multicast"],
];

const lists = RANGES.map(([cidr, family, label]) => {
  const [network, prefix] = cidr.split("/") as [string, string];
  const list = new BlockList();
  list.addSubnet(network, Number(prefix), family);
  return { list, family, label };
});

/** Strip brackets from an IPv6 URL hostname ("[::1]" → "::1"). */
export function unbracket(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Why an address is blocked, or null if it's public unicast and allowed.
 * Anything that doesn't parse as an IP is blocked ("invalid").
 */
export function blockedReason(address: string): string | null {
  const ip = unbracket(address).split("%")[0] ?? ""; // drop IPv6 zone id
  const version = isIP(ip);
  if (version === 0) return "invalid";
  const family = version === 4 ? "ipv4" : "ipv6";
  for (const { list, family: f, label } of lists) {
    if (f === family && list.check(ip, family)) return label;
  }
  return null;
}

export function isBlockedAddress(address: string): boolean {
  return blockedReason(address) !== null;
}
