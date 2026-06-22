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
  labelKey?: PortalStringKey;
  label?: string;
  descriptionKey: PortalStringKey;
  avatar: string;
  iconSrc?: string;
};

type RuntimeMessage = SecretaryChatTurn & {
  provider?: SecretaryChatProvider;
};

type ActiveProviderReadiness = {
  provider: SecretaryChatProvider;
  ready: boolean;
  reason: string;
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
  { key: 'inventory', labelKey: 'aiFriendsMentionInventoryLabel', descriptionKey: 'aiFriendsMentionInventoryDescription', avatar: '📦', iconSrc: nesioToolIcons.storage },
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
    titleKey: 'aiFriendsRecentSmartTitle',
    tagKey: 'aiFriendsRecentSmartTag',
    previewKey: 'aiFriendsRecentSmartPreview',
    avatar: '✦',
    iconSrc: nesioAiIcons.gemini,
    time: '11:20',
    unread: '2',
  },
  {
    id: 'group',
    titleKey: 'aiFriendsRecentGroupTitle',
    tagKey: 'aiFriendsRecentGroupTag',
    previewKey: 'aiFriendsRecentGroupPreview',
    avatar: '👥',
    iconSrc: nesioToolIcons.secretary,
    time: '10:05',
  },
  {
    id: 'claude',
    title: 'Claude',
    previewKey: 'aiFriendsRecentClaudePreview',
    avatar: 'AI',
    iconSrc: nesioAiIcons.claude,
    timeKey: 'aiFriendsRecentYesterday',
  },
  {
    id: 'chatgpt',
    title: 'ChatGPT',
    previewKey: 'aiFriendsRecentChatGptPreview',
    avatar: 'G',
    iconSrc: nesioAiIcons.chatgpt,
    timeKey: 'aiFriendsRecentYesterday',
  },
  {
    id: 'gemini',
    title: 'Gemini',
    previewKey: 'aiFriendsRecentGeminiPreview',
    avatar: 'G',
    iconSrc: nesioAiIcons.gemini,
    timeKey: 'aiFriendsRecentYesterday',
  },
] satisfies Array<{
  id: string;
  title?: string;
  titleKey?: PortalStringKey;
  tagKey?: PortalStringKey;
  previewKey: PortalStringKey;
  avatar: string;
  iconSrc: string;
  time?: string;
  timeKey?: PortalStringKey;
  unread?: string;
}>;

type RecentConversation = (typeof recentConversations)[number];

const DOUBAO_PROVIDER_ALIASES = ['@doubao'];

function getDoubaoMentionAlias(locale: PortalLocale): string {
  return `@${t(locale, 'aiFriendsProviderDoubaoLabel')}`;
}

function resolveSecretaryProvider(composer: string, conversationId: string): SecretaryChatProvider {
  const normalized = composer.toLowerCase();
  if (normalized.includes('@claude')) return 'claude';
  if (normalized.includes('@chatgpt')) return 'chatgpt';
  if (
    normalized.includes(getDoubaoMentionAlias('zh').toLowerCase()) ||
    DOUBAO_PROVIDER_ALIASES.some((alias) => normalized.includes(alias))
  ) return 'doubao';
  switch (conversationId) {
    case 'claude':
      return 'claude';
    case 'chatgpt':
      return 'chatgpt';
    case 'gemini':
      return 'gemini';
    default:
      break;
  }
  return 'gemini';
}

function getProviderLabel(locale: PortalLocale, provider: SecretaryChatProvider): string {
  switch (provider) {
    case 'claude':
    case 'anthropic':
      return 'Claude';
    case 'chatgpt':
    case 'openai':
      return 'ChatGPT';
    case 'doubao':
      return t(locale, 'aiFriendsProviderDoubaoLabel');
    default:
      return 'Gemini';
  }
}

