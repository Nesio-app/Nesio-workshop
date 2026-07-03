/**
 * Actionability — hard gate before a card is generated
 *
 * Rule: the user must be able to complete the first step within 1 minute
 * of seeing this card. If no such step exists, return null — the card is
 * dropped regardless of how important the underlying event is.
 *
 * "Correct but not actionable" is still noise.
 */

import type { GuidanceEvent, WindowUrgency, GuidanceAction } from './types';

export function buildAction(event: GuidanceEvent, urgency: WindowUrgency): GuidanceAction | null {
  switch (event.type) {
    case 'flight':
      if (urgency === 'critical') return { label: '现在需要出发前往机场', cta: '知道了', actionType: 'dismiss' };
      if (urgency === 'high')     return { label: '用航空公司 App 完成在线值机（约 1 分钟）', cta: '去值机', actionType: 'dismiss' };
      if (urgency === 'low')      return { label: '提前确认航班号和航站楼', cta: '记住了', actionType: 'dismiss' };
      return null;

    case 'travel':
      if (urgency === 'critical') return { label: '立刻出发，检查随身物品', cta: '出发', actionType: 'dismiss' };
      if (urgency === 'high')     return { label: '确认行李是否打包完毕', cta: '已确认', actionType: 'dismiss' };
      if (urgency === 'medium')   return { label: '把最重要的物品加入行李清单', cta: '好的', actionType: 'dismiss' };
      return null;

    case 'medical':
      if (urgency === 'critical') return { label: '立刻出发，带好就诊卡和证件', cta: '出发', actionType: 'dismiss' };
      if (urgency === 'high')     return { label: '确认预约时间和诊室地址', cta: '已确认', actionType: 'dismiss' };
      if (urgency === 'medium')   return { label: '今天提前确认预约信息', cta: '好的', actionType: 'dismiss' };
      if (urgency === 'low')      return { label: '明天有预约，提前安排好时间', cta: '记住了', actionType: 'dismiss' };
      return null;

    case 'meeting':
      if (urgency === 'critical') return { label: '立即加入会议或前往会议室', cta: '进入', actionType: 'dismiss' };
      if (urgency === 'high')     return { label: '找好会议链接，准备好要说的内容', cta: '准备好了', actionType: 'dismiss' };
      if (urgency === 'medium')   return { label: '确认会议时间和地点', cta: '已确认', actionType: 'dismiss' };
      if (urgency === 'low')      return { label: '明天有会议，今晚可以提前想想', cta: '知道了', actionType: 'dismiss' };
      return null;

    case 'deadline':
      if (urgency === 'critical') return { label: '现在打开任务，完成第一步', cta: '开始', actionType: 'dismiss' };
      if (urgency === 'high')     return { label: '今天必须推进，先做最小的那一步', cta: '开始做', actionType: 'dismiss' };
      if (urgency === 'medium')   return { label: '明天截止，今天做好准备', cta: '知道了', actionType: 'dismiss' };
      return null;

    case 'birthday':
    case 'anniversary': {
      const name = event.title.slice(0, 16);
      if (urgency === 'critical') return { label: `今天是 ${name}，发一条祝福消息`, cta: '发消息', actionType: 'dismiss' };
      if (urgency === 'high')     return { label: `明天是 ${name}，今晚准备一下`, cta: '提醒我', actionType: 'snooze' };
      if (urgency === 'medium')   return { label: '还有几天，现在可以选好礼物或安排', cta: '去准备', actionType: 'dismiss' };
      if (urgency === 'low')      return { label: '这周内，提前安排好时间', cta: '记住了', actionType: 'dismiss' };
      return null;
    }

    case 'weather_cold':
      return { label: '出门前把厚外套放到门口', cta: '知道了', actionType: 'dismiss' };

    case 'weather_rain':
      return { label: '出门前把雨伞放进包里', cta: '知道了', actionType: 'dismiss' };

    case 'email_signal': {
      const emailType = String(event.payload.emailType ?? '');
      if (emailType === 'flight')      return { label: '查看机票确认邮件，记下航班号和时间', cta: '知道了', actionType: 'dismiss' };
      if (emailType === 'hotel')       return { label: '确认入住时间和地址', cta: '查看', actionType: 'dismiss' };
      if (emailType === 'appointment') return { label: '确认预约时间，加入日历', cta: '加入日历', actionType: 'dismiss' };
      if (emailType === 'deadline')    return { label: '查看截止日期，决定是否今天行动', cta: '查看', actionType: 'dismiss' };
      if (emailType === 'bill')        return { label: '看一眼账单金额，确认是否需要付款', cta: '查看', actionType: 'dismiss' };
      if (emailType === 'package')     return { label: '查看快递状态', cta: '查看', actionType: 'dismiss' };
      // verification/reminder: low signal, not reliably actionable
      return null;
    }

    case 'health_habit': {
      const item = String(event.payload.itemName ?? '今天的健康计划');
      return { label: `${item} — 现在花 1 分钟开始`, cta: '打卡', actionType: 'done' };
    }

    case 'object_context': {
      const item = String(event.payload.itemName ?? '这件东西');
      const loc = String(event.payload.location ?? '');
      if (event.payload.expiryDate) {
        return { label: `处理 ${item}${loc ? `（${loc}）` : ''}`, cta: '知道了', actionType: 'dismiss' };
      }
      return { label: `确认 ${item} 是否需要用${loc ? `（${loc}）` : ''}`, cta: '知道了', actionType: 'dismiss' };
    }

    default:
      return null;
  }
}
