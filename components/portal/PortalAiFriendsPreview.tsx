'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createAppApiClient,
  type ProductionRuntimeHealthResponse,
  type ProductionRuntimeProviderAction,
  type SecretaryChatProvider,
  type SecretaryChatTurn,
  type SecretaryHealthResponse,
} from '@/lib/portal/app-api-client';
import { t, type PortalStringKey } from '@/lib/portal/i18n';
import { nesioAiIcons, nesioToolIcons } from '@/lib/portal/nesio-design-system-assets.mjs';
import { loadProfileSettings, type PortalLocale } from '@/lib/portal/profile';

interface PortalAiFriendsPreviewProps {
  open: boolean;
  onClose: () => void;
}

type MentionTarget = {
  key: string;
  label: string;
  descriptionKey: PortalStringKey;
  avatar: string;
  iconSrc?: string;
};

type RuntimeMessage = SecretaryChatTurn & {
  provider?: SecretaryChatProvider;
};

type AiCapabilityId = 'image' | 'file' | 'audio' | 'live' | 'note';

const AI_CAPABILITIES: Array<{
  id: AiCapabilityId;
  icon: string;
  labelKey: PortalStringKey;
  noticeKey: PortalStringKey;
}> = [
  { id: 'image', icon: '📷', labelKey: 'aiFriendsCapabilityImage', noticeKey: 'aiFriendsImageIntentNotice' },
  { id: 'file', icon: '📎', labelKey: 'aiFriendsCapabilityFile', noticeKey: 'aiFriendsFileIntentNotice' },
  { id: 'audio', icon: '🎙', labelKey: 'aiFriendsCapabilityAudio', noticeKey: 'aiFriendsAudioConnecting' },
  { id: 'live', icon: '📞', labelKey: 'aiFriendsCapabilityLive', noticeKey: 'aiFriendsLiveIntentNotice' },
  { id: 'note', icon: '📝', labelKey: 'aiFriendsCapabilityNote', noticeKey: 'aiFriendsFlomoIntentNotice' },
];

const mentionTargets: MentionTarget[] = [
  { key: 'claude', label: '@Claude', descriptionKey: 'aiFriendsMentionClaudeDescription', avatar: 'AI', iconSrc: nesioAiIcons.claude },
  { key: 'chatgpt', label: '@ChatGPT', descriptionKey: 'aiFriendsMentionChatGptDescription', avatar: 'G', iconSrc: nesioAiIcons.chatgpt },
  { key: 'gemini', label: '@Gemini', descriptionKey: 'aiFriendsMentionGeminiDescription', avatar: '✦', iconSrc: nesioAiIcons.gemini },
  { key: 'flomo', label: '@Flomo', descriptionKey: 'aiFriendsMentionFlomoDescription', avatar: 'F' },
  { key: 'inventory', label: '@物品库', descriptionKey: 'aiFriendsMentionInventoryDescription', avatar: '📦', iconSrc: nesioToolIcons.storage },
];

type SearchShortcutAction = 'date' | 'aiSuggestion' | 'note' | 'inventory' | 'expense' | 'todo' | 'image' | 'call' | 'file';

const searchShortcuts = [
  { icon: '🗓', labelKey: 'aiFriendsSearchDate', action: 'date' },
  { icon: '✦', labelKey: 'aiFriendsSearchAiSuggestion', action: 'aiSuggestion' },
  { icon: '📝', labelKey: 'aiFriendsSearchNote', action: 'note' },
  { icon: '📦', labelKey: 'aiFriendsSearchInventory', action: 'inventory' },
  { icon: '💰', labelKey: 'aiFriendsSearchExpense', action: 'expense' },
  { icon: '✅', labelKey: 'aiFriendsSearchTodo', action: 'todo' },
  { icon: '📷', labelKey: 'aiFriendsSearchImage', action: 'image' },
  { icon: '📞', labelKey: 'aiFriendsSearchCall', action: 'call' },
  { icon: '📎', labelKey: 'aiFriendsSearchFile', action: 'file' },
] satisfies Array<{ icon: string; labelKey: PortalStringKey; action: SearchShortcutAction }>;

