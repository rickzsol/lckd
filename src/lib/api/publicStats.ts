import { z } from "zod";

const databaseNumberSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
  z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
);

const publicStatsRowSchema = z.object({
  launched: databaseNumberSchema.pipe(z.number().int()),
  total_locked_tokens: databaseNumberSchema,
  devs_verified: databaseNumberSchema.pipe(z.number().int()),
  building_now: databaseNumberSchema.pipe(z.number().int()),
  as_of: z.string().datetime({ offset: true }),
});

export const unavailablePublicStats = {
  launched: null,
  totalLockedTokens: null,
  devsVerified: null,
  buildingNow: null,
  asOf: null,
  available: false as const,
};

export function parsePublicStats(value: unknown) {
  const row = publicStatsRowSchema.parse(value);

  return {
    launched: row.launched,
    totalLockedTokens: row.total_locked_tokens,
    devsVerified: row.devs_verified,
    buildingNow: row.building_now,
    asOf: row.as_of,
    available: true as const,
  };
}
