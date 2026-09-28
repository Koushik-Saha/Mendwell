import type { ConnectorTransport } from "@mendwell/core";
import type { SafeFetch } from "./safeFetch";

/** Connector requests go through the SSRF-safe fetcher like every other call to a customer site (hard rule 6). */
export function connectorTransport(safeFetch: SafeFetch, maxBytes = 1024 * 1024): ConnectorTransport {
  return async (request) => {
    const res = await safeFetch(request.url, { method: request.method, headers: request.headers, body: request.body, maxBytes });
    return { status: res.status, body: res.body.toString("utf8") };
  };
}
