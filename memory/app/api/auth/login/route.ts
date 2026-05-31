import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSessionToken, setSessionCookie, verifyPassword } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-response";

const schema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("登录信息无效", 400);

  const login = parsed.data.email.trim();
  const isPhone = /^1\d{10}$/.test(login.replace(/\s/g, ""));
  const email = isPhone
    ? `phone_${login.replace(/\s/g, "")}@nianguichu.local`
    : login.toLowerCase();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return jsonError("账号或密码错误", 401);

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) return jsonError("账号或密码错误", 401);

  const token = await createSessionToken({
    id: user.id,
    email: user.email,
    name: user.name,
  });
  await setSessionCookie(token);

  return jsonOk({ user: { id: user.id, email: user.email, name: user.name } });
}
