import type { Metadata } from 'next';
import LegalPage, { type LegalSection } from '@/components/portal/LegalPage';

export const metadata: Metadata = {
  title: 'Support · Nesio',
  description: 'Get help with Nesio — contact, FAQ, and how to manage your data.',
};

// 支持页 —— App Store Connect 的 Support URL 必须能打开的落地页。
const SECTIONS: LegalSection[] = [
  {
    h: ['联系我们', 'Contact'],
    body: [
      ['有问题、反馈或需要协助,请邮件联系:support@nesio.app。我们会尽快回复。',
       'For questions, feedback, or help, email us at support@nesio.app. We reply as soon as we can.'],
    ],
  },
  {
    h: ['常见问题', 'FAQ'],
    body: [
      ['· 不登录能用吗?能。Nesio 本地优先,不登录即可完整记录与查找;登录仅用于可选的云同步和邮件类功能。',
       '· Can I use it without an account? Yes. Nesio is local-first — you can capture and search fully without signing in. Signing in is only for optional cloud sync and email features.'],
      ['· 我的数据在哪?默认只在你的设备上。登录并开启同步后,才会备份到云端。',
       '· Where is my data? On your device by default. It is backed up to the cloud only after you sign in and enable sync.'],
      ['· 怎么导出数据?打开「设置 → 数据」,选择导出,即可下载你的全部数据备份。',
       '· How do I export my data? Open Settings → Data and choose export to download a full backup of your data.'],
      ['· 怎么删除账号?打开「设置 → 数据 → 删除账号与云端数据」,会删除你的云端全部数据并退出登录。',
       '· How do I delete my account? Open Settings → Data → “Delete account & cloud data”, which deletes all of your cloud data and signs you out.'],
      ['· Pro 是什么?Pro 解锁 AI 拍照理解、对话式问答、AI 日程与邮件直接回复;订阅通过 App 内购买管理。',
       '· What is Pro? Pro unlocks AI photo understanding, conversational Q&A, AI routines, and direct email replies; the subscription is managed through in-app purchase.'],
    ],
  },
  {
    h: ['隐私', 'Privacy'],
    body: [
      ['我们如何处理你的数据,请见隐私政策:/privacy。',
       'For how we handle your data, see our Privacy Policy at /privacy.'],
    ],
  },
];

export default function SupportPage() {
  return (
    <LegalPage
      title={['支持', 'Support']}
      updated={['更新于:2026 年 7 月', 'Updated: July 2026']}
      intro={[
        '需要帮助?下面是联系方式与常见问题。你的数据始终由你掌控 —— 随时可以导出或删除。',
        'Need help? Below are ways to reach us and answers to common questions. Your data is always under your control — you can export or delete it any time.',
      ]}
      sections={SECTIONS}
    />
  );
}
