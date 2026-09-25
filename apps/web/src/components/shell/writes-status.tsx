import { CirclePause, ShieldCheck } from "lucide-react";
import { connection } from "next/server";
import { writesEnabled } from "@/lib/flags";

/** Shows the global kill switch (WRITES_ENABLED) so nobody has to guess whether fixes can be applied. */
export async function WritesStatus() {
  await connection(); // read the flag at request time, not build time
  const on = writesEnabled();
  const Icon = on ? ShieldCheck : CirclePause;
  return (
    <div className="flex items-start gap-2.5 text-xs">
      <Icon className={on ? "mt-0.5 size-4 shrink-0 text-verified" : "mt-0.5 size-4 shrink-0 text-waiting"} aria-hidden="true" />
      <div>
        <p className="font-semibold text-foreground">{on ? "Fixes can be applied" : "All fixes paused"}</p>
        <p className="text-muted-foreground">{on ? "Approvals and per-site pauses still apply." : "No site will be changed until this is turned back on."}</p>
      </div>
    </div>
  );
}
