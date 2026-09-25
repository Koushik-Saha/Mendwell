import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth-client";
import { getSessionPageContext } from "@/lib/server/page-context";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Two-factor code" };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const ctx = await getSessionPageContext(undefined, { allowPendingTwoFactor: true });
  if (!ctx.user.twoFactorEnabled || ctx.session.twoFactorVerifiedAt) redirect(safeNext(next));
  return (
    <>
      <h1 className="text-xl font-semibold">Enter your code</h1>
      <p className="mt-1 text-muted-foreground">Open your authenticator app and enter the 6-digit code for Mendwell.</p>
      <TwoFactorForm next={safeNext(next)} />
    </>
  );
}
