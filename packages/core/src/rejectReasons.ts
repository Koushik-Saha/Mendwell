/** Why a fix is rejected: fixed choices, so reasons can be counted and nothing free-form is logged. */
export const REJECT_REASONS = {
  inaccurate: "Doesn't describe it correctly",
  wrong_tone: "Wrong tone or wording",
  not_needed: "Not needed here",
  decorative: "The image is decorative",
  wrong_link: "Wrong link target",
  other: "Something else",
} as const;
export type RejectReason = keyof typeof REJECT_REASONS;
export const isRejectReason = (value: unknown): value is RejectReason => typeof value === "string" && value in REJECT_REASONS;
