import {
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock,
  Hourglass,
  Mail,
  PencilLine,
  RotateCcw,
  ScanSearch,
  Send,
  TriangleAlert,
  Undo2,
  UserPen,
  X,
  type LucideIcon,
} from "lucide-react";
import { REJECT_REASONS } from "@mendwell/core/client";

type Step = { action: string; who: string; byPerson: boolean; reason: string | null; at: string };

const STEPS: Record<string, { label: string; icon: LucideIcon; tone?: "verified" | "waiting" | "alert" }> = {
  "fix.proposed": { label: "Proposed", icon: CircleDashed },
  "fix.request_approval": { label: "Sent for approval", icon: Hourglass, tone: "waiting" },
  "fix.auto_approve": { label: "Approved automatically (auto-fix is on)", icon: CircleCheck },
  "fix.approve": { label: "Approved", icon: CircleCheck },
  "fix.edit": { label: "Edited and approved", icon: PencilLine },
  "fix.reject": { label: "Rejected", icon: X },
  "fix.decided_by_email": { label: "Decided from an email link", icon: Mail },
  "fix.start_apply": { label: "Applying through the Mendwell plugin", icon: Send },
  "fix.requeue": { label: "Held back, will try again", icon: Clock },
  "fix.applied": { label: "Written to the site", icon: Send },
  "fix.start_verify": { label: "Checking the live page", icon: ScanSearch },
  "fix.verify_passed": { label: "Verified on the live page", icon: CircleCheck, tone: "verified" },
  "fix.verify_failed": { label: "Didn't pass the check on the live page", icon: TriangleAlert, tone: "alert" },
  "fix.start_rollback": { label: "Undoing", icon: RotateCcw, tone: "alert" },
  "fix.rolled_back": { label: "Rolled back", icon: RotateCcw, tone: "alert" },
  "fix.conflict": { label: "Left as edited (someone changed it)", icon: UserPen, tone: "alert" },
  "fix.apply_failed": { label: "Couldn't be applied", icon: TriangleAlert, tone: "alert" },
  "fix.undo": { label: "Undone", icon: Undo2 },
  "fix.supersede": { label: "No longer needed", icon: CircleSlash },
};

const REASONS: Record<string, string> = {
  ...REJECT_REASONS,
  site_paused: "changes were paused",
  plugin_paused: "changes were paused in WordPress",
  expected_current_mismatch: "the content already had a value",
  undo_conflict: "the content was edited before the undo",
  issue_resolved: "the issue went away",
  alt_mismatch: "the page didn't show the new alt text",
  axe_image_alt_failed: "the image still failed the accessibility check",
  title_mismatch: "the page didn't show the new title",
  description_mismatch: "the page didn't show the new description",
  page_unavailable: "the page couldn't be loaded",
};

const toneClass = { verified: "text-verified", waiting: "text-waiting", alert: "text-alert" } as const;
const time = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** The fix's lifecycle, oldest first, from the audit log (PROJECT_SPEC §11, screen 7). */
export function FixTimeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative space-y-4 border-l border-dashed border-border-strong pl-6">
      {steps.map((step, i) => {
        const def = STEPS[step.action] ?? { label: step.action.replace(/^fix\./, "").replace(/_/g, " "), icon: CircleDashed };
        const Icon = def.icon;
        const reason = step.reason ? (REASONS[step.reason] ?? null) : null;
        return (
          <li key={`${step.action}-${i}`} className="relative">
            <span className="absolute -left-[2.05rem] grid size-5 place-items-center rounded-full border border-border bg-card">
              <Icon className={`size-3 ${def.tone ? toneClass[def.tone] : "text-muted-foreground"}`} aria-hidden="true" />
            </span>
            <p className="text-sm font-medium">
              {def.label}
              {reason ? <span className="font-normal text-muted-foreground">: {reason}</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              <time dateTime={step.at}>{time.format(new Date(step.at))}</time>
              {step.byPerson ? ` · by ${step.who}` : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
