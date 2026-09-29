// Network-only entry point (no Playwright): for the web app's connector calls and pairing checks.
export { blockedReason, isBlockedAddress } from "./ip";
export { AddressError, devNetFromEnv, resolvePinned, type ResolvedAddress, type Resolver, type TestAllow } from "./resolve";
export {
  buildUserAgent,
  createSafeFetch,
  SafeFetchError,
  type SafeFetch,
  type SafeFetchErrorCode,
  type SafeFetchOptions,
  type SafeRequest,
  type SafeResponse,
} from "./safeFetch";
export { connectorTransport } from "./connectorTransport";
