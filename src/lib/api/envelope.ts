import { TRUST_POLICY_VERSION } from "@/lib/trust/projection";

/** Every public trust response is wrapped so consumers can pin provenance and
 * detect staleness. `source` is the canonical LCKD URL for the resource. */
export interface Envelope<T> {
  asOf: string;
  source: string;
  stale: boolean;
  policyVersion: number;
  data: T;
}

export function envelope<T>(
  data: T,
  opts: { source: string; asOf?: string; stale?: boolean },
): Envelope<T> {
  return {
    asOf: opts.asOf ?? new Date().toISOString(),
    source: opts.source,
    stale: opts.stale ?? false,
    policyVersion: TRUST_POLICY_VERSION,
    data,
  };
}

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lckd.tech";

export function tokenSource(mint: string): string {
  return `${SITE_ORIGIN}/token/${mint}`;
}

export function unlocksSource(): string {
  return `${SITE_ORIGIN}/unlocks`;
}
