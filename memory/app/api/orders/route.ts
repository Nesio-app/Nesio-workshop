import { z } from "zod";
import { prisma } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/api-response";
import { sanitizeText } from "@/lib/sanitize";
import { generateOrderNumber } from "@/lib/content-admin";
import {
  orderLinesToJson,
  orderLinesToText,
  orderLinesTotalCents,
  resolveOrderLineItems,
} from "@/lib/order-items";

export const dynamic = "force-dynamic";

const PAYMENT_METHODS = [
  "inquiry",
  "stripe",
  "alipay",
  "wechat",
  "bank",
] as const;

const itemSchema = z
  .object({
    slug: z.string().min(1).max(80),
    qty: z.number().int().positive().max(99),
    name: z.string().max(120).optional(),
  })
  .strict();

const schema = z.object({
  contactEmail: z.string().email(),
  contactName: z.string().min(1).max(80),
  contactPhone: z.string().min(6).max(20),
  shippingAddress: z.string().max(200).optional(),
  shippingCity: z.string().max(60).optional(),
  shippingProvince: z.string().max(60).optional(),
  shippingPostal: z.string().max(20).optional(),
  note: z.string().max(2000).optional(),
  memorialSlug: z.string().max(80).optional(),
  items: z.array(itemSchema).min(1),
  paymentMethod: z.enum(PAYMENT_METHODS).default("alipay"),
});

