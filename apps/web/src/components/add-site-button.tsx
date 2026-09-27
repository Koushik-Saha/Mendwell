import { Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Admins and owners add sites; members see why they can't. */
export function AddSiteButton({ id, canAdd }: { id: string; canAdd: boolean }) {
  if (canAdd) {
    return (
      <Button asChild>
        <Link href="/sites/new">
          <Plus aria-hidden="true" />
          Add site
        </Link>
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled aria-describedby={id}>
        <Plus aria-hidden="true" />
        Add site
      </Button>
      <p id={id} className="text-xs text-muted-foreground">
        Ask an admin or owner to add sites.
      </p>
    </div>
  );
}
