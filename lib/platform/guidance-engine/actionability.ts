/**
 * Actionability — hard gate before a card is generated
 *
 * Rule: the user must be able to complete the first step within 1 minute
 * of seeing this card. If no such step exists, return null — the card is
 * dropped regardless of how important the underlying event is.
 *
 * "Correct but not actionable" is still noise.
 *
 * 批次 9:文案 L(locale, zh, en) 双语 — 中文字面保留(契约断言不受影响),
 * 英文界面下卡片动作同样出英文。
 */

import { L } from '@/lib/portal/i18n';
import type { GuidanceEvent, WindowUrgency, GuidanceAction } from './types';

export function buildAction(event: GuidanceEvent, urgency: WindowUrgency, locale: string = 'zh'): GuidanceAction | null {
  const l = (zh: string, en: string) => L(locale, zh, en);
  switch (event.type) {
    case 'dec_insight': {
      // DEC cards ship their own one-step CTA (PRD: primaryAction).
      const cta = typeof event.payload.primaryAction === 'string' && event.payload.primaryAction
        ? event.payload.primaryAction
        : l('知道了', 'Got it');
      return { label: cta, cta, actionType: 'dismiss' };
    }

    case 'domain_insight': {
      // warm-coach:不制造焦虑、不给任务式按钮、始终可跳过。域相关软提示文案由适配器写在 payload(知识随域走)。
      const label = l(String(event.payload.ctaLabelZh ?? '了解这条来自你数据的观察。'), String(event.payload.ctaLabelEn ?? 'A gentle observation from your own data.'));
      return { label, cta: l('知道了', 'Got it'), actionType: 'dismiss' };
    }

    case 'flight':
      if (urgency === 'critical') return { label: l('现在需要出发前往机场', 'Time to leave for the airport'), cta: l('知道了', 'Got it'), actionType: 'dismiss' };
      if (urgency === 'high')     return { label: l('用航空公司 App 完成在线值机（约 1 分钟）', 'Check in online with the airline app (about 1 min)'), cta: l('去值机', 'Check in'), actionType: 'dismiss' };
      if (urgency === 'low')      return { label: l('提前确认航班号和航站楼', 'Confirm the flight number and terminal ahead of time'), cta: l('记住了', 'Noted'), actionType: 'dismiss' };
      return null;

    case 'travel':
      if (urgency === 'critical') return { label: l('立刻出发，检查随身物品', 'Leave now — check your essentials'), cta: l('出发', 'Go'), actionType: 'dismiss' };
      if (urgency === 'high')     return { label: l('确认行李是否打包完毕', 'Confirm your bags are packed'), cta: l('已确认', 'Confirmed'), actionType: 'dismiss' };
      if (urgency === 'medium')   return { label: l('把最重要的物品加入行李清单', 'Add the most important items to your packing list'), cta: l('好的', 'OK'), actionType: 'dismiss' };
      return null;

    case 'medical':
      if (urgency === 'critical') return { label: l('立刻出发，带好就诊卡和证件', 'Leave now — bring your medical card and ID'), cta: l('出发', 'Go'), actionType: 'dismiss' };
      if (urgency === 'high')     return { label: l('确认预约时间和诊室地址', 'Confirm the appointment time and clinic address'), cta: l('已确认', 'Confirmed'), actionType: 'dismiss' };
      if (urgency === 'medium')   return { label: l('今天提前确认预约信息', 'Confirm the appointment details today'), cta: l('好的', 'OK'), actionType: 'dismiss' };
      if (urgency === 'low')      return { label: l('明天有预约，提前安排好时间', 'Appointment tomorrow — plan your time'), cta: l('记住了', 'Noted'), actionType: 'dismiss' };
      return null;

    case 'meeting':
      if (urgency === 'critical') return { label: l('立即加入会议或前往会议室', 'Join the meeting or head to the room now'), cta: l('进入', 'Join'), actionType: 'dismiss' };
      if (urgency === 'high')     return { label: l('找好会议链接，准备好要说的内容', 'Get the meeting link and your talking points ready'), cta: l('准备好了', 'Ready'), actionType: 'dismiss' };
      if (urgency === 'medium')   return { label: l('确认会议时间和地点', 'Confirm the meeting time and place'), cta: l('已确认', 'Confirmed'), actionType: 'dismiss' };
      if (urgency === 'low')      return { label: l('明天有会议，今晚可以提前想想', 'Meeting tomorrow — worth a thought tonight'), cta: l('知道了', 'Got it'), actionType: 'dismiss' };
      return null;

    case 'holiday':
      // 节日永远不是任务:轻确认即可,把「安排活动」的主动权留给用户
      return { label: l('想安排点什么，随口说一句就记下', 'Want to plan something? Just say it and it sticks'), cta: l('知道了', 'Got it'), actionType: 'dismiss' };

    case 'deadline':
      if (urgency === 'critical') return { label: l('现在打开任务，完成第一步', 'Open the task now and do the first step'), cta: l('开始', 'Start'), actionType: 'dismiss' };
      if (urgency === 'high')     return { label: l('今天必须推进，先做最小的那一步', 'Move it today — start with the smallest step'), cta: l('开始做', 'Start'), actionType: 'dismiss' };
      if (urgency === 'medium')   return { label: l('明天截止，今天做好准备', 'Due tomorrow — prepare today'), cta: l('知道了', 'Got it'), actionType: 'dismiss' };
      return null;

    case 'expiry':
      // 批次 65:物品过期不是任务 —— 口吻是「用掉/处理」,不是催办
      if (urgency === 'critical') return { label: l('今天把它用掉，或者直接处理掉', 'Use it up today, or just deal with it'), cta: l('处理了', 'Done'), actionType: 'dismiss' };
      if (urgency === 'high')     return { label: l('明天过期，今天优先用它', 'Expires tomorrow — use it first today'), cta: l('知道了', 'Got it'), actionType: 'dismiss' };
      return { label: l('快过期了，安排着用', 'Expiring soon — plan to use it'), cta: l('知道了', 'Got it'), actionType: 'dismiss' };

    case 'birthday':
    case 'anniversary': {
      const name = event.title.slice(0, 16);
      if (urgency === 'critical') return { label: l(`今天是 ${name}，发一条祝福消息`, `Today is ${name} — send a message`), cta: l('发消息', 'Message'), actionType: 'dismiss' };
      if (urgency === 'high')     return { label: l(`明天是 ${name}，今晚准备一下`, `Tomorrow is ${name} — prep tonight`), cta: l('提醒我', 'Remind me'), actionType: 'snooze' };
      if (urgency === 'medium')   return { label: l('还有几天，现在可以选好礼物或安排', 'A few days out — pick a gift or make plans now'), cta: l('去准备', 'Prepare'), actionType: 'dismiss' };
      if (urgency === 'low')      return { label: l('这周内，提前安排好时间', 'This week — set aside some time'), cta: l('记住了', 'Noted'), actionType: 'dismiss' };
      return null;
    }

    case 'weather_cold':
      return { label: l('出门前把厚外套放到门口', 'Put a warm coat by the door before you leave'), cta: l('知道了', 'Got it'), actionType: 'dismiss' };

    case 'weather_rain':
      return { label: l('出门前把雨伞放进包里', 'Put an umbrella in your bag before you leave'), cta: l('知道了', 'Got it'), actionType: 'dismiss' };

    case 'email_signal': {
      const emailType = String(event.payload.emailType ?? '');
      if (emailType === 'flight')      return { label: l('查看机票确认邮件，记下航班号和时间', 'Check the flight confirmation — note the flight number and time'), cta: l('知道了', 'Got it'), actionType: 'dismiss' };
      if (emailType === 'hotel')       return { label: l('确认入住时间和地址', 'Confirm check-in time and address'), cta: l('查看', 'View'), actionType: 'dismiss' };
      if (emailType === 'appointment') return { label: l('确认预约时间，加入日历', 'Confirm the appointment and add to calendar'), cta: l('加入日历', 'Add'), actionType: 'dismiss' };
      if (emailType === 'deadline')    return { label: l('查看截止日期，决定是否今天行动', 'Check the deadline and decide whether to act today'), cta: l('查看', 'View'), actionType: 'dismiss' };
      if (emailType === 'bill')        return { label: l('看一眼账单金额，确认是否需要付款', 'Glance at the bill and confirm if payment is due'), cta: l('查看', 'View'), actionType: 'dismiss' };
      if (emailType === 'package')     return { label: l('查看快递状态', 'Check the package status'), cta: l('查看', 'View'), actionType: 'dismiss' };
      // verification/reminder: low signal, not reliably actionable
      return null;
    }

    case 'health_habit': {
      const item = String(event.payload.itemName ?? l('今天的健康计划', "today's health plan"));
      return { label: l(`${item} — 现在花 1 分钟开始`, `${item} — take 1 minute to start now`), cta: l('打卡', 'Check in'), actionType: 'done' };
    }

    case 'object_context': {
      const item = String(event.payload.itemName ?? l('这件东西', 'this item'));
      const loc = String(event.payload.location ?? '');
      if (event.payload.expiryDate) {
        return { label: l(`处理 ${item}${loc ? `（${loc}）` : ''}`, `Deal with ${item}${loc ? ` (${loc})` : ''}`), cta: l('知道了', 'Got it'), actionType: 'dismiss' };
      }
      return { label: l(`确认 ${item} 是否需要用${loc ? `（${loc}）` : ''}`, `Check whether you need ${item}${loc ? ` (${loc})` : ''}`), cta: l('知道了', 'Got it'), actionType: 'dismiss' };
    }

    case 'renewal': {
      const isWarranty = /warranty|保修/.test(String(event.payload.subtype ?? ''));
      if (isWarranty) return { label: l('趁还在保先送修', 'Service it while under warranty'), cta: l('知道了', 'Got it'), actionType: 'dismiss' };
      return { label: l('预约续办证件', 'Book the document renewal'), cta: l('知道了', 'Got it'), actionType: 'dismiss' };
    }

    default:
      return null;
  }
}
