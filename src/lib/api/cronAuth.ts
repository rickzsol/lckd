import { timingSafeEqual } from "node:crypto";

/** Constant-time CRON_SECRET bearer check, shared by all cron routes. Fails
 * closed when the secret is unset. */
export function isValidCronSecret(authorization: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  const received = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  if (!received || !expected) return false;

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(received);
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