const recentConversations = [
  {
    id: 'smart',
    title: '智友',
    tag: '智能调度',
    preview: '综合建议：定制相册配手写卡片最暖心...',
    avatar: '✦',
    iconSrc: nesioAiIcons.gemini,
    time: '11:20',
    unread: '2',
  },
  {
    id: 'group',
    title: '产品脑暴群',
    tag: '群聊',
    preview: 'Claude、ChatGPT、Gemini：3 个 AI 正在讨论方案...',
    avatar: '👥',
    iconSrc: nesioToolIcons.secretary,
    time: '10:05',
  },
  {
    id: 'claude',
    title: 'Claude',
    preview: '可以考虑定制相册，附上手写信，300 元内...',
    avatar: 'AI',
    iconSrc: nesioAiIcons.claude,
    time: '昨天',
  },
  {
    id: 'chatgpt',
    title: 'ChatGPT',
    preview: '护肤礼盒很受欢迎，兰蔻套装 300 元左右...',
    avatar: 'G',
    iconSrc: nesioAiIcons.chatgpt,
    time: '昨天',
  },
  {
    id: 'gemini',
    title: 'Gemini',
    preview: '300 元做定制相册很充裕，加急运费留 50...',
    avatar: 'G',
    iconSrc: nesioAiIcons.gemini,
    time: '昨天',
  },
];

type RecentConversation = (typeof recentConversations)[number];

function resolveSecretaryProvider(composer: string): SecretaryChatProvider {
  const normalized = composer.toLowerCase();
  if (normalized.includes('@claude')) return 'claude';
  if (normalized.includes('@chatgpt')) return 'chatgpt';
  if (normalized.includes('@豆包') || normalized.includes('@doubao')) return 'doubao';
  return 'gemini';
}

function getProviderLabel(provider: SecretaryChatProvider): string {
  switch (provider) {
    case 'claude':
    case 'anthropic':
      return 'Claude';
    case 'chatgpt':
    case 'openai':
      return 'ChatGPT';
    case 'doubao':
      return '豆包';
    default:
      return 'Gemini';
  }
}

function getConversationComposerIntent(conversationId: string): string {
  switch (conversationId) {
    case 'claude':
      return '@Claude ';
    case 'chatgpt':
      return '@ChatGPT ';
    case 'gemini':
      return '@Gemini ';
    case 'group':
      return '@Claude @ChatGPT @Gemini ';
    default:
      return '';
  }
}

