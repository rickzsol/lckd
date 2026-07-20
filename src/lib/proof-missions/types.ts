import type { ProofMission } from "./mission";

export type ProofStatus = "pending" | "accepted" | "rejected";
export type ProofDecision = "approve" | "reject";

export interface PublicProof {
  id: string;
  contributor: string;
  evidenceUrl: string;
  evidenceNote: string;
  submittedAt: string;
  reviewedAt: string | null;
}

export interface ReviewProof extends PublicProof {
  isOwn: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  contributor: string;
  acceptedProofs: number;
  points: number;
}

export interface ProofMissionBoard {
  mission: ProofMission;
  isAcceptingSubmissions: boolean;
  accepted: PublicProof[];
  reviewQueue: ReviewProof[];
  leaderboard: LeaderboardEntry[];
  counts: { accepted: number; pending: number };
  viewer: {
    isSignedIn: boolean;
    hasLinkedWallet: boolean;
    canReview: boolean;
    submissionStatus: ProofStatus | null;
  };
}
