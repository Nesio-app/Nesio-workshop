import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api-response";
import { generateCode, saveCode } from "@/lib/verify-code";

export const dynamic = "force-dynamic";

const schema = z.object({
  channel: z.enum(["email", "phone"]),
  target: z.string().min(3).max(254),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("请填写有效的邮箱或手机号", 400);

  const { channel, target } = parsed.data;
  const normalized =
    channel === "email" ? target.toLowerCase().trim() : target.replace(/\s/g, "");

  if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return jsonError("邮箱格式不正确", 400);
  }
  if (channel === "phone" && !/^1\d{10}$/.test(normalized)) {
    return jsonError("请输入11位中国大陆手机号", 400);
  }

  const code = generateCode();
  saveCode(channel, normalized, code);

  if (process.env.NODE_ENV !== "production") {
    console.info(`[verify-code] ${channel} ${normalized} => ${code}`);
  }

  const devHint =
    process.env.NODE_ENV !== "production"
      ? `（开发环境验证码：${code}）`
      : "";

  return jsonOk({
    message: `验证码已发送${devHint}`,
    expiresIn: 600,
  });
}
