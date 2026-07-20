import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrationDirectory = new URL("../../../supabase/migrations/", import.meta.url);
const migrationName = readdirSync(migrationDirectory).find((name) => name.endsWith("_proof_missions.sql"));
const sql = migrationName ? readFileSync(new URL(migrationName, migrationDirectory), "utf8") : "";

test("proof mission migration keeps both tables private", () => {
  assert.match(sql, /alter table public\.proof_submissions enable row level security/);
  assert.match(sql, /alter table public\.proof_reviews enable row level security/);
  assert.match(sql, /revoke all on public\.proof_submissions from anon, authenticated/);
  assert.match(sql, /revoke all on public\.proof_reviews from anon, authenticated/);
});

test("proof review invariants are enforced in the database", () => {
  assert.match(sql, /unique \(submission_id, reviewer_github_id\)/);
  assert.match(sql, /submission_contributor_id = new\.reviewer_github_id/);
  assert.match(sql, /for update/);
  assert.match(sql, /approval_count >= 2/);
});
