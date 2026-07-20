import type { AllocationClassification } from "@/types";

const FINAL_LABELS: Record<AllocationClassification, string> = {
  distributed: "distributed",
  sold: "sold",
  internal: "moved",
  burned: "burned",
  received: "received",
  unknown: "unclassified",
};

const PROVISIONAL_LABELS: Record<AllocationClassification, string> = {
  distributed: "distribution signal",
  sold: "sale signal",
  internal: "move signal",
  burned: "burn signal",
  received: "inflow signal",
  unknown: "unclassified",
};

export function allocationMovementLabel(
  classification: AllocationClassification,
  isFinal: boolean,
): string {
  return isFinal ? FINAL_LABELS[classification] : PROVISIONAL_LABELS[classification];
}

export function allocationCounterpartyLabel(
  counterpartyWallet: string | null,
  isCounterpartyTracked: boolean | null,
): string | null {
  if (!counterpartyWallet) return null;
  return isCounterpartyTracked === false ? "an external wallet" : counterpartyWallet;
}
