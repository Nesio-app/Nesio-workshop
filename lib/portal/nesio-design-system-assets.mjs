export const NESIO_DESIGN_SYSTEM_ASSET_VERSION = "nesio-design-system-v0";

export const nesioBrandAssets = Object.freeze({
  // App 实际渲染的是 /icons/ 下的副本(TodayFeed 品牌角标);/assets/logo/ 为设计系统源
  crystal: "/icons/treasurebox.svg",
  pwa192: "/icons/treasurebox-pwa-192.png",
  pwa512: "/icons/treasurebox-pwa-512.png",
  pwa512Maskable: "/icons/treasurebox-pwa-512-maskable.png",
});

export const nesioToolIcons = Object.freeze({
  storage: "/icons/tools/storage.svg",
  plan: "/icons/tools/plan.svg",
  reading: "/icons/tools/reading.svg",
  fitness: "/icons/tools/fitness.svg",
  quiz: "/icons/tools/quiz.svg",
  sanctuary: "/icons/tools/sanctuary.svg",
  psych: "/icons/tools/psych.svg",
  health: "/icons/tools/health.svg",
  finance: "/icons/tools/finance.svg",
  lifesim: "/icons/tools/lifesim.svg",
  secretary: "/icons/tools/secretary.svg",
});

export const moduleIconAliases = Object.freeze({
  inventory: "storage",
  storage: "storage",
  plan: "plan",
  reading: "reading",
  fitness: "fitness",
  quiz: "quiz",
  sanctuary: "sanctuary",
  psychoanalysis: "psych",
  psych: "psych",
  health: "health",
  finance: "finance",
  lifesim: "lifesim",
  secretary: "secretary",
});

export function getNesioToolIcon(moduleId, fallback = "") {
  const iconKey = moduleIconAliases[moduleId] || moduleId;
  return nesioToolIcons[iconKey] || fallback || "";
}

export const nesioAiIcons = Object.freeze({
  claude: "/icons/ai/claude.svg",
  chatgpt: "/icons/ai/chatgpt.svg",
  gemini: "/icons/ai/gemini.svg",
  doubao: "/icons/ai/doubao.svg",
  deepseek: "/icons/ai/deepseek.svg",
  grok: "/icons/ai/grok.svg",
});

export const nesioDesignSystemAssets = Object.freeze({
  version: NESIO_DESIGN_SYSTEM_ASSET_VERSION,
  brand: nesioBrandAssets,
  tools: nesioToolIcons,
  ai: nesioAiIcons,
});
