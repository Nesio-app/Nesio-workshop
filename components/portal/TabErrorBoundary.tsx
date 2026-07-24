'use client';

/**
 * TabErrorBoundary — 把某一块(如洞察的健身 tab)的渲染错误就地兜住,
 * 不让它冒泡到整棵树导致整个 app 崩溃 / 被 iOS 杀掉重挂载(「卡很久跳回今天页」)。
 * 关键:把真实报错**显示在屏幕上**,用户截图即可定位根因(远程私有站点抓不到端上错误)。
 */

import { Component, type ReactNode } from 'react';

export default class TabErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    try { console.error('[tab-error]', this.props.label || '', error); } catch { /* ignore */ }
  }

  render() {
    if (this.state.error) {
      const msg = String(this.state.error?.stack || this.state.error?.message || this.state.error);
      return (
        <div className="nesio-analytics-tab" style={{ padding: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--weight-semibold)', color: 'var(--portal-ink)', margin: 0 }}>这一块暂时打不开</p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--portal-muted)', margin: '0.4rem 0 0', lineHeight: 1.6 }}>
            别的页面不受影响。把下面这段截图发我,我就能定位:
          </p>
          <pre style={{ margin: '0.5rem 0 0', padding: '0.6rem', fontSize: '0.68rem', lineHeight: 1.4, color: 'var(--status-risk)', background: 'var(--status-risk-soft)', borderRadius: 'var(--radius-sm, 12px)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '10rem', overflow: 'auto' }}>
            {msg}
          </pre>
          <button type="button" className="nesio-ob-primary-btn" style={{ marginTop: '0.6rem', width: '100%' }} onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
