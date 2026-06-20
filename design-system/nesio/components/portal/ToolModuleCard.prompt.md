A paid/owned tool placed on the home screen. The key idea: it shows the tool's *live signal*, not its name. The name sits faint in the corner; the body is whatever is glanceable — items about to expire, the next workout, today's spend.

```jsx
<ToolModuleCard icon="../assets/icons/tools/storage.svg" name="收纳" nameEn="Storage"
  tone="cool" status={{ status: 'gentle', label: '3 件将到期' }} onOpen={openStorage}>
  <strong style={{ fontSize: 'var(--text-h3)' }}>牛奶 · 酸奶 · 鸡蛋</strong>
  <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-xs)' }}>最近 3 天内到期</span>
</ToolModuleCard>
```

`tone` matches the tool's cabin (cool/warm/neutral). `status` is a warm-coach badge. `locked` dims + shows a lock for not-yet-owned tools. Enter the toolbox for everything else via a "更多" entry.
