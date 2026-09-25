import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getOptionalSession } from "@/lib/server/page-context";
import { AcceptInvitation } from "./accept-invitation";

export const metadata: Metadata = { title: "Accept invitation", referrer: "no-referrer" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getOptionalSession();
  const here = `/invite/${encodeURIComponent(token)}`;
  return (
    <>
      <h1 className="text-xl font-semibold">You&apos;re invited</h1>
      {session ? (
        <>
          <p className="mt-1 text-muted-foreground">
            Accept to join the workspace as <span className="font-semibold text-foreground">{session.user.email}</span>. The invitation
            must have been sent to this address.
          </p>
          <AcceptInvitation token={token} />
        </>
      ) : (
        <>
          <p className="mt-1 text-muted-foreground">Sign in with the email address the invitation was sent to, then accept it.</p>
          <Button asChild className="mt-6 w-full">
            <Link href={`/sign-in?next=${encodeURIComponent(here)}`}>Sign in to accept</Link>
          </Button>
        </>
      )}
    </>
  );
}
