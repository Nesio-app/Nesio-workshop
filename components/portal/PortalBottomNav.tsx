'use client';

interface PortalBottomNavProps {
  aiFriendsOpen?: boolean;
  treasureOpen?: boolean;
  onHome: () => void;
  onOpenAiFriends: () => void;
  onOpenTreasure: () => void;
}

export default function PortalBottomNav({
  aiFriendsOpen = false,
  treasureOpen = false,
  onHome,
  onOpenAiFriends,
  onOpenTreasure,
}: PortalBottomNavProps) {
  return (
    <nav className="portal-bottom-nav" aria-label="宝盒导航">
      <button
        type="button"
        className="portal-bottom-nav-btn"
        onClick={onHome}
        aria-label="首页"
      >
        <span className="portal-bottom-nav-icon portal-bottom-nav-icon--symbol" aria-hidden>
          ⌂
        </span>
        <span className="portal-bottom-nav-label">首页</span>
      </button>
      <button
        type="button"
        className={
          'portal-bottom-nav-btn' + (aiFriendsOpen ? ' portal-bottom-nav-btn--active' : '')
        }
        onClick={onOpenAiFriends}
        aria-label="智友"
        aria-expanded={aiFriendsOpen}
      >
        <span className="portal-bottom-nav-icon portal-bottom-nav-icon--symbol" aria-hidden>✦</span>
        <span className="portal-bottom-nav-label">智友</span>
      </button>
      <button
        type="button"
        className={
          'portal-bottom-nav-btn' + (treasureOpen ? ' portal-bottom-nav-btn--active' : '')
        }
        onClick={onOpenTreasure}
        aria-label="工具箱"
        aria-expanded={treasureOpen}
      >
        <span className="portal-bottom-nav-icon portal-bottom-nav-icon--symbol" aria-hidden>▦</span>
        <span className="portal-bottom-nav-label">工具箱</span>
      </button>
    </nav>
  );
}
