import { CirclePause, ShieldCheck } from "lucide-react";
import { connection } from "next/server";
import { effectiveWrites } from "@/lib/server/platform-admin";

/** Shows the global kill switch (WRITES_ENABLED) so nobody has to guess whether fixes can be applied. */
export async function WritesStatus({ billingBlocked = false }: { billingBlocked?: boolean }) {
  await connection(); // read the flag at request time, not build time
  const writes = await effectiveWrites();
  const on = writes.enabled && !billingBlocked;
  const Icon = on ? ShieldCheck : CirclePause;
  return (
    <div className="flex items-start gap-2.5 text-xs">
      <Icon className={on ? "mt-0.5 size-4 shrink-0 text-verified" : "mt-0.5 size-4 shrink-0 text-waiting"} aria-hidden="true" />
      <div>
        <p className="font-semibold text-foreground">{on ? "Fixes can be applied" : "All fixes paused"}</p>
        <p className="text-muted-foreground">
          {on ? "Approvals and per-site pauses still apply." : billingBlocked && writes.enabled ? "Until billing is sorted. Scans and reports continue." : "No site will be changed until this is turned back on."}
        </p>
      </div>
    </div>
  );
}
