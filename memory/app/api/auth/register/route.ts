import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  createSessionToken,
  hashPassword,
  setSessionCookie,
  slugify,
} from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api-response";
import { sanitizeShort, sanitizeText } from "@/lib/sanitize";
import { verifyCode } from "@/lib/verify-code";

const schema = z
  .object({
    channel: z.enum(["email", "phone"]).default("email"),
    email: z.string().email().max(254).optional(),
    phone: z.string().max(20).optional(),
    code: z.string().length(6),
    password: z.string().min(8).max(128),
    name: z.string().max(80).optional(),
    memorial: z
      .object({
        name: z.string().min(1).max(80),
        birthDate: z.string().optional(),
        deathDate: z.string().min(1),
        motto: z.string().max(200).optional(),
        privacy: z.enum(["private", "family", "public"]).default("family"),
        quietMode: z.boolean().default(true),
      })
      .optional(),
  })
  .refine((d) => d.email || d.phone, {
    message: "请提供邮箱或手机号",
  });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("注册信息无效", 400);

  const data = parsed.data;
  const channel = data.channel;
  let email = data.email?.toLowerCase().trim() || "";
  let phone = data.phone?.replace(/\s/g, "") || "";

  if (channel === "phone") {
    if (!/^1\d{10}$/.test(phone)) {
      return jsonError("请输入11位手机号", 400);
    }
    if (!verifyCode("phone", phone, data.code)) {
      return jsonError("验证码错误或已过期", 400);
    }
    email = `phone_${phone}@nianguichu.local`;
  } else {
    if (!email) return jsonError("请填写邮箱", 400);
    if (!verifyCode("email", email, data.code)) {
      return jsonError("验证码错误或已过期", 400);
    }
  }

  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) return jsonError("该账号已注册", 409);

  if (phone) {
    const existingPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingPhone) return jsonError("该手机号已注册", 409);
  }

  const passwordHash = await hashPassword(data.password);
  const user = await prisma.user.create({
    data: {
      email,
      phone: phone || null,
      passwordHash,
      name: data.name ? sanitizeShort(data.name) : null,
    },
  });

  let memorialSlug: string | null = null;
  if (data.memorial) {
    const m = data.memorial;
    const slug = slugify(sanitizeText(m.name, 40));
    const memorial = await prisma.memorial.create({
      data: {
        slug,
        ownerId: user.id,
        name: sanitizeText(m.name, 80),
        birthDate: m.birthDate ? new Date(m.birthDate) : null,
        deathDate: new Date(m.deathDate),
        motto: m.motto ? sanitizeText(m.motto, 200) : null,
        privacy: m.privacy,
        quietMode: m.quietMode,
        members: {
          create: { email: user.email, role: "owner" },
        },
      },
    });
    memorialSlug = memorial.slug;
  }

  const token = await createSessionToken({
    id: user.id,
    email: user.email,
    name: user.name,
  });
  await setSessionCookie(token);

  return jsonOk({
    user: {
      id: user.id,
      email: channel === "phone" ? phone : user.email,
      name: user.name,
      phone: user.phone,
    },
    memorialSlug,
  });
}
