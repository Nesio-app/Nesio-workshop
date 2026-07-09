import type { Metadata } from 'next';
import LegalPage, { type LegalSection } from '@/components/portal/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy · Nesio',
  description: 'How Nesio handles your data — local-first, optional cloud sync, no ad tracking.',
};

// 隐私政策 —— App Store / Google 提审必须能打开的 URL。内容按 App 的**实际**数据实践写,
// 与提审素材里的隐私营养标签(docs/appstore/submission-assets.md §5)保持一致。
// 联系邮箱用 support@nesio.app(⬜ 上架前需真实可收信;别放个人 Gmail 到公开政策里)。
const SECTIONS: LegalSection[] = [
  {
    h: ['我们收集什么、存在哪', 'What we collect and where it lives'],
    body: [
      ['· 你的记录(笔记、照片、语音):默认只存在你的设备上(本机存储与浏览器数据库),不登录也能完整使用。',
       '· Your records (notes, photos, voice): by default they live only on your device (local storage and the in-browser database). The app works fully without an account.'],
      ['· 可选云同步:登录后,你可以把记忆同步到云端(由 Supabase 托管),用于跨设备访问与备份。你可以随时关闭同步或删除云端数据。',
       '· Optional cloud sync: once signed in, you may sync your memories to the cloud (hosted on Supabase) for cross-device access and backup. You can turn sync off or delete cloud data at any time.'],
      ['· 账号信息:用邮箱、Google 或 Apple 登录时,我们仅接收完成登录所需的基本身份(邮箱地址,以及你授权提供的显示名)。',
       '· Account info: when you sign in with email, Google, or Apple, we receive only the basic identity needed to sign you in (your email address, and a display name if you allow it).'],
    ],
  },
  {
    h: ['AI 处理', 'AI processing'],
    body: [
      ['当你使用需要云端 AI 的功能(如拍照理解、对话问答、AI 日程)时,相关内容会发送给 AI 服务商(例如 Google Gemini)进行处理,以生成结果。这些内容仅用于为你即时生成结果,不用于训练模型。',
       'When you use features that require cloud AI (photo understanding, conversational Q&A, AI routines), the relevant content is sent to an AI provider (for example Google Gemini) to produce the result. It is used only to generate your result, not to train models.'],
      ['免费功能尽量在你的设备上或用确定性算法完成,不发送到付费云端 AI。',
       'Free features run on your device or with deterministic logic wherever possible, and are not sent to paid cloud AI.'],
    ],
  },
  {
    h: ['可选的第三方连接', 'Optional third-party connections'],
    body: [
      ['只有在你主动连接并授权后,我们才会访问对应服务,且可随时断开并撤销授权:',
       'We access these services only after you explicitly connect and authorize them, and you can disconnect and revoke access at any time:'],
      ['· Gmail:仅在你连接后用于邮件相关功能;发送权限(如「邮件直接回复」)需你单独授权。',
       '· Gmail: used for email features only after you connect it; sending (e.g. direct email replies) requires your separate consent.'],
      ['· 日历、天气、Flomo、Notion 等连接器:仅在你连接后按功能所需读取,数据用于在 App 内为你呈现。',
       '· Calendar, weather, Flomo, Notion and similar connectors: read only what the feature needs, after you connect them, to show information inside the app.'],
    ],
  },
  {
    h: ['我们不会做的事', 'What we never do'],
    body: [
      ['· 不出售你的个人数据。· 不用于广告追踪、不做跨站/跨 App 画像。· 不在未经你操作的情况下把你的内容分享给其他人。',
       '· We do not sell your personal data. · We do not use it for advertising tracking or cross-site/cross-app profiling. · We do not share your content with anyone unless you take an action to do so.'],
    ],
  },
  {
    h: ['诊断与使用数据', 'Diagnostics and usage data'],
    body: [
      ['我们可能收集匿名、聚合的使用数据(如崩溃信息、功能使用计数)来改进产品。这些数据不包含你的记录内容,也不关联你的身份。',
       'We may collect anonymous, aggregated usage data (such as crash reports and feature-usage counts) to improve the product. This does not include the content of your records and is not linked to your identity.'],
    ],
  },
  {
    h: ['你的权利与选择', 'Your rights and choices'],
    body: [
      ['· 导出:随时在设置里导出你的全部数据。',
       '· Export: export all of your data from Settings at any time.'],
      ['· 删除账号:在「设置 → 数据 → 删除账号与云端数据」可删除你的云端全部数据并退出登录;本机数据也可单独清除。',
       '· Delete account: from Settings → Data → “Delete account & cloud data”, you can delete all of your cloud data and sign out; local data can also be cleared separately.'],
      ['· 撤销连接:随时断开任何第三方连接并撤销其授权。',
       '· Revoke connections: disconnect any third-party integration and revoke its access at any time.'],
    ],
  },
  {
    h: ['数据保留', 'Data retention'],
    body: [
      ['云端数据会保留到你删除为止。当你删除账号或云端数据,我们会将其从数据库与文件存储中移除。存在你设备上的数据由你自行掌控,卸载 App 或清除数据即会移除。',
       'Cloud data is retained until you delete it. When you delete your account or cloud data, we remove it from our database and file storage. Data on your device is under your control and is removed when you uninstall the app or clear its data.'],
    ],
  },
  {
    h: ['iOS App Store 版本', 'iOS App Store version'],
    body: [
      ['iOS App Store 版本不包含地图/位置、健康、财务与人物模块,因此不会请求位置或健康权限,也不访问这些数据。相机、麦克风、相册与通知权限仅用于对应功能(拍一拍、说一句、选取照片、每日提醒)。',
       'The iOS App Store version does not include the maps/location, health, finance, or people modules, so it does not request location or health permissions or access that data. Camera, microphone, photo library, and notification permissions are used only for their features (snap, speak, pick a photo, daily reminders).'],
    ],
  },
  {
    h: ['儿童', 'Children'],
    body: [
      ['Nesio 不面向 13 岁以下的儿童,我们不会有意收集儿童的个人信息。',
       'Nesio is not directed to children under 13, and we do not knowingly collect personal information from children.'],
    ],
  },
  {
    h: ['政策变更', 'Changes to this policy'],
    body: [
      ['如本政策有重大变更,我们会在此页面更新并调整生效日期。',
       'If we make material changes to this policy, we will update this page and revise the effective date.'],
    ],
  },
  {
    h: ['联系我们', 'Contact us'],
    body: [
      ['有任何隐私相关问题,请联系:support@nesio.app。',
       'For any privacy questions, contact: support@nesio.app.'],
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title={['隐私政策', 'Privacy Policy']}
      updated={['生效日期:2026 年 7 月', 'Effective: July 2026']}
      intro={[
        'Nesio 以「本地优先」为原则:你的数据首先属于你、存在你的设备上。本政策说明我们收集哪些数据、如何使用,以及你能如何掌控它。',
        'Nesio is built local-first: your data belongs to you and lives on your device first. This policy explains what we collect, how we use it, and how you stay in control.',
      ]}
      sections={SECTIONS}
    />
  );
}
