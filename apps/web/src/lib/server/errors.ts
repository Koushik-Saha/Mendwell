export type ErrorCode =
  | "unauthorized"
  | "two_factor_required"
  | "no_organization"
  | "forbidden"
  | "owner_only"
  | "last_owner"
  | "solo_org"
  | "not_found"
  | "validation_failed"
  | "invalid_json"
  | "invalid_origin"
  | "conflict"
  | "already_member"
  | "invalid_code"
  | "internal_error";

/** An error that is safe to show to the client as `{ error: { code, message } }`. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = () => new AppError("unauthorized", "Sign in to continue.", 401);
export const twoFactorRequired = () => new AppError("two_factor_required", "Enter the code from your authenticator app to continue.", 401);
export const noOrganization = () => new AppError("no_organization", "Create a workspace to continue.", 403);
export const forbidden = (message = "You don't have permission to do that.") => new AppError("forbidden", message, 403);
/** Also used for resources in other orgs: we never confirm that they exist. */
export const notFound = (what = "That item") => new AppError("not_found", `${what} wasn't found.`, 404);