function stripAssistantMentions(message: string): string {
  return message
    .replace(/@(Claude|ChatGPT|Gemini|豆包|Doubao)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function PortalAiFriendsPreview({ open }: PortalAiFriendsPreviewProps) {
  const [locale, setLocale] = useState<PortalLocale>('zh');
  const [composer, setComposer] = useState('');
  const [runtimeMessages, setRuntimeMessages] = useState<RuntimeMessage[]>([]);
  const [aiSending, setAiSending] = useState(false);
  const [surface, setSurface] = useState<'chat' | 'search'>('chat');
  const [activeConversationId, setActiveConversationId] = useState('smart');
  const [attachmentTrayOpen, setAttachmentTrayOpen] = useState(false);
  const [searchToolsOpen, setSearchToolsOpen] = useState(false);
  const [conversationListOpen, setConversationListOpen] = useState(false);
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [videoCallOpen, setVideoCallOpen] = useState(false);
  const [audioCallOpen, setAudioCallOpen] = useState(false);
  const [activeCapability, setActiveCapability] = useState<AiCapabilityId | null>(null);
  const [utilityNotice, setUtilityNotice] = useState('');
  const [secretaryHealth, setSecretaryHealth] = useState<SecretaryHealthResponse | null>(null);
  const [productionRuntimeStatus, setProductionRuntimeStatus] = useState<ProductionRuntimeHealthResponse | null>(null);
  const [aiRuntimeStatus, setAiRuntimeStatus] = useState(t('zh', 'aiFriendsStatusChecking'));
  const [localAttachments, setLocalAttachments] = useState<string[]>([]);
  const composerRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appApiClient = useMemo(() => createAppApiClient(), []);

  useEffect(() => {
    const settings = loadProfileSettings();
    setLocale(settings.locale);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function readSecretaryHealth() {
      try {
        const health = await appApiClient.fetchSecretaryHealth({ personalLab: true });
        if (cancelled) return;
        setSecretaryHealth(health);
        if (health.ok && health.behaviorEnabled) {
          const configuredProviders = [
            health.gemini ? 'Gemini' : null,
            health.chatgpt ? 'ChatGPT' : null,
            health.claude ? 'Claude' : null,
            health.doubao ? '豆包' : null,
          ].filter(Boolean);
          setAiRuntimeStatus(
            configuredProviders.length
              ? t(locale, 'providerAiConnectedTemplate', { provider: configuredProviders.join(' / ') })
              : t(locale, 'aiFriendsStatusEnabledNoKeys'),
          );
          return;
        }
        setAiRuntimeStatus(health.message || t(locale, 'aiFriendsStatusRuntimeOff'));
      } catch (error) {
        if (!cancelled) {
          setAiRuntimeStatus(error instanceof Error ? error.message : t(locale, 'aiFriendsStatusCheckFailed'));
        }
      }
    }

    readSecretaryHealth();
    return () => {
      cancelled = true;
    };
  }, [appApiClient, locale]);

  useEffect(() => {
    let cancelled = false;

    async function readProductionRuntimeStatus() {
      try {
        const status = await appApiClient.fetchProductionRuntimeHealth();
        if (!cancelled) setProductionRuntimeStatus(status);
      } catch {
        if (!cancelled) setProductionRuntimeStatus(null);
      }
    }

    readProductionRuntimeStatus();
    return () => {
      cancelled = true;
    };
  }, [appApiClient]);

  const mentionNeedle = useMemo(() => {
    const match = composer.match(/@([\w\u4e00-\u9fa5]*)$/);
    return match?.[1]?.toLowerCase() ?? null;
  }, [composer]);

  const mentionOptions = useMemo(() => {
    if (mentionNeedle === null) return [];
    return mentionTargets.filter((target) => target.label.toLowerCase().includes(mentionNeedle));
  }, [mentionNeedle]);

  const liveProviderSummary = useMemo(() => {
    if (!secretaryHealth) return aiRuntimeStatus;
    const configuredProviders = [
      secretaryHealth.gemini ? 'Gemini' : null,
      secretaryHealth.chatgpt ? 'ChatGPT' : null,
      secretaryHealth.claude ? 'Claude' : null,
      secretaryHealth.doubao ? '豆包' : null,
    ].filter(Boolean);
    if (configuredProviders.length) return `${configuredProviders.join(' / ')} 可用`;
    return aiRuntimeStatus;
  }, [aiRuntimeStatus, secretaryHealth]);

  const aiProviderActionsById = useMemo(() => {
    return (productionRuntimeStatus?.providerActionMatrix || [])
      .filter((provider) => provider.category === 'ai' && provider.actionStatus === 'ready')
      .reduce<Record<string, ProductionRuntimeProviderAction>>((index, provider) => {
        index[provider.id] = provider;
        return index;
      }, {});
  }, [productionRuntimeStatus?.providerActionMatrix]);

  if (!open) return null;

  const startNewThread = () => {
    setSurface('chat');
    setAttachmentTrayOpen(false);
    setSearchToolsOpen(false);
    setCallSheetOpen(false);
    setAudioCallOpen(false);
    setVideoCallOpen(false);
    setComposer('');
    setActiveConversationId('smart');
    setConversationListOpen(true);
    setUtilityNotice(t(locale, 'aiFriendsNewThreadNotice'));
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const selectConversation = (item: RecentConversation) => {
    setActiveConversationId(item.id);
    setConversationListOpen(false);
    setAttachmentTrayOpen(false);
    setCallSheetOpen(false);
    setSurface('chat');
    setComposer(getConversationComposerIntent(item.id));
    setUtilityNotice(t(locale, 'aiFriendsConversationSwitchedTemplate', { title: item.title }));
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const openAttachmentTray = () => {
    setConversationListOpen(false);
    setSearchToolsOpen(false);
    setCallSheetOpen(false);
    setAudioCallOpen(false);
    setVideoCallOpen(false);
    setAttachmentTrayOpen((value) => !value);
    setUtilityNotice(t(locale, 'aiFriendsAttachmentTrayNotice'));
  };

  const openMentionMenu = () => {
    setSurface('chat');
    setAttachmentTrayOpen(false);
    setConversationListOpen(false);
    setSearchToolsOpen(false);
    setCallSheetOpen(false);
    setComposer((value) => {
      if (/@[\w\u4e00-\u9fa5]*$/.test(value)) return value;
      return `${value}${value.endsWith(' ') || value.length === 0 ? '' : ' '}@`;
    });
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const openCallSheet = () => {
    setAttachmentTrayOpen(false);
    setConversationListOpen(false);
    setSearchToolsOpen(false);
    setAudioCallOpen(false);
    setVideoCallOpen(false);
    setCallSheetOpen(true);
    setUtilityNotice(t(locale, 'aiFriendsLiveIntentNotice'));
  };

  const openConversationList = () => {
    setSurface('chat');
    setAttachmentTrayOpen(false);
    setSearchToolsOpen(false);
    setCallSheetOpen(false);
    setAudioCallOpen(false);
    setVideoCallOpen(false);
    setConversationListOpen(true);
  };

  const openAudioCall = () => {
    setAttachmentTrayOpen(false);
    setConversationListOpen(false);
    setSearchToolsOpen(false);
    setCallSheetOpen(false);
    setVideoCallOpen(false);
    setAudioCallOpen(true);
    setUtilityNotice(t(locale, 'aiFriendsAudioConnecting'));
  };

  const insertMention = (target: MentionTarget) => {
    setComposer((value) => {
      if (/@[\w\u4e00-\u9fa5]*$/.test(value)) {
        return value.replace(/@[\w\u4e00-\u9fa5]*$/, `${target.label} `);
      }
      return `${value}${value.endsWith(' ') || value.length === 0 ? '' : ' '}${target.label} `;
    });
  };

  const addLocalAttachment = (kind: string, fileName?: string) => {
    const label = fileName ? `${kind}：${fileName}` : kind;
    setLocalAttachments((items) => [label, ...items].slice(0, 3));
    setUtilityNotice(t(locale, 'aiFriendsLocalAttachmentTemplate', { label }));
  };

  const addFlomoNoteIntent = () => {
    setComposer((value) => `${value}${value.endsWith(' ') || value.length === 0 ? '' : ' '}@Flomo `);
    setLocalAttachments((items) => ['笔记：将本条保存到 Flomo', ...items].slice(0, 3));
    setUtilityNotice(t(locale, 'aiFriendsFlomoIntentNotice'));
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const handleCapabilityAction = (capabilityId: AiCapabilityId) => {
    setActiveCapability(capabilityId);
    const capability = AI_CAPABILITIES.find((item) => item.id === capabilityId);
    if (capability) setUtilityNotice(t(locale, capability.noticeKey));

    switch (capabilityId) {
      case 'image':
        imageInputRef.current?.click();
        return;
      case 'file':
        fileInputRef.current?.click();
        return;
      case 'audio':
        openAudioCall();
        return;
      case 'live':
        openCallSheet();
        return;
      case 'note':
        addFlomoNoteIntent();
        return;
      default:
        requestAnimationFrame(() => composerRef.current?.focus());
    }
  };

  const handleSearchShortcut = (action: SearchShortcutAction) => {
    setSurface('chat');
    setSearchToolsOpen(false);

    switch (action) {
      case 'date':
        setComposer('@Gemini 帮我看今天接下来最重要的安排。');
        setUtilityNotice(t(locale, 'aiFriendsCalendarIntentNotice'));
        break;
      case 'aiSuggestion':
        setComposer('@Gemini ');
        setUtilityNotice(t(locale, 'aiFriendsRecommendationIntentNotice'));
        break;
      case 'note':
        addFlomoNoteIntent();
        return;
      case 'inventory':
        setComposer('@物品库 记一个物品：');
        setUtilityNotice(t(locale, 'aiFriendsInventoryIntentNotice'));
        break;
      case 'expense':
        setComposer('@豆包 记录一笔支出：');
        setUtilityNotice(t(locale, 'aiFriendsExpenseIntentNotice'));
        break;
      case 'todo':
        setComposer('@Flomo 待办：');
        setUtilityNotice(t(locale, 'aiFriendsTodoIntentNotice'));
        break;
      case 'image':
        imageInputRef.current?.click();
        setUtilityNotice(t(locale, 'aiFriendsImageIntentNotice'));
        return;
      case 'call':
        openCallSheet();
        return;
      case 'file':
        fileInputRef.current?.click();
        setUtilityNotice(t(locale, 'aiFriendsFileIntentNotice'));
        return;
      default:
        setComposer('');
    }

    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const sendComposerMessage = async () => {
    const rawMessage = composer.trim();
    if (aiSending) {
      setUtilityNotice(t(locale, 'aiFriendsBusyNotice'));
      return;
    }
    if (!rawMessage) {
      setUtilityNotice(t(locale, 'aiFriendsEmptyMessageNotice'));
      return;
    }

    const provider = resolveSecretaryProvider(composer);
    const providerAction = aiProviderActionsById[provider];
    if (!providerAction || providerAction.startEndpoint !== '/api/secretary/chat') {
      const runtimeProvider = productionRuntimeStatus?.providerActionMatrix.find((item) => item.id === provider);
      const missing = runtimeProvider?.missingEnv?.length
        ? t(locale, 'providerMissingEnv', { missing: runtimeProvider.missingEnv.slice(0, 3).join(' / ') })
        : t(locale, 'providerRuntimeNotReady');
      const unavailable = t(locale, 'providerUnavailableTemplate', {
        provider: getProviderLabel(provider),
        reason: missing,
      });
      setUtilityNotice(unavailable);
      setRuntimeMessages((items) => [
        ...items,
        {
          role: 'assistant',
          content: unavailable,
          provider,
        },
      ]);
      return;
    }
    const message = stripAssistantMentions(rawMessage) || rawMessage;
    const history: SecretaryChatTurn[] = runtimeMessages
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));
    const userMessage: RuntimeMessage = { role: 'user', content: rawMessage, provider };

    setRuntimeMessages((items) => [...items, userMessage]);
    setComposer('');
    setAiSending(true);
    setUtilityNotice(t(locale, 'providerAiConnectingTemplate', { provider: getProviderLabel(provider) }));

    try {
      const result = await appApiClient.sendSecretaryMessage({
        provider,
        message,
        history,
        personalLab: true,
      });

      if (result.text) {
        setRuntimeMessages((items) => [
          ...items,
          {
            role: 'assistant',
            content: result.text || '',
            provider,
          },
        ]);
        setUtilityNotice(t(locale, 'providerAiConnectedTemplate', { provider: result.model || provider }));
      } else {
        const errorText = [result.error, result.detail, result.hint].filter(Boolean).join(' · ') || t(locale, 'providerAiUnavailable');
        setRuntimeMessages((items) => [
          ...items,
          {
            role: 'assistant',
            content: t(locale, 'providerAiNotConnectedTemplate', { reason: errorText }),
            provider,
          },
        ]);
        setUtilityNotice(errorText);
      }
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      setRuntimeMessages((items) => [
        ...items,
        {
          role: 'assistant',
          content: t(locale, 'providerAiNotConnectedTemplate', { reason: errorText }),
          provider,
        },
      ]);
      setUtilityNotice(errorText);
    } finally {
      setAiSending(false);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  };

  return (
    <section className="portal-ai-preview portal-ai-preview--screen" aria-label="智友" data-active-conversation={activeConversationId}>
      {surface === 'search' ? (
        <section className="portal-ai-search-surface" aria-label="智友搜索">
          <header className="portal-ai-search-head">
            <button type="button" className="portal-ai-screen-icon-btn" data-runtime-action="ai-return-from-search" onClick={() => setSurface('chat')}>
              <span aria-hidden>←</span>
              <span className="sr-only">返回智友</span>
            </button>
            <h1>搜索</h1>
            <button type="button" className="portal-ai-screen-icon-btn" aria-label="新建对话" data-runtime-action="ai-start-new-thread" onClick={startNewThread}>
              +
            </button>
          </header>
          <label className="portal-ai-search-input">
            <span aria-hidden>⌕</span>
            <input
              type="search"
              placeholder={t(locale, 'aiFriendsSearchPlaceholder')}
              onFocus={() => setSearchToolsOpen(true)}
              onChange={() => setSearchToolsOpen(true)}
            />
          </label>
          {searchToolsOpen ? (
            <div className="portal-ai-search-grid" aria-label="搜索分类">
              {searchShortcuts.map((shortcut) => (
                <button
                  key={shortcut.action}
                  type="button"
                  data-runtime-action={`ai-search-shortcut-${shortcut.action}`}
                  onClick={() => handleSearchShortcut(shortcut.action)}
                >
                  <span aria-hidden>{shortcut.icon}</span>
                  <b>{t(locale, shortcut.labelKey)}</b>
                </button>
              ))}
            </div>
          ) : null}
          <section className="portal-ai-recent" aria-label="最近对话">
            <h2>最近对话</h2>
            {recentConversations.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`portal-ai-recent-row${activeConversationId === item.id ? ' portal-ai-recent-row--active' : ''}`}
                aria-pressed={activeConversationId === item.id}
                data-runtime-action={`ai-select-conversation-${item.id}`}
                onClick={() => selectConversation(item)}
              >
                <span className="portal-ai-conversation-avatar" aria-hidden>
                  <Image src={item.iconSrc} alt="" className="portal-ai-conversation-icon" width={54} height={54} />
                </span>
                <span>
                  <b>
                    {item.title}
                    {item.tag ? <small>{item.tag}</small> : null}
                  </b>
                  <em>{item.preview}</em>
                </span>
                <i>{item.time}</i>
                {item.unread ? <strong>{item.unread}</strong> : null}
              </button>
            ))}
          </section>
        </section>
      ) : (
        <>
          <header className="portal-ai-workspace-head">
            <h1>智友</h1>
            <div>
              <button
                type="button"
                className="portal-ai-screen-icon-btn"
                aria-label="搜索"
                data-runtime-action="ai-open-search"
                onClick={() => setSurface('search')}
              >
                ⌕
              </button>
              <button
                type="button"
                className="portal-ai-screen-icon-btn"
                aria-label="打开对话列表"
                aria-expanded={conversationListOpen}
                aria-controls="portal-ai-conversation-list"
                data-runtime-action="ai-open-conversation-list"
                onClick={openConversationList}
              >
                💬
              </button>
            </div>
          </header>

          <section className="portal-ai-thread" aria-label="集合对话">
            <p className="portal-ai-runtime-status" aria-live="polite">
              {aiRuntimeStatus}
            </p>
            <p className="portal-ai-message portal-ai-message--user">帮我想个送妈妈的生日礼物，预算 300</p>
            <p className="portal-ai-thread-note">已综合 Claude · ChatGPT 的回答</p>
            <div className="portal-ai-message-row">
              <span className="portal-ai-bot-avatar" aria-hidden>✦</span>
              <p className="portal-ai-message portal-ai-message--assistant">
                综合建议：<b>定制相册</b>（¥150–200）配手写卡片最暖心；想更实用可选<b>护肤礼盒</b>（¥280–320）。慢慢看，要我帮你比价吗？
              </p>
            </div>
            <p className="portal-ai-message portal-ai-message--user">@Flomo 周五前买好牛奶</p>
            <div className="portal-ai-message-row">
              <span className="portal-ai-bot-avatar portal-ai-bot-avatar--flomo" aria-hidden>F</span>
              <p className="portal-ai-message portal-ai-message--assistant portal-ai-message--compact">
                收到～ <b>✓ 已记入 Flomo 笔记序列</b>
              </p>
            </div>
            <p className="portal-ai-message portal-ai-message--user">@Gemini 你怎么看这个礼物预算？</p>
            <div className="portal-ai-message-row">
              <span className="portal-ai-bot-avatar portal-ai-bot-avatar--gemini" aria-hidden>G</span>
              <p className="portal-ai-message portal-ai-message--assistant">
                300 元做定制相册很充裕，建议留 50 元加急运费，确保 5 天内到。
              </p>
            </div>
            {runtimeMessages.map((message, index) => (
              message.role === 'user' ? (
                <p key={`${message.role}-${index}`} className="portal-ai-message portal-ai-message--user">
                  {message.content}
                </p>
              ) : (
                <div key={`${message.role}-${index}`} className="portal-ai-message-row">
                  <span className="portal-ai-bot-avatar" aria-hidden>
                    {message.provider === 'chatgpt' || message.provider === 'openai'
                      ? 'G'
                      : message.provider === 'doubao'
                        ? '豆'
                        : message.provider === 'claude' || message.provider === 'anthropic'
                          ? 'C'
                          : '✦'}
                  </span>
                  <p className="portal-ai-message portal-ai-message--assistant">{message.content}</p>
                </div>
              )
            ))}
          </section>

          <div className="portal-ai-composer">
            {attachmentTrayOpen ? (
              <div id="portal-ai-capability-rail" className="portal-ai-capability-rail" aria-label="智友快捷能力">
                {AI_CAPABILITIES.map((capability) => (
                  <button
                    key={capability.id}
                    type="button"
                    className={activeCapability === capability.id ? 'is-active' : ''}
                    aria-pressed={activeCapability === capability.id}
                    aria-controls={capability.id === 'audio' ? 'portal-ai-audio-call' : capability.id === 'live' ? 'portal-ai-call-sheet' : undefined}
                    data-runtime-action={`ai-capability-${capability.id}`}
                    onClick={() => handleCapabilityAction(capability.id)}
                  >
                    {capability.icon}
                    <span>{t(locale, capability.labelKey)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <p>{t(locale, 'aiFriendsComposerHint')}</p>
            {(utilityNotice || localAttachments.length > 0) ? (
              <div className="portal-ai-local-status" aria-live="polite">
                {localAttachments.map((item) => (
                  <span key={item}>{item}</span>
                ))}
                <small>{utilityNotice}</small>
              </div>
            ) : null}
            <div className="portal-ai-composer-row">
              <button
                type="button"
                className="portal-ai-round-action"
                aria-label="添加附件"
                aria-expanded={attachmentTrayOpen}
                aria-controls="portal-ai-capability-rail"
                data-runtime-action="ai-open-attachment-tray"
                onClick={openAttachmentTray}
              >
                ＋
              </button>
              <button
                type="button"
                className="portal-ai-round-action"
                aria-label="@ 调度"
                aria-expanded={mentionOptions.length > 0}
                aria-controls="portal-ai-mention-menu"
                data-runtime-action="ai-open-mention-menu"
                onClick={openMentionMenu}
              >
                @
              </button>
              <input
                ref={composerRef}
                aria-label="智友集合输入框"
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendComposerMessage();
                  }
                }}
                placeholder={t(locale, 'aiFriendsComposerPlaceholder')}
              />
              <button
                type="button"
                className="portal-ai-round-action"
                aria-label="语音输入"
                aria-expanded={audioCallOpen}
                aria-controls="portal-ai-audio-call"
                data-runtime-action="ai-open-audio-call"
                onClick={openAudioCall}
              >
                🎙
              </button>
              <button
                type="button"
                className="portal-ai-call-button"
                aria-label="通话"
                aria-expanded={callSheetOpen || videoCallOpen || audioCallOpen}
                aria-controls="portal-ai-call-sheet"
                data-runtime-action="ai-open-live-call"
                onClick={openCallSheet}
              >
                📞<span>通话</span>
              </button>
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="portal-ai-hidden-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) addLocalAttachment('图片', file.name);
                event.target.value = '';
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              className="portal-ai-hidden-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) addLocalAttachment('文件', file.name);
                event.target.value = '';
              }}
            />
            {mentionOptions.length ? (
              <div id="portal-ai-mention-menu" className="portal-ai-mention-menu" role="listbox" aria-label="@ 调度候选">
                {mentionOptions.map((target) => (
                  <button
                    key={target.key}
                    type="button"
                    role="option"
                    aria-selected="false"
                    data-runtime-action={`ai-insert-mention-${target.key}`}
                    onClick={() => insertMention(target)}
                  >
                    {target.iconSrc ? (
                      <Image src={target.iconSrc} alt="" className="portal-ai-mention-icon" width={30} height={30} />
                    ) : null}
                    <b>{target.label}</b>
                    <span>{t(locale, target.descriptionKey)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {conversationListOpen ? (
            <div id="portal-ai-conversation-list" className="portal-ai-conversation-sheet" role="dialog" aria-modal="true" aria-label="AI 对话列表">
              <button type="button" className="portal-ai-conversation-scrim" aria-label="关闭 AI 对话列表" onClick={() => setConversationListOpen(false)} />
              <section>
                <span className="portal-ai-sheet-handle" aria-hidden />
                <h2>{t(locale, 'aiFriendsConversationListTitle')}</h2>
                {recentConversations.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`portal-ai-recent-row${activeConversationId === item.id ? ' portal-ai-recent-row--active' : ''}`}
                    aria-pressed={activeConversationId === item.id}
                    data-runtime-action={`ai-select-conversation-${item.id}`}
                    onClick={() => selectConversation(item)}
                  >
                    <span className="portal-ai-conversation-avatar" aria-hidden>
                      <Image src={item.iconSrc} alt="" className="portal-ai-conversation-icon" width={54} height={54} />
                    </span>
                    <span>
                      <b>{item.title}{item.tag ? <small>{item.tag}</small> : null}</b>
                      <em>{item.preview}</em>
                    </span>
                    <i>{item.time}</i>
                    {item.unread ? <strong>{item.unread}</strong> : null}
                  </button>
                ))}
              </section>
            </div>
          ) : null}

          {typeof document !== 'undefined' && callSheetOpen ? createPortal(
            <div className="portal-ai-modal-layer">
              <button type="button" className="portal-ai-modal-scrim" aria-label="关闭通话选项" onClick={() => setCallSheetOpen(false)} />
              <section id="portal-ai-call-sheet" className="portal-ai-call-sheet" role="dialog" aria-modal="true" aria-label={t(locale, 'aiFriendsCallSheetTitle')}>
                <span className="portal-ai-sheet-handle" aria-hidden />
                <h2>{t(locale, 'aiFriendsCallSheetTitle')}</h2>
                <button type="button" onClick={() => { setCallSheetOpen(false); setVideoCallOpen(true); }}>
                  <span aria-hidden>📹</span>
                  <p>
                    <b>{t(locale, 'aiFriendsVideoCallTitle')}</b>
                    <small>{t(locale, 'aiFriendsVideoCallSubtitle')}</small>
                  </p>
                  <i aria-hidden>›</i>
                </button>
                <button type="button" onClick={() => { setCallSheetOpen(false); setAudioCallOpen(true); }}>
                  <span aria-hidden>🎙</span>
                  <p>
                    <b>{t(locale, 'aiFriendsAudioCallTitle')}</b>
                    <small>{t(locale, 'aiFriendsAudioCallSubtitle')}</small>
                  </p>
                  <i aria-hidden>›</i>
                </button>
              </section>
            </div>,
            document.body,
          ) : null}

          {typeof document !== 'undefined' && audioCallOpen ? createPortal(
            <div className="portal-ai-modal-layer portal-ai-modal-layer--call">
              <section id="portal-ai-audio-call" className="portal-ai-video-call" role="dialog" aria-modal="true" aria-label={t(locale, 'aiFriendsAudioCallTitle')}>
                <div className="portal-ai-video-avatar" aria-hidden>🎙</div>
                <p>{t(locale, 'aiFriendsAudioConnecting')}</p>
                <small>{liveProviderSummary}</small>
                <button type="button" onClick={() => setAudioCallOpen(false)}>{t(locale, 'aiFriendsEndCall')}</button>
              </section>
            </div>,
            document.body,
          ) : null}

          {typeof document !== 'undefined' && videoCallOpen ? createPortal(
            <div className="portal-ai-modal-layer portal-ai-modal-layer--call">
              <section className="portal-ai-video-call" role="dialog" aria-modal="true" aria-label={t(locale, 'aiFriendsVideoCallTitle')}>
                <div className="portal-ai-video-avatar" aria-hidden>✦</div>
                <p>{t(locale, 'aiFriendsVideoConnecting')}</p>
                <small>{liveProviderSummary}</small>
                <button type="button" onClick={() => setVideoCallOpen(false)}>{t(locale, 'aiFriendsEndCall')}</button>
              </section>
            </div>,
            document.body,
          ) : null}
        </>
      )}
    </section>
  );
}
