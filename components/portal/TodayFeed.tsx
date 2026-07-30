'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { portalLocaleToDictionaryLocale, loadProfileSettings } from '@/lib/portal/profile';
import { reportDue } from '@/lib/portal/daily-report-persist';
import { useProfileAvatar } from './use-profile-avatar';
import { getPoints } from '@/lib/platform/rewards-engine';
import NesioMark from './NesioMark';
import RetrospectCard from './RetrospectCard';
import { usePortalLocale } from './use-portal-locale';
import { L } from '@/lib/portal/i18n';
import { buildTodayViewModel, focusTimeHint, markFocusNodeDone, deleteFocusNode, addCommitmentNode, addMeetingNotes, saveSubtasks, toggleSubtask, type FocusNode, type SubTask, type ProactiveContext, type ProactiveContextItem, getLiveMemoryNode, type LiveMemoryNode } from '@/lib/platform/view-models/today-view-model';
import type { CalendarEvent } from '@/lib/portal/types';
import { dismissJudgedCard, judgeState, clearJudgeError } from '@/lib/portal/guidance-judge-auto';

/**
 * 判决失败的原因 → 人话。ledger 里存的是 `route 401` / `route 429` / `network` /
 * 服务端回的 error 码。直接印这些字符串等于没说,但也**不能编** —— 认不出就
 * 原样带出去,至少能 grep 到。
 */
function judgeReason(err: string, locale: string): string {
  const e = err.toLowerCase();
  if (e.includes('401') || e.includes('unauthorized') || e.includes('not_signed_in')) return L(locale, '需要先登录', 'sign-in needed');
  if (e.includes('403') || e.includes('forbidden') || e.includes('paid')) return L(locale, '这台设备没开这项', 'not enabled here');
  if (e.includes('429') || e.includes('rate')) return L(locale, '这会儿太频繁了', 'rate limited');
  if (e.includes('network') || e.includes('fetch')) return L(locale, '网络没通', 'network down');
  if (e.startsWith('route 5') || e.includes('500') || e.includes('502') || e.includes('503')) return L(locale, '服务端出错', 'server error');
  if (e.includes('parse') || e.includes('bad_json')) return L(locale, '返回看不懂', 'bad response');
  return err;
}
import { resolveCardTarget, openCardTarget } from '@/lib/portal/card-target';
import ProactiveCardDetail from './today/ProactiveCardDetail';
import { createAppApiClient } from '@/lib/portal/app-api-client';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { dismissProactiveById, getProactiveCardBudget, type ProactiveCardData } from './today/proactive-types';
import { archiveShownCard } from '@/lib/portal/card-archive';
import { ProactiveGuidanceCard } from './today/ProactiveGuidanceCard';
import { ExperimentCheckinCard } from './today/ExperimentCheckinCard';
import CaptureBar from './today/CaptureBar';
import { RoutineDueCards } from './today/RoutineDueCards';
import { DailyReportCard } from './today/DailyReportCard';
import { ThawedReminder } from './today/ThawedReminder';
import { ReengageNudgeCard } from './today/ReengageNudgeCard';
import { TodayFocusSection } from './today/FocusSection';
import { useTodayData } from './today/useTodayData';
import { FocusModeSheet } from './today/FocusModeSheet';
import { MeetingRecorderSheet } from './today/MeetingRecorderSheet';

const MoodTrendSheet = dynamic(() => import('./MoodTrendSheet'), { ssr: false });
const MemoryNodeDetailLazy = dynamic(() => import('./MemoryNodeDetail'), { ssr: false });
const FamilyTodayStrip = dynamic(() => import('./today/FamilyTodayStrip'), { ssr: false });
import MemoryFlashBanner, { useMemoryFlash } from './MemoryFlashBanner';
import WrappedCard, { useWrappedTrigger } from './WrappedCard';
import { takeCloudRestoreReceipt, restoreReceiptText } from '@/lib/portal/cloud-restore-receipt';

// ---- Main TodayFeed component ----

