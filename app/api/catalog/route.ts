import { api, getCatalog } from "../../../lib/sparelink/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return api(() => getCatalog(request)); }
