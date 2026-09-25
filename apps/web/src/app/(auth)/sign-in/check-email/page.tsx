import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <>
      <span className="grid size-10 place-items-center rounded-[var(--radius-control)] bg-primary-soft text-primary">
        <MailCheck className="size-5" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-xl font-semibold">Check your email</h1>
      <p className="mt-1 text-muted-foreground">
        We sent a sign-in link{email ? <> to <span className="font-semibold text-foreground">{email}</span></> : null}. It works once and
        expires in 15 minutes.
      </p>
      <p className="mt-4 text-sm text-muted-foreground">
        Nothing arrived? Check spam, or{" "}
        <Link href="/sign-in" className="font-semibold text-primary underline underline-offset-2">
          send another link
        </Link>
        .
      </p>
    </>
  );
}
