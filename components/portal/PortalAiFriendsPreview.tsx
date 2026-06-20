'use client';

import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createAppApiClient, type SecretaryChatProvider, type SecretaryChatTurn } from '@/lib/portal/app-api-client';

interface PortalAiFriendsPreviewProps {
  open: boolean;
  onClose: () => void;
}

type MentionTarget = {
  key: string;
  label: string;
  description: string;
  avatar: string;
};

type RuntimeMessage = SecretaryChatTurn & {
  provider?: SecretaryChatProvider;
};

const mentionTargets: MentionTarget[] = [
  { key: 'claude', label: '@Claude', description: '长文推理 / 方案拆解', avatar: 'AI' },
  { key: 'chatgpt', label: '@ChatGPT', description: '写作推理 / 日常助手', avatar: 'G' },
  { key: 'gemini', label: '@Gemini', description: '多模态 / 实时信息', avatar: '✦' },
  { key: 'flomo', label: '@Flomo', description: '保存为笔记', avatar: 'F' },
  { key: 'inventory', label: '@物品库', description: '记一个物品 / 查到期', avatar: '📦' },
];

const searchShortcuts = [
  ['🗓', '日期'],
  ['✦', 'AI 建议'],
  ['📝', '笔记'],
  ['📦', '物品'],
  ['💰', '支出'],
  ['✅', '待办'],
  ['📷', '图片'],
  ['📞', '通话'],
  ['📎', '文件'],
];

const recentConversations = [
  {
    id: 'smart',
    title: '智友',
    tag: '智能调度',
    preview: '综合建议：定制相册配手写卡片最暖心...',
    avatar: '✦',
    time: '11:20',
    unread: '2',
  },
  {
    id: 'group',
    title: '产品脑暴群',
    tag: '群聊',
    preview: 'Claude、ChatGPT、Gemini：3 个 AI 正在讨论方案...',
    avatar: '👥',
    time: '10:05',
  },
  {
    id: 'claude',
    title: 'Claude',
    preview: '可以考虑定制相册，附上手写信，300 元内...',
    avatar: 'AI',
    time: '昨天',
  },
  {
    id: 'chatgpt',
    title: 'ChatGPT',
    preview: '护肤礼盒很受欢迎，兰蔻套装 300 元左右...',
    avatar: 'G',
    time: '昨天',
  },
  {
    id: 'gemini',
    title: 'Gemini',
    preview: '300 元做定制相册很充裕，加急运费留 50...',
    avatar: 'G',
    time: '昨天',
  },
];

function resolveSecretaryProvider(composer: string): SecretaryChatProvider {
  const normalized = composer.toLowerCase();
  if (normalized.includes('@chatgpt')) return 'chatgpt';
  if (normalized.includes('@豆包') || normalized.includes('@doubao')) return 'doubao';
  return 'gemini';
}

