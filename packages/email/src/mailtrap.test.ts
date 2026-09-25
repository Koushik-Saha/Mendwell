import { describe, expect, it, vi } from "vitest";
import { createMailtrapMailer, EmailDeliveryError, parseFrom } from "./index";

const message = { to: "ada@example.test", subject: "Your Mendwell sign-in link", html: "<p>hi</p>", text: "hi" };

function fakeFetch(status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ success: status < 300 }), { status }));
}

describe("createMailtrapMailer", () => {
  it("sends through Email Sending with a bearer token and a parsed sender", async () => {
    const fetch = fakeFetch();
    await createMailtrapMailer({ token: "tok_123", from: "Mendwell <noreply@koushiksaha.dev>", fetch }).send(message);

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://send.api.mailtrap.io/api/send");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok_123");
    expect(JSON.parse(String(init?.body))).toEqual({
      from: { email: "noreply@koushiksaha.dev", name: "Mendwell" },
      to: [{ email: "ada@example.test" }],
      subject: message.subject,
      html: message.html,
      text: message.text,
      category: "transactional",
    });
  });

  it("delivers into a testing inbox when sandboxInboxId is set", async () => {
    const fetch = fakeFetch();
    await createMailtrapMailer({ token: "t", from: "noreply@koushiksaha.dev", sandboxInboxId: "1831231", fetch }).send(message);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://sandbox.api.mailtrap.io/api/send/1831231");
  });

  it("throws on rejection without leaking the recipient, subject or token", async () => {
    const mailer = createMailtrapMailer({ token: "secret_token", from: "noreply@koushiksaha.dev", fetch: fakeFetch(401) });
    const error = await mailer.send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailDeliveryError);
    const text = String((error as Error).message);
    expect(text).toBe("Mailtrap rejected the message (HTTP 401)");
    for (const secret of ["secret_token", message.to, message.subject]) expect(text).not.toContain(secret);
  });

  it("turns network failures into a delivery error", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed: getaddrinfo ENOTFOUND");
    });
    await expect(createMailtrapMailer({ token: "t", from: "a@b.test", fetch }).send(message)).rejects.toThrow(
      "Mailtrap request failed (network or timeout)",
    );
  });
});

describe("parseFrom", () => {
  it.each([
    ["Mendwell <noreply@koushiksaha.dev>", { email: "noreply@koushiksaha.dev", name: "Mendwell" }],
    ['"Mendwell Reports" <reports@koushiksaha.dev>', { email: "reports@koushiksaha.dev", name: "Mendwell Reports" }],
    ["noreply@koushiksaha.dev", { email: "noreply@koushiksaha.dev" }],
    ["<noreply@koushiksaha.dev>", { email: "noreply@koushiksaha.dev" }],
  ])("parses %j", (input, expected) => {
    expect(parseFrom(input)).toEqual(expected);
  });

  it.each(["", "Mendwell", "not an email", "a@b <c>"])("rejects %j", (input) => {
    expect(() => parseFrom(input)).toThrow();
  });
});
