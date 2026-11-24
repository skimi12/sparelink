import { api, getRecord, updateRecord } from "../../../../lib/sparelink/server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) { return api(async () => getRecord((await context.params).id, "request")); }
export async function PATCH(request: Request, context: Context) { return api(async () => updateRecord(request, (await context.params).id, "request")); }
