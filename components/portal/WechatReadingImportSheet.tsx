'use client';

/**
 * WechatReadingImportSheet — 微信读书笔记导入(批次 22)。
 * 微信读书无开放 API:App 内「我的笔记 → 导出笔记」得到文本,粘进来即可解析入库。
 */

import { useState } from 'react';
import { parseWechatReading } from '@/lib/portal/wechat-reading';
import { ingestLifeNode } from '@/lib/life-domain/ingest-node';
import { InfoTip } from './InfoTip';
import { track } from '@/lib/portal/telemetry';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';
import { useSheetDrag } from './use-sheet-drag';

export default function WechatReadingImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [text, setText] = useState('');
  const [result, setResult] = useState('');
  const { handleProps, cardStyle, expanded } = useSheetDrag(onClose);

  if (!open) return null;

  function doImport() {
    const notes = parseWechatReading(text);
    if (notes.length === 0) {
      setResult(L(dict, '没有解析到划线。确认粘贴的是微信读书「导出笔记」的内容。', 'No highlights found. Make sure you pasted the WeChat Reading "export notes" content.'));
      return;
    }
    for (const n of notes) {
      ingestLifeNode({
        name: n.highlight.slice(0, 40),
        type: 'preference',
        source: 'manual',
        confidence: 0.9,
        rawInput: n.highlight,
        tags: ['微信读书', ...(n.book ? [n.book] : [])],
        attributes: {
          book: n.book,
          ...(n.author ? { author: n.author } : {}),
          ...(n.chapter ? { chapter: n.chapter } : {}),
          ...(n.thought ? { thought: n.thought } : {}),
          // source:'manual' 落 Signal 层会被压成泛泛的 Entry —— 微信读书划线有专属
          // SignalSource('wechat_reading'),标出来才认得出是读书笔记不是随手记。
          signalSource: 'wechat_reading',
        },
        relations: [],
      });
    }
    track('wechat_reading_import', { count: notes.length });
    setResult(L(dict, `已导入 ${notes.length} 条划线(在 Memory 里搜书名即可找到)。`, `Imported ${notes.length} highlights (search the book title in Memory to find them).`));
    setText('');
    setTimeout(onClose, 1600);
  }

  return (
    <div className="nesio-settings-sheet-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '微信读书导入', 'WeChat Reading import')}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className={`nesio-settings-sheet-card${expanded ? ' nesio-sheet--expanded' : ''}`} style={cardStyle}>
        <div className="nesio-sheet-handle" {...handleProps} />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">
            {L(dict, '微信读书导入', 'WeChat Reading')}
            <InfoTip text={L(dict, '微信读书没有开放接口。在微信读书 App:某本书 → 我的笔记 → 右上角 → 导出笔记(复制/发到文件传输助手),把文字粘到下面。', 'WeChat Reading has no public API. In the app: a book → My notes → top-right → Export notes (copy), then paste the text below.')} />
          </h2>
        </div>
        <div className="nesio-settings-sheet-body">
          <textarea
            className="nesio-routine-input"
            style={{ minHeight: '9rem', resize: 'vertical', lineHeight: 1.5 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={L(dict, '把微信读书导出的笔记粘到这里…\n\n《书名》 作者\n◆ 章节\n>> 划线原文\n想法：你的批注', 'Paste your WeChat Reading export here…')}
          />
          <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-2)' }} onClick={doImport} disabled={!text.trim()}>
            {L(dict, '解析并导入', 'Parse and import')}
          </button>
          {result && <p className="nesio-settings-option-hint" style={{ marginTop: 'var(--space-2)' }}>{result}</p>}
        </div>
      </div>
    </div>
  );
}
