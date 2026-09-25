import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Placeholder until onboarding (PROJECT_SPEC §11.3) ships. Disabled, with the reason announced. */
export function AddSiteButton({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled aria-describedby={id}>
        <Plus aria-hidden="true" />
        Add site
      </Button>
      <p id={id} className="text-xs text-muted-foreground">
        Adding sites opens soon.
      </p>
    </div>
  );
}
