import type { Metadata } from 'next';
import LegalPage, { type LegalSection } from '@/components/portal/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service · Nesio',
  description: 'Nesio terms of service and subscription/renewal terms.',
};

// 服务条款(含订阅与自动续费说明)—— 会员权益页/登录页底部链接的落地。
const SECTIONS: LegalSection[] = [
  {
    h: ['服务内容', 'The service'],
    body: [
      ['Nesio 是本地优先的个人生活记录工具:记录、检索、回顾你自己的信息。不登录可完整使用核心功能;登录用于可选云同步与邮件类功能。',
       'Nesio is a local-first personal life-logging tool: capture, search, and revisit your own information. Core features work without an account; signing in enables optional cloud sync and email features.'],
    ],
  },
  {
    h: ['订阅与免费试用', 'Subscriptions and free trial'],
    body: [
      ['· Pro 订阅解锁 AI 深度识别与整理、AI 例程、邮件直接回复、冷冻仓等能力;基础记录、搜索、手动标签永久免费。',
       '· Pro unlocks AI recognition and cleanup, AI routines, direct email replies, and the Freeze Vault; capture, search, and manual tags stay free forever.'],
      ['· 新用户享 21 天(3 周)全功能免费试用——刚好养成一个记录的好习惯。试用结束自动回到免费版,不自动扣费。',
       '· New users get a 21-day (3-week) full-feature free trial — just long enough to build a note-taking habit. When it ends you return to the free tier; nothing is charged automatically.'],
      ['· 付费方式与价格以 App 内购买页为准(支持按周/按月/按年);通过 App Store 订阅的,续费与退订遵循 Apple 的订阅规则,可随时在系统设置中取消。',
       '· Billing options and prices are shown on the in-app purchase page (weekly / monthly / yearly). App Store subscriptions follow Apple’s renewal rules and can be canceled anytime in system settings.'],
      ['· 自动续费:订阅到期前 24 小时自动续订并扣费;取消需在当前周期结束至少 24 小时前操作。',
       '· Auto-renewal: your subscription renews and is charged within 24 hours before the current period ends; cancel at least 24 hours before the period ends to avoid renewal.'],
    ],
  },
  {
    h: ['你的数据', 'Your data'],
    body: [
      ['数据处理方式见隐私政策(/privacy)。你随时可以导出全部数据或删除账号与云端数据。',
       'See our Privacy Policy (/privacy) for how data is handled. You can export everything or delete your account and cloud data at any time.'],
    ],
  },
  {
    h: ['合理使用', 'Acceptable use'],
    body: [
      ['请勿将服务用于违法用途、滥用 AI 配额或干扰服务运行。我们可能对滥用行为限流或终止服务。',
       'Do not use the service for unlawful purposes, abuse AI quotas, or disrupt how the service runs. We may rate-limit or terminate abusive usage.'],
    ],
  },
  {
    h: ['免责与变更', 'Disclaimers and changes'],
    body: [
      ['服务按"现状"提供;AI 输出可能有误,重要决定请自行核实。条款如有重大变更会在此页更新。',
       'The service is provided "as is"; AI output can be wrong — verify anything important. Material changes to these terms will be posted here.'],
    ],
  },
  {
    h: ['联系', 'Contact'],
    body: [['support@nesio.app', 'support@nesio.app']],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title={['服务条款', 'Terms of Service']}
      updated={['生效日期:2026 年 7 月', 'Effective: July 2026']}
      intro={[
        '使用 Nesio 即表示你同意以下条款。写得尽量短,值得读完。',
        'By using Nesio you agree to these terms. We kept them short enough to actually read.',
      ]}
      sections={SECTIONS}
    />
  );
}
