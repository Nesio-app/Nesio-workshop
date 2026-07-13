'use client';

/**
 * ArticleReaderSheet — 节点正文的友好阅读入口(批次 24 起,批次 26 升级)。
 *
 * 批次 26:内部改用移植自 reading-ios 的瀑布流阅读器(ReaderView)——
 * 把节点里存的 article 全文经 ADHD 脱水引擎切成短行,bionic 加粗 + 卡拉OK 焦点遮罩。
 * 对外 props 不变(title/article/onClose),MemoryNodeDetail 无需改动。
 */

import { useMemo } from 'react';
import { textToAdhdBook, type ReaderBook } from '@/lib/portal/adhd-reader';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import ReaderView, { type ReaderMeta } from './reader/ReaderView';

/** 由标题派生稳定 id,让同一篇文章重开时能恢复阅读进度。 */
function stableId(title: string, article: string): string {
  const s = `${title}::${article.length}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return `article-${Math.abs(h).toString(36)}`;
}

export default function ArticleReaderSheet({ title, article, meta, onClose }: {
  title: string;
  article: string;
  meta?: ReaderMeta;
  onClose: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());

  const book = useMemo<ReaderBook | null>(() => {
    if (!article.trim()) return null;
    try {
      return textToAdhdBook(article, { id: stableId(title, article), title: title || '阅读', author: '' });
    } catch {
      return null;
    }
  }, [title, article]);

  if (!book) {
    return (
      <div className="nesio-rd-overlay" role="dialog" aria-modal="true" aria-label={title}>
        <div className="nesio-rd-topbar">
          <button type="button" className="nesio-rd-btn" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
          <div className="nesio-rd-head-mid"><p className="nesio-rd-head-title">{title}</p></div>
          <div style={{ width: 36 }} />
        </div>
        <div className="nesio-rd-scroll">
          <p className="nesio-rd-end">{L(dict, '这条没有可阅读的正文。', 'No readable text here.')}</p>
        </div>
      </div>
    );
  }

  return <ReaderView book={book} rawText={article} meta={meta} onClose={onClose} />;
}
