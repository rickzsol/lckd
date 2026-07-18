import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { requireAuth } from "@/lib/api/auth";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getServerClient, hasServerSupabaseConfig } from "@/lib/supabase";

export { OPTIONS };

const applicationSchema = z.object({
  projectName: z.string().trim().min(2).max(64),
  ticker: z
    .string()
    .trim()
    .max(10)
    .regex(/^[A-Z0-9]*$/, "Ticker must be uppercase letters and numbers only")
    .nullable()
    .default(null),
  pitch: z.string().trim().min(1).max(500),
  repo: z
    .string()
    .trim()
    .max(200)
    .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, "Repository must be in owner/name format")
    .nullable()
    .default(null),
  buyAmountSol: z.number().finite().min(0.1).max(100),
  lockDurationDays: z.number().int().min(30).max(365),
  contact: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9_@.-]*$/, "Contact contains unsupported characters")
    .nullable()
    .default(null),
}).strict();

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = await checkRateLimit(request, "match");
  if (limited) return limited;

  const { session, error: authError } = await requireAuth();
  if (authError) return authError;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError("Invalid JSON", 400);
  }

  const parsed = applicationSchema.safeParse(raw);
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  const body = parsed.data;

  if (body.repo) {
    const [owner] = body.repo.split("/");
    if (owner.toLowerCase() !== session.github_username.toLowerCase()) {
      return apiError("Repository owner must match your GitHub account", 403);
    }
  }

  if (!hasServerSupabaseConfig()) {
    return apiError("Applications are temporarily unavailable", 503);
  }

  try {
    const { error } = await getServerClient().from("match_applications").insert({
      github_id: session.github_id,
      github_username: session.github_username,
      project_name: body.projectName,
      ticker: body.ticker || null,
      pitch: body.pitch,
      repo: body.repo,
      buy_amount_sol: body.buyAmountSol,
      lock_duration_days: body.lockDurationDays,
      contact: body.contact || null,
    });

    if (error) {
      console.error("[match/apply] Insert failed:", error.message);
      return apiError("Applications are temporarily unavailable", 503);
    }
  } catch (error) {
    console.error("[match/apply] Unexpected failure:", error instanceof Error ? error.message : error);
    return apiError("Applications are temporarily unavailable", 503);
  }

  return apiResponse({ success: true }, 201);
}