function getProviderAvatarLabel(locale: PortalLocale, provider: SecretaryChatProvider | undefined): string {
  if (provider === 'chatgpt' || provider === 'openai') return 'G';
  if (provider === 'doubao') return t(locale, 'aiFriendsProviderDoubaoAvatar');
  if (provider === 'claude' || provider === 'anthropic') return 'C';
  return '✦';
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
  const doubaoLabel = t('zh', 'aiFriendsProviderDoubaoLabel');
  return message
    .replace(new RegExp(`@(Claude|ChatGPT|Gemini|${doubaoLabel}|Doubao)\\b`, 'gi'), '')
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

  const mentionLabel = (target: MentionTarget) => target.label ?? (target.labelKey ? t(locale, target.labelKey) : '');

  const conversationTitle = (item: RecentConversation) => item.title ?? (item.titleKey ? t(locale, item.titleKey) : '');

  const conversationTime = (item: RecentConversation) => item.time ?? (item.timeKey ? t(locale, item.timeKey) : '');

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
            health.doubao ? t(locale, 'aiFriendsProviderDoubaoLabel') : null,
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
    return mentionTargets.filter((target) => {
      const label = target.label ?? (target.labelKey ? t(locale, target.labelKey) : '');
      return label.toLowerCase().includes(mentionNeedle);
    });
  }, [locale, mentionNeedle]);

  const liveProviderSummary = useMemo(() => {
    if (!secretaryHealth) return aiRuntimeStatus;
    const configuredProviders = secretaryHealth.providerMatrix?.length
      ? secretaryHealth.providerMatrix
        .filter((provider) => provider.runtimeAvailable)
        .map((provider) => provider.fallbackProvider
          ? t(locale, 'providerAiFallbackTemplate', { provider: provider.label, fallback: provider.fallbackProvider })
          : provider.label)
      : [
        secretaryHealth.gemini ? 'Gemini' : null,
        secretaryHealth.chatgpt ? 'ChatGPT' : null,
        secretaryHealth.claude ? 'Claude' : null,
        secretaryHealth.doubao ? t(locale, 'aiFriendsProviderDoubaoLabel') : null,
      ].filter(Boolean);
    if (configuredProviders.length) return t(locale, 'aiFriendsProvidersAvailableTemplate', { providers: configuredProviders.join(' / ') });
    return aiRuntimeStatus;
  }, [aiRuntimeStatus, locale, secretaryHealth]);

  const secretaryProviderMatrixById = useMemo(() => {
    return (secretaryHealth?.providerMatrix || []).reduce<Record<string, NonNullable<SecretaryHealthResponse['providerMatrix']>[number]>>((index, provider) => {
      index[provider.provider] = provider;
      return index;
    }, {});
  }, [secretaryHealth?.providerMatrix]);

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
    setUtilityNotice(t(locale, 'aiFriendsConversationSwitchedTemplate', { title: conversationTitle(item) }));
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
    const readiness = resolveActiveProviderReadiness();
    if (!readiness.ready) {
      appendProviderUnavailableMessage(readiness);
    }
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
    const readiness = resolveActiveProviderReadiness();
    if (!readiness.ready) {
      appendProviderUnavailableMessage(readiness);
    }
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
        return value.replace(/@[\w\u4e00-\u9fa5]*$/, `${mentionLabel(target)} `);
      }
      return `${value}${value.endsWith(' ') || value.length === 0 ? '' : ' '}${mentionLabel(target)} `;
    });
  };

  function appendLocalAssistantMessage(content: string, provider: SecretaryChatProvider = 'gemini') {
    setRuntimeMessages((items) => [
      ...items,
      {
        role: 'assistant',
        content,
        provider,
      },
    ]);
  }

  function resolveActiveProviderReadiness(): ActiveProviderReadiness {
    const provider = resolveSecretaryProvider(composer, activeConversationId);
    const providerAction = aiProviderActionsById[provider];
    const secretaryProvider = secretaryProviderMatrixById[provider];
    const secretaryProviderReady = secretaryProvider?.runtimeAvailable && secretaryProvider?.chatEndpoint === '/api/secretary/chat';
    const productionProviderReady = providerAction?.startEndpoint === '/api/secretary/chat';

    if (secretaryProviderReady || productionProviderReady) {
      return { provider, ready: true, reason: '' };
    }

    const runtimeProvider = productionRuntimeStatus?.providerActionMatrix.find((item) => item.id === provider);
    let reason = t(locale, 'providerRuntimeNotReady');
    if (!secretaryProvider && runtimeProvider?.missingEnv?.length) {
      reason = t(locale, 'providerMissingEnv', { missing: runtimeProvider.missingEnv.slice(0, 3).join(' / ') });
    }
    return { provider, ready: false, reason };
  }

  function appendProviderUnavailableMessage(readiness: ActiveProviderReadiness) {
    const unavailable = t(locale, 'providerUnavailableTemplate', {
      provider: getProviderLabel(locale, readiness.provider),
      reason: readiness.reason,
    });
    setUtilityNotice(unavailable);
    setRuntimeMessages((items) => [
      ...items,
      {
        role: 'assistant',
        content: unavailable,
        provider: readiness.provider,
      },
    ]);
  }

  const addLocalAttachment = (kind: string, fileName?: string) => {
    const label = fileName ? `${kind}：${fileName}` : kind;
    const notice = t(locale, 'aiFriendsLocalAttachmentTemplate', { label });
    setLocalAttachments((items) => [label, ...items].slice(0, 3));
    setUtilityNotice(notice);
    appendLocalAssistantMessage(notice);
  };

  const addFlomoNoteIntent = () => {
    const notice = t(locale, 'aiFriendsFlomoIntentNotice');
    setComposer((value) => `${value}${value.endsWith(' ') || value.length === 0 ? '' : ' '}@Flomo `);
    setLocalAttachments((items) => [t(locale, 'aiFriendsLocalFlomoAttachment'), ...items].slice(0, 3));
    setUtilityNotice(notice);
    appendLocalAssistantMessage(notice, 'gemini');
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
        setComposer(t(locale, 'aiFriendsCalendarComposerIntent'));
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
        setComposer(t(locale, 'aiFriendsInventoryComposerIntent'));
        setUtilityNotice(t(locale, 'aiFriendsInventoryIntentNotice'));
        break;
      case 'expense':
        setComposer(t(locale, 'aiFriendsExpenseComposerIntent'));
        setUtilityNotice(t(locale, 'aiFriendsExpenseIntentNotice'));
        break;
      case 'todo':
        setComposer(t(locale, 'aiFriendsTodoComposerIntent'));
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

    const readiness = resolveActiveProviderReadiness();
    const provider = readiness.provider;
    if (!readiness.ready) {
      appendProviderUnavailableMessage(readiness);
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
    setUtilityNotice(t(locale, 'providerAiConnectingTemplate', { provider: getProviderLabel(locale, provider) }));

    try {
      const result = await appApiClient.sendSecretaryMessage({
        provider,
        message,
        history,
        personalLab: true,
        locale,
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
    <section className="portal-ai-preview portal-ai-preview--screen" aria-label={t(locale, 'aiFriendsTitle')} data-active-conversation={activeConversationId}>
      {surface === 'search' ? (
        <section className="portal-ai-search-surface" aria-label={t(locale, 'aiFriendsSearchAriaLabel')}>
          <header className="portal-ai-search-head">
            <button type="button" className="portal-ai-screen-icon-btn" data-runtime-action="ai-return-from-search" onClick={() => setSurface('chat')}>
              <span aria-hidden>←</span>
              <span className="sr-only">{t(locale, 'aiFriendsBackToChat')}</span>
            </button>
            <h1>{t(locale, 'aiFriendsSearchTitle')}</h1>
            <button type="button" className="portal-ai-screen-icon-btn" aria-label={t(locale, 'aiFriendsNewConversation')} data-runtime-action="ai-start-new-thread" onClick={startNewThread}>
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
            <div className="portal-ai-search-grid" aria-label={t(locale, 'aiFriendsSearchCategoriesLabel')}>
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
          <section className="portal-ai-recent" aria-label={t(locale, 'aiFriendsRecentConversationsLabel')}>
            <h2>{t(locale, 'aiFriendsRecentConversationsLabel')}</h2>
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
                    {conversationTitle(item)}
                    {item.tagKey ? <small>{t(locale, item.tagKey)}</small> : null}
                  </b>
                  <em>{t(locale, item.previewKey)}</em>
                </span>
                <i>{conversationTime(item)}</i>
                {item.unread ? <strong>{item.unread}</strong> : null}
              </button>
            ))}
          </section>
        </section>
      ) : (
        <>
          <header className="portal-ai-workspace-head">
            <h1>{t(locale, 'aiFriendsTitle')}</h1>
            <div>
              <button
                type="button"
                className="portal-ai-screen-icon-btn"
                aria-label={t(locale, 'aiFriendsOpenSearch')}
                data-runtime-action="ai-open-search"
                onClick={() => setSurface('search')}
              >
                ⌕
              </button>
              <button
                type="button"
                className="portal-ai-screen-icon-btn"
                aria-label={t(locale, 'aiFriendsOpenConversationList')}
                aria-expanded={conversationListOpen}
                aria-controls="portal-ai-conversation-list"
                data-runtime-action="ai-open-conversation-list"
                onClick={openConversationList}
              >
                💬
              </button>
            </div>
          </header>

          <section className="portal-ai-thread" aria-label={t(locale, 'aiFriendsThreadLabel')}>
            <p className="portal-ai-runtime-status" aria-live="polite">
              {aiRuntimeStatus}
            </p>
            <p className="portal-ai-message portal-ai-message--user">{t(locale, 'aiFriendsDemoUserGiftRequest')}</p>
            <p className="portal-ai-thread-note">{t(locale, 'aiFriendsDemoThreadNote')}</p>
            <div className="portal-ai-message-row">
              <span className="portal-ai-bot-avatar" aria-hidden>✦</span>
              <p className="portal-ai-message portal-ai-message--assistant">
                {t(locale, 'aiFriendsDemoAssistantGiftPrefix')}
                <b>{t(locale, 'aiFriendsDemoAssistantGiftAlbum')}</b>
                {t(locale, 'aiFriendsDemoAssistantGiftMiddle')}
                <b>{t(locale, 'aiFriendsDemoAssistantGiftSkincare')}</b>
                {t(locale, 'aiFriendsDemoAssistantGiftSuffix')}
              </p>
            </div>
            <p className="portal-ai-message portal-ai-message--user">{t(locale, 'aiFriendsDemoFlomoRequest')}</p>
            <div className="portal-ai-message-row">
              <span className="portal-ai-bot-avatar portal-ai-bot-avatar--flomo" aria-hidden>F</span>
              <p className="portal-ai-message portal-ai-message--assistant portal-ai-message--compact">
                {t(locale, 'aiFriendsDemoFlomoSaved')}
              </p>
            </div>
            <p className="portal-ai-message portal-ai-message--user">{t(locale, 'aiFriendsDemoGeminiRequest')}</p>
            <div className="portal-ai-message-row">
              <span className="portal-ai-bot-avatar portal-ai-bot-avatar--gemini" aria-hidden>G</span>
              <p className="portal-ai-message portal-ai-message--assistant">{t(locale, 'aiFriendsDemoGeminiAnswer')}</p>
            </div>
            {runtimeMessages.map((message, index) => (
              message.role === 'user' ? (
                <p key={`${message.role}-${index}`} className="portal-ai-message portal-ai-message--user">
                  {message.content}
                </p>
              ) : (
                <div key={`${message.role}-${index}`} className="portal-ai-message-row">
                  <span className="portal-ai-bot-avatar" aria-hidden>
                    {getProviderAvatarLabel(locale, message.provider)}
                  </span>
                  <p className="portal-ai-message portal-ai-message--assistant">{message.content}</p>
                </div>
              )
            ))}
          </section>

          <div className="portal-ai-composer">
            {attachmentTrayOpen ? (
              <div id="portal-ai-capability-rail" className="portal-ai-capability-rail" aria-label={t(locale, 'aiFriendsCapabilityRailLabel')}>
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
                aria-label={t(locale, 'aiFriendsAddAttachment')}
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
                aria-label={t(locale, 'aiFriendsMentionDispatch')}
                aria-expanded={mentionOptions.length > 0}
                aria-controls="portal-ai-mention-menu"
                data-runtime-action="ai-open-mention-menu"
                onClick={openMentionMenu}
              >
                @
              </button>
              <input
                ref={composerRef}
                aria-label={t(locale, 'aiFriendsInputLabel')}
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
                aria-label={t(locale, 'aiFriendsVoiceInput')}
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
                aria-label={t(locale, 'aiFriendsCall')}
                aria-expanded={callSheetOpen || videoCallOpen || audioCallOpen}
                aria-controls="portal-ai-call-sheet"
                data-runtime-action="ai-open-live-call"
                onClick={openCallSheet}
              >
                📞<span>{t(locale, 'aiFriendsCall')}</span>
              </button>
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="portal-ai-hidden-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) addLocalAttachment(t(locale, 'aiFriendsImageAttachmentKind'), file.name);
                event.target.value = '';
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              className="portal-ai-hidden-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) addLocalAttachment(t(locale, 'aiFriendsFileAttachmentKind'), file.name);
                event.target.value = '';
              }}
            />
            {mentionOptions.length ? (
              <div id="portal-ai-mention-menu" className="portal-ai-mention-menu" role="listbox" aria-label={t(locale, 'aiFriendsMentionMenuLabel')}>
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
                    <b>{mentionLabel(target)}</b>
                    <span>{t(locale, target.descriptionKey)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {conversationListOpen ? (
            <div id="portal-ai-conversation-list" className="portal-ai-conversation-sheet" role="dialog" aria-modal="true" aria-label={t(locale, 'aiFriendsConversationListAriaLabel')}>
              <button type="button" className="portal-ai-conversation-scrim" aria-label={t(locale, 'aiFriendsCloseConversationList')} onClick={() => setConversationListOpen(false)} />
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
                      <b>{conversationTitle(item)}{item.tagKey ? <small>{t(locale, item.tagKey)}</small> : null}</b>
                      <em>{t(locale, item.previewKey)}</em>
                    </span>
                    <i>{conversationTime(item)}</i>
                    {item.unread ? <strong>{item.unread}</strong> : null}
                  </button>
                ))}
              </section>
            </div>
          ) : null}

          {typeof document !== 'undefined' && callSheetOpen ? createPortal(
            <div className="portal-ai-modal-layer">
              <button type="button" className="portal-ai-modal-scrim" aria-label={t(locale, 'aiFriendsCloseCallOptions')} onClick={() => setCallSheetOpen(false)} />
              <section id="portal-ai-call-sheet" className="portal-ai-call-sheet" role="dialog" aria-modal="true" aria-label={t(locale, 'aiFriendsCallSheetTitle')}>
                <span className="portal-ai-sheet-handle" aria-hidden />
                <h2>{t(locale, 'aiFriendsCallSheetTitle')}</h2>
                <button type="button" onClick={() => { setCallSheetOpen(false); setVideoCallOpen(true); }}>
                  <span aria-hidden>📹</span>
                  <p>
                    <b>{t(locale, 'aiFriendsVideoCallOptionTitle')}</b>
                    <small>{t(locale, 'aiFriendsVideoCallSubtitle')}</small>
                  </p>
                  <i aria-hidden>›</i>
                </button>
                <button type="button" onClick={() => { setCallSheetOpen(false); setAudioCallOpen(true); }}>
                  <span aria-hidden>🎙</span>
                  <p>
                    <b>{t(locale, 'aiFriendsAudioCallOptionTitle')}</b>
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
