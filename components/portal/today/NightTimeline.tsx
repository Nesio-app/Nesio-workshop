'use client';

/**
 * NightTimeline — 夜间空状态时间线(此刻 · 把你带回今天)。
 * 从 FocusSection 拆出;无共享状态,纯展示。
 * 文案受 v14-sovereignty 契约约束(低压首记录邀请)。
 */

export function NightTimeline() {
  return (
    <div className="nesio-today-night">
      <div className="nesio-today-night-hero">
        <p className="nesio-today-night-kicker">此刻 · 把你带回今天</p>
        <h2 className="nesio-today-night-title">先放进来一件事<br />以后就找得到</h2>
        <p className="nesio-today-night-sub">说一句、拍一下，Nesio 会帮你留到以后找得到。</p>
        <div className="nesio-today-night-actions">
          <span className="nesio-today-night-conf">● 建议确认</span>
          <button type="button" className="nesio-today-btn nesio-today-btn--night">好的</button>
        </div>
      </div>
      <div className="nesio-today-night-timeline">
        <p className="nesio-today-night-timeline-label">今晚的路径</p>
        <ol className="nesio-today-night-steps">
          {[
            { time: '现在', label: '记录一件真实小事', active: true },
            { time: '明早', label: '基于记录生成提醒', active: false },
            { time: '之后', label: '你反馈后逐步调整', active: false },
          ].map((step, i) => (
            <li key={i} className={`nesio-today-night-step${step.active ? ' nesio-today-night-step--active' : ''}`}>
              <span className="nesio-today-night-step-dot" />
              <span className="nesio-today-night-step-time">{step.time}</span>
              <span className="nesio-today-night-step-label">{step.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
