// Public barrel for the claims module. Plan-2 Part-1 minimal surface:
// types + persist + validators. UX wiring (admin / public video pages)
// and the claim-indexes graph stage land in follow-up commits once the
// AI session quality is signed off on a sample batch.

export * from "./types.js";
export * from "./persist.js";
export {
  ClaimsValidationError,
  buildValidationContext,
  validateClaim,
  validateClaimsPayload,
  assertValidClaims,
  type ValidationContext,
} from "./validate.js";
