import { api, moderateRecord } from "../../../../../lib/sparelink/server";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return api(async () => moderateRecord(request, (await context.params).id)); }
