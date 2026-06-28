'use client';

import { useState } from 'react';
import { deleteLifeNode, updateLifeNode, type LifeNode } from '@/lib/portal/life-graph';

interface MemoryNodeDetailProps {
  node: LifeNode | null;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  person: '人物', object: '物品', place: '地点', event: '事件',
  commitment: '承诺', health_state: '健康状态', preference: '偏好',
};
const HIDDEN_ATTRIBUTE_KEYS = new Set([
  'calendarId',
  'calendarName',
  'description',
  'emailId',
  'messageId',
  'htmlLink',
  'url',
]);
const ATTRIBUTE_LABELS: Record<string, string> = {
  start: '开始',
  end: '结束',
  location: '地点',
  date: '日期',
  owner: '相关人',
  detail: '说明',
  note: '备注',
  status: '状态',
};

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.82) return '比较确定';
  if (confidence >= 0.58) return '可能相关';
  return '建议确认';
}

function formatAttributeValue(key: string, value: string | number | boolean | null): string {
  if (value === null) return '';
  const raw = String(value);
  if ((key === 'start' || key === 'end' || key === 'date') && raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: key === 'date' ? undefined : '2-digit',
        minute: key === 'date' ? undefined : '2-digit',
      });
    }
  }
  return raw;
}

export default function MemoryNodeDetail({ node, onClose }: MemoryNodeDetailProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [deleted, setDeleted] = useState(false);

  if (!node || deleted) return null;

  // node is guaranteed non-null below this point
  const n = node;

  function startEdit() { setName(n.name); setEditing(true); }

  function saveEdit() {
    if (!name.trim()) return;
    updateLifeNode(n.id, { name: name.trim() });
    setEditing(false);
    onClose();
  }

  function handleDelete() {
    if (!confirm(`确认删除「${n.name}」？`)) return;
    deleteLifeNode(n.id);
    setDeleted(true);
    onClose();
  }

  const createdDate = new Date(n.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', year: 'numeric' });
  const attrs = Object.entries(n.attributes).filter(
    ([k, v]) => v !== null && v !== '' && !HIDDEN_ATTRIBUTE_KEYS.has(k),
  );
  const showRawInput = Boolean(n.rawInput && n.source !== 'calendar' && n.source !== 'email');

  return (
    <div className="nesio-node-detail-overlay" role="dialog" aria-modal="true" aria-label={n.name}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label="关闭" />
      <div className="nesio-settings-sheet-card">
        <div className="nesio-sheet-handle" aria-hidden />

        <div className="nesio-settings-sheet-header">
          {editing ? (
            <input
              className="nesio-ob-input" style={{ fontSize: '1rem', marginBottom: 0, flex: 1 }}
              value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
              autoFocus
            />
          ) : (
            <h2 className="nesio-settings-sheet-title">{n.name}</h2>
          )}
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <div className="nesio-settings-sheet-body">
          {/* Type + source */}
          <div className="nesio-node-meta-row">
            <span className="nesio-node-type-badge">{TYPE_LABELS[n.type] || n.type}</span>
            <span className="nesio-node-source">来源：{
              ({ manual: '手动', photo: '拍照', voice: '语音', calendar: '日历', email: '邮件', system: '系统' } as Record<string, string>)[n.source] || n.source
            }</span>
            <span className="nesio-node-confidence">{confidenceLabel(n.confidence)}</span>
          </div>

          {/* Raw input */}
          {showRawInput && (
            <div className="nesio-node-raw">
              <p className="nesio-settings-section-label">原始记录</p>
              <p style={{ fontSize: '0.88rem', color: 'var(--portal-muted)', fontStyle: 'italic' }}>&ldquo;{n.rawInput}&rdquo;</p>
            </div>
          )}

          {/* Attributes */}
          {attrs.length > 0 && (
            <>
              <p className="nesio-settings-section-label">属性</p>
              {attrs.map(([k, v]) => (
                <div key={k} className="nesio-node-attr-row">
                  <span className="nesio-node-attr-key">{ATTRIBUTE_LABELS[k] || k}</span>
                  <span className="nesio-node-attr-val">{formatAttributeValue(k, v)}</span>
                </div>
              ))}
            </>
          )}

          {/* Relations */}
          {n.relations.length > 0 && (
            <>
              <p className="nesio-settings-section-label">关联</p>
              {n.relations.map((r, i) => (
                <div key={i} className="nesio-node-attr-row">
                  <span className="nesio-node-attr-key">{r.relation}</span>
                  <span className="nesio-node-attr-val">{r.targetId}</span>
                </div>
              ))}
            </>
          )}

          {/* Tags */}
          {n.tags && n.tags.length > 0 && (
            <div className="nesio-today-card-tags" style={{ marginTop: '0.75rem' }}>
              {n.tags.map((t) => <span key={t} className="nesio-today-card-tag">{t}</span>)}
            </div>
          )}

          <p style={{ fontSize: '0.7rem', color: 'var(--portal-muted)', marginTop: '1rem' }}>记录于 {createdDate}</p>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.25rem' }}>
            {editing ? (
              <>
                <button type="button" className="nesio-ob-primary-btn" style={{ flex: 1 }} onClick={saveEdit}>保存</button>
                <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1 }} onClick={() => setEditing(false)}>取消</button>
              </>
            ) : (
              <>
                <button type="button" className="nesio-today-btn nesio-today-btn--ghost" style={{ flex: 1 }} onClick={startEdit}>编辑</button>
                <button type="button" className="nesio-settings-danger-btn" style={{ flex: 1, marginTop: 0 }} onClick={handleDelete}>删除</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
