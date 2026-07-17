import assert from "node:assert/strict";
import test from "node:test";
import { getNextUnlock, getUpcomingUnlocks } from "./unlocksQuery";

// With no Supabase env configured, the query must report a DEGRADED read, not an
// empty "ok" board. An empty ok would render "nothing is unlocking", a false
// statement built from a failure (finding 11).
test("an unconfigured datastore yields a degraded result, not empty-ok", async (t) => {
  const saved = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  t.after(() => {
    if (saved.url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.key;
  });

  const result = await getUpcomingUnlocks();
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.rows, []);

  // The feed strip collapses a degraded read to null, never a positive value.
  assert.equal(await getNextUnlock(), null);
});
