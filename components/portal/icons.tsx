/**
 * 设计系统描边图标集 — 全站去 emoji 的替代物(2026-07-04 UI 精修批次 1)。
 * 统一 24 viewBox / currentColor / strokeWidth 1.8,与 NesioProfileCard
 * 原有内联 SVG 同一语言。颜色由使用处的 color 决定。
 */

const base = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
} as const;

type IconProps = { size?: number };

function make(paths: React.ReactNode) {
  return function Icon({ size = 20 }: IconProps) {
    return <svg {...base} width={size} height={size} aria-hidden>{paths}</svg>;
  };
}

// ── 连接器 ──
export const IconCalendar = make(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>);
export const IconMail = make(<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></>);
export const IconCheck = make(<path d="m4 12.5 5 5L20 6.5" />);
export const IconPhone = make(<><path d="M6.5 3h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4 6.2 2 2 0 0 1 6 4z" /></>);
export const IconNavigate = make(<><path d="M3 11 21 3l-8 18-2-7z" /></>);
export const IconCloudSun = make(<><path d="M12 2v2M4.9 4.9l1.4 1.4M2 12h2" /><path d="M15.9 11.6a4 4 0 1 0-6.4 3.9" /><path d="M13 22H7a4 4 0 1 1 .6-7.9A5 5 0 0 1 17.5 16 3 3 0 0 1 17 22h-4z" /></>);
export const IconNote = make(<><path d="M4 4h13l3 3v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M8 9h8M8 13h8M8 17h5" /></>);
export const IconBook = make(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></>);
export const IconTimer = make(<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></>);
export const IconHeartPulse = make(<><path d="M19 14c1.5-1.5 3-3.3 3-5.5A5.5 5.5 0 0 0 12 5 5.5 5.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7z" /><path d="M3.5 12h4l1.5-3 3 6 1.5-3h4" /></>);
export const IconCheckSquare = make(<><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m8 12 3 3 5-6" /></>);
export const IconActivity = make(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />);
export const IconBookOpen = make(<><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" /></>);
export const IconCar = make(<><path d="M5 11 6.5 6.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" /><path d="M3 11h18a1 1 0 0 1 1 1v5h-2M2 17v-5a1 1 0 0 1 1-1M4 17h16" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></>);

// ── 通用/外观 ──
export const IconGear = make(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const IconDatabase = make(<><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5" /></>);
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconMoon = make(<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />);
export const IconHalfMoon = make(<><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" /></>);
export const IconLock = make(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>);
export const IconStar = make(<path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8L12 2z" />);
export const IconBookmark = make(<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />);
export const IconMic = make(<><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" /></>);
export const IconShield = make(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />);
export const IconLink = make(<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>);
export const IconChevronRight = make(<path d="m9 6 6 6-6 6" />);
export const IconCard = make(<><rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" /><path d="M6 15h4" /></>);
export const IconHelpCircle = make(<><circle cx="12" cy="12" r="9" /><path d="M9.3 9.3a2.7 2.7 0 1 1 3.9 2.4c-.75.37-1.2.9-1.2 1.7v.35" /><path d="M12 17h.01" /></>);
export const IconDownload = make(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>);
// 加号:今天页输入条左侧「加图片/文件」。用图标而不是 + 字符 —— 字符当图标在自查里被抓过一轮。
export const IconPlus = make(<><path d="M12 5v14M5 12h14" /></>);
export const IconUpload = make(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 8 5-5 5 5M12 3v12" /></>);

// ── 记忆节点类型 / 领域 / 天气(批次 2 全站去 emoji)──
export const IconUser = make(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>);
export const IconBox = make(<><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>);
export const IconMapPin = make(<><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>);
export const IconFlag = make(<><path d="M4 22V4a2 2 0 0 1 2-2h9l-1.5 4L15 10H6" /></>);
export const IconTarget = make(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /></>);
export const IconCheckCircle = make(<><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>);
export const IconClock = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2.2" /></>);
export const IconSpeaker = make(<><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>);
export const IconThermometer = make(<><path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z" /><path d="M12 17.5v-6" /></>);
export const IconSmile = make(<><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></>);
export const IconKeyboard = make(<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" /></>);
export const IconCamera = make(<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>);
export const IconImage = make(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>);
export const IconFile = make(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>);
export const IconHistory = make(<><path d="M3 3v6h6" /><path d="M3.5 9a9 9 0 1 1-.5 3" /><path d="M12 7v5l3.5 2" /></>);
export const IconSnowflake = make(<><path d="M12 2v20M4 6l16 12M20 6 4 18" /><path d="m9 4 3 2 3-2M9 20l3-2 3 2" /></>);
export const IconMap = make(<><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></>);
export const IconFolder = make(<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />);
export const IconRefresh = make(<><path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 3v6h-6" /></>);
export const IconAlertTriangle = make(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>);
// 剧场 logo:线条空心三角(2026-07-28 UI 精修 —— 实心块与其余描边图标不同语言)。
export const IconPlay = make(<path d="M8 5.2v13.6L19 12z" />);
export const IconGlobe = make(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18z" /></>);
export const IconHome = make(<><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22v-8h6v8" /></>);
export const IconTrendingUp = make(<><path d="m2 17 7-7 4 4 9-9" /><path d="M15 5h7v7" /></>);
export const IconTrendingDown = make(<><path d="m2 7 7 7 4-4 9 9" /><path d="M15 19h7v-7" /></>);
export const IconZap = make(<path d="M13 2 3 14h7l-1 8 10-12h-7z" />);
export const IconBalloon = make(<><ellipse cx="12" cy="9" rx="6.5" ry="7.5" /><path d="M12 16.5c-.6 1 .6 1.5 0 2.5-.5.9-1.5 1.2-1.5 3" /></>);
export const IconCloud = make(<path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 12.4 4 4 0 0 0 6 20h11.5z" />);
export const IconPlane = make(<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />);
export const IconGift = make(<><rect x="3" y="8" width="18" height="4" /><path d="M12 8v13M5 12v9h14v-9" /><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" /></>);
export const IconBed = make(<><path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10" /><path d="M2 17h20M6 8v9" /><circle cx="7" cy="12" r="1.2" /></>);
export const IconUtensils = make(<><path d="M3 2v7a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V2M7 2v20" /><path d="M17 2c-1.7 0-3 2-3 5s1.3 5 3 5v10M17 2c1.7 0 3 2 3 5s-1.3 5-3 5" /></>);
export const IconBriefcase = make(<><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M2 13h20" /></>);
export const IconBulb = make(<><path d="M9 18h6M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z" /></>);
export const IconRain = make(<><path d="M17.5 15a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 8.4 4 4 0 0 0 6 16" /><path d="M8 19v2M12 18v3M16 19v2" /></>);
/** 镜子 / 多面镜入口 */
export const IconMirror = make(<><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M9 8h6M9 12h4M9 16h5" /></>);
/** 家人 / 家务入口 */
export const IconPeople = make(<><path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11a2.5 2.5 0 1 0 0-5" /><path d="M4 20v-1a5 5 0 0 1 10 0v1M15.5 15.5A5 5 0 0 1 20 20v1" /></>);

// ── 衣橱(2026-07-29:入口曾误用 IconBookmark「收藏夹」,衣物卡一律 👕 emoji)──
/** 衣橱入口 —— 衣架 */
export const IconHanger = make(<><path d="M12 8.2V6.6a2 2 0 1 1 2-2" /><path d="m12 8.2-8.3 6.3a1.3 1.3 0 0 0 .8 2.3h15a1.3 1.3 0 0 0 .8-2.3z" /></>);
/** 上装 —— T恤 */
export const IconShirt = make(<path d="M8.2 3 4 5.4l1.5 4.2 2.4-.9V21h8.2V8.7l2.4.9L20 5.4 15.8 3a3.9 3.9 0 0 1-7.6 0z" />);
/** 下装 —— 长裤 */
export const IconPants = make(<><path d="M6.5 3h11l.8 18h-4.5L12 11.5 10.2 21H5.7z" /><path d="M6.7 7.4h10.6" /></>);
/** 外套 —— 开襟 + 领口 */
export const IconJacket = make(<><path d="M9 3 4.6 5.4 3.4 9.8l2.4.9V21h12.4V10.7l2.4-.9-1.2-4.4L15 3l-3 3.1z" /><path d="M12 6.1V21" /></>);
/** 连衣裙 */
export const IconDress = make(<><path d="M9.2 3h5.6l-1.2 4.4L18 21H6l4.4-13.6z" /><path d="M9.2 3 12 5.1 14.8 3" /></>);
/** 鞋 */
export const IconShoe = make(<><path d="M2 18.8v-6.3h2.7l2.9 2 4.6.8c2.9.5 5.3 1.2 7.2 2.2.9.5 1.4 1.3 1.4 2.3v.7H3.2A1.2 1.2 0 0 1 2 19.3z" /><path d="M4.7 12.5v3.4" /></>);
/** 配饰 —— 腕表 */
export const IconWatch = make(<><circle cx="12" cy="12" r="4.8" /><path d="M9.2 7.5 9.6 3h4.8l.4 4.5M9.2 16.5l.4 4.5h4.8l.4-4.5" /></>);
/** 喜欢 / 不喜欢(替代 👍👎)*/
export const IconThumbUp = make(<><path d="M7 10.5v11" /><path d="M15 5.9 14 10h5.8a2 2 0 0 1 2 2.6l-2.4 8a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-7.5a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z" /></>);
export const IconThumbDown = make(<><path d="M17 13.5v-11" /><path d="M9 18.1 10 14H4.2a2 2 0 0 1-2-2.6l2.4-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9z" /></>);

/** 叶子(休眠/自然,替代 🌿) */
export const IconLeaf = make(<><path d="M4 20c0-8 5.5-13 16-13 0 9-5 14-12.5 14H4z" /><path d="M9 15c1.8-3.4 4.3-5.6 8-7" /></>);

/** 步行(足迹时间线的出行方式,配 IconCar 用) */
export const IconWalk = make(<><circle cx="13" cy="4" r="1.8" /><path d="M11 21l1.6-5.4-2.6-2.2.8-4.6 3.2 1.4 2.6 2.6" /><path d="M8.2 9.4 6 12M12.6 15.6 15 21" /></>);

/** 衣物类别 → 描边图标。衣橱里所有缩略图占位、类别标题都走这里,不再一律 👕。 */
export function GarmentIcon({ type, size = 20 }: { type: string; size?: number }) {
  switch (type) {
    case 'top': return <IconShirt size={size} />;
    case 'bottom': return <IconPants size={size} />;
    case 'outer': return <IconJacket size={size} />;
    case 'dress': return <IconDress size={size} />;
    case 'shoes': return <IconShoe size={size} />;
    case 'accessory': return <IconWatch size={size} />;
    default: return <IconHanger size={size} />;
  }
}

/** 记忆节点类型 → 描边图标(替代 👤📦📍📅🤝🩷⭐ emoji 映射) */
export function NodeTypeIcon({ type, size = 16 }: { type: string; size?: number }) {
  switch (type) {
    case 'person': return <IconUser size={size} />;
    case 'object': return <IconBox size={size} />;
    case 'place': return <IconMapPin size={size} />;
    case 'event': return <IconCalendar size={size} />;
    case 'commitment': return <IconFlag size={size} />;
    case 'health_state': return <IconHeartPulse size={size} />;
    case 'preference': return <IconStar size={size} />;
    case 'note': return <IconNote size={size} />;
    default: return <IconNote size={size} />;
  }
}

/** 生活领域 → 描边图标(替代 domain-taxonomy 的 🏡📈📦🩷🧘) */
export function DomainIcon({ domain, size = 13 }: { domain: string; size?: number }) {
  switch (domain) {
    case 'life': return <IconHome size={size} />;
    case 'growth': return <IconTrendingUp size={size} />;
    case 'assets': return <IconBox size={size} />;
    case 'health': return <IconHeartPulse size={size} />;
    case 'energy': return <IconZap size={size} />;
    default: return <IconNote size={size} />;
  }
}

/** 天气状况 → 常见天气图标 */
export function WeatherIcon({ condition, size = 16 }: { condition: string; size?: number }) {
  if (/晴|sunny|clear/i.test(condition)) return <IconSun size={size} />;
  if (/雨|rain|shower|drizzle/i.test(condition)) return <IconRain size={size} />;
  if (/雪|snow/i.test(condition)) return <IconSnowflake size={size} />;
  if (/阴|多云|云|cloud|overcast/i.test(condition)) return <IconCloud size={size} />;
  return <IconCloudSun size={size} />;
}

/**
 * emoji → 描边图标的**渲染层**转换表。
 *
 * 为什么留着 emoji:好几处数据层(引导卡缓存、工具箱清单、旧记录)里存的就是 emoji 字符串,
 * 有的还跨版本/跨仓共享。改数据层要迁移历史数据,风险远大于收益 ——
 * 所以数据层照旧,**渲染层一律换成站内描边图标**。
 * 2026-07-29:从 GuidanceIcon 里提出来通用化,工具箱等处也走这张表(此前它们直接渲染 emoji)。
 */
const EMOJI_ICON: Record<string, React.ComponentType<{ size?: number }>> = {
  '✈️': IconPlane, '🏥': IconHeartPulse, '⏰': IconClock, '🎂': IconGift,
  '💝': IconStar, '🧳': IconMap, '🎙': IconMic, '📩': IconMail,
  '💪': IconActivity, '🧥': IconCloud, '☂️': IconRain, '📦': IconBox,
  '💡': IconBulb, '🗓': IconCalendar, '✅': IconCheckCircle, '🌙': IconMoon,
  '🎈': IconBalloon, '✨': IconStar,
  // 工具箱 / 今天页卡片(2026-07-29 补)
  '📖': IconBookOpen, '🏋️': IconActivity, '🏋': IconActivity, '🌱': IconLeaf,
  '🚗': IconCar, '💊': IconHeartPulse, '🏡': IconHome, '⚡': IconZap, '⚡️': IconZap,
  '✦': IconStar, '📝': IconNote, '📬': IconMail, '📌': IconFlag, '📍': IconMapPin,
  '🕊️': IconBalloon, '🕊': IconBalloon, '🌿': IconLeaf, '🎁': IconGift, '☁': IconCloud, '☁️': IconCloud,
};

/** 任意 emoji 字符串 → 描边图标(表里没有就退回便签图标,绝不把 emoji 漏到界面上) */
export function EmojiIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  const C = EMOJI_ICON[icon];
  return C ? <C size={size} /> : <IconNote size={size} />;
}

/** 引导卡 emoji 图标 → 描边图标(保留原名,内部走同一张表) */
export function GuidanceIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  return <EmojiIcon icon={icon} size={size} />;
}
