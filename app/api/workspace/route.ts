import { api, getWorkspace } from "../../../lib/sparelink/server";
export const dynamic = "force-dynamic";
export async function GET() { return api(getWorkspace); }
