The home's "陪你看见" (I'll help you see) module — AI/DB-driven, customizable: important dates, schedules, to-dos, next-step nudges. It surfaces a *small doable step*, never a backlog, and every item offers 稍后 / 跳过.

```jsx
<ReminderCard subtitle="基于你的数据 · 今天 3 件"
  items={[
    { kind: '重要日期', text: '妈妈的生日还有 3 天，要不要先想个小礼物？', status: 'calm', action: '记一笔' },
    { kind: '下一步', text: '把昨天的想法保存下来，明天再决定也可以。', status: 'gentle', action: '保存想法' },
    { kind: '到期', text: '冰箱里的牛奶 3 天后到期。', status: 'risk', action: '查看收纳' },
  ]}
/>
```

Copy rule: no judgment, no urgency. `risk` (red) only for genuine expiry/safety; everything else is `gentle`/`calm`.
