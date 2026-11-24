import { api, createRecord } from "../../../lib/sparelink/server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return api(() => createRecord(request, "listing")); }
