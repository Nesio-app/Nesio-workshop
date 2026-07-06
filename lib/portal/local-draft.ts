/**
 * local-draft — 纯本地邮件起草兜底(批次 56)。
 *
 * AI 不在线时用它。不假装替你写好整封信,只做一件确定有用的事:
 * 把你已经写下的「想说的意图」套进一个得体的骨架 —— 称呼 + 你的话 + 落款,
 * 让你有一个能直接改的初稿,而不是对着空白框卡住。
 * 语气(客气/简洁/温暖/婉拒/跟进)只改开头和结尾那一两句,正文永远是你自己的话。
 */

export type DraftTone = 'polite' | 'concise' | 'warm' | 'decline' | 'followup';

/** 从 "Name <email@x.com>" 里取一个用来称呼的名字(取不到就空)。 */
function greetName(from: string): string {
  const raw = (from || '').trim();
  const namePart = raw.replace(/<[^>]*>/, '').replace(/^["']|["']$/g, '').trim();
  if (namePart) return namePart.split(/\s+/)[0];
  const m = raw.match(/<([^>]+)>/);
  return m ? m[1].split('@')[0] : '';
}

function opener(tone: DraftTone | '', name: string, zh: boolean): string {
  const who = name || (zh ? '你好' : 'there');
  if (zh) {
    switch (tone) {
      case 'warm': return `${name ? name + ',' : ''}好久没联系,`;
      case 'decline': return `${name ? name + ',' : '你好,'}谢谢你想到我,`;
      case 'followup': return `${name ? name + ',' : '你好,'}想跟你确认一下,`;
      case 'concise': return `${name ? name + ',' : '你好,'}`;
      default: return `${name ? name : '你'}好,`;
    }
  }
  switch (tone) {
    case 'warm': return `Hi ${who}, it's been a while —`;
    case 'decline': return `Hi ${who}, thank you for thinking of me —`;
    case 'followup': return `Hi ${who}, just following up —`;
    case 'concise': return `Hi ${who},`;
    default: return `Hi ${who},`;
  }
}

function closer(tone: DraftTone | '', zh: boolean): string {
  if (zh) {
    switch (tone) {
      case 'decline': return '这次先不参与了,还是谢谢你,后面有机会再聊。';
      case 'followup': return '方便的话回我一句就好,谢谢。';
      case 'warm': return '有空一起坐坐,盼回音。';
      case 'concise': return '谢谢。';
      default: return '麻烦你了,期待回复。';
    }
  }
  switch (tone) {
    case 'decline': return "I'll pass this time, but thank you — let's find another chance.";
    case 'followup': return 'A quick reply whenever you get a moment would be great. Thanks.';
    case 'warm': return "Would love to catch up soon. Talk soon.";
    case 'concise': return 'Thanks.';
    default: return 'Thanks in advance — looking forward to your reply.';
  }
}

/**
 * 本地拼一个能直接改的初稿。intent 是用户自己写的「我想说什么」,原样放进正文。
 * 没写 intent 就给一句占位提示,提醒用户填一句核心的话。
 */
export function draftLocally(opts: {
  from?: string;
  intent?: string;
  tone?: DraftTone | '';
  userName?: string;
  locale?: string;
}): string {
  const zh = (opts.locale || 'zh') !== 'en';
  const name = greetName(opts.from || '');
  const intent = (opts.intent || '').trim();
  const bodyLine = intent || (zh ? '(在这里写下你想说的核心一句)' : '(Write the one thing you want to say here)');
  const sign = (opts.userName || '').trim();
  const signLine = zh ? (sign ? `${sign}` : '此致') : (sign ? `Best,\n${sign}` : 'Best');
  return [opener(opts.tone || '', name, zh), '', bodyLine, '', closer(opts.tone || '', zh), '', signLine].join('\n');
}
