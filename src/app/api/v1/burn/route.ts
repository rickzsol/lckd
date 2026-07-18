import { apiResponse, OPTIONS } from "@/lib/api/helpers";
import { getBurnLedger } from "@/lib/burnLedger";

export const dynamic = "force-dynamic";

export { OPTIONS };

export async function GET() {
  return apiResponse(await getBurnLedger());
}
