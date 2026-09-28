/**
 * Browser-safe entry point: constants and types only, no node:crypto. Client components import
 * from "@mendwell/core/client"; server code keeps using "@mendwell/core".
 */
export { ALT_MAX, ALT_MIN, META_DESCRIPTION_MAX, META_DESCRIPTION_MIN, META_TITLE_MAX, META_TITLE_MIN } from "./validators";
export { isRejectReason, REJECT_REASONS, type RejectReason } from "./rejectReasons";
export type { AltFixValue, FixValue, LinkFixValue, MetaFixValue } from "./fixValues";
export type { FixCategory, FixStatus } from "./domain";
