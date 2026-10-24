/**
 * Generated-payment alias and handwritten checkout progress states.
 * @packageDocumentation
 */

import type { components } from "./generated-api";

/** Payment resource defined by the backend-owned API contract. */
export type Payment = components["schemas"]["Payment"];

export const PROGRESS = [
  "Awaiting wallet approval",
  "Transaction submitted",
  "Verifying on-chain",
  "Payment verified",
] as const;

/** Checkout progress retained across status and submission transitions. */
export type Progress = (typeof PROGRESS)[number];
