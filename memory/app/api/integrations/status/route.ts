import { composioConfigured } from "@/lib/composio";
import { jsonOk } from "@/lib/api-response";

export async function GET() {
  return jsonOk({
    composio: composioConfigured(),
    cron: Boolean(process.env.CRON_SECRET),
    database: Boolean(process.env.DATABASE_URL),
    stripeEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
    payments: {
      alipayQr: process.env.PAYMENT_ALIPAY_QR_URL || null,
      wechatQr: process.env.PAYMENT_WECHAT_QR_URL || null,
      bankName: process.env.PAYMENT_BANK_NAME || null,
      bankAccount: process.env.PAYMENT_BANK_ACCOUNT || null,
      bankHolder: process.env.PAYMENT_BANK_HOLDER || null,
    },
    storageEnabled: Boolean(
      process.env.S3_BUCKET &&
        process.env.S3_ACCESS_KEY_ID &&
        process.env.S3_SECRET_ACCESS_KEY &&
        process.env.S3_PUBLIC_URL
    ),
    wechatLoginEnabled: Boolean(
      process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET
    ),
  });
}
