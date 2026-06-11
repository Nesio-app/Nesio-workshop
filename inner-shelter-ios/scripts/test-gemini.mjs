#!/usr/bin/env node
/** 本地测试 Google AI 密钥是否有效：GEMINI_API_KEY=AIza... node scripts/test-gemini.mjs */
const key = process.env.GEMINI_API_KEY?.trim();
if (!key) {
  console.error('请先设置: export GEMINI_API_KEY=你的密钥');
  process.exit(1);
}

const models = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash'];

for (const model of models) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: '用中文说你好' }] }],
    }),
  });
  const data = await res.json();
  if (res.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
    console.log('✓ 成功 model:', model);
    console.log(data.candidates[0].content.parts[0].text);
    process.exit(0);
  }
  console.log('✗', model, ':', data?.error?.message || res.status);
}
console.error('\n所有模型都失败。请到 https://aistudio.google.com/apikey 重新创建密钥。');
process.exit(1);
