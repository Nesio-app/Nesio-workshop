'use client';

/**
 * 挂在 TA 身上的记录 · 分类描边图标(去 person-records 里的 emoji;设计规范全站无 emoji)。
 * person-records 的 `icon` 字段(emoji)仅作数据兼容,UI 一律走这里的描边图标。
 */
import type { PersonRecordCategory } from '@/lib/portal/person-records';
import { IconStar, IconCard, IconMapPin, IconHeartPulse, IconThermometer, IconActivity } from '../icons';

const MAP: Record<PersonRecordCategory, React.ComponentType<{ size?: number }>> = {
  achievement: IconStar,
  spending: IconCard,
  location: IconMapPin,
  medical: IconHeartPulse,
  medication: IconThermometer,
  health: IconActivity,
};

export function RecordCatIcon({ category, size = 16 }: { category: PersonRecordCategory; size?: number }) {
  const Ico = MAP[category] ?? IconStar;
  return <Ico size={size} />;
}
