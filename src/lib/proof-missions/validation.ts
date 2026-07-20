import { z } from "zod";
import type { ProofDecision } from "./types";

const httpsEvidenceUrl = z.string().trim().max(2048).url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Evidence must use a public HTTPS URL");

export const proofSubmissionSchema = z.object({
  missionKey: z.string().trim().min(1).max(64),
  evidenceUrl: httpsEvidenceUrl,
  evidenceNote: z.string().trim().min(40).max(1000),
}).strict();

export const proofReviewSchema = z.object({
  decision: z.enum(["approve", "reject"] satisfies ProofDecision[]),
}).strict();

export function getReviewerIds(value = process.env.PROOF_MISSION_REVIEWER_GITHUB_IDS): Set<string> {
  if (!value) return new Set();
  return new Set(
    value.split(",").map((id) => id.trim()).filter((id) => /^\d{1,32}$/.test(id)),
  );
}

export function isEligibleReviewer(githubId: string, value?: string): boolean {
  return getReviewerIds(value).has(githubId);
}

export function hasReviewerQuorum(value?: string): boolean {
  return getReviewerIds(value).size >= 2;
}
