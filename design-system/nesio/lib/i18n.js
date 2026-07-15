/* ───────────────────────────────────────────────────────────
   Nesio · 宝盒 — multilingual strings
   Languages: zh (简体中文) · en · ja (日本語) · ko (한국어)
   Usage:  import { t } from './i18n.js';  t('zh', 'shellBrand')
   The shell's source of truth currently ships zh + en; ja/ko here
   extend the system so new modules launch fully localized.
   ─────────────────────────────────────────────────────────── */

export const LOCALES = ['zh', 'en', 'ja', 'ko'];
export const LOCALE_LABELS = { zh: '简体中文', en: 'English', ja: '日本語', ko: '한국어' };

export const STRINGS = {
  zh: {
    shellBrand: '宝盒',
    shellTagline: '数字静谧庭院',
    greetingMorning: '早安', greetingDay: '午安', greetingEvening: '晚安',
    settings: '账号设置',
    note: '笔记', ai: '智友', aiFull: 'AI 群聊',
    toolboxMore: '更多工具', toolbox: '宝盒工具',
    reminderTitle: '陪你看见', reminderSub: '基于你的数据',
    quoteLabel: '今日话语', saveQuote: '收藏这句话',
    actHandle: '轻轻处理', actLater: '稍后', actSkip: '跳过', actSave: '保存想法',
    enter: '进入', open: '打开', locked: '未开通',
    themeDay: '日', themeNight: '夜', themeAuto: '随系统',
    notReady: '待就绪', ready: '已就绪', gated: '待授权', external: '外部入口',
    expiringSoon: '即将到期', nextStep: '下一步', importantDate: '重要日期',
  },
  en: {
    shellBrand: 'Nesio',
    shellTagline: 'A quiet digital courtyard',
    greetingMorning: 'Good morning', greetingDay: 'Good afternoon', greetingEvening: 'Good evening',
    settings: 'Account',
    note: 'Notes', ai: 'AI Friends', aiFull: 'AI group chat',
    toolboxMore: 'More tools', toolbox: 'Toolbox',
    reminderTitle: 'Here with you', reminderSub: 'From your data',
    quoteLabel: 'Daily quote', saveQuote: 'Save quote',
    actHandle: 'Gently handle', actLater: 'Later', actSkip: 'Skip', actSave: 'Save the thought',
    enter: 'Enter', open: 'Open', locked: 'Locked',
    themeDay: 'Day', themeNight: 'Night', themeAuto: 'Auto',
    notReady: 'Not ready', ready: 'Ready', gated: 'Awaiting approval', external: 'External',
    expiringSoon: 'Expiring soon', nextStep: 'Next step', importantDate: 'Important date',
  },
  ja: {
    shellBrand: '宝箱',
    shellTagline: '静かなデジタルの庭',
    greetingMorning: 'おはよう', greetingDay: 'こんにちは', greetingEvening: 'こんばんは',
    settings: 'アカウント設定',
    note: 'ノート', ai: 'AIフレンド', aiFull: 'AIグループチャット',
    toolboxMore: 'その他のツール', toolbox: 'ツールボックス',
    reminderTitle: 'そばで見守る', reminderSub: 'あなたのデータから',
    quoteLabel: '今日の言葉', saveQuote: 'この言葉を保存',
    actHandle: 'そっと片づける', actLater: 'あとで', actSkip: 'スキップ', actSave: '思いを保存',
    enter: '開く', open: '開く', locked: '未開放',
    themeDay: '昼', themeNight: '夜', themeAuto: '自動',
    notReady: '準備中', ready: '準備完了', gated: '承認待ち', external: '外部',
    expiringSoon: 'まもなく期限', nextStep: '次の一歩', importantDate: '大切な日',
  },
  ko: {
    shellBrand: '보물상자',
    shellTagline: '고요한 디지털 정원',
    greetingMorning: '좋은 아침', greetingDay: '안녕하세요', greetingEvening: '좋은 저녁',
    settings: '계정 설정',
    note: '노트', ai: 'AI 친구', aiFull: 'AI 그룹 채팅',
    toolboxMore: '더 많은 도구', toolbox: '도구 상자',
    reminderTitle: '함께 살펴봐요', reminderSub: '당신의 데이터로',
    quoteLabel: '오늘의 한마디', saveQuote: '이 문장 저장',
    actHandle: '가볍게 처리', actLater: '나중에', actSkip: '건너뛰기', actSave: '생각 저장',
    enter: '들어가기', open: '열기', locked: '미개방',
    themeDay: '낮', themeNight: '밤', themeAuto: '자동',
    notReady: '준비 중', ready: '준비됨', gated: '승인 대기', external: '외부',
    expiringSoon: '곧 만료', nextStep: '다음 단계', importantDate: '중요한 날',
  },
};

export function t(locale, key) {
  const L = STRINGS[locale] || STRINGS.zh;
  return L[key] ?? STRINGS.zh[key] ?? key;
}
