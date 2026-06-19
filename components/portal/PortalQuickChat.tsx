'use client';

import { withBase } from '@/lib/portal/paths';

function SecretaryChatIcon() {
  return (
    <svg
      className="portal-quick-chat-fab-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
    >
      <path
        d="M7.25 17.4H6.1c-1.35 0-2.45-1.1-2.45-2.45V7.6c0-1.35 1.1-2.45 2.45-2.45h11.8c1.35 0 2.45 1.1 2.45 2.45v7.35c0 1.35-1.1 2.45-2.45 2.45h-5.75L7.25 20v-2.6Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.25 11.25h.01M12 11.25h.01M15.75 11.25h.01"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function PortalQuickChat() {
  return (
    <div className="portal-quick-chat">
      <a
        className="portal-quick-chat-fab"
        href={withBase('/secretary')}
        aria-label="打开智友"
      >
        <SecretaryChatIcon />
      </a>
    </div>
  );
}
