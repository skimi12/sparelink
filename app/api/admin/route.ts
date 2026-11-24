import { api, getAdmin } from "../../../lib/sparelink/server";
export const dynamic = "force-dynamic";
export async function GET() { return api(getAdmin); }
