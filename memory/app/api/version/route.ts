import { jsonOk } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET() {
  return jsonOk({
    version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || "local",
    build: process.env.RENDER_GIT_COMMIT || null,
    service: "nianguichu",
  });
}
