import type { Metadata } from "next";
import { parseServerEnv } from "@/lib/server/env";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

const errors: Record<string, string> = {
  INVALID_TOKEN: "That sign-in link has expired or was already used. Request a new one below.",
  EXPIRED_TOKEN: "That sign-in link has expired. Request a new one below.",
  link: "That sign-in link has expired or was already used. Request a new one below.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const env = parseServerEnv();
  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-muted-foreground">We&apos;ll email you a link. No password needed.</p>
      <SignInForm next={next} googleEnabled={Boolean(env.GOOGLE_CLIENT_ID)} initialError={error ? (errors[error] ?? errors.link) : undefined} />
    </>
  );
}
