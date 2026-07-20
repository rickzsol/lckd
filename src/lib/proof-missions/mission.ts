export const PROOF_MISSION_MINT = "7UTubJ3W6JWwLUj82B9LgHFDmc8wFWtSNLis6u8epump";
export const PROOF_MISSION_POINTS = 100;

export interface ProofMission {
  key: string;
  mintAddress: string;
  title: string;
  brief: string;
  requirements: string[];
  startsAt: string;
  endsAt: string;
  points: number;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getCurrentProofMission(now = new Date()): ProofMission {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);

  return {
    key: `lckd-owner-map-${dateKey(start)}`,
    mintAddress: PROOF_MISSION_MINT,
    title: "Map the visible owner set",
    brief: "Source-label the ten largest visible LCKD owner wallets and state what the evidence cannot prove.",
    requirements: [
      "Publish a wallet-by-wallet table with explorer or protocol sources.",
      "Include the snapshot time or finalized slot used for the analysis.",
      "Separate verified facts from labels that are inferred or still unknown.",
    ],
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    points: PROOF_MISSION_POINTS,
  };
}

export function isCurrentMissionKey(key: string, now = new Date()): boolean {
  return key === getCurrentProofMission(now).key;
}
