import { api, getConfig } from "../../../lib/sparelink/server";
export const dynamic = "force-dynamic";
export async function GET() { return api(getConfig); }
