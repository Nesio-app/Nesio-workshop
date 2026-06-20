Calm, tactile button — use for any action; filled `primary` for the one main step, lighter variants for secondary choices.

```jsx
<Button variant="primary">记录这件物品</Button>
<Button variant="soft">稍后再看</Button>
<Button variant="ghost" size="sm">跳过</Button>
```

Variants: `primary` (filled blue) · `secondary` (glass) · `soft` (tonal) · `ghost` (text). Sizes `sm|md|lg`. `tone="risk"` (muted red) only for real safety/expiry actions. `pill`, `full`, `iconLeft`, `iconRight`. Follows the warm-coach rule: always offer a gentle way out (skip / later) as a `soft` or `ghost` sibling.