export default function TodayFeed({
  canUsePrivateData,
  onOpenMemory,
}: {
  canUsePrivateData: boolean;
  onOpenMemory?: () => void;
}) {
  const {
    displayName,
    memoryCount, memoryNotes, todayReport,
    focusNodes, allNodes, receipt,
    dormantStore, setDormantStore,
    calendarEvents, proactiveContext,
    proactiveCards, setProactiveCards,
    dismissedCardIds, setDismissedCardIds,
  } = useTodayData(canUsePrivateData);
  const [moodTrendOpen, setMoodTrendOpen] = useState(false);
  const [points, setPoints] = useState(0); // App 级积分(奖品商城),顶栏徽章
  useEffect(() => {
    const sync = () => { try { setPoints(getPoints()); } catch { /* SSR / 无存储 */ } };
    sync();
    window.addEventListener('nesio-rewards-updated', sync);
    return () => window.removeEventListener('nesio-rewards-updated', sync);
  }, []);
  const [guideDetailNode, setGuideDetailNode] = useState<LiveMemoryNode | null>(null); // 批次 83:引导卡点开详情
  // 云端往本机填过数据时的一次性回执(QA:积分 0→150 像被人乱改)。读一次即清。
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  // 批次 31:焦点下方快捷输入(用户新指令)
  const [quickAdd, setQuickAdd] = useState('');
  const uiLocale = portalLocaleToDictionaryLocale(usePortalLocale());
  /**
   * 「+」传完东西之后那条回执。
   *
   * 2026-07-29:这个 state 之前**被 set 了却从来没有渲染** —— 整份文件搜不到第二处引用。
   * 所以传完什么反馈都没有,用户不知道到底存没存进去(这正是要补的「已存入」提示)。
   * 现在存成功先报一句,识别结果回来了再把它补进同一条回执里。
   */
  const [quickSaved, setQuickSaved] = useState<string>('');

  /**
   * 「+」上传 → 落成记忆(2026-07-28)。
   *
   * **不按类型白名单收,按体积设限** —— 白名单永远会漏掉某个「常见类型」,
   * 而用户要的是「都能收」。所以三条分流按能力划,不按后缀划:
   *   · 图片   → local-image-store(压缩,能出缩略图);
   *   · 文本类 → 正文进 rawInput(这样能被本地检索搜到,是纯二进制给不了的);
   *   · 其余   → local-file-store(原样存 Blob,pdf/docx/xlsx/zip… 一视同仁)。
   * 超过 MAX_FILE_BYTES 的明确拒收,不截断 —— 截断的 pdf 是坏文件,比没有更糟。
   */
  /**
   * 存好之后认一下这张图是什么(2026-07-29「加号要更智能」)。
   *
   * 和「收进来」那条路的差别只在**顺序**:先把东西收好(本机、确定成功),
   * 再去问一下这是什么。所以识别失败不影响已经存好的那条记忆 ——
   * 认出来了就改个看得懂的名字,认不出来就保持文件名原样,不打扰。
   *
   * 免费用户不发这一趟(云识图是付费档);先缩再发,不然原图直接 413(见 image-payload.ts)。
   */
  const recognizeSavedImage = useCallback(async (file: File, nodeId: string) => {
    try {
      const { canUsePaidCloudAi } = await import('@/lib/portal/entitlement');
      if (!canUsePaidCloudAi()) return;   // 后台动作:免费静默跳过,不弹升级
      const { fileToUploadPayload } = await import('@/lib/portal/image-payload');
      const { base64, mimeType } = await fileToUploadPayload(file);
      const res = await fetch('/api/portal/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'image', imageBase64: base64, mimeType, uiLocale }),
      });
      if (!res.ok) return;
      const data = await res.json() as { ok?: boolean; nodes?: Array<{ name?: string; tags?: string[] }> };
      const first = data.nodes?.[0];
      if (!data.ok || !first?.name) return;
      const { updateLifeNode } = await import('@/lib/portal/life-graph');
      updateLifeNode(nodeId, { name: first.name, tags: ['照片', ...(first.tags || [])].slice(0, 6) });
      window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
      setQuickSaved(L(uiLocale, `已存入 · 认出是「${first.name}」`, `Saved · recognized "${first.name}"`));
      setTimeout(() => setQuickSaved(''), 4000);
    } catch { /* 认不出来不打扰 —— 东西已经存好了,这只是锦上添花 */ }
  }, [uiLocale]);

  const captureFiles = useCallback(async (files: File[]) => {
    const list = files.slice(0, 30);
    if (!list.length) return;
    // ⚠️ 走 ingestLifeNode,不是 addLifeNode —— 后者是底层写,业务层直调会绕过主事实表
    //    (scripts/write-gate-addLifeNode.test.mjs 明文禁止)。我第一版就是直调 addLifeNode,
    //    表现是「文件存进 IDB 了,记忆一条没有」,右上角计数纹丝不动。
    const { ingestLifeNode } = await import('@/lib/life-domain/ingest-node');
    const { MAX_FILE_BYTES, prettyBytes, putLocalFile } = await import('@/lib/portal/local-file-store');

    const isImage = (f: File) => f.type.startsWith('image/');
    const isTextish = (f: File) => !isImage(f) && (f.type.startsWith('text/') || /\.(csv|tsv|txt|md|json|xml|ya?ml|log)$/i.test(f.name));

    const imgs = list.filter(isImage);
    const texts = list.filter(isTextish);
    const bins = list.filter((f) => !isImage(f) && !isTextish(f));
    const tooBig = [...bins, ...imgs].filter((f) => f.size > MAX_FILE_BYTES);
    const failed: string[] = tooBig.map((f) => `${f.name}(${prettyBytes(f.size)})`);

    if (imgs.length) {
      const { compressToDataUrl, putLocalImage } = await import('@/lib/portal/local-image-store');
      const assets = [];
      for (let i = 0; i < imgs.length; i++) {
        if (imgs[i].size > MAX_FILE_BYTES) continue;
        const dataUrl = await compressToDataUrl(imgs[i], 1400, 0.82);
        const id = `local-today-${Date.now()}-${i}`;
        const ok = await putLocalImage(id, dataUrl);
        if (!ok) { failed.push(imgs[i].name); continue; }
        assets.push({ id, kind: 'image' as const, local: true, mimeType: 'image/jpeg', label: imgs[i].name, createdAt: new Date().toISOString() });
      }
      if (assets.length) {
        const node = ingestLifeNode({
          name: assets.length === 1 ? imgs[0].name.replace(/\.[^.]+$/, '') : `${assets.length} 张照片`,
          type: 'note', source: 'manual', tags: ['照片'], attributes: {}, relations: [], confidence: 1, assets,
        });
        // 2026-07-29「提高智能」:存进去只是第一步 —— 顺手认一下这是什么,
        // 把文件名(IMG_9740 这种)换成看得懂的名字,并打上识别到的标签。
        // 存已经成功了,识别是加分项:认不出来就保持原样,**绝不因此报错**。
        void recognizeSavedImage(imgs[0], node.id);
      }
    }

    for (const f of texts) {
      const text = await f.text();
      ingestLifeNode({
        name: f.name.replace(/\.[^.]+$/, ''),
        type: 'note', source: 'manual', tags: ['文件'], attributes: {}, relations: [], confidence: 1,
        rawInput: text.slice(0, 20000),
      });
    }

    for (let i = 0; i < bins.length; i++) {
      const f = bins[i];
      if (f.size > MAX_FILE_BYTES) continue;
      const id = `localfile-${Date.now()}-${i}`;
      const mimeType = f.type || 'application/octet-stream';
      const ok = await putLocalFile(id, f, { name: f.name, mimeType, size: f.size });
      if (!ok) { failed.push(f.name); continue; }
      ingestLifeNode({
        name: f.name.replace(/\.[^.]+$/, ''),
        type: 'note', source: 'manual', tags: ['文件'], attributes: { fileName: f.name, fileSize: String(f.size) },
        relations: [], confidence: 1,
        assets: [{ id, kind: 'file' as const, local: true, mimeType, label: f.name, createdAt: new Date().toISOString() }],
      });
    }

    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nesio-life-graph-updated'));
    const saved = list.length - failed.length;
    if (saved > 0) {
      setQuickSaved(L(uiLocale, `已存入 ${saved} 项`, `Saved ${saved} item${saved > 1 ? 's' : ''}`));
      setTimeout(() => setQuickSaved(''), 4000);
    }
    // 存不下的必须说,哪怕同一批里别的存进去了 —— 不能因为「大部分成功」就把失败的吞掉。
    if (failed.length) {
      throw new Error(`${failed.slice(0, 3).join('、')} 没存进去(单个上限 ${prettyBytes(MAX_FILE_BYTES)})。`);
    }
  }, []);
  // 批次 33:话筒 = 原地录音转文字直接入记忆(不跳说一句 sheet);无语音 API 才回落 sheet
  const [micState, setMicState] = useState<'idle' | 'recording'>('idle');
  const recogRef = useRef<{ stop: () => void } | null>(null);
  const quickInputRef = useRef<HTMLTextAreaElement | null>(null);

  // 批次 163:记一笔草稿持久化 —— 没点记下就退出 App,下次进来这条还在。
  useEffect(() => {
    // 读入防线(QA:草稿里出现从未输入过的「关注chong」):超长/非字符串一律丢弃
    try { const d = localStorage.getItem('nesio-jot-draft-v1'); if (d && typeof d === 'string' && d.length <= 2000) setQuickAdd(d); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    // 语音识别进行中的 interim 半句不落盘(QA 乱码草稿根因):识别引擎的中间猜测
    // 每帧都在变,落盘等于把听错的半句永久写死;等 onend 出最终稿再由本 effect 落。
    if (micState === 'recording') return;
    try { if (quickAdd) localStorage.setItem('nesio-jot-draft-v1', quickAdd); else localStorage.removeItem('nesio-jot-draft-v1'); } catch { /* ignore */ }
  }, [quickAdd, micState]);
  // 卸载时停掉识别器(QA:导航走开后识别器还活着,环境音继续往草稿里写)
  useEffect(() => () => { recogRef.current?.stop(); }, []);

  function startQuickMic() {
    // 批次 37 重做:边说边把文字写进输入框(interim 实时可见),说完文字留在框里
    // 由用户回车确认;识别起不来(iOS PWA 常见)立刻回落说一句 sheet,绝不装死。
    type SR = { new (): { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void } };
    const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) { window.dispatchEvent(new CustomEvent('nesio-open-voice')); return; }
    if (micState === 'recording') { recogRef.current?.stop(); return; }
    let recog: InstanceType<SR>;
    try { recog = new Ctor(); } catch { window.dispatchEvent(new CustomEvent('nesio-open-voice')); return; }
    recog.lang = uiLocale === 'en' ? 'en-US' : 'zh-CN';
    recog.interimResults = true;
    recog.continuous = false;
    let got = false;
    recog.onresult = (e) => {
      got = true;
      const text = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join('');
      setQuickAdd(text); // 实时写进输入框,像在打字
    };
    recog.onend = () => {
      setMicState('idle');
      recogRef.current = null;
      // 一个字都没听到(常见于权限/引擎没起来)→ 回落说一句 sheet
      if (!got) window.dispatchEvent(new CustomEvent('nesio-open-voice'));
    };
    recog.onerror = () => {
      setMicState('idle');
      recogRef.current = null;
      window.dispatchEvent(new CustomEvent('nesio-open-voice'));
    };
    recogRef.current = recog;
    setMicState('recording');
    try { recog.start(); } catch {
      setMicState('idle');
      recogRef.current = null;
      window.dispatchEvent(new CustomEvent('nesio-open-voice'));
    }
  }
  // 心情第一拍「看趋势」→ 情绪趋势 sheet(洞察浮层现由 Portal 层挂载,见 nesio-open-insights)
  useEffect(() => {
    const openMoodTrend = () => setMoodTrendOpen(true);
    window.addEventListener('nesio-open-mood-trend', openMoodTrend);
    return () => {
      window.removeEventListener('nesio-open-mood-trend', openMoodTrend);
    };
  }, []);

  // Proactive cards: up to 2, each independently dismissable
  const [meetingRecorderNode, setMeetingRecorderNode] = useState<FocusNode | null>(null);
  const [focusModeNode, setFocusModeNode] = useState<FocusNode | null>(null);


  // 批次 13:profile store 的缺省名是 zh「我」,英文界面下按语言回落 Me
  // P1-6:称呼是本机数据(引导里填的),显示不需要登录 —— 此前 canUsePrivateData 门
  // 让匿名用户填了「J」头像还是「Me」(称呼存了但没接到显示)。
  const trimmedName = displayName.trim();
  const initials = trimmedName && trimmedName !== '我'
    ? trimmedName.slice(0, 1)
    : L(uiLocale, '我', 'Me');
  const { shouldShow: showWrapped, dismiss: dismissWrapped } = useWrappedTrigger();

  // 头像统一走 useProfileAvatar(批次 11:签名 URL 过期自动换新,修「头像丢失」)
  const { avatarUrl, refreshAvatar } = useProfileAvatar(canUsePrivateData);

  // All proactive cards come from the guidance pipeline (email included) —
  // single path so cooling-store and attention-budget always apply.
  // 用户在 设置→通用→主动提醒程度 里可把预算降到 1 或 0(安静)。
  const [levelTick, setLevelTick] = useState(0);
  useEffect(() => {
    const onLevel = () => setLevelTick((v) => v + 1);
    window.addEventListener('nesio-proactive-level-changed', onLevel);
    return () => window.removeEventListener('nesio-proactive-level-changed', onLevel);
  }, []);
  void levelTick;
  // v1 规格 §1:回忆/引导 ≤1 张/天(晚间重心回忆,上限 2);没有强触发就整格消失,
  // 不硬凑 —— 轮播兜底(历史上的今天/小技巧)已废除,「页面活着」由收据首行负责。
  const hourNow = new Date().getHours();
  const isEvening = hourNow >= 21;
  const cardBudget = Math.min(3, getProactiveCardBudget(), isEvening ? 2 : 1);
  // 「安静」模式(getProactiveCardBudget()===0)此前只管判决卡 —— 回顾/Wrapped/回访/例行/实验
  // 五张旁路 nudge 卡照出不误,用户设了安静还是被打扰(Today 审计 2026-07-29)。
  // 日报(显式开关)/解冻(用户自设承诺)/家庭(共享义务)不属打扰,不受此闸。
  const quietAll = getProactiveCardBudget() === 0;
  // 架构审查 #2:统一仲裁 —— 置顶抢占的节点,其引导卡不再重复出现
  const [pinnedNodeId, setPinnedNodeId] = useState<string | null>(null);
  const guidanceNodeIds = useMemo(() => proactiveCards.map((c) => c.nodeId).filter((x): x is string => Boolean(x)), [proactiveCards]);
  // 配额只管噪音不管安全:severity 3(urgent)豁免截断,登机口不能被「今天已出一张」挡住。
  const visibleProactive = proactiveCards
    .filter((c) => !dismissedCardIds.has(c.id) && (!c.nodeId || c.nodeId !== pinnedNodeId)
      && (!c.expiresAt || new Date(c.expiresAt).getTime() > Date.now()));
  const activeProactiveCards = [
    ...visibleProactive.filter((c) => c.urgent),
    ...visibleProactive.filter((c) => !c.urgent).slice(0, cardBudget),
  ];
  // 兜底提示分两种(2026-07-30 真机实锤:「AI 判断暂不可用」在没什么可判时也会出现)。
  // 只有**真失败过**才说不可用,并且必须说清是哪一种失败、给一颗能点的重试 ——
  // 仓库红线:异步动作的失败态要可见、可重试,不许只留一句没有下文的话。
  // 没什么可判 / 没到点 / 免费档 = idle,兜底卡照出,但一个字都不说。
  const showingFallback = activeProactiveCards.some((c) => c.sourceTags.includes('fallback'));
  const judge = showingFallback ? judgeState() : { kind: 'live' as const };
  const judgeFailed = judge.kind === 'failed' ? judge.error : null;
  const [retrying, setRetrying] = useState(false);
  const [cardDetail, setCardDetail] = useState<ProactiveCardData | null>(null); // 卡详情(任何卡都点得开)

  // 卡片档案:真实上屏即入档(times 累计)。AI 判决卡在判决时已建条,这里 bump;
  // 兜底/遗留卡记 rules lane。档案是唯一监测面,出一次记一次。
  useEffect(() => {
    for (const card of activeProactiveCards) {
      const isJudge = card.id.startsWith('judge-');
      archiveShownCard({
        id: isJudge ? (card.factKey || card.id) : `rules:${card.factKey || card.id}`,
        lane: isJudge ? 'ai' : 'rules',
        group: card.cardType || '其他',
        title: card.title,
        body: card.body,
        whyNow: card.reason || '',
        evidence: [],
        severity: Math.max(0, Math.min(3, Math.round(card.priority / 3))),
        gates: [],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 以卡片 id 序列为准,避免对象引用抖动重复入档
  }, [activeProactiveCards.map((c) => c.id).join('|')]);

  // §1 ①收据首行 → 批次 80(用户定案「都记着呢N条意义不大」):
  // 称呼(首次设置的名字) + 时段问候 + **一条最有用的信息**
  // (最近的带时点焦点事项/到期物);没有要紧事才落回承诺文案。
  const receiptLine = useMemo(() => {
    // 默认兜底名(「我」/User)不是称呼 —— 只有用户亲自设置的名字才上问候语
    const GENERIC_NAMES = new Set(['我', 'me', 'user', '用户', '朋友']);
    const nameRaw = displayName.trim();
    const name = nameRaw.length > 0 && nameRaw.length <= 12 && !GENERIC_NAMES.has(nameRaw.toLowerCase()) && !GENERIC_NAMES.has(nameRaw) ? nameRaw : '';
    const hello = hourNow < 11
      ? L(uiLocale, '早', 'Morning')
      : isEvening ? L(uiLocale, '晚上好', 'Evening') : L(uiLocale, '下午好', 'Afternoon');
    // 标点也得跟着语言走。原来这里写死的是中文全角逗号+句号,英文界面下拼出来的是
    // 「婧,Morning。Note anything — …」—— 半句英文配一对中文标点。
    // 英文里称呼也该在问候后面(Morning, 婧.),不是前面。
    const prefix = uiLocale === 'en'
      ? (name ? `${hello}, ${name}. ` : `${hello}. `)
      : (name ? `${name},${hello}。` : `${hello}。`);

    if (receipt.realTotal === 0) {
      return `${prefix}${L(uiLocale, '记点什么,我替你记着。', "Note anything — I'll hold it for you.")}`;
    }

    // 最有用的一条:焦点里最近的、带真实时间提示的事(跳过刚记录/已过期)
    // 批次 180:问候语跳过「别人的请假/OOO/节假日」这类日历噪音 —— 它们不是你要做的一件事
    // (用户实锤:问候里冒出「Sindhu OOO」)。这类通常是他人日历的全天多日事件。
    const GREETING_NOISE_RE = /\bOOO\b|out[\s-]?of[\s-]?office|\bPTO\b|请假|休假|年假|调休|vacation|holiday|公休|放假/i;
    // 批次188(用户实锤:问候「接下来:X」与下面第一张焦点卡是**同一件事**,UI/算法重叠)——
    // 问候不再复述具体事项(焦点卡已经在讲这件事,还能点开拆解),只保留「几件要紧 + 最近多近」
    // 的概览,时间提示不带事件名 → 与焦点列表分工:问候=一眼概览,卡片=具体+可操作。
    // 用户实锤逻辑错(2026-07-29):「今天有 8 件,最近的一件明天」—— 原计数把未来所有
    // 带时点的节点都算进"今天"。改:只数**日期是今天**的;「最近一件」整个去掉(只报件数)。
    const sameLocalDay = (iso: string) => {
      const d = new Date(iso);
      const t = new Date();
      return !Number.isNaN(d.getTime()) && d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
    };
    let actionable = 0;
    for (const n of focusNodes) {
      const hint = focusTimeHint(n, uiLocale);
      if (!hint || hint === L(uiLocale, '刚记录', 'just noted') || hint === L(uiLocale, '已过期', 'expired')) continue;
      if (GREETING_NOISE_RE.test(n.name)) continue; // 别人的 OOO/请假不当"你的一件事"
      const dateStr = String(n.attributes?.date ?? n.attributes?.dueDate ?? n.attributes?.eventDate ?? '');
      if (!dateStr || !sameLocalDay(dateStr)) continue;
      actionable++;
    }
    if (actionable > 0) {
      return `${prefix}${L(uiLocale,
        `今天有 ${actionable} 件要紧的。`,
        `${actionable} thing${actionable > 1 ? 's' : ''} need you today.`)}`;
    }
    if (isEvening) {
      return receipt.todayCount > 0
        ? `${prefix}${L(uiLocale, `今天的 ${receipt.todayCount} 条都收好了,可以放心把今天放下了。`, `Today's ${receipt.todayCount} notes are tucked away — you can let today go.`)}`
        : `${prefix}${L(uiLocale, '今天很安静,可以放心把今天放下了。', 'A quiet day. You can let it go now.')}`;
    }
    return `${prefix}${L(uiLocale, '没有要紧的事,想到什么随时说。', "Nothing pressing — say anything, anytime.")}`;
  }, [receipt, uiLocale, hourNow, isEvening, displayName, focusNodes]);

  return (
    <div className="nesio-today-root">
      <header className="nesio-today-header">
        <button
          type="button"
          data-tour="memory"
          className="nesio-today-brand"
          aria-label={L(uiLocale, '打开记忆', 'Open memory')}
          onClick={() => onOpenMemory?.()}
        >
          <NesioMark className="nesio-today-brand-icon" />
        </button>
        <div className="nesio-today-header-tools">
          {/* App 级积分徽章 → 奖品商城(积分来自忍住没买 / 跟练 / 深度疗愈);点开经 Portal 的 nesio-open-rewards 门 */}
          <button type="button" className="nesio-today-points" onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-rewards'))}
            aria-label={L(uiLocale, `${points} 积分 · 打开奖品商城`, `${points} points · open rewards`)}>
            {points}
          </button>
          {/* 批次 39:听简报暂时收进「设置 → 路线图」(还在打磨);记录心情移到中央「+」扇形菜单 */}
          <a href="/settings" className="nesio-today-avatar" aria-label={L(uiLocale, '我的设置', 'My settings')}>
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 头像是运行时签名 URL,next/image 无法静态优化
              <img src={avatarUrl} alt="" className="nesio-today-avatar-img" draggable={false} onError={refreshAvatar} />
            ) : initials}
          </a>
        </div>
      </header>

      <div className="nesio-today-scroll">
        {/* §1 ①安心态收据(宋体 = Nesio 的声音):先兑现承诺,再看今天 */}
        {/* bug2:问候不再走衬线「嗓音」体 —— Noto Serif SC 在 iOS 上没有本地字体,
            级联落到 Hiragino Mincho/系统衬线,渲出来偏粗且带繁体字形,和下面时间线两种字。
            改回设计系统正文 sans(--font-sans,Noto Sans SC 简体优先)+ 常规字重。 */}
        <p className="nesio-today-receipt">{receiptLine}</p>

        {/* 云端往本机填过数据时的一次性回执(QA:积分 0→150 像被人乱改)。读一次即清。 */}
        {restoreNote && (
          <p style={{ margin: '0 0 0.6rem', fontSize: '0.72rem', lineHeight: 1.6, color: 'var(--portal-muted)' }}>
            {restoreNote}
          </p>
        )}

        {/* 家庭家务闭环的今天页一端:分给我的家务可当场完成;有人做完了在这收到回响。空则不渲染。
            仅登录(canUsePrivateData)才挂载 —— 登出用户不白打一次 401。 */}
        {canUsePrivateData && <FamilyTodayStrip />}

        {/* 批次 105:回顾卡(去年今日)—— 念念翻出一条旧记忆,放问候下面(设计规范今天页第 2 段)。
            周年/月纪念优先;没有符合的不渲染。点开复用 MemoryNodeDetail。 */}
        {!quietAll && <RetrospectCard onOpen={(id) => { const live = getLiveMemoryNode(id); if (live) setGuideDetailNode(live); }} />}

        {/* 季度 Wrapped 卡片 */}
        {!quietAll && showWrapped && <WrappedCard onDismiss={dismissWrapped} />}

        {/* 每日图文日报(未来预测区首张;仅登录 + 开关开 + 有内容时,todayReport 已受私据门)*/}
        {/* pending:开着日报但还没到 08:00 —— 卡上说清它几点来,而不是空着一块。 */}
        {canUsePrivateData && (
          <DailyReportCard
            report={todayReport}
            pending={loadProfileSettings().dailyReportEnabled && !reportDue(new Date())}
          />
        )}

        {/* 回访再触达:来过好几回但某功能没碰过 → 轻轻探一句(全局两天一条,可稍后/不再提醒)*/}
        {canUsePrivateData && !quietAll && (
          <ReengageNudgeCard
            nodes={allNodes}
            onOpenInsights={() => window.dispatchEvent(new CustomEvent('nesio-open-insights'))}
          />
        )}

        {/* AI 判决**失败**时的兜底提示(承诺④:降级必须可见,不许静默)。
            idle(没什么可判/没到点/免费档)不是失败,不在这里说话。 */}
        {judgeFailed && (
          <p className="nesio-settings-option-hint" style={{ margin: '0 0 var(--space-2)' }}>
            {L(uiLocale, `AI 判断这次没成(${judgeReason(judgeFailed, uiLocale)}),先看这些确定的。`, `AI judging failed (${judgeReason(judgeFailed, uiLocale)}) — here are the certain ones.`)}
            <button
              type="button"
              disabled={retrying}
              onClick={() => { setRetrying(true); clearJudgeError(); window.dispatchEvent(new CustomEvent('nesio-today-refresh')); }}
              style={{ marginLeft: 'var(--space-2)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--portal-accent)', fontWeight: 'var(--weight-semibold)', fontFamily: 'var(--font-sans)', fontSize: 'inherit' }}
            >
              {retrying ? L(uiLocale, '重试中…', 'Retrying…') : L(uiLocale, '再试一次', 'Try again')}
            </button>
          </p>
        )}

        {/* 未来引导卡 — AI 判决出的卡;点开走 resolver,关掉记当日日键 */}
        {activeProactiveCards.map((card) => (
          <ProactiveGuidanceCard
            key={card.id}
            card={card}
            /*
             * 2026-07-30 用户实锤:「有来源的,我点不进去看细节」。
             * 这里原来的三分支里,第三支是 undefined —— 例行卡/月报提醒/金句/兜底卡
             * 整张点不动,而它们恰恰是卡面上写着「依据 · N 条」的那种。
             * 现在保底:前两支解析不出来,就开卡详情(它凭什么出现 + 依据 + 来源)。
             * 注意 resolveCardTarget 可能返回 null —— 那一支以前也是「点了没反应」,一并兜住。
             */
            onOpen={() => {
              if (card.nodeId) {
                const live = getLiveMemoryNode(card.nodeId);
                if (live) { setGuideDetailNode(live); return; }
              }
              if (card.fingerprints) {
                const target = resolveCardTarget(card.fingerprints);
                if (target) { openCardTarget(target); return; }
              }
              setCardDetail(card);
            }}
            onDismiss={() => {
              // 判决卡:「知道了」= 当日日键静默(三门之一);兜底/遗留卡走旧 dismissed 存储。
              // 冷却(自适应 2-24h)已随规则管线拆除 —— 用户裁决(card-verdict)与日键是仅存的记忆。
              if (card.id.startsWith('judge-') && card.factKey) {
                dismissJudgedCard(card.factKey);
              }
              // 只记当日,不带 factKey —— 带了就是按指纹永久静音,会把「喜欢」「稍后」也一并
              // 永久闭嘴(用户实锤审计 2026-07-29)。永久语义只属于「没用」(card-verdict mute)。
              dismissProactiveById(card.id);
              setDismissedCardIds((prev) => { const next = new Set(prev); next.add(card.id); return next; });
            }}
            onMarkDone={(nodeId) => markFocusNodeDone(nodeId)}
          />
        ))}

        {/* 冷冻到期提醒(批次 7:冷冻仓入口迁到拍一下,决定回路留在首屏) */}
        <ThawedReminder />

        {/* 2026-07-28 UI 精修(用户标注 图4/图5):搜索/记一笔输入条搬到这儿(原「+ 新建日程」位),
            新建日程按钮按标注删掉。输入条本体见 today/CaptureBar.tsx。 */}
        <CaptureBar
          value={quickAdd}
          onChange={setQuickAdd}
          onSubmit={() => {
            const name = quickAdd.trim();
            if (!name) return;
            addCommitmentNode(name);
            setQuickAdd('');
            setQuickSaved(L(uiLocale, '已记下', 'Noted'));
            setTimeout(() => setQuickSaved(''), 2000);
          }}
          onMic={startQuickMic}
          recording={micState === 'recording'}
          inputRef={quickInputRef}
          onFiles={captureFiles}
        />
        {/* 存进去了要说一声。这条回执之前**只被 set、从来没渲染** ——
            于是「+」传完文件、记一笔按了「记下」,界面上什么反应都没有。
            识别结果回来了会把同一条改写成「已存入 · 认出是「…」」。 */}
        {quickSaved && (
          <p className="nesio-tl-capture-receipt" role="status">{quickSaved}</p>
        )}

        {/* 今日焦点 — 重要安排 / 重要日子 / 重要提醒 */}
        <TodayFocusSection
          guidanceNodeIds={guidanceNodeIds}
          onPinnedResolved={setPinnedNodeId}
          focusNodes={focusNodes}
          calendarEvents={calendarEvents}
          specialDays={proactiveContext.upcomingSpecialDays}
          allNodes={allNodes}
          dormantStore={dormantStore}
          onSetDormantStore={setDormantStore}
          onOpenMemory={onOpenMemory}
          onOpenRecorder={(node) => setMeetingRecorderNode(node)}
          onFocusMode={(node) => setFocusModeNode(node)}
          onDeleteNode={(id) => deleteFocusNode(id)}
        />

        {/* 批次 132(用户「底部输入口需要删除」):独立快捷输入栏已删 ——
            记一笔输入内联进时间线「记一笔·话筒」节点(唯一极简输入入口)。 */}

        {/* 实验打卡(批次 8:按用户要求放到最下面) */}
        {!quietAll && <RoutineDueCards />}
        {!quietAll && <ExperimentCheckinCard />}

        {/* 批次 169:用户实锤去掉底部「想到什么…」提示行 */}
      </div>

      {/* 聚焦模式 */}
      <FocusModeSheet
        node={focusModeNode}
        onClose={() => setFocusModeNode(null)}
        onDone={(node) => { markFocusNodeDone(node.id); setFocusModeNode(null); }}
      />

      {/* 会议记录 sheet */}
      <MeetingRecorderSheet
        open={meetingRecorderNode !== null}
        meetingNode={meetingRecorderNode}
        onClose={() => setMeetingRecorderNode(null)}
      />

      {/* 批次 83:引导卡 → 记忆详情(portal 到 body,避 transform 祖先) */}
      {guideDetailNode && typeof document !== 'undefined' && createPortal(
        <MemoryNodeDetailLazy node={guideDetailNode} onClose={() => setGuideDetailNode(null)} />,
        document.body,
      )}

      {/* 任何引导卡都点得开的详情(2026-07-30:此前只有带 nodeId/可解析指纹的卡有入口)。
          依据里带 signalId 的条目本身也能点进对应记忆 —— 那个指针数据里一直有,只是没接线。 */}
      {cardDetail && (
        <ProactiveCardDetail
          card={cardDetail}
          onClose={() => setCardDetail(null)}
          onOpenSignal={(sid) => {
            const live = getLiveMemoryNode(sid);
            if (!live) return false;
            setGuideDetailNode(live);
            return true;
          }}
        />
      )}

      {/* 批次 136:情绪趋势(心情第一拍「看趋势」进来) */}
      <MoodTrendSheet open={moodTrendOpen} onClose={() => setMoodTrendOpen(false)} />
    </div>
  );
}
