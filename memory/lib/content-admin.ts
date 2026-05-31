import { SessionUser } from "@/lib/auth";

export function canManageContent(user: SessionUser | null) {
  if (!user) return false;
  const admins = (process.env.CONTENT_ADMIN_EMAILS || "demo@nianguichu.local")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(user.email.toLowerCase());
}

export function generateOrderNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `NG${y}${m}${day}-${rand}`;
}