function paymentInstructions(method: string, orderNumber: string, totalYuan: number) {
  const alipayQr = process.env.PAYMENT_ALIPAY_QR_URL || "";
  const wechatQr = process.env.PAYMENT_WECHAT_QR_URL || "";
  const bankName = process.env.PAYMENT_BANK_NAME || "中国工商银行";
  const bankAccount = process.env.PAYMENT_BANK_ACCOUNT || "";
  const bankHolder = process.env.PAYMENT_BANK_HOLDER || "念归处科技有限公司";

  if (method === "alipay") {
    return {
      title: "支付宝支付",
      steps: [
        `打开支付宝，向收款码转账 ¥${totalYuan.toFixed(2)}`,
        `备注订单号：${orderNumber}`,
        "支付完成后客服将在 24 小时内为您开通/发货",
      ],
      qrUrl: alipayQr || null,
    };
  }
  if (method === "wechat") {
    return {
      title: "微信支付",
      steps: [
        `打开微信扫一扫，支付 ¥${totalYuan.toFixed(2)}`,
        `备注订单号：${orderNumber}`,
        "支付完成后客服将在 24 小时内为您开通/发货",
      ],
      qrUrl: wechatQr || null,
    };
  }
  if (method === "bank") {
    return {
      title: "银行转账",
      steps: [
        `开户行：${bankName}`,
        `户名：${bankHolder}`,
        bankAccount ? `账号：${bankAccount}` : "账号：请联系客服获取",
        `金额：¥${totalYuan.toFixed(2)}，附言：${orderNumber}`,
      ],
      qrUrl: null,
    };
  }
  return null;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("请完整填写联系信息", 400);

  const data = parsed.data;
  const resolved = await resolveOrderLineItems(
    data.items.map((i) => ({
      slug: i.slug,
      qty: i.qty,
      name: i.name,
    }))
  );
  if ("error" in resolved) return jsonError(resolved.error, 400);

  const lines = resolved.items;
  const totalCents = orderLinesTotalCents(lines);
  if (totalCents <= 0) {
    return jsonError("订单金额无效，请重新选择商品", 400);
  }

  const needsShipping = lines.some((l) => l.category !== "plan");
  if (
    needsShipping &&
    (!data.shippingAddress?.trim() ||
      !data.shippingCity?.trim() ||
      !data.shippingProvince?.trim())
  ) {
    return jsonError("实物商品请填写完整收货地址", 400);
  }

  const itemsText = orderLinesToText(lines);
  const itemsJson = orderLinesToJson(lines);
  const orderNumber = generateOrderNumber();
  const totalYuan = totalCents / 100;

  const shippingAddress = needsShipping
    ? sanitizeText(data.shippingAddress!, 200)
    : data.shippingAddress
      ? sanitizeText(data.shippingAddress, 200)
      : "数字服务 · 无需物流";
  const shippingCity = needsShipping
    ? sanitizeText(data.shippingCity!, 60)
    : data.shippingCity
      ? sanitizeText(data.shippingCity, 60)
      : "—";
  const shippingProvince = needsShipping
    ? sanitizeText(data.shippingProvince!, 60)
    : data.shippingProvince
      ? sanitizeText(data.shippingProvince, 60)
      : "—";

  if (data.paymentMethod === "stripe" && process.env.STRIPE_SECRET_KEY) {
    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
        "http://localhost:3000";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: data.contactEmail,
        payment_method_types: ["card", "alipay", "wechat_pay"],
        line_items: lines.map((i) => ({
          quantity: i.qty,
          price_data: {
            currency: "cny",
            unit_amount: i.priceCents,
            product_data: { name: i.name },
          },
        })),
        success_url: `${baseUrl}/?order=${orderNumber}&paid=1`,
        cancel_url: `${baseUrl}/?order=${orderNumber}&paid=0`,
        metadata: { orderNumber },
      });

      await prisma.orderInquiry.create({
        data: {
          orderNumber,
          contactEmail: data.contactEmail.toLowerCase(),
          contactName: sanitizeText(data.contactName, 80),
          contactPhone: sanitizeText(data.contactPhone, 20),
          shippingAddress,
          shippingCity,
          shippingProvince,
          shippingPostal: data.shippingPostal
            ? sanitizeText(data.shippingPostal, 20)
            : null,
          items: sanitizeText(itemsText, 2000),
          itemsJson: JSON.stringify(itemsJson),
          note: data.note ? sanitizeText(data.note, 2000) : null,
          memorialSlug: data.memorialSlug
            ? sanitizeText(data.memorialSlug, 80)
            : null,
          totalCents,
          status: "awaiting_payment",
          paymentMethod: "stripe",
          stripeSessionId: session.id,
        },
      });

      return jsonOk({
        orderNumber,
        total: totalYuan,
        checkoutUrl: session.url,
        paymentMethod: "stripe",
      });
    } catch (e) {
      console.error("Stripe checkout failed:", e);
      return jsonError("Stripe 支付暂不可用，请选用支付宝/微信/银行转账", 502);
    }
  }

  const method =
    data.paymentMethod === "inquiry" ? "alipay" : data.paymentMethod;

  await prisma.orderInquiry.create({
    data: {
      orderNumber,
      contactEmail: data.contactEmail.toLowerCase(),
      contactName: sanitizeText(data.contactName, 80),
      contactPhone: sanitizeText(data.contactPhone, 20),
      shippingAddress,
      shippingCity,
      shippingProvince,
      shippingPostal: data.shippingPostal
        ? sanitizeText(data.shippingPostal, 20)
        : null,
      items: sanitizeText(itemsText, 2000),
      itemsJson: JSON.stringify(itemsJson),
      note: data.note ? sanitizeText(data.note, 2000) : null,
      memorialSlug: data.memorialSlug
        ? sanitizeText(data.memorialSlug, 80)
        : null,
      totalCents,
      status: "awaiting_payment",
      paymentMethod: method,
    },
  });

  return jsonOk({
    orderNumber,
    total: totalYuan,
    paymentMethod: method,
    payment: paymentInstructions(method, orderNumber, totalYuan),
  });
}

export async function GET(request: Request) {
  const orderNumber = new URL(request.url).searchParams.get("orderNumber");
  if (!orderNumber) return jsonError("缺少订单号", 400);

  const order = await prisma.orderInquiry.findUnique({
    where: { orderNumber },
    select: {
      orderNumber: true,
      status: true,
      totalCents: true,
      paymentMethod: true,
      createdAt: true,
    },
  });
  if (!order) return jsonError("订单不存在", 404);

  return jsonOk({
    order: {
      ...order,
      total: order.totalCents / 100,
    },
  });
}
