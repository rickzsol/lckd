import { apiResponse, OPTIONS } from "@/lib/api/helpers";
import { getBurnLedger } from "@/lib/burnLedger";

export const revalidate = 300;

export { OPTIONS };

export async function GET() {
  return apiResponse(await getBurnLedger());
}
