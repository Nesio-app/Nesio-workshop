/**
 * 多面镜 · 存入记忆(信下方「存入记忆」按钮)。
 *
 * 全局性:走**合法写入门** ingestLifeNode(Signal 主事实表的 LifeNode 形态门,见 STATE.md),
 * 按 attributes.externalId 幂等(同月同镜同主题重存 = 原地更新,不堆重复节点)——
 * 与每日日报/月报/生活报告同一套幂等持久化。信是私据衍生物,调用方在已登录态才展示本按钮。
 */
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import type { MirrorLetter } from './mirror-letters';

/** 幂等键:月-镜-主题唯一 → 同一封信重存原地覆盖。 */
export function mirrorLetterExternalId(letter: Pick<MirrorLetter, 'month' | 'mirrorId' | 'topic'>): string {
  return `mirror-letter-${letter.month}-${letter.mirrorId}-${letter.topic || 'all'}`;
}

/** 把当前这封信存进记忆。空信跳过。meta 提供落库标题与署名标签。 */
export function persistMirrorLetterToMemory(
  letter: MirrorLetter,
  meta: { title: string; mirrorName: string; topicLabel?: string },
): 'saved' | 'skipped' {
  if (!letter.paragraphs.length) return 'skipped';
  const body = letter.paragraphs.map((p) => p.text).join('\n\n');
  const tags = ['多面镜', meta.mirrorName];
  if (meta.topicLabel && letter.topic && letter.topic !== 'all') tags.push(meta.topicLabel);
  ingestLifeNode({
    type: 'event',
    name: meta.title,
    source: 'system',
    confidence: 1,
    relations: [],
    tags,
    rawInput: body,
    attributes: {
      kind: 'mirror-letter',
      externalId: mirrorLetterExternalId(letter),
      month: letter.month,
      mirrorId: letter.mirrorId,
      topic: letter.topic || 'all',
    },
  });
  return 'saved';
}
