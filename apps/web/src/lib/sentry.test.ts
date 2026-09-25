import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrubEvent, sentryOptions } from "./sentry";

describe("scrubEvent", () => {
  it("removes request bodies, cookies, headers and query strings", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: "https://app.mendwell.test/api/sites?token=secret",
        data: { connectorSecret: "abc" },
        cookies: { session: "xyz" },
        headers: { authorization: "Bearer abc" },
        query_string: "token=secret",
      },
    } satisfies ErrorEvent);
    expect(event.request).toEqual({ url: "https://app.mendwell.test/api/sites" });
  });

  it("keeps only the user id", () => {
    const event = scrubEvent({
      type: undefined,
      user: { id: "usr_1", email: "owner@example.com", ip_address: "203.0.113.4" },
    });
    expect(event.user).toEqual({ id: "usr_1" });
  });

  it("drops extra context", () => {
    expect(scrubEvent({ type: undefined, extra: { html: "<p>page</p>" } }).extra).toBeUndefined();
  });
});

describe("sentryOptions", () => {
  it("is disabled without a DSN and never sends default PII", () => {
    expect(sentryOptions(undefined)).toMatchObject({ enabled: false, sendDefaultPii: false });
    expect(sentryOptions("https://key@o0.ingest.sentry.io/0")).toMatchObject({ enabled: true, sendDefaultPii: false });
  });
});
