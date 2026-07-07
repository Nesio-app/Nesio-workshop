/**
 * 反馈事实日志 —— A 计划 #0 前置(event-sourcing)。
 *
 * 订阅反馈总线,把每条反馈**追加**成可回放事实(不再"折进权重即弃")。三原语/ranker 的状态是它的
 * 可回放**投影**:collect first, derive second。有了它,2b 的「回放重训」「审计」「跨设备迁移」才可能。
 *
 * 物理:先放独立 IDB append 日志(有界,保留最近 N 条,够小模型回放 + 审计),结构对齐 Signal fact,
 * 日后可并入 Signal 事实表(见 system-layers.md #0 与本提案的张力,已按"先独立日志"落地)。
 */

import { createBlobStore } from '@/lib/portal/idb-blob-store';
import { reportStorageDropped } from '@/lib/portal/storage-health';
import { onFeedback, type FeedbackEvent } from './feedback-bus';

const LOG_KEY = 'nesio-feedback-log-v1';
const LOG_CAP = 2000; // 追加式有界:保留最近 2000 条(足够小模型回放/重训 + 审计,又不撑爆配额)

const store = createBlobStore<FeedbackEvent[]>({
  key: LOG_KEY,
  updateEvent: 'nesio-feedback-log-updated',
  validate: (v) => Array.isArray(v),
  onWriteError: reportStorageDropped,
});

function append(e: FeedbackEvent): void {
  const cur = store.load();
  const arr = Array.isArray(cur) ? cur.slice() : [];
  arr.push(e);
  if (arr.length > LOG_CAP) arr.splice(0, arr.length - LOG_CAP);
  store.save(arr);
}

// 作为总线订阅者:每条反馈先落日志(collect first)。模块被 index 引入即注册。
onFeedback(append);

/** 读全量日志(投影/回放用)。 */
export function readFeedbackLog(): FeedbackEvent[] {
  const cur = store.load();
  return Array.isArray(cur) ? cur : [];
}

/** 回放:可按 surface/dimension 过滤,供某原语从头重建投影。 */
export function replayFeedback(filter?: (e: FeedbackEvent) => boolean): FeedbackEvent[] {
  const log = readFeedbackLog();
  return filter ? log.filter(filter) : log;
}
