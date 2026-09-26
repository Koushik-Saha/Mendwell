import { connect, type PeerCertificate } from "node:tls";
import type { Severity } from "@mendwell/core";
import { assertTestAllowOutsideProduction, resolvePinned, type Resolver, type TestAllow } from "../net/resolve";
import type { ScannerFinding } from "./types";

export type CertificateInfo = {
  authorized: boolean;
  authorizationError: string | null;
  validFrom: Date;
  validTo: Date;
  issuer: string | null;
  subject: string | null;
};

const DAY = 86_400_000;

/** PROJECT_SPEC §4: alert at 21 / 7 / 1 days before expiry; invalid or expired is critical. */
export function classifyCertificate(info: CertificateInfo, host: string, now = new Date()): ScannerFinding[] {
  const pageUrl = `https://${host}/`;
  const daysRemaining = Math.floor((info.validTo.getTime() - now.getTime()) / DAY);
  const measured = { daysRemaining, validTo: info.validTo.toISOString(), issuer: info.issuer ?? "unknown" };
  const target = { host };

  if (now > info.validTo || now < info.validFrom || !info.authorized) {
    const why = now > info.validTo ? "has expired" : now < info.validFrom ? "isn't valid yet" : `isn't trusted (${info.authorizationError ?? "unknown error"})`;
    return [
      {
        rule: "ssl-invalid",
        category: "ssl",
        severity: "critical",
        pageUrl,
        target,
        evidence: { message: `The SSL certificate ${why}. Visitors see a security warning. Contact your host.`, measured },
      },
    ];
  }
  const severity: Severity | null = daysRemaining <= 1 ? "critical" : daysRemaining <= 7 ? "serious" : daysRemaining <= 21 ? "moderate" : null;
  if (!severity) return [];
  return [
    {
      rule: "ssl-expiring",
      category: "ssl",
      severity,
      pageUrl,
      target,
      evidence: { message: `The SSL certificate expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}. Contact your host to renew it.`, measured },
    },
  ];
}

function name(entity: PeerCertificate["issuer"] | undefined): string | null {
  const value = entity?.O ?? entity?.CN;
  return value === undefined ? null : Array.isArray(value) ? value.join(", ") : value;
}

/** Read the site's certificate over a pinned, SSRF-checked TLS connection. */
export async function readCertificate(
  host: string,
  options: { port?: number; timeoutMs?: number; resolver?: Resolver; testAllow?: TestAllow; ca?: string } = {},
): Promise<CertificateInfo> {
  assertTestAllowOutsideProduction(options.testAllow);
  const port = options.port ?? 443;
  if (port !== 443 && !options.testAllow?.ports.includes(port)) throw new Error("Only port 443 is allowed");
  const pinned = await resolvePinned(host, { resolver: options.resolver, testAllow: options.testAllow });

  return new Promise((resolve, reject) => {
    const socket = connect({
      host: pinned.address,
      port,
      servername: host,
      rejectUnauthorized: false, // we want to *report* bad certificates, not just fail
      ...(options.ca ? { ca: options.ca } : {}),
      timeout: options.timeoutMs ?? 15_000,
    });
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const info: CertificateInfo = {
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
        validFrom: new Date(cert.valid_from),
        validTo: new Date(cert.valid_to),
        issuer: name(cert.issuer),
        subject: name(cert.subject),
      };
      socket.end();
      resolve(info);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("TLS handshake timed out"));
    });
    socket.once("error", (error) => reject(new Error(`TLS connection failed (${(error as NodeJS.ErrnoException).code ?? "error"})`)));
  });
}

export async function checkSsl(host: string, options: Parameters<typeof readCertificate>[1] & { now?: Date } = {}): Promise<{ info: CertificateInfo | null; findings: ScannerFinding[] }> {
  try {
    const info = await readCertificate(host, options);
    return { info, findings: classifyCertificate(info, host, options.now) };
  } catch (error) {
    return {
      info: null,
      findings: [
        {
          rule: "ssl-invalid",
          category: "ssl",
          severity: "critical",
          pageUrl: `https://${host}/`,
          target: { host },
          evidence: { message: "We couldn't open a secure (HTTPS) connection to the site.", measured: { error: (error as Error).message } },
        },
      ],
    };
  }
}
