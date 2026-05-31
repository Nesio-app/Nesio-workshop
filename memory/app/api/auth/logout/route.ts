import { clearSessionCookie } from "@/lib/auth";
import { jsonOk } from "@/lib/api-response";

export async function POST() {
  await clearSessionCookie();
  return jsonOk({ loggedOut: true });
}
