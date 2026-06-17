# 熔归 RONG GUI v3

智能健身训练应用 — 训练计划、动作库、血糖联动、AI 教练。

## 功能

- **主页**：睡眠/HRV 读数、恢复评分、今日训练入口
- **训练**：Verna 4 周下肢+核心超级组计划，训练前沙盒（防晒/补水/CARs）
- **动作库**：三维筛选 + 动作详情（要点、神经唤醒语、修改方案）
- **AI 教练**：基于健康档案的实时建议（需配置 API 密钥）
- **血糖**：餐后血糖记录与步行干预
- **动态跟练**：全屏跟练模式，3-2-1 倒计时，离心/向心节奏环
- **骨骼动画**：动作库与 HUD 内 SVG 动态演示
- **肌肉图谱**：详情页高亮主动肌 / 协同肌
- **氛围音**：雨声 / 低保真 / 森林 / 静谧（Web Audio）+ 组间提示音

## 本地开发

```bash
npm install
npm run sync
npx serve public
```

## 部署到 Vercel

1. 将仓库连接到 [Vercel](https://vercel.com)
2. 在 Project Settings → Environment Variables 添加：
   - `GEMINI_API_KEY`（推荐，[Google AI Studio](https://aistudio.google.com/apikey)）
   - 或 `OPENAI_API_KEY`（备用）
3. 部署：

```bash
npm run deploy
```

健康检查：`GET /api/fitness/health`

AI 教练：`POST /api/fitness/chat` — body: `{ "system": "...", "user": "..." }`

## 仓库

https://github.com/hanbing6228/fitness
