import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _anonClient: SupabaseClient | null = null;
let _serverClient: SupabaseClient | null = null;

/** Anon key client — respects RLS. Use for public reads. */
export function getSupabase(): SupabaseClient {
  if (!_anonClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    _anonClient = createClient(url, key);
  }
  return _anonClient;
}

/** Service role client — bypasses RLS. Use only for authenticated writes. */
export function getServerClient(): SupabaseClient {
  if (!_serverClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    _serverClient = createClient(url, key);
  }
  return _serverClient;
}

/** @deprecated Use getServerClient() instead */
export const createServerClient = getServerClient;

export function hasSupabaseConfig(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
