import assert from "node:assert/strict";
import test from "node:test";
import { buildLeaderboard } from "./data.server";
import { getCurrentProofMission, isCurrentMissionKey } from "./mission";
import { hasReviewerQuorum, isEligibleReviewer, proofSubmissionSchema } from "./validation";

test("weekly mission uses the UTC Monday boundary", () => {
  const mission = getCurrentProofMission(new Date("2026-07-26T23:59:59Z"));
  assert.equal(mission.key, "lckd-owner-map-2026-07-20");
  assert.equal(mission.endsAt, "2026-07-27T00:00:00.000Z");
  assert.equal(isCurrentMissionKey(mission.key, new Date("2026-07-26T23:59:59Z")), true);
  assert.equal(isCurrentMissionKey(mission.key, new Date("2026-07-27T00:00:00Z")), false);
});

test("submission validation requires a public HTTPS URL and useful note", () => {
  const valid = proofSubmissionSchema.safeParse({
    missionKey: "lckd-owner-map-2026-07-20",
    evidenceUrl: "https://github.com/example/research/issues/1",
    evidenceNote: "Labels are sourced per wallet and unknown owners remain explicitly unknown.",
  });
  assert.equal(valid.success, true);
  assert.equal(proofSubmissionSchema.safeParse({
    missionKey: "x", evidenceUrl: "http://example.com", evidenceNote: "short",
  }).success, false);
});

test("reviewers are selected only by exact numeric GitHub ID", () => {
  assert.equal(isEligibleReviewer("123", "123, 456"), true);
  assert.equal(isEligibleReviewer("12", "123, 456"), false);
  assert.equal(isEligibleReviewer("admin", "admin,123"), false);
  assert.equal(hasReviewerQuorum("123, 456"), true);
  assert.equal(hasReviewerQuorum("123,123,invalid"), false);
});

test("leaderboard ranks accepted proof counts and awards fixed points", () => {
  const base = {
    id: "1", contributor_github_id: "1", evidence_url: "https://example.com",
    evidence_note: "evidence", status: "accepted" as const, created_at: "2026-07-20T00:00:00Z", reviewed_at: null,
  };
  const board = buildLeaderboard([
    { ...base, contributor_github_username: "beta" },
    { ...base, id: "2", contributor_github_username: "alpha" },
    { ...base, id: "3", contributor_github_username: "alpha" },
  ]);
  assert.deepEqual(board.map(({ contributor, points }) => ({ contributor, points })), [
    { contributor: "alpha", points: 200 },
    { contributor: "beta", points: 100 },
  ]);
});
