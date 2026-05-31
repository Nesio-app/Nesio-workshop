import QRCode from "qrcode";
import { getMemorialBySlug, canView } from "@/lib/memorial-access";
import { getSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Params = { params: { slug: string } };

export async function GET(_request: Request, { params }: Params) {
  const memorial = await getMemorialBySlug(params.slug);
  if (!memorial) return jsonError("纪念馆不存在", 404);

  const user = await getSessionUser();
  if (!canView(memorial, user)) return jsonError("无权访问", 403);

  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "https://nianguichu.onrender.com";
  const url = `${base}/?memorial=${encodeURIComponent(params.slug)}`;

  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: 256,
    color: { dark: "#2c2416", light: "#faf8f4" },
  });

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
