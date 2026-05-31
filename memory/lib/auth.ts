import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

const COOKIE = "memorial_session";
const MAX_AGE = 60 * 60 * 24 * 14;

function secretKey() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error("AUTH_SECRET must be set (min 16 chars)");
  }
  return new TextEncoder().encode(s);
}

export type SessionUser = { id: string; email: string; name: string | null };

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(user: SessionUser) {
  return new SignJWT({ sub: user.id, email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());
}

export async function setSessionCookie(token: string) {
  const crossOrigin = process.env.ALLOW_CROSS_ORIGIN === "true";
  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: crossOrigin ? "none" : "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  cookies().set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const id = payload.sub;
    if (!id || typeof id !== "string") return null;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return null;
    return { id: user.id, email: user.email, name: user.name };
  } catch {
    return null;
  }
}

export function slugify(name: string): string {
  const base =
    "m_" +
    Date.now().toString(36) +
    "_" +
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\u4e00-\u9fff-]/g, "")
      .slice(0, 24);
  return base || `m_${Date.now().toString(36)}`;
}
