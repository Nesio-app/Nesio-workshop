'use client';

import { useMemo, useState } from 'react';

interface PortalAiFriendsPreviewProps {
  open: boolean;
  onClose: () => void;
}

const conversations = [
  {
    id: 'smart',
    name: '智友',
    tag: '智能调度',
    avatar: '✦',
    className: 'portal-ai-conversation-avatar--smart',
    preview: '综合建议：定制相册配手写卡片最暖心...',
    time: '11:20',
    unread: '2',
  },
  {
    id: 'group',
    name: '产品脑暴群',
    tag: '群聊',
    avatar: '👥',
    className: 'portal-ai-conversation-avatar--group',
    preview: 'Claude、ChatGPT、Gemini：3 个 AI 正在讨论方案...',
    time: '10:05',
  },
  {
    id: 'claude',
    name: 'Claude',
    avatar: 'AI',
    className: 'portal-ai-conversation-avatar--claude',
    preview: 'Anthropic · 即将接入',
    time: '待接',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    avatar: 'G',
    className: 'portal-ai-conversation-avatar--chatgpt',
    preview: 'OpenAI 大模型，适合推理、写作与多步骤任务...',
    time: '19:56',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    avatar: '✦',
    className: 'portal-ai-conversation-avatar--gemini',
    preview: '我是你的幕僚，可以帮你理清待办与优先级...',
    time: '19:56',
  },
  {
    id: 'doubao',
    name: '豆包',
    avatar: '◐',
    className: 'portal-ai-conversation-avatar--doubao',
    preview: '豆包大模型，适合日常对话与中文任务。',
    time: '19:56',
  },
  {
    id: 'inventory',
    name: '物品库 Agent',
    tag: '工具',
    avatar: '📦',
    className: 'portal-ai-conversation-avatar--inventory',
    preview: '牛奶后天到期，需要我加入购物清单吗？',
    time: '08:00',
    unread: '1',
  },
];

export default function PortalAiFriendsPreview({ open }: PortalAiFriendsPreviewProps) {
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState('smart');
  const filteredConversations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((item) =>
      `${item.name} ${item.tag ?? ''} ${item.preview}`.toLowerCase().includes(needle),
    );
  }, [query]);
  const activeConversation = conversations.find((item) => item.id === activeId) ?? conversations[0];

  if (!open) return null;

  return (
    <section className="portal-ai-preview portal-ai-preview--screen" aria-label="智友">
      <header className="portal-ai-screen-head">
        <button type="button" className="portal-ai-screen-icon-btn" aria-label="群聊">
          👥
        </button>
        <h1>智友</h1>
        <button type="button" className="portal-ai-screen-icon-btn" aria-label="新建对话">
          +
        </button>
      </header>

      <label className="portal-ai-screen-search">
        <span aria-hidden>⌕</span>
        <input
          type="search"
          placeholder="搜索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="portal-ai-conversation-list">
        {filteredConversations.map((item) => (
          <button
            key={item.id}
            type="button"
            className={'portal-ai-conversation' + (item.id === activeId ? ' portal-ai-conversation--active' : '')}
            onClick={() => setActiveId(item.id)}
            aria-pressed={item.id === activeId}
          >
            <span className={`portal-ai-conversation-avatar ${item.className}`} aria-hidden>
              {item.avatar}
            </span>
            <span className="portal-ai-conversation-body">
              <span className="portal-ai-conversation-title">
                {item.name}
                {item.tag ? <small>{item.tag}</small> : null}
              </span>
              <span className="portal-ai-conversation-preview">{item.preview}</span>
            </span>
            <span className="portal-ai-conversation-meta">
              <span>{item.time}</span>
              {item.unread ? <b>{item.unread}</b> : null}
            </span>
          </button>
        ))}
      </div>

      <section className="portal-ai-active-chat" aria-label="当前对话">
        <div>
          <span className={`portal-ai-active-avatar ${activeConversation.className}`} aria-hidden>
            {activeConversation.avatar}
          </span>
          <p>
            <b>{activeConversation.name}</b>
            <small>{activeConversation.preview}</small>
          </p>
        </div>
        <label>
          <span className="sr-only">输入消息</span>
          <input placeholder="发消息、图片、语音或文件..." />
        </label>
      </section>

      <div className="portal-ai-screen-capabilities" aria-label="智友能力">
        <button type="button">📷<span>图片</span></button>
        <button type="button">📎<span>文件</span></button>
        <button type="button">🎙<span>语音</span></button>
        <button type="button">📞<span>Live</span></button>
        <button type="button">👥<span>群聊</span></button>
      </div>
    </section>
  );
}
