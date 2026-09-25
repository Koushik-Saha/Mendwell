import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-[48ch]">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-1 text-muted-foreground">The link may be old, or the page was moved.</p>
        <Button asChild className="mt-5">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
