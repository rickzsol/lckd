import "server-only";

import { getServerClient } from "@/lib/supabase";
import { getCurrentProofMission, PROOF_MISSION_POINTS } from "./mission";
import type {
  LeaderboardEntry,
  ProofMissionBoard,
  ProofStatus,
  PublicProof,
  ReviewProof,
} from "./types";
import { getReviewerIds } from "./validation";

interface SubmissionRow {
  id: string;
  contributor_github_id: string;
  contributor_github_username: string;
  evidence_url: string;
  evidence_note: string;
  status: ProofStatus;
  created_at: string;
  reviewed_at: string | null;
}

export interface ProofViewer {
  githubId: string;
  hasLinkedWallet: boolean;
}

function publicProof(row: SubmissionRow): PublicProof {
  return {
    id: row.id,
    contributor: row.contributor_github_username,
    evidenceUrl: row.evidence_url,
    evidenceNote: row.evidence_note,
    submittedAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

export function buildLeaderboard(rows: SubmissionRow[]): LeaderboardEntry[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.contributor_github_username, (totals.get(row.contributor_github_username) ?? 0) + 1);
  }
  return [...totals.entries()]
    .sort(([leftName, leftCount], [rightName, rightCount]) =>
      rightCount - leftCount || leftName.localeCompare(rightName),
    )
    .map(([contributor, acceptedProofs], index) => ({
      rank: index + 1,
      contributor,
      acceptedProofs,
      points: acceptedProofs * PROOF_MISSION_POINTS,
    }));
}

export async function loadProofViewer(githubId: string): Promise<ProofViewer> {
  const { data, error } = await getServerClient()
    .from("github_profiles")
    .select("wallet_address")
    .eq("github_id", githubId)
    .maybeSingle();
  if (error) throw new Error(`Viewer profile query failed: ${error.message}`);
  return { githubId, hasLinkedWallet: Boolean(data?.wallet_address) };
}

export async function loadProofMissionBoard(viewer: ProofViewer | null): Promise<ProofMissionBoard> {
  const mission = getCurrentProofMission();
  const client = getServerClient();
  const reviewerIds = getReviewerIds();
  const isAcceptingSubmissions = reviewerIds.size >= 2;
  const canReview = Boolean(
    isAcceptingSubmissions && viewer?.hasLinkedWallet && reviewerIds.has(viewer.githubId),
  );
  const columns = "id, contributor_github_id, contributor_github_username, evidence_url, evidence_note, status, created_at, reviewed_at";

  const acceptedRequest = client.from("proof_submissions").select(columns)
    .eq("mission_key", mission.key).eq("status", "accepted").order("reviewed_at", { ascending: true });
  const pendingCountRequest = client.from("proof_submissions").select("id", { count: "exact", head: true })
    .eq("mission_key", mission.key).eq("status", "pending");
  const viewerRequest = viewer
    ? client.from("proof_submissions").select("status").eq("mission_key", mission.key)
      .eq("contributor_github_id", viewer.githubId).in("status", ["pending", "accepted"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const queueRequest = canReview
    ? client.from("proof_submissions").select(columns).eq("mission_key", mission.key)
      .eq("status", "pending").order("created_at", { ascending: true })
    : Promise.resolve({ data: [], error: null });

  const [acceptedResult, pendingResult, viewerResult, queueResult] = await Promise.all([
    acceptedRequest, pendingCountRequest, viewerRequest, queueRequest,
  ]);
  const error = acceptedResult.error ?? pendingResult.error ?? viewerResult.error ?? queueResult.error;
  if (error) throw new Error(`Proof mission query failed: ${error.message}`);

  const acceptedRows = (acceptedResult.data ?? []) as unknown as SubmissionRow[];
  const queueRows = (queueResult.data ?? []) as unknown as SubmissionRow[];
  const reviewedIds = new Set<string>();
  if (canReview && viewer && queueRows.length > 0) {
    const { data: reviews, error: reviewError } = await client.from("proof_reviews")
      .select("submission_id")
      .eq("reviewer_github_id", viewer.githubId)
      .in("submission_id", queueRows.map((row) => row.id));
    if (reviewError) throw new Error(`Proof review query failed: ${reviewError.message}`);
    for (const review of reviews ?? []) reviewedIds.add(review.submission_id);
  }
  const reviewQueue: ReviewProof[] = queueRows
    .filter((row) => !reviewedIds.has(row.id))
    .map((row) => ({
      ...publicProof(row),
      isOwn: row.contributor_github_id === viewer?.githubId,
    }));

  return {
    mission,
    isAcceptingSubmissions,
    accepted: acceptedRows.map(publicProof),
    reviewQueue,
    leaderboard: buildLeaderboard(acceptedRows),
    counts: { accepted: acceptedRows.length, pending: pendingResult.count ?? 0 },
    viewer: {
      isSignedIn: Boolean(viewer),
      hasLinkedWallet: viewer?.hasLinkedWallet ?? false,
      canReview,
      submissionStatus: (viewerResult.data?.status as ProofStatus | undefined) ?? null,
    },
  };
}