function stripAssistantMentions(message: string): string {
  return message
    .replace(/@(Claude|ChatGPT|Gemini|豆包|Doubao)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function PortalAiFriendsPreview({ open }: PortalAiFriendsPreviewProps) {
  const [composer, setComposer] = useState('');
  const [runtimeMessages, setRuntimeMessages] = useState<RuntimeMessage[]>([]);
  const [aiSending, setAiSending] = useState(false);
  const [surface, setSurface] = useState<'chat' | 'search'>('chat');
  const [attachmentTrayOpen, setAttachmentTrayOpen] = useState(false);
  const [searchToolsOpen, setSearchToolsOpen] = useState(false);
  const [conversationListOpen, setConversationListOpen] = useState(false);
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [videoCallOpen, setVideoCallOpen] = useState(false);
  const [audioCallOpen, setAudioCallOpen] = useState(false);
  const [utilityNotice, setUtilityNotice] = useState('');
  const [localAttachments, setLocalAttachments] = useState<string[]>([]);
  const composerRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const appApiClient = useMemo(() => createAppApiClient(), []);

  const mentionNeedle = useMemo(() => {
    const match = composer.match(/@([\w\u4e00-\u9fa5]*)$/);
    return match?.[1]?.toLowerCase() ?? null;
  }, [composer]);

  const mentionOptions = useMemo(() => {
    if (mentionNeedle === null) return [];
    return mentionTargets.filter((target) => target.label.toLowerCase().includes(mentionNeedle));
  }, [mentionNeedle]);

  if (!open) return null;

  const startNewThread = () => {
    setSurface('chat');
    setComposer('');
    setConversationListOpen(true);
    setUtilityNotice('已新建一条集合对话，可以直接 @AI 或 @工具。');
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const openAttachmentTray = () => {
    setAttachmentTrayOpen((value) => !value);
    setUtilityNotice('图片、文件、语音会先作为本地意图保留；真实上传与外部授权后续再开。');
  };

  const openMentionMenu = () => {
    setSurface('chat');
    setComposer((value) => {
      if (/@[\w\u4e00-\u9fa5]*$/.test(value)) return value;
      return `${value}${value.endsWith(' ') || value.length === 0 ? '' : ' '}@`;
    });
    requestAnimationFrame(() => composerRef.current?.focus());
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
    setUtilityNotice(`${label} 已作为本地意图加入；真实上传后续单独授权。`);
  };

  const addFlomoNoteIntent = () => {
    setComposer((value) => `${value}${value.endsWith(' ') || value.length === 0 ? '' : ' '}@Flomo `);
    setLocalAttachments((items) => ['笔记：将本条保存到 Flomo', ...items].slice(0, 3));
    setUtilityNotice('已准备 Flomo 笔记意图，发送后会进入本地 mock 记录。');
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const sendComposerMessage = async () => {
    const rawMessage = composer.trim();
    if (!rawMessage || aiSending) {
      if (!rawMessage) setUtilityNotice('先写一句想问智友的话，或用 @ 拉入一个 AI。');
      return;
    }

    const provider = resolveSecretaryProvider(composer);
    const message = stripAssistantMentions(rawMessage) || rawMessage;
    const history: SecretaryChatTurn[] = runtimeMessages
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));
    const userMessage: RuntimeMessage = { role: 'user', content: rawMessage, provider };

    setRuntimeMessages((items) => [...items, userMessage]);
    setComposer('');
    setAiSending(true);
    setUtilityNotice(`正在连接 ${provider === 'chatgpt' ? 'ChatGPT' : provider === 'doubao' ? '豆包' : 'Gemini'}...`);

    try {
      const result = await appApiClient.sendSecretaryMessage({
        provider: resolveSecretaryProvider(composer),
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
        setUtilityNotice(`已连接 ${result.model || provider}。`);
      } else {
        const errorText = [result.error, result.detail, result.hint].filter(Boolean).join(' · ') || 'AI 暂时不可用';
        setRuntimeMessages((items) => [
          ...items,
          {
            role: 'assistant',
            content: `暂时没有连上：${errorText}`,
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
          content: `暂时没有连上：${errorText}`,
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
    <section className="portal-ai-preview portal-ai-preview--screen" aria-label="智友">
      {surface === 'search' ? (
        <section className="portal-ai-search-surface" aria-label="智友搜索">
          <header className="portal-ai-search-head">
            <button type="button" className="portal-ai-screen-icon-btn" onClick={() => setSurface('chat')}>
              <span aria-hidden>←</span>
              <span className="sr-only">返回智友</span>
            </button>
            <h1>搜索</h1>
            <button type="button" className="portal-ai-screen-icon-btn" aria-label="新建对话" onClick={startNewThread}>
              +
            </button>
          </header>
          <label className="portal-ai-search-input">
            <span aria-hidden>⌕</span>
            <input
              type="search"
              placeholder="搜索对话、笔记、AI 建议..."
              onFocus={() => setSearchToolsOpen(true)}
              onChange={() => setSearchToolsOpen(true)}
            />
          </label>
          {searchToolsOpen ? (
            <div className="portal-ai-search-grid" aria-label="搜索分类">
              {searchShortcuts.map(([icon, label]) => (
                <button key={label} type="button">
                  <span aria-hidden>{icon}</span>
                  <b>{label}</b>
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
                className="portal-ai-recent-row"
                onClick={() => {
                  setSurface('chat');
                  setUtilityNotice(`已切换到 ${item.title} 对话。`);
                }}
              >
                <span className="portal-ai-conversation-avatar" aria-hidden>
                  {item.avatar}
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
                onClick={() => setSurface('search')}
              >
                ⌕
              </button>
              <button type="button" className="portal-ai-screen-icon-btn" aria-label="打开对话列表" onClick={() => setConversationListOpen(true)}>
                💬
              </button>
            </div>
          </header>

          <section className="portal-ai-thread" aria-label="集合对话">
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
                    {message.provider === 'chatgpt' ? 'G' : message.provider === 'doubao' ? '豆' : '✦'}
                  </span>
                  <p className="portal-ai-message portal-ai-message--assistant">{message.content}</p>
                </div>
              )
            ))}
          </section>

          <div className="portal-ai-composer">
            {attachmentTrayOpen ? (
              <div className="portal-ai-capability-rail" aria-label="智友快捷能力">
                <button type="button" onClick={() => imageInputRef.current?.click()}>📷<span>图片</span></button>
                <button type="button" onClick={() => fileInputRef.current?.click()}>📎<span>文件</span></button>
                <button type="button" onClick={() => setAudioCallOpen(true)}>🎙<span>语音</span></button>
                <button type="button" onClick={() => setCallSheetOpen(true)}>📞<span>实时</span></button>
                <button type="button" onClick={addFlomoNoteIntent}>📝<span>笔记</span></button>
              </div>
            ) : null}
            <p>输入框搞定一切： @AI 拉它进来 · @Flomo 存笔记 · @物品库 记物品</p>
            {(utilityNotice || localAttachments.length > 0) ? (
              <div className="portal-ai-local-status" aria-live="polite">
                {localAttachments.map((item) => (
                  <span key={item}>{item}</span>
                ))}
                <small>{utilityNotice}</small>
              </div>
            ) : null}
            <div className="portal-ai-composer-row">
              <button type="button" className="portal-ai-round-action" aria-label="添加附件" onClick={openAttachmentTray}>＋</button>
              <button type="button" className="portal-ai-round-action" aria-label="@ 调度" onClick={openMentionMenu}>@</button>
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
                placeholder="发消息给智友..."
                disabled={aiSending}
              />
              <button type="button" className="portal-ai-round-action" aria-label="语音输入" onClick={() => setAudioCallOpen(true)}>🎙</button>
              <button type="button" className="portal-ai-call-button" aria-label="通话" onClick={() => setCallSheetOpen(true)}>
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
              <div className="portal-ai-mention-menu" role="listbox" aria-label="@ 调度候选">
                {mentionOptions.map((target) => (
                  <button
                    key={target.key}
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => insertMention(target)}
                  >
                    <b>{target.label}</b>
                    <span>{target.description}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {conversationListOpen ? (
            <div className="portal-ai-conversation-sheet" role="dialog" aria-modal="true" aria-label="AI 对话列表">
              <button type="button" className="portal-ai-conversation-scrim" aria-label="关闭 AI 对话列表" onClick={() => setConversationListOpen(false)} />
              <section>
                <span className="portal-ai-sheet-handle" aria-hidden />
                <h2>所有 AI 对话</h2>
                {recentConversations.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="portal-ai-recent-row"
                    onClick={() => {
                      setConversationListOpen(false);
                      setSurface('chat');
                      setUtilityNotice(`已切换到 ${item.title} 对话。`);
                    }}
                  >
                    <span className="portal-ai-conversation-avatar" aria-hidden>{item.avatar}</span>
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
              <section className="portal-ai-call-sheet" role="dialog" aria-modal="true" aria-label="Live 通话">
                <span className="portal-ai-sheet-handle" aria-hidden />
                <h2>Live 通话</h2>
                <button type="button" onClick={() => { setCallSheetOpen(false); setVideoCallOpen(true); }}>
                  <span aria-hidden>📹</span>
                  <p>
                    <b>视频通话</b>
                    <small>和智友面对面，实时回应</small>
                  </p>
                  <i aria-hidden>›</i>
                </button>
                <button type="button" onClick={() => { setCallSheetOpen(false); setAudioCallOpen(true); }}>
                  <span aria-hidden>🎙</span>
                  <p>
                    <b>音频通话</b>
                    <small>语音实时对话，解放双手</small>
                  </p>
                  <i aria-hidden>›</i>
                </button>
              </section>
            </div>,
            document.body,
          ) : null}

          {typeof document !== 'undefined' && audioCallOpen ? createPortal(
            <div className="portal-ai-modal-layer portal-ai-modal-layer--call">
              <section className="portal-ai-video-call" role="dialog" aria-modal="true" aria-label="AI 实时语音通话">
                <div className="portal-ai-video-avatar" aria-hidden>🎙</div>
                <p>正在连接实时语音通话</p>
                <small>Mock Live · 后续接入 Gemini Live 类实时语音模型</small>
                <button type="button" onClick={() => setAudioCallOpen(false)}>结束</button>
              </section>
            </div>,
            document.body,
          ) : null}

          {typeof document !== 'undefined' && videoCallOpen ? createPortal(
            <div className="portal-ai-modal-layer portal-ai-modal-layer--call">
              <section className="portal-ai-video-call" role="dialog" aria-modal="true" aria-label="AI 虚拟形象视频通话">
                <div className="portal-ai-video-avatar" aria-hidden>✦</div>
                <p>正在连接智友虚拟形象</p>
                <small>Mock Live · 后续接入实时语音/视频模型</small>
                <button type="button" onClick={() => setVideoCallOpen(false)}>结束</button>
              </section>
            </div>,
            document.body,
          ) : null}
        </>
      )}
    </section>
  );
}
