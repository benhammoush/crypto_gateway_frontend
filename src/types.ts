import type { components } from "./generated-api";

export type Payment = components["schemas"]["Payment"];

export const PROGRESS = [
  "Awaiting wallet approval",
  "Transaction submitted",
  "Verifying on-chain",
  "Payment verified",
] as const;

export type Progress = (typeof PROGRESS)[number];
