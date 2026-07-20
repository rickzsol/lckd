import assert from "node:assert/strict";
import test from "node:test";
import { unavailablePublicStats } from "@/lib/api/publicStats";

test("stats route returns unavailable values when Supabase is unconfigured", async () => {
  const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const priorKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  try {
    const { GET } = await import("./route");
    const response = await GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), unavailablePublicStats);
  } finally {
    if (priorUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = priorUrl;
    if (priorKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = priorKey;
  }
});
